const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { resolveGirnItems, validateGirnItem } = require('../services/girnItemResolver');
const { extractInvoiceNow } = require('../services/invoiceOcrEngine');
const { ensureSupplier, supplierPayloadFromInvoice } = require('../services/girnSupplierEngine');
const { classifyLineItems } = require('../services/girnItemClassifier');
const { getCategoryConfig, girnNeedsInspection, girnCanAutoApprove } = require('../config/girnCategoryConfig');
const { applyStockForGirn, rollbackStock } = require('../services/girnStockEngine');
const { validateGirnInspection } = require('../services/girnInspectionEngine');
const { assignLotToGirnItem } = require('../services/componentLotEngine');

const router = express.Router();
router.use('/', require('./girn/inspections'));
const upload = multer({ storage: multer.memoryStorage() });

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

async function generateGirnNumber() {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `GIRN-${yyyymm}-`;

  const { data, error } = await supabase
    .from('girns')
    .select('girn_number')
    .ilike('girn_number', `${prefix}%`)
    .order('girn_number', { ascending: false })
    .limit(1);

  if (error) throw error;

  let nextSeq = 1;
  if (data && data.length > 0) {
    const last = data[0].girn_number;
    const parts = last.split('-');
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
  }

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

function toNumber(value) {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

async function loadInspectionsForItems(itemIds = []) {
  if (!itemIds.length) return {};

  const { data: inspections, error } = await supabase
    .from('girn_inspections')
    .select('*')
    .in('girn_item_id', itemIds);

  if (error) throw error;
  if (!inspections?.length) return {};

  const inspectionIds = inspections.map((i) => i.id);
  const [{ data: values }, { data: documents }] = await Promise.all([
    supabase.from('girn_inspection_values').select('*').in('inspection_id', inspectionIds),
    supabase.from('girn_inspection_documents').select('*').in('inspection_id', inspectionIds),
  ]);

  const byItemId = {};
  for (const insp of inspections) {
    byItemId[insp.girn_item_id] = {
      ...insp,
      values: (values || []).filter((v) => v.inspection_id === insp.id),
      documents: (documents || []).filter((d) => d.inspection_id === insp.id),
    };
  }
  return byItemId;
}


function inferRmId(description = '') {
  const match = String(description).match(/\b\d{3,}\b/);
  return match ? match[0] : '';
}

function normalizeOcrGirnItems(lineItems = [], taxItems = []) {
  const rawDefaultVat = toNumber(taxItems[0]?.rate);
  // Normalize rate: if OCR gave a fractional rate (e.g. 0.18), convert to percent (18)
  let defaultVat = rawDefaultVat;
  if (defaultVat > 0 && defaultVat <= 1) {
    defaultVat = defaultVat * 100;
  }

  return lineItems.map((item) => {
    const description = item.description || '';
    const quantity = toNumber(item.quantity);
    const unitRate = toNumber(item.unit_price);
    const fallbackTotal = toNumber(item.total);
    const amount = quantity && unitRate ? quantity * unitRate : fallbackTotal;
    const vatPercentage = defaultVat || 0;
    const vatAmount = amount * (vatPercentage / 100);
    const totalAmount = amount + vatAmount;

    return {
      raw_material_id: null,
      raw_material_label: '',
      rm_id: inferRmId(description),
      rm_code: description,
      grade: '',
      inventory_number: '',
      unit: '',
      quantity,
      unit_rate: unitRate,
      amount,
      vat_percentage: vatPercentage,
      vat_amount: vatAmount,
      total_amount: totalAmount,
    };
  });
}

function mapItemToDbRow(girnId, item) {
  const category = item.item_category || 'raw_material';
  const masterId = item.master_record_id || item.raw_material_id || null;

  return {
    girn_id: girnId,
    item_category: category,
    master_record_id: masterId,
    raw_material_id: category === 'raw_material' ? masterId : item.raw_material_id || null,
    quantity_type: item.quantity_type || getCategoryConfig(category).quantityType,
    item_code: item.item_code || item.rm_id || null,
    item_description: item.item_description || item.rm_code || null,
    lot_number: item.lot_number || null,
    quantity_ok: item.quantity_ok != null ? toNumber(item.quantity_ok) : null,
    quantity_not_ok: item.quantity_not_ok != null ? toNumber(item.quantity_not_ok) : null,
    rm_code: item.rm_code || item.item_code || null,
    grade: item.grade || null,
    inventory_number: item.inventory_number || null,
    unit: item.unit || null,
    quantity: parseFloat(item.quantity) || 0,
    unit_rate: parseFloat(item.unit_rate) || 0,
    amount: parseFloat(item.amount) || 0,
    vat_percentage: parseFloat(item.vat_percentage) || 0,
    vat_amount: parseFloat(item.vat_amount) || 0,
    total_amount: parseFloat(item.total_amount) || 0,
  };
}

async function buildDraftGirnFromInvoice(invoice, employeeId) {
  const supplierFields = supplierPayloadFromInvoice(invoice);
  const baseItems = normalizeOcrGirnItems(invoice.line_items || [], invoice.tax_items || []);
  const classifications = await classifyLineItems(baseItems);

  const items = baseItems.map((item, idx) => {
    const cls = classifications[idx] || {};
    const category = cls.item_category || 'other';
    const cfg = getCategoryConfig(category);

    return {
      ...item,
      item_category: category,
      master_record_id: cls.master_record_id || null,
      master_record_label: cls.master_record_label || '',
      item_code: cls.item_code || item.rm_id || '',
      item_description: cls.item_description || item.rm_code || '',
      quantity_type: cls.quantity_type || cfg.quantityType,
      match_confidence: cls.match_confidence || 'none',
    };
  });

  const grandTotal = items.reduce((sum, item) => sum + toNumber(item.total_amount), 0);

  return {
    invoice_id: invoice.id,
    supplier_id: supplierFields.supplier_id || '',
    supplier_name: supplierFields.name || '',
    supplier_gstin: supplierFields.GSTIN || '',
    supplier_state: supplierFields.state || '',
    supplier_billing_address: supplierFields.billing_address || '',
    received_by: employeeId || '',
    po_reference: invoice.invoice_number || '',
    received_date: invoice.invoice_date || new Date().toISOString().slice(0, 10),
    csr: '',
    notes: invoice.invoice_number ? `Generated from invoice ${invoice.invoice_number}` : 'Generated from scanned invoice',
    grand_total: grandTotal || toNumber(invoice.total_amount),
    items,
  };
}

async function resolveGirnSupplier(body) {
  if (body.supplier_id) {
    return body.supplier_id;
  }

  const supplierId = await ensureSupplier({
    name: body.supplier_name,
    GSTIN: body.supplier_gstin,
    state: body.supplier_state,
    billing_address: body.supplier_billing_address,
  });

  if (supplierId) {
    return supplierId;
  }

  if (!body.invoice_id) {
    return null;
  }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(`*,
      suppliers(
        id,
        name,
        billing_address,
        account_number,
        ifsc,
        GSTIN,
        state
      )`)
    .eq('id', body.invoice_id)
    .maybeSingle();

  if (error) throw error;
  if (!invoice) return null;

  return ensureSupplier(supplierPayloadFromInvoice(invoice));
}

// ─── LIST ──────────────────────────────────────────────────────────────────────
router.get('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('girns')
      .select(`
        id,
        girn_number,
        invoice_id,
        received_date,
        received_by,
        po_reference,
        csr,
        grand_total,
        status,
        notes,
        suppliers ( id, name ),
        invoices ( id, invoice_number, file_url ),
        employees!received_by ( id, full_name, employee_code )
      `)
      .order('received_date', { ascending: false });

    if (error) throw error;

    const girns = (data || []).map((g) => ({
      id: g.id,
      girn_number: g.girn_number,
      invoice_id: g.invoice_id,
      invoice_number: g.invoices?.invoice_number ?? null,
      invoice_file_url: g.invoices?.file_url ?? null,
      received_date: g.received_date,
      received_by: g.received_by,
      received_by_name: g.employees?.full_name ?? null,
      received_by_code: g.employees?.employee_code ?? null,
      po_reference: g.po_reference,
      csr: g.csr,
      grand_total: g.grand_total,
      status: g.status,
      notes: g.notes,
      supplier_id: g.suppliers?.id ?? null,
      supplier_name: g.suppliers?.name ?? null,
    }));

    return res.json({ girns });
  } catch (err) {
    console.error('GIRN list error:', err);
    return res.status(500).json({ error: 'Unable to load GIRNs' });
  }
});

