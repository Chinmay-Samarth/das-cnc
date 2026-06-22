const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

function normalizeRole(role) {
  return String(role || '').toUpperCase();
}

function computeAccessLevel(role) {
  const normalized = normalizeRole(role);

  if (normalized.includes('ADMIN')) return 'ADMIN';
  if (normalized.includes('MANAGER')) return 'MANAGER';
  if (normalized.includes('SUPERVISOR')) return 'SUPERVISOR';
  return 'OPERATOR';
}

async function verifyPassword(password, employee) {
  // Supports either hashed passwords or temporary plain-text passwords.
  if (employee.password_hash) {
    return bcrypt.compare(password, employee.password_hash);
  }

  if (employee.password) {
    return password === employee.password;
  }

  return false;
}

function issueToken(employee) {
  return jwt.sign(
    {
      sub: employee.id,
      employee_code: employee.employee_code,
      role: employee.role,
      access_level: computeAccessLevel(employee.role),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

router.post('/login', async (req, res) => {
  try {
    const { employeeCode, password } = req.body || {};

    if (!employeeCode || !password) {
      return res.status(400).json({
        error: 'employeeCode and password are required',
      });
    }

    const normalizedCode = String(employeeCode).trim().toUpperCase();

    const { data: employee, error } = await supabase
      .from('employees')
      .select(`*,
        departments(name),
        shifts(name)
      `)
      .eq('employee_code', normalizedCode)
      .single();

    if (error || !employee || !employee.is_active) {
      return res.status(401).json({ error: 'Invalid employee code or password' });
    }

    const validPassword = await verifyPassword(password, employee);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid employee code or password' });
    }

    const token = issueToken(employee);

    return res.json({
      token,
      employee: {
        id: employee.id,
        employee_code: employee.employee_code,
        full_name: employee.full_name,
        role: employee.role,
        access_level: computeAccessLevel(employee.role),
        department: employee.departments?.name || null,
        shift_name: employee.shifts?.name || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const employeeId = decoded?.sub;

    if (!employeeId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { data: employee, error } = await supabase
      .from('employees')
      .select('id, employee_code, full_name, role, is_active, departments(name), shifts(name)')
      .eq('id', employeeId)
      .single();

    if (error || !employee || !employee.is_active) {
      return res.status(401).json({ error: 'Invalid token user' });
    }

    return res.json({
      employee: {
        id: employee.id,
        employee_code: employee.employee_code,
        full_name: employee.full_name,
        role: employee.role,
        access_level: computeAccessLevel(employee.role),
        department: employee.departments?.name || null,
        shift_name: employee.shifts?.name || null,
      },
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router;
