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

async function uploadFile(employeeId, file) {
  if (!file) return null;

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
        job_description,
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
      job_description: employee.job_description,
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
      .select(`*,
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
      job_description: data.job_description,
      department: data.departments?.name || null,
      shift: data.shifts?.name || null,
      status: data.is_active ? 'Active' : 'Inactive',
      is_active: data.is_active,
      created_at: data.created_at,
      department_id: data.department_id,
      shift_id: data.shift_id,
      img_url: data.img_url || null,
      temporary_address: data.temporary_address || null,
      permanent_address: data.permanent_address || null,
      bank_name: data.bank_name || null,
      bank_account_number: data.bank_account_number || null,
      ifsc: data.ifsc || null,
      basic_salary: data.basic_salary || null,
      PA : data.PA || null,
      PT: data.PT || null,
      allowance : data.allowance || null,
      aadhar_url : data.aadhar_url || null,
      marks_card_url : data.marks_card_url || null,
      work_experience_url: data.work_experience_url || null,
      thumb_impression_url : data.thumb_impression_url || null,
      ESI_no: data.ESI_no || null
    };

    return res.json({ employee });
  } catch (err) {
    console.error('Employee detail error:', err);
    return res.status(500).json({ error: 'Unable to load employee details' });
  }
});

router.post('/', verifyEmployeeAuth, upload.fields([
  {name: 'photo', maxCount: 1},
  {name: 'aadhar', maxCount: 1},
  {name: 'marks_card', maxCount: 1},
  {name: 'work_experience', maxCount: 1},
  {name: 'thumb_impression', maxCount: 1},

]), async (req, res) => {
  try {
    const {
      employee_code,
      full_name,
      job_description,
      department_id,
      shift_id,
      password,
      temporary_address,
      permanent_address,
      bank_name,
      bank_account_number,
      ifsc,
      PT,
      basic_salary,
      PA,
      allowance,
      ESI_no
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
      job_description,
      department_id: department_id || null,
      shift_id: shift_id || null,
      password: password || null,
      is_active: true,
      temporary_address: temporary_address|| null,
      permanent_address: permanent_address||null,
      bank_name: bank_name || null,
      bank_account_number: bank_account_number || null,
      ifsc: ifsc || null,
      basic_salary: basic_salary || null,
      PA: PA || null,
      allowance: allowance || null,
      ESI_no
    };

    const { data: newEmployee, error: insertError } = await supabase
      .from('employees')
      .insert(insertPayload)
      .select();

    if (insertError) {
      throw insertError;
    }

    const createdEmployee = newEmployee[0];

    if(req.file){
      const photo = req.files?.photo?.[0]
      const aadhar = req.files?.aadhar?.[0]
      const marksCard = req.files?.marksCard?.[0]
      const workExperience  = req.files?.workExperience?.[0]
      const thumbImpression = req.files?.thumbImpression?.[0]

      const photoUrl = await uploadFile(createdEmployee.id, photo)
      const aadharUrl = await uploadFile(createdEmployee.id, aadhar)
      const markCardUrl = await uploadFile(createdEmployee.id, marksCard)
      const workExperienceUrl = await uploadFile(createdEmployee.id, workExperience)
      const thumbExperienceUrl = await uploadFile(createdEmployee.id, thumbImpression)

      const {error: filesUploadError} = await supabase
      .from('employees')
      .update({ img_url: photoUrl,
        aadhar_url: aadharUrl,
        marks_card_url: markCardUrl,
        work_experience_url: workExperienceUrl,
        thumb_impression_url: thumbExperienceUrl
      })
      .eq('id', createdEmployee.id)

      if (filesUploadError) throw filesUploadError

      createdEmployee.img_url = photoUrl
      createdEmployee.aadhar_url = aadharUrl
      createdEmployee.marks_card_url = markCardUrl
      createdEmployee.work_experience_url = workExperienceUrl
      createdEmployee.thumb_impression_url = thumbExperienceUrl
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

router.put('/:id', verifyEmployeeAuth, upload.fields([
  {name: 'photo', maxCount: 1},
  {name: 'aadhar', maxCount: 1},
  {name: 'marks_card', maxCount: 1},
  {name: 'work_experience', maxCount: 1},
  {name: 'thumb_impression', maxCount: 1},

]), async (req, res) => {
  try {
    const employeeId = req.params.id;
    const {
      employee_code,
      full_name,
      job_description,
      department_id,
      shift_id,
      password,
      is_active,
      ESI_no,
      temporary_address,
      permanent_address,
      bank_name,
      bank_account_number,
      ifsc,
      basic_salary,
      PT,
      PA,
      allowance
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
    if (job_description) updatePayload.job_description = job_description;
    if (department_id !== undefined) updatePayload.department_id = department_id || null;
    if (shift_id !== undefined) updatePayload.shift_id = shift_id || null;
    if (password !== undefined) updatePayload.password = password || null;
    if (is_active !== undefined) updatePayload.is_active = parseBoolean(is_active);
    if(ESI_no !== undefined) updatePayload.ESI_no = ESI_no || null;
    if(temporary_address !== undefined) updatePayload.temporary_address = temporary_address || null;
    if(permanent_address!== undefined) updatePayload.permanent_address = permanent_address || null;
    if(bank_name !== undefined) updatePayload.bank_name = bank_name || null;
    if(bank_account_number !== undefined) updatePayload.bank_account_number = bank_account_number || null;
    if(ifsc !== undefined) updatePayload.ifsc = ifsc || null;
    if(basic_salary!==undefined) updatePayload.basic_salary = basic_salary || null;
    if(PA!==undefined) updatePayload.PA = PA || null;
    if(PT!==undefined) updatePayload.PT = PT || null;
    if (allowance!== undefined) updatePayload.allowance = allowance || null;
    
    const photo = req.files?.photo?.[0];
    const aadhar = req.files?.aadhar?.[0];
    const marksCard = req.files?.marks_card?.[0];
    const workExperience = req.files?.work_experience?.[0];
    const thumbImpression = req.files?.thumb_impression?.[0];

    if (photo) {
      updatePayload.img_url = await uploadEmployeeDocument(
        employeeId,
        photo,
      );
    }

    if (aadhar) {
      updatePayload.aadhar_url = await uploadEmployeeDocument(
        employeeId,
        aadhar,
      );
    }

    if (marksCard) {
      updatePayload.marks_card_url = await uploadEmployeeDocument(
        employeeId,
        marksCard,
      );
    }

    if (workExperience) {
      updatePayload.work_experience_url = await uploadEmployeeDocument(
        employeeId,
        workExperience,

      );
    }

    if (thumbImpression) {
      updatePayload.thumb_impression_url = await uploadEmployeeDocument(
        employeeId,
        thumbImpression,
      );
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