// ─── CREATE ────────────────────────────────────────────────────────────────────
router.post('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const {
      invoice_id,
      supplier_id,
      supplier_name,
      supplier_gstin,
      supplier_state,
      supplier_billing_address,
      received_by,
      po_reference,
      received_date,
      csr,
      notes,
      items = [],
      auto_approve = false,
    } = req.body;

    if (!received_by || !received_date) {
      return res.status(400).json({ error: 'received_by and received_date are required' });
    }

    if (!supplier_id && !String(supplier_name || '').trim() && !String(supplier_gstin || '').trim() && !invoice_id) {
      return res.status(400).json({ error: 'Supplier details are required' });
    }

    const resolvedSupplierId = await resolveGirnSupplier(req.body);
    if (!resolvedSupplierId) {
      return res.status(400).json({ error: 'Unable to resolve supplier from the provided details' });
    }

    if (items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    for (const item of items) {
      const validationError = validateGirnItem(item);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
    }

    const resolvedItems = await resolveGirnItems(items);

    const girnNumber = await generateGirnNumber();

    const grandTotal = resolvedItems.reduce((sum, item) => {
      return sum + (parseFloat(item.total_amount) || 0);
    }, 0);

    const shouldAutoApprove = auto_approve && girnCanAutoApprove(resolvedItems);
    const initialStatus = shouldAutoApprove ? 'approved' : 'draft';

    const { data: newGirn, error: girnError } = await supabase
      .from('girns')
      .insert({
        girn_number: girnNumber,
        invoice_id: invoice_id || null,
        supplier_id: resolvedSupplierId,
        received_by,
        po_reference: po_reference || null,
        received_date,
        csr: csr || null,
        notes: notes || null,
        grand_total: grandTotal,
        status: initialStatus,
      })
      .select()
      .single();

    if (girnError) throw girnError;

    if (resolvedItems.length > 0) {
      const itemRows = resolvedItems.map((item) => mapItemToDbRow(newGirn.id, item));

      const { error: itemsError } = await supabase
        .from('girn_items')
        .insert(itemRows);

      if (itemsError) throw itemsError;
    }

    if (shouldAutoApprove) {
      const { data: insertedItems } = await supabase
        .from('girn_items')
        .select('*')
        .eq('girn_id', newGirn.id);

      try {
        await applyStockForGirn(newGirn.id, insertedItems || []);
      } catch (stockErr) {
        await supabase.from('girn_items').delete().eq('girn_id', newGirn.id);
        await supabase.from('girns').delete().eq('id', newGirn.id);
        throw stockErr;
      }
    }

    return res.status(201).json({
      message: shouldAutoApprove ? 'GIRN registered and approved' : 'GIRN created successfully',
      girn: { ...newGirn, status: initialStatus },
    });
  } catch (err) {
    console.error('GIRN create error:', err);
    const isClientError =
      err.message?.includes('RM ID') ||
      err.message?.includes('raw material') ||
      err.message?.includes('RM Code') ||
      err.message?.includes('Supplier') ||
      err.message?.includes('line item') ||
      err.message?.includes('Master') ||
      err.message?.includes('existing');
    return res.status(isClientError ? 400 : 500).json({
      error: isClientError ? err.message : 'Unable to create GIRN',
    });
  }
});

