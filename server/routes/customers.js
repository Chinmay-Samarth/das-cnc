const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

const CUSTOMER_FIELDS = [
  'name',
  'official_address',
  'billing_address',
  'gstin',
  'pan_no',
  'contact_person',
  'contact_phone',
  'bank_name',
  'account_no',
  'account_type',
  'ifsc',
  'payment_terms',
];

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

function cleanText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function buildCustomerPayload(body, { partial = false } = {}) {
  const payload = {};

  CUSTOMER_FIELDS.forEach((field) => {
    if (body[field] === undefined) return;
    payload[field] = cleanText(body[field]);
  });

  if (payload.gstin) payload.gstin = payload.gstin.toUpperCase();
  if (payload.pan_no) payload.pan_no = payload.pan_no.toUpperCase();
  if (payload.ifsc) payload.ifsc = payload.ifsc.toUpperCase();

  if (!partial && !payload.name) {
    return { error: 'name is required' };
  }

  if (partial && Object.prototype.hasOwnProperty.call(payload, 'name') && !payload.name) {
    return { error: 'name is required' };
  }

  return { payload };
}

function toCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    official_address: row.official_address,
    billing_address: row.billing_address,
    gstin: row.gstin,
    pan_no: row.pan_no,
    contact_person: row.contact_person,
    contact_phone: row.contact_phone,
    bank_name: row.bank_name,
    account_no: row.account_no,
    account_type: row.account_type,
    ifsc: row.ifsc,
    payment_terms: row.payment_terms,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function customerErrorMessage(err, fallback) {
  if (err?.code === '23514') {
    if (String(err.message || '').includes('customers_gstin_format')) {
      return 'GSTIN format is invalid';
    }
    if (String(err.message || '').includes('customers_pan_format')) {
      return 'PAN format is invalid';
    }
    if (String(err.message || '').includes('customers_ifsc_format')) {
      return 'IFSC format is invalid';
    }
  }

  return fallback;
}

router.get('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    return res.json({ customers: (data || []).map(toCustomer) });
  } catch (err) {
    console.error('Customer list error:', err);
    return res.status(500).json({ error: 'Unable to load customers' });
  }
});

router.get('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    return res.json({ customer: toCustomer(data) });
  } catch (err) {
    console.error('Customer detail error:', err);
    return res.status(500).json({ error: 'Unable to load customer details' });
  }
});

router.post('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const { payload, error: payloadError } = buildCustomerPayload(req.body);
    if (payloadError) {
      return res.status(400).json({ error: payloadError });
    }

    if (payload.gstin) {
      const { data: existing, error: checkError } = await supabase
        .from('customers')
        .select('id')
        .eq('gstin', payload.gstin)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') throw checkError;
      if (existing) {
        return res.status(409).json({ error: 'Customer GSTIN already exists' });
      }
    }

    const { data, error } = await supabase
      .from('customers')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      message: 'Customer created successfully',
      customer: toCustomer(data),
    });
  } catch (err) {
    console.error('Customer creation error:', err);
    return res.status(500).json({ error: customerErrorMessage(err, 'Unable to create customer') });
  }
});

router.put('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const { payload, error: payloadError } = buildCustomerPayload(req.body, { partial: true });
    if (payloadError) {
      return res.status(400).json({ error: payloadError });
    }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided to update' });
    }

    if (payload.gstin) {
      const { data: existing, error: checkError } = await supabase
        .from('customers')
        .select('id')
        .eq('gstin', payload.gstin)
        .neq('id', req.params.id)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') throw checkError;
      if (existing) {
        return res.status(409).json({ error: 'Customer GSTIN already exists' });
      }
    }

    const { data, error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      message: 'Customer updated successfully',
      customer: toCustomer(data),
    });
  } catch (err) {
    console.error('Customer update error:', err);
    return res.status(500).json({ error: customerErrorMessage(err, 'Unable to update customer') });
  }
});

module.exports = router;
