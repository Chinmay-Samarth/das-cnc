const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

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
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function escapeIlike(value) {
  return String(value).replace(/[%_\\]/g, '\\$&');
}

function toResult({ type, typeLabel, id, title, subtitle, path }) {
  return { type, typeLabel, id, title, subtitle: subtitle || '', path };
}

function formatMasterSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function queryData(result, label) {
  if (result.error) {
    console.error(`Global search ${label} query failed:`, result.error.message);
    return [];
  }
  return result.data || [];
}

router.get('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const raw = (req.query.q || '').trim();
    const perType = Math.min(parseInt(req.query.limit, 10) || 5, 10);

    if (!raw || raw.length < 2) {
      return res.json({ results: [] });
    }

    const q = escapeIlike(raw);
    const pattern = `%${q}%`;

    const [
      employeesRes,
      suppliersRes,
      customersRes,
      invoicesRes,
      girnsRes,
      mastersRes,
    ] = await Promise.all([
      supabase
        .from('employees')
        .select('id, full_name, employee_code, job_description')
        .eq('is_active', true)
        .or(`full_name.ilike.${pattern},employee_code.ilike.${pattern},job_description.ilike.${pattern}`)
        .order('full_name', { ascending: true })
        .limit(perType),

      supabase
        .from('suppliers')
        .select('id, name, GSTIN, contact_person')
        .or(`name.ilike.${pattern},GSTIN.ilike.${pattern},contact_person.ilike.${pattern}`)
        .order('name', { ascending: true })
        .limit(perType),

      supabase
        .from('customers')
        .select('id, name, gstin, contact_person')
        .or(`name.ilike.${pattern},gstin.ilike.${pattern},contact_person.ilike.${pattern}`)
        .order('name', { ascending: true })
        .limit(perType),

      supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, total_amount, suppliers(name)')
        .or(`invoice_number.ilike.${pattern}`)
        .order('created_at', { ascending: false })
        .limit(perType),

      supabase
        .from('girns')
        .select('id, girn_number, po_reference, status, suppliers(name)')
        .or(`girn_number.ilike.${pattern},po_reference.ilike.${pattern}`)
        .order('received_date', { ascending: false })
        .limit(perType),

      supabase
        .from('v_master_lookup')
        .select('record_id, label, master_slug')
        .ilike('label', pattern)
        .order('label', { ascending: true })
        .limit(perType),
    ]);

    const results = [];

    for (const row of queryData(employeesRes, 'employees')) {
      results.push(toResult({
        type: 'employee',
        typeLabel: 'Employee',
        id: row.id,
        title: row.full_name,
        subtitle: [row.employee_code, row.job_description].filter(Boolean).join(' · '),
        path: `/employees/${row.id}`,
      }));
    }

    for (const row of queryData(suppliersRes, 'suppliers')) {
      results.push(toResult({
        type: 'supplier',
        typeLabel: 'Supplier',
        id: row.id,
        title: row.name,
        subtitle: [row.GSTIN, row.contact_person].filter(Boolean).join(' · '),
        path: `/suppliers/${row.id}`,
      }));
    }

    for (const row of queryData(customersRes, 'customers')) {
      results.push(toResult({
        type: 'customer',
        typeLabel: 'Customer',
        id: row.id,
        title: row.name,
        subtitle: [row.gstin, row.contact_person].filter(Boolean).join(' · '),
        path: `/customers/${row.id}`,
      }));
    }

    for (const row of queryData(invoicesRes, 'invoices')) {
      results.push(toResult({
        type: 'invoice',
        typeLabel: 'Invoice',
        id: row.id,
        title: row.invoice_number || 'Invoice',
        subtitle: [row.suppliers?.name, row.invoice_date].filter(Boolean).join(' · '),
        path: `/invoices/${row.id}`,
      }));
    }

    for (const row of queryData(girnsRes, 'girns')) {
      results.push(toResult({
        type: 'girn',
        typeLabel: 'GIRN',
        id: row.id,
        title: row.girn_number,
        subtitle: [row.suppliers?.name, row.po_reference, row.status].filter(Boolean).join(' · '),
        path: `/girn/${row.id}`,
      }));
    }

    for (const row of queryData(mastersRes, 'masters')) {
      const masterLabel = formatMasterSlug(row.master_slug);
      results.push(toResult({
        type: 'master',
        typeLabel: masterLabel || 'Master',
        id: row.record_id,
        title: row.label,
        subtitle: masterLabel,
        path: `/masters/${row.master_slug}/records/${row.record_id}`,
      }));
    }

    res.json({ results });
  } catch (err) {
    console.error('Global search failed:', err);
    res.status(500).json({ error: err.message || 'Search failed' });
  }
});

module.exports = router;