// ─── EXTRACT INVOICE FOR GIRN REVIEW ──────────────────────────────────────────
router.post('/extract-invoice', verifyEmployeeAuth, upload.single('invoice'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No invoice file uploaded' });
    }

    const { invoice } = await extractInvoiceNow(file);
    const draftGirn = await buildDraftGirnFromInvoice(invoice, req.user?.sub);

    return res.json({
      invoice,
      draft_girn: draftGirn,
    });
  } catch (err) {
    console.dir(err, {depth: null})
    console.error('GIRN invoice extraction error:', err);
    return res.status(500).json({ error: err.message || 'Unable to extract invoice' });
  }
});

// ─── GET SINGLE ────────────────────────────────────────────────────────────────
router.get('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: girn, error: girnError } = await supabase
      .from('girns')
      .select(`
        id,
        girn_number,
        invoice_id,
        received_date,
        received_by,
        po_reference,
        csr,
        grand_total,
        status,
        notes,
        suppliers ( id, name ),
        invoices ( id, invoice_number, file_url ),
        employees!received_by ( id, full_name, employee_code )
      `)
      .eq('id', id)
      .maybeSingle();

    if (girnError) throw girnError;
    if (!girn) return res.status(404).json({ error: 'GIRN not found' });

    const { data: items, error: itemsError } = await supabase
      .from('girn_items')
      .select('*')
      .eq('girn_id', id)
      .order('id', { ascending: true });

    if (itemsError) throw itemsError;

    const itemIds = (items || []).map((i) => i.id);
    const inspectionsByItem = await loadInspectionsForItems(itemIds);

    const masterRecordIds = (items || [])
      .map((i) => i.master_record_id || i.raw_material_id)
      .filter(Boolean);

    let masterLabelMap = {};
    if (masterRecordIds.length > 0) {
      const { data: lookupRows, error: lookupError } = await supabase
        .from('v_master_lookup')
        .select('record_id, label, master_slug')
        .in('record_id', masterRecordIds);

      if (lookupError) throw lookupError;
      masterLabelMap = Object.fromEntries(
        (lookupRows || []).map((row) => [row.record_id, { label: row.label, master_slug: row.master_slug }])
      );
    }

    const itemsWithLogs = (items || []).map((item) => {
      const recordId = item.master_record_id || item.raw_material_id;
      const lookup = masterLabelMap[recordId] || {};
      return {
        ...item,
        master_record_label: lookup.label ?? null,
        raw_material_label: lookup.label ?? null,
        inspection: inspectionsByItem[item.id] || null,
      };
    });

    return res.json({
      girn: {
        ...girn,
        supplier_id: girn.suppliers?.id ?? null,
        supplier_name: girn.suppliers?.name ?? null,
        invoice_number: girn.invoices?.invoice_number ?? null,
        invoice_file_url: girn.invoices?.file_url ?? null,
        received_by_name: girn.employees?.full_name ?? null,
        received_by_code: girn.employees?.employee_code ?? null,
        items: itemsWithLogs,
      },
    });
  } catch (err) {
    console.error('GIRN detail error:', err);
    return res.status(500).json({ error: 'Unable to load GIRN' });
  }
});

