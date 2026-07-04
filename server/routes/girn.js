const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { resolveGirnItemMaterials } = require('../services/girnRawMaterialEngine');
const { extractInvoiceNow } = require('../services/invoiceOcrEngine');
const { ensureSupplier, supplierPayloadFromInvoice } = require('../services/girnSupplierEngine');

const router = express.Router();
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

function buildDraftGirnFromInvoice(invoice, employeeId) {
  const supplierFields = supplierPayloadFromInvoice(invoice);
  const items = normalizeOcrGirnItems(invoice.line_items || [], invoice.tax_items || []);
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

    if (
      items.some(
        (item) =>
          !item.raw_material_id &&
          (!String(item.rm_id || '').trim() || !String(item.rm_code || '').trim())
      )
    ) {
      return res.status(400).json({
        error: 'Each line item must be linked to a raw material or include both RM ID and RM Code',
      });
    }

    const resolvedItems = await resolveGirnItemMaterials(items);

    const girnNumber = await generateGirnNumber();

    const grandTotal = items.reduce((sum, item) => {
      const total = parseFloat(item.total_amount) || 0;
      return sum + total;
    }, 0);

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
        status: 'draft',
      })
      .select()
      .single();

    if (girnError) throw girnError;

    if (resolvedItems.length > 0) {
      const itemRows = resolvedItems.map((item) => ({
        girn_id: newGirn.id,
        raw_material_id: item.raw_material_id || null,
        rm_code: item.rm_code || null,
        grade: item.grade || null,
        inventory_number: item.inventory_number || null,
        unit: item.unit || null,
        quantity: parseFloat(item.quantity) || 0,
        unit_rate: parseFloat(item.unit_rate) || 0,
        amount: parseFloat(item.amount) || 0,
        vat_percentage: parseFloat(item.vat_percentage) || 0,
        vat_amount: parseFloat(item.vat_amount) || 0,
        total_amount: parseFloat(item.total_amount) || 0,
      }));

      const { error: itemsError } = await supabase
        .from('girn_items')
        .insert(itemRows);

      if (itemsError) throw itemsError;
    }

    return res.status(201).json({ message: 'GIRN created successfully', girn: newGirn });
  } catch (err) {
    console.error('GIRN create error:', err);
    const isClientError =
      err.message?.includes('RM ID') ||
      err.message?.includes('raw material') ||
      err.message?.includes('RM Code') ||
      err.message?.includes('Supplier');
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
    const draftGirn = buildDraftGirnFromInvoice(invoice, req.user?.sub);

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
    let inspectionLogs = [];
    if (itemIds.length > 0) {
      const { data: logs, error: logsError } = await supabase
        .from('girn_inspection_logs')
        .select('*')
        .in('girn_item_id', itemIds);

      if (logsError) throw logsError;
      inspectionLogs = logs || [];
    }

    const rawMaterialIds = (items || [])
      .map((i) => i.raw_material_id)
      .filter(Boolean);

    let rawMaterialLabelMap = {};
    if (rawMaterialIds.length > 0) {
      const { data: lookupRows, error: lookupError } = await supabase
        .from('v_master_lookup')
        .select('record_id, label')
        .in('record_id', rawMaterialIds);

      if (lookupError) throw lookupError;
      rawMaterialLabelMap = Object.fromEntries(
        (lookupRows || []).map((row) => [row.record_id, row.label])
      );
    }

    const itemsWithLogs = (items || []).map((item) => ({
      ...item,
      raw_material_label: rawMaterialLabelMap[item.raw_material_id] ?? null,
      inspection_logs: inspectionLogs.filter((l) => l.girn_item_id === item.id),
    }));

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

    if (
      items.some(
        (item) =>
          !item.raw_material_id &&
          (!String(item.rm_id || '').trim() || !String(item.rm_code || '').trim())
      )
    ) {
      return res.status(400).json({
        error: 'Each line item must be linked to a raw material or include both RM ID and RM Code',
      });
    }

    const resolvedItems = await resolveGirnItemMaterials(items);

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
      const itemRows = resolvedItems.map((item) => ({
        girn_id: id,
        raw_material_id: item.raw_material_id || null,
        rm_code: item.rm_code || null,
        grade: item.grade || null,
        inventory_number: item.inventory_number || null,
        unit: item.unit || null,
        quantity: parseFloat(item.quantity) || 0,
        unit_rate: parseFloat(item.unit_rate) || 0,
        amount: parseFloat(item.amount) || 0,
        vat_percentage: parseFloat(item.vat_percentage) || 0,
        vat_amount: parseFloat(item.vat_amount) || 0,
        total_amount: parseFloat(item.total_amount) || 0,
      }));

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
      err.message?.includes('Supplier');
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

// ─── SAVE INSPECTION LOGS FOR AN ITEM ──────────────────────────────────────────
router.post('/:id/items/:itemId/inspect', verifyEmployeeAuth, async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { checkpoints = [] } = req.body;

    const { data: girn, error: girnError } = await supabase
      .from('girns')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (girnError) throw girnError;
    if (!girn) return res.status(404).json({ error: 'GIRN not found' });
    if (girn.status !== 'pending_inspection') {
      return res.status(409).json({ error: 'Inspection can only be saved when GIRN is pending inspection' });
    }

    const { data: item, error: itemError } = await supabase
      .from('girn_items')
      .select('id')
      .eq('id', itemId)
      .eq('girn_id', id)
      .maybeSingle();

    if (itemError) throw itemError;
    if (!item) return res.status(404).json({ error: 'GIRN item not found' });

    // Delete existing logs for this item then re-insert
    const { error: deleteError } = await supabase
      .from('girn_inspection_logs')
      .delete()
      .eq('girn_item_id', itemId);

    if (deleteError) throw deleteError;

    if (checkpoints.length > 0) {
      const logRows = checkpoints.map((cp) => ({
        girn_item_id: itemId,
        checkpoint: cp.checkpoint,
        standard: cp.standard || null,
        passed: cp.passed === true || cp.passed === 'true',
        inspector_note: cp.inspector_note || null,
      }));

      const { error: insertError } = await supabase
        .from('girn_inspection_logs')
        .insert(logRows);

      if (insertError) throw insertError;
    }

    return res.json({ message: 'Inspection saved successfully' });
  } catch (err) {
    console.error('GIRN inspect error:', err);
    return res.status(500).json({ error: 'Unable to save inspection' });
  }
});

