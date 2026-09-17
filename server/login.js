const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { computeAccessLevel } = require('./utils/accessLevel');
const {
  verifyPassword,
  setEmployeePassword,
  lazyUpgradePlaintextPassword,
  assertPasswordPolicy,
} = require('./services/passwordService');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

const authSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

function issueToken(employee) {
  return jwt.sign(
    {
      sub: employee.id,
      employee_code: employee.employee_code,
      job_description: employee.job_description,
      access_level: computeAccessLevel(employee.job_description),
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function employeePublicPayload(employee) {
  return {
    id: employee.id,
    employee_code: employee.employee_code,
    full_name: employee.full_name,
    job_description: employee.job_description,
    access_level: computeAccessLevel(employee.job_description),
    is_active: employee.is_active !== false,
    must_change_password: Boolean(employee.must_change_password),
    department: employee.departments?.name || employee.department || null,
    shift_name: employee.shifts?.name || employee.shift_name || null,
  };
}

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    const token = authHeader.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.post('/login', authSensitiveLimiter, async (req, res) => {
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

    if (error || !employee) {
      return res.status(401).json({ error: 'Invalid employee code or password' });
    }

    if (employee.is_active === false) {
      return res.status(403).json({ error: 'Account is inactive. Contact an administrator.' });
    }

    const validPassword = await verifyPassword(password, employee);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid employee code or password' });
    }

    await lazyUpgradePlaintextPassword(employee, password);

    const token = issueToken(employee);

    return res.json({
      token,
      employee: employeePublicPayload(employee),
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
      .select(
        'id, employee_code, full_name, job_description, is_active, must_change_password, departments(name), shifts(name)'
      )
      .eq('id', employeeId)
      .single();

    if (error || !employee) {
      return res.status(401).json({ error: 'Invalid token user' });
    }

    if (employee.is_active === false) {
      return res.status(403).json({ error: 'Account is inactive' });
    }

    return res.json({
      employee: employeePublicPayload(employee),
    });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

router.post('/change-password', authSensitiveLimiter, verifyEmployeeAuth, async (req, res) => {
  try {
    const employeeId = req.user?.sub;
    if (!employeeId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!newPassword) {
      return res.status(400).json({ error: 'newPassword is required' });
    }

    if (confirmPassword != null && String(confirmPassword) !== String(newPassword)) {
      return res.status(400).json({ error: 'New password and confirmation do not match' });
    }

    try {
      assertPasswordPolicy(newPassword);
    } catch (policyErr) {
      return res.status(policyErr.status || 400).json({ error: policyErr.message });
    }

    const { data: employee, error } = await supabase
      .from('employees')
      .select('id, password, password_hash, must_change_password, is_active')
      .eq('id', employeeId)
      .maybeSingle();

    if (error || !employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    if (employee.is_active === false) {
      return res.status(403).json({ error: 'Account is inactive' });
    }

    const mustChange = Boolean(employee.must_change_password);
    if (!mustChange) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'currentPassword is required' });
      }
      const ok = await verifyPassword(currentPassword, employee);
      if (!ok) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    await setEmployeePassword(employeeId, newPassword, { mustChange: false });

    return res.json({
      message: 'Password updated successfully',
      employee: { id: employeeId, must_change_password: false },
    });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Unable to change password' });
  }
});

module.exports = router;