// ─── UPDATE ────────────────────────────────────────────────────────────────────
router.put('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchError } = await supabase
      .from('girns')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return res.status(404).json({ error: 'GIRN not found' });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: 'Only draft GIRNs can be edited' });
    }

    const {
      invoice_id,
      supplier_id,
      supplier_name,
      supplier_gstin,
      supplier_state,
      supplier_billing_address,
      received_by,
      po_reference,
      received_date,
      csr,
      notes,
      items = [],
    } = req.body;

    const resolvedSupplierId = supplier_id
      ? supplier_id
      : await resolveGirnSupplier(req.body);

    if (!resolvedSupplierId) {
      return res.status(400).json({ error: 'Unable to resolve supplier from the provided details' });
    }

    if (items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    for (const item of items) {
      const validationError = validateGirnItem(item);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
    }

    const resolvedItems = await resolveGirnItems(items);

    const grandTotal = resolvedItems.reduce((sum, item) => {
      return sum + (parseFloat(item.total_amount) || 0);
    }, 0);

    const { data: updatedGirn, error: updateError } = await supabase
      .from('girns')
      .update({
        supplier_id: resolvedSupplierId,
        invoice_id: invoice_id ?? null,
        received_by: received_by || undefined,
        po_reference: po_reference ?? null,
        received_date: received_date || undefined,
        csr: csr ?? null,
        notes: notes ?? null,
        grand_total: grandTotal,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Replace items — delete existing, re-insert
    const { error: deleteError } = await supabase
      .from('girn_items')
      .delete()
      .eq('girn_id', id);

    if (deleteError) throw deleteError;

    if (resolvedItems.length > 0) {
      const itemRows = resolvedItems.map((item) => mapItemToDbRow(id, item));

      const { error: insertError } = await supabase
        .from('girn_items')
        .insert(itemRows);

      if (insertError) throw insertError;
    }

    return res.json({ message: 'GIRN updated successfully', girn: updatedGirn });
  } catch (err) {
    console.error('GIRN update error:', err);
    const isClientError =
      err.message?.includes('RM ID') ||
      err.message?.includes('raw material') ||
      err.message?.includes('RM Code') ||
      err.message?.includes('Supplier') ||
      err.message?.includes('line item') ||
      err.message?.includes('Master') ||
      err.message?.includes('existing');
    return res.status(isClientError ? 400 : 500).json({
      error: isClientError ? err.message : 'Unable to update GIRN',
    });
  }
});

