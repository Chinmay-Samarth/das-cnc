const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const STORAGE_BUCKET = 'employee-images';

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function uploadEmployeePhoto(employeeId, file) {
  if (!file) {
    return null;
  }

  const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
  const filePath = `${employeeId}${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData, error: publicUrlError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);

  if (publicUrlError) {
    throw publicUrlError;
  }

  return publicUrlData?.publicUrl || null;
}

function parseBoolean(value) {
  if (value === 'false') return false;
  if (value === 'true') return true;
  return value;
}

router.get('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select(`
        id,
        employee_code,
        full_name,
        role,
        is_active,
        img_url,
        departments(name),
        shifts(name)
      `)
      .eq('is_active', true)
      .order('full_name', { ascending: true });

    if (error) {
      throw error;
    }

    const employees = (data || []).map((employee) => ({
      id: employee.id,
      employee_code: employee.employee_code,
      full_name: employee.full_name,
      role: employee.role,
      department: employee.departments?.name || null,
      shift: employee.shifts?.name || null,
      status: employee.is_active ? 'Active' : 'Inactive',
      is_active: employee.is_active,
      img_url: employee.img_url || null,
    }));

    return res.json({ employees });
  } catch (err) {
    console.error('Employee list error:', err);
    return res.status(500).json({ error: 'Unable to load employees' });
  }
});

router.get('/departments', verifyEmployeeAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return res.json({ departments: data || [] });
  } catch (err) {
    console.error('Departments list error:', err);
    return res.status(500).json({ error: 'Unable to load departments' });
  }
});

router.get('/shifts', verifyEmployeeAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('shifts')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return res.json({ shifts: data || [] });
  } catch (err) {
    console.error('Shifts list error:', err);
    return res.status(500).json({ error: 'Unable to load shifts' });
  }
});

router.get('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const employeeId = req.params.id;
    const { data, error } = await supabase
      .from('employees')
      .select(`
        id,
        employee_code,
        full_name,
        role,
        is_active,
        department_id,
        shift_id,
        created_at,
        img_url,
        departments(name),
        shifts(name)
      `)
      .eq('id', employeeId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const employee = {
      id: data.id,
      employee_code: data.employee_code,
      full_name: data.full_name,
      role: data.role,
      department: data.departments?.name || null,
      shift: data.shifts?.name || null,
      status: data.is_active ? 'Active' : 'Inactive',
      is_active: data.is_active,
      created_at: data.created_at,
      department_id: data.department_id,
      shift_id: data.shift_id,
      img_url: data.img_url || null,
    };

    return res.json({ employee });
  } catch (err) {
    console.error('Employee detail error:', err);
    return res.status(500).json({ error: 'Unable to load employee details' });
  }
});

router.post('/', verifyEmployeeAuth, upload.single('photo'), async (req, res) => {
  try {
    const {
      employee_code,
      full_name,
      role,
      department_id,
      shift_id,
      password,
    } = req.body;

    if (!employee_code || !full_name || !role) {
      return res.status(400).json({
        error: 'employee_code, full_name, and role are required',
      });
    }

    const { data: existing, error: checkError } = await supabase
      .from('employees')
      .select('id')
      .eq('employee_code', employee_code.toUpperCase())
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existing) {
      return res.status(409).json({
        error: 'Employee code already exists',
      });
    }

    const insertPayload = {
      employee_code: employee_code.toUpperCase(),
      full_name,
      role,
      department_id: department_id || null,
      shift_id: shift_id || null,
      password: password || null,
      is_active: true,
    };

    const { data: newEmployee, error: insertError } = await supabase
      .from('employees')
      .insert(insertPayload)
      .select();

    if (insertError) {
      throw insertError;
    }

    const createdEmployee = newEmployee[0];

    if (req.file) {
      const photoUrl = await uploadEmployeePhoto(createdEmployee.id, req.file);
      if (photoUrl) {
        const { error: photoUpdateError } = await supabase
          .from('employees')
          .update({ img_url: photoUrl })
          .eq('id', createdEmployee.id);

        if (photoUpdateError) {
          throw photoUpdateError;
        }

        createdEmployee.img_url = photoUrl;
      }
    }

    return res.status(201).json({
      message: 'Employee created successfully',
      employee: createdEmployee,
    });
  } catch (err) {
    console.error('Employee creation error:', err);
    return res.status(500).json({ error: 'Unable to create employee' });
  }
});

router.put('/:id', verifyEmployeeAuth, upload.single('photo'), async (req, res) => {
  try {
    const employeeId = req.params.id;
    const {
      employee_code,
      full_name,
      role,
      department_id,
      shift_id,
      password,
      is_active,
    } = req.body;

    const updatePayload = {};

    if (employee_code) {
      const { data: existing, error: checkError } = await supabase
        .from('employees')
        .select('id')
        .eq('employee_code', employee_code.toUpperCase())
        .neq('id', employeeId)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      if (existing) {
        return res.status(409).json({ error: 'Employee code already exists' });
      }

      updatePayload.employee_code = employee_code.toUpperCase();
    }

    if (full_name) updatePayload.full_name = full_name;
    if (role) updatePayload.role = role;
    if (department_id !== undefined) updatePayload.department_id = department_id || null;
    if (shift_id !== undefined) updatePayload.shift_id = shift_id || null;
    if (password !== undefined) updatePayload.password = password || null;
    if (is_active !== undefined) updatePayload.is_active = parseBoolean(is_active);

    if (req.file) {
      const photoUrl = await uploadEmployeePhoto(employeeId, req.file);
      if (photoUrl) {
        updatePayload.img_url = photoUrl;
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided to update' });
    }

    const { data: updatedEmployees, error: updateError } = await supabase
      .from('employees')
      .update(updatePayload)
      .eq('id', employeeId)
      .select();

    if (updateError) {
      throw updateError;
    }

    if (!updatedEmployees || updatedEmployees.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    return res.json({
      message: 'Employee updated successfully',
      employee: updatedEmployees[0],
    });
  } catch (err) {
    console.error('Employee update error:', err);
    return res.status(500).json({ error: 'Unable to update employee' });
  }
});

module.exports = router;