// ─── APPROVE ───────────────────────────────────────────────────────────────────
router.post('/:id/approve', verifyEmployeeAuth, async (req, res) => {
  const { id } = req.params;
  const insertedLedgerIds = [];
  const stockUpdates = [];

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
      .select('id, raw_material_id, quantity, unit')
      .eq('girn_id', id);

    if (itemsError) throw itemsError;

    for (const item of items || []) {
      if (!item.raw_material_id) continue;

      // Upsert raw_material_stock
      const { data: existingStock } = await supabase
        .from('raw_material_stock')
        .select('id, current_stock')
        .eq('raw_material_id', item.raw_material_id)
        .maybeSingle();

      if (existingStock) {
        const newStock = (parseFloat(existingStock.current_stock) || 0) + (parseFloat(item.quantity) || 0);
        const { error: stockUpdateError } = await supabase
          .from('raw_material_stock')
          .update({ current_stock: newStock })
          .eq('id', existingStock.id);

        if (stockUpdateError) throw stockUpdateError;
        stockUpdates.push({ id: existingStock.id, previous: existingStock.current_stock, delta: item.quantity });
      } else {
        const { error: stockInsertError } = await supabase
          .from('raw_material_stock')
          .insert({
            raw_material_id: item.raw_material_id,
            current_stock: parseFloat(item.quantity) || 0,
            unit: item.unit || null,
          });

        if (stockInsertError) throw stockInsertError;
      }

      // Append stock ledger entry
      const { data: ledgerRow, error: ledgerError } = await supabase
        .from('stock_ledger')
        .insert({
          raw_material_id: item.raw_material_id,
          change_qty: parseFloat(item.quantity) || 0,
          reason: 'girn',
          reference_id: id,
          note: `Received via GIRN ${id}`,
        })
        .select('id')
        .single();

      if (ledgerError) throw ledgerError;
      insertedLedgerIds.push(ledgerRow.id);
    }

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

    // Roll back ledger inserts
    if (insertedLedgerIds.length > 0) {
      await supabase
        .from('stock_ledger')
        .delete()
        .in('id', insertedLedgerIds)
        .catch((e) => console.error('Ledger rollback failed:', e));
    }

    // Roll back stock increments
    for (const s of stockUpdates) {
      await supabase
        .from('raw_material_stock')
        .update({ current_stock: s.previous })
        .eq('id', s.id)
        .catch((e) => console.error('Stock rollback failed:', e));
    }

    return res.status(500).json({ error: 'Unable to approve GIRN' });
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