// ─── SUBMIT FOR INSPECTION ─────────────────────────────────────────────────────
router.post('/:id/submit', verifyEmployeeAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchError } = await supabase
      .from('girns')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return res.status(404).json({ error: 'GIRN not found' });
    if (existing.status !== 'draft') {
      return res.status(409).json({ error: 'Only draft GIRNs can be submitted' });
    }

    const { data: girnItems, error: itemsError } = await supabase
      .from('girn_items')
      .select('item_category')
      .eq('girn_id', id);

    if (itemsError) throw itemsError;

    if (!girnNeedsInspection(girnItems || [])) {
      const { data: fullItems } = await supabase
        .from('girn_items')
        .select('*')
        .eq('girn_id', id);

      const { stockUpdates, ledgerIds } = await applyStockForGirn(id, fullItems || []);

      try {
        const { data: approved, error: approveError } = await supabase
          .from('girns')
          .update({ status: 'approved' })
          .eq('id', id)
          .select()
          .single();

        if (approveError) throw approveError;
        return res.json({ message: 'GIRN approved (no inspection required)', girn: approved });
      } catch (approveErr) {
        await rollbackStock(stockUpdates, ledgerIds);
        throw approveErr;
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('girns')
      .update({ status: 'pending_inspection' })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({ message: 'GIRN submitted for inspection', girn: updated });
  } catch (err) {
    console.error('GIRN submit error:', err);
    return res.status(500).json({ error: 'Unable to submit GIRN' });
  }
});

// ─── APPROVE ───────────────────────────────────────────────────────────────────
router.post('/:id/approve', verifyEmployeeAuth, async (req, res) => {
  const { id } = req.params;
  let stockUpdates = [];
  let ledgerIds = [];

  try {
    const { data: girn, error: girnError } = await supabase
      .from('girns')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (girnError) throw girnError;
    if (!girn) return res.status(404).json({ error: 'GIRN not found' });
    if (girn.status !== 'pending_inspection') {
      return res.status(409).json({ error: 'Only GIRNs pending inspection can be approved' });
    }

    const { data: items, error: itemsError } = await supabase
      .from('girn_items')
      .select('*')
      .eq('girn_id', id);

    if (itemsError) throw itemsError;

    const itemIds = (items || []).map((i) => i.id);
    const inspectionsByItem = await loadInspectionsForItems(itemIds);

    const itemsWithInspections = (items || []).map((item) => ({
      ...item,
      inspection: inspectionsByItem[item.id] || null,
    }));

    const inspectionError = await validateGirnInspection(itemsWithInspections);
    if (inspectionError) {
      return res.status(400).json({ error: inspectionError });
    }

    for (const item of itemsWithInspections) {
      if (
        item.item_category === 'component' &&
        !item.lot_number &&
        item.master_record_id &&
        item.inspection?.overall_result === 'pass'
      ) {
        await assignLotToGirnItem(item.id, item.master_record_id);
        const { data: refreshed } = await supabase
          .from('girn_items')
          .select('lot_number')
          .eq('id', item.id)
          .single();
        item.lot_number = refreshed?.lot_number || item.lot_number;
      }
    }

    const stockResult = await applyStockForGirn(id, itemsWithInspections);
    stockUpdates = stockResult.stockUpdates;
    ledgerIds = stockResult.ledgerIds;

    const { data: approved, error: approveError } = await supabase
      .from('girns')
      .update({ status: 'approved' })
      .eq('id', id)
      .select()
      .single();

    if (approveError) throw approveError;

    return res.json({ message: 'GIRN approved and stock updated', girn: approved });
  } catch (err) {
    console.error('GIRN approve error — rolling back:', err);
    await rollbackStock(stockUpdates, ledgerIds).catch((e) => console.error('Rollback failed:', e));
    return res.status(500).json({ error: err.message || 'Unable to approve GIRN' });
  }
});

// ─── REJECT ────────────────────────────────────────────────────────────────────
router.post('/:id/reject', verifyEmployeeAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from('girns')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) return res.status(404).json({ error: 'GIRN not found' });
    if (existing.status !== 'pending_inspection') {
      return res.status(409).json({ error: 'Only GIRNs pending inspection can be rejected' });
    }

    const updatePayload = { status: 'rejected' };
    if (notes) updatePayload.notes = notes;

    const { data: rejected, error: updateError } = await supabase
      .from('girns')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.json({ message: 'GIRN rejected', girn: rejected });
  } catch (err) {
    console.error('GIRN reject error:', err);
    return res.status(500).json({ error: 'Unable to reject GIRN' });
  }
});

module.exports = router;
