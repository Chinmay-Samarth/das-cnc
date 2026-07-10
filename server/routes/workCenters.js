const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const {
  isValidUUID,
  listWorkCenters,
  getWorkCenterById,
  listAvailableMachines,
  listMachinesForCenter,
  addMachineToCenter,
  removeMachineFromCenter,
} = require('../services/workCenterEngine');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

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

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('Work center route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

function cleanText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function parseNumber(value, { min, max, field } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = Number(value);
  if (Number.isNaN(num)) {
    const err = new Error(`${field || 'value'} must be a number`);
    err.status = 400;
    throw err;
  }
  if (min != null && num < min) {
    const err = new Error(`${field || 'value'} must be >= ${min}`);
    err.status = 400;
    throw err;
  }
  if (max != null && num > max) {
    const err = new Error(`${field || 'value'} must be <= ${max}`);
    err.status = 400;
    throw err;
  }
  return num;
}

function buildWorkCenterPayload(body, { partial = false } = {}) {
  const payload = {};

  if (body.name !== undefined) payload.name = cleanText(body.name);
  if (body.code !== undefined) payload.code = cleanText(body.code)?.toUpperCase() || null;

  if (body.department_id !== undefined) {
    const deptId = cleanText(body.department_id);
    if (deptId && !isValidUUID(deptId)) {
      return { error: 'Invalid department_id' };
    }
    payload.department_id = deptId || null;
  }

  if (body.overhead_hourly_rate !== undefined) {
    try {
      payload.overhead_hourly_rate = parseNumber(body.overhead_hourly_rate, {
        min: 0,
        field: 'overhead_hourly_rate',
      });
    } catch (err) {
      return { error: err.message };
    }
  }

  if (body.speed !== undefined) {
    try {
      payload.speed = parseNumber(body.speed, { min: 0.0001, field: 'speed' });
    } catch (err) {
      return { error: err.message };
    }
  }

  if (body.efficiency !== undefined) {
    try {
      payload.efficiency = parseNumber(body.efficiency, {
        min: 0.01,
        max: 100,
        field: 'efficiency',
      });
    } catch (err) {
      return { error: err.message };
    }
  }

  if (body.is_active !== undefined) {
    payload.is_active =
      body.is_active === true ||
      body.is_active === 'true' ||
      body.is_active === 1 ||
      body.is_active === '1';
  }

  if (!partial) {
    if (!payload.name) return { error: 'name is required' };
    if (!payload.code) return { error: 'code is required' };
    if (payload.overhead_hourly_rate == null) payload.overhead_hourly_rate = 0;
    if (payload.speed == null) payload.speed = 1;
    if (payload.efficiency == null) payload.efficiency = 100;
    if (payload.is_active === undefined) payload.is_active = true;
  } else {
    if (Object.prototype.hasOwnProperty.call(payload, 'name') && !payload.name) {
      return { error: 'name is required' };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'code') && !payload.code) {
      return { error: 'code is required' };
    }
  }

  return { payload };
}

function dbErrorMessage(err, fallback) {
  if (err?.code === '23505') {
    if (String(err.message || '').includes('work_centers_code') || String(err.details || '').includes('code')) {
      return 'A work center with this code already exists';
    }
    return 'Duplicate value violates a unique constraint';
  }
  if (err?.code === '23514') {
    return 'One or more field values are out of allowed range';
  }
  if (err?.code === '23503') {
    return 'Referenced department or machine does not exist';
  }
  return fallback;
}

// GET /api/work-centers
router.get(
  '/',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    const workCenters = await listWorkCenters();
    return res.json({ work_centers: workCenters });
  })
);

// GET /api/work-centers/lookup?search=
router.get(
  '/lookup',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    const search = (req.query.search || '').trim();
    let query = supabase
      .from('work_centers')
      .select('id, name, code, is_active')
      .eq('is_active', true)
      .order('code', { ascending: true })
      .limit(50);

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json({
      results: (data || []).map((row) => ({
        id: row.id,
        label: `${row.code} — ${row.name}`,
        code: row.code,
        name: row.name,
      })),
    });
  })
);

// GET /api/work-centers/available-machines?search=
router.get(
  '/available-machines',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    const machines = await listAvailableMachines(req.query.search || '');
    return res.json({ machines });
  })
);

// GET /api/work-centers/:id
router.get(
  '/:id',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    const workCenter = await getWorkCenterById(req.params.id);
    return res.json({ work_center: workCenter });
  })
);

// POST /api/work-centers
router.post(
  '/',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    const { payload, error: payloadError } = buildWorkCenterPayload(req.body);
    if (payloadError) {
      return res.status(400).json({ error: payloadError });
    }

    const { data, error } = await supabase
      .from('work_centers')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      return res.status(400).json({ error: dbErrorMessage(error, 'Unable to create work center') });
    }

    const workCenter = await getWorkCenterById(data.id);
    return res.status(201).json({ work_center: workCenter });
  })
);

// PATCH /api/work-centers/:id
router.patch(
  '/:id',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    if (!isValidUUID(req.params.id)) {
      return res.status(400).json({ error: 'Invalid work center id' });
    }

    const { payload, error: payloadError } = buildWorkCenterPayload(req.body, { partial: true });
    if (payloadError) {
      return res.status(400).json({ error: payloadError });
    }

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('work_centers')
      .update(payload)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();

    if (error) {
      return res.status(400).json({ error: dbErrorMessage(error, 'Unable to update work center') });
    }
    if (!data) {
      return res.status(404).json({ error: 'Work center not found' });
    }

    const workCenter = await getWorkCenterById(data.id);
    return res.json({ work_center: workCenter });
  })
);

// DELETE /api/work-centers/:id — soft delete (is_active = false)
router.delete(
  '/:id',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    if (!isValidUUID(req.params.id)) {
      return res.status(400).json({ error: 'Invalid work center id' });
    }

    const { data, error } = await supabase
      .from('work_centers')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ error: 'Work center not found' });
    }

    return res.json({ success: true });
  })
);

// GET /api/work-centers/:id/machines
router.get(
  '/:id/machines',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    if (!isValidUUID(req.params.id)) {
      return res.status(400).json({ error: 'Invalid work center id' });
    }

    // Ensure center exists
    await getWorkCenterById(req.params.id);
    const machines = await listMachinesForCenter(req.params.id);
    return res.json({ machines });
  })
);

// POST /api/work-centers/:id/machines
router.post(
  '/:id/machines',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    if (!isValidUUID(req.params.id)) {
      return res.status(400).json({ error: 'Invalid work center id' });
    }

    const machineRecordId = cleanText(req.body?.machine_record_id);
    if (!machineRecordId) {
      return res.status(400).json({ error: 'machine_record_id is required' });
    }

    const machine = await addMachineToCenter(
      req.params.id,
      machineRecordId,
      req.body?.sequence
    );
    return res.status(201).json({ machine });
  })
);

// DELETE /api/work-centers/:id/machines/:machineRecordId
router.delete(
  '/:id/machines/:machineRecordId',
  verifyEmployeeAuth,
  wrap(async (req, res) => {
    if (!isValidUUID(req.params.id) || !isValidUUID(req.params.machineRecordId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = await removeMachineFromCenter(req.params.id, req.params.machineRecordId);
    return res.json(result);
  })
);

module.exports = router;
