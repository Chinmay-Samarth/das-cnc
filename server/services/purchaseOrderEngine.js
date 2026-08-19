const { createClient } = require('@supabase/supabase-js');
const {
  loadProcurementMetaForMaster,
  loadSupplierIdForMasterRecord,
  computeOrderQtyWithMoq,
} = require('./masterFieldEngine');
const {
  getActiveCampaignRmRequirements,
  loadOnHandByMasterRecordId,
} = require('./materialRequirementsEngine');
const { dismissReorderNotification } = require('./reorderAlertEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 10000) / 10000;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + toNumber(days));
  return d.toISOString().slice(0, 10);
}

async function nextPoNumber() {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing, error: selErr } = await supabase
      .from('document_sequences')
      .select('last_value')
      .eq('doc_type', 'purchase_order')
      .eq('year', year)
      .maybeSingle();
    if (selErr) throw selErr;

    if (!existing) {
      const { error: insErr } = await supabase
        .from('document_sequences')
        .insert({ doc_type: 'purchase_order', year, last_value: 1 });
      if (!insErr) return `PO-${year}-0001`;
      continue;
    }

    const nextVal = existing.last_value + 1;
    const { data: updated, error: upErr } = await supabase
      .from('document_sequences')
      .update({ last_value: nextVal })
      .eq('doc_type', 'purchase_order')
      .eq('year', year)
      .eq('last_value', existing.last_value)
      .select('last_value')
      .maybeSingle();
    if (upErr) throw upErr;
    if (updated) return `PO-${year}-${String(nextVal).padStart(4, '0')}`;
  }
  throw httpError('Unable to allocate PO number', 500);
}

async function enrichPoHeader(row) {
  if (!row) return null;
  const supplierId = row.supplier_id;
  let supplier = null;
  if (supplierId) {
    const { data } = await supabase.from('suppliers').select('id, name, lead_time_days, credit_period_days').eq('id', supplierId).maybeSingle();
    supplier = data;
  }
  const lines = row.lines || [];
  const totalQty = lines.reduce((s, l) => s + toNumber(l.quantity), 0);
  const receivedQty = lines.reduce((s, l) => s + toNumber(l.received_qty), 0);
  const fulfillmentPct = totalQty > 0 ? round2((receivedQty / totalQty) * 100) : 0;
  return {
    ...row,
    supplier_name: supplier?.name ?? null,
    lead_time_days: supplier?.lead_time_days ?? null,
    credit_period_days: supplier?.credit_period_days ?? null,
    fulfillment_pct: fulfillmentPct,
  };
}

async function loadPoLines(poId) {
  const { data, error } = await supabase
    .from('purchase_order_lines')
    .select('*')
    .eq('purchase_order_id', poId)
    .order('line_no');
  if (error) throw error;
  const lines = data || [];
  if (!lines.length) return [];

  const recordIds = [...new Set(lines.map((l) => l.master_record_id))];
  const { data: lookups } = await supabase
    .from('v_master_lookup')
    .select('record_id, label')
    .in('record_id', recordIds);
  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));

  return lines.map((l) => ({
    ...l,
    item_label: labelById[l.master_record_id] || l.master_record_id,
    open_qty: roundQty(Math.max(0, toNumber(l.quantity) - toNumber(l.received_qty))),
  }));
}

async function getPurchaseOrderById(id, { includeMatch = true } = {}) {
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!po) throw httpError('Purchase order not found', 404);

  const lines = await loadPoLines(id);
  const { data: girns } = await supabase
    .from('girns')
    .select('id, girn_number, status, received_date, grand_total')
    .eq('purchase_order_id', id)
    .order('created_at', { ascending: false });

  let match_exceptions = [];
  if (includeMatch) {
    const { data: ex } = await supabase
      .from('purchase_order_match_exceptions')
      .select('*')
      .eq('purchase_order_id', id)
      .order('created_at', { ascending: false });
    match_exceptions = ex || [];
  }

  return enrichPoHeader({ ...po, lines, girns: girns || [], match_exceptions });
}

async function listPurchaseOrders() {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows = data || [];
  const supplierIds = [...new Set(rows.map((r) => r.supplier_id).filter(Boolean))];
  let supplierMap = new Map();
  if (supplierIds.length) {
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('id, name')
      .in('id', supplierIds);
    supplierMap = new Map((suppliers || []).map((s) => [s.id, s.name]));
  }

  return Promise.all(
    rows.map(async (po) => {
      const lines = await loadPoLines(po.id);
      const totalQty = lines.reduce((s, l) => s + toNumber(l.quantity), 0);
      const receivedQty = lines.reduce((s, l) => s + toNumber(l.received_qty), 0);
      return {
        ...po,
        supplier_name: supplierMap.get(po.supplier_id) || null,
        line_count: lines.length,
        fulfillment_pct: totalQty > 0 ? round2((receivedQty / totalQty) * 100) : 0,
      };
    })
  );
}

function computeLineAmount(qty, rate) {
  return round2(toNumber(qty) * toNumber(rate));
}

async function recomputePoTotal(poId) {
  const lines = await loadPoLines(poId);
  const total = round2(lines.reduce((s, l) => s + toNumber(l.amount), 0));
  await supabase
    .from('purchase_orders')
    .update({ total_amount: total, updated_at: new Date().toISOString() })
    .eq('id', poId);
  return total;
}

async function insertPoWithLines({ supplierId, createdBy, notes, lines, campaignSnapshot, parentPoId }) {
  const poNumber = await nextPoNumber();
  const { data: po, error } = await supabase
    .from('purchase_orders')
    .insert({
      po_number: poNumber,
      supplier_id: supplierId || null,
      status: 'draft',
      match_status: 'pending',
      notes: notes || null,
      campaign_snapshot: campaignSnapshot || null,
      parent_po_id: parentPoId || null,
      created_by: createdBy || null,
      total_amount: 0,
    })
    .select()
    .single();
  if (error) throw error;

  if (lines?.length) {
    const lineRows = lines.map((l, idx) => ({
      purchase_order_id: po.id,
      line_no: idx + 1,
      item_category: l.item_category || 'raw_material',
      master_record_id: l.master_record_id,
      quantity: roundQty(l.quantity),
      unit: l.unit || null,
      unit_rate: toNumber(l.unit_rate) || 0,
      amount: computeLineAmount(l.quantity, l.unit_rate),
      campaign_requirement: toNumber(l.campaign_requirement) || 0,
      moq: toNumber(l.moq) || 0,
      predicted_stockout_date: l.predicted_stockout_date || null,
      lead_time_days: l.lead_time_days != null ? Number(l.lead_time_days) : null,
      trigger_reason: l.trigger_reason || null,
      notes: l.notes || null,
    }));
    const { error: lineErr } = await supabase.from('purchase_order_lines').insert(lineRows);
    if (lineErr) throw lineErr;
    await recomputePoTotal(po.id);
  }

  return getPurchaseOrderById(po.id);
}

async function findOpenDraftForSupplier(supplierId) {
  let query = supabase
    .from('purchase_orders')
    .select('id')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1);
  if (supplierId) query = query.eq('supplier_id', supplierId);
  else query = query.is('supplier_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function upsertLineOnDraft(poId, linePayload) {
  const { data: existing } = await supabase
    .from('purchase_order_lines')
    .select('id, line_no')
    .eq('purchase_order_id', poId)
    .eq('master_record_id', linePayload.master_record_id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('purchase_order_lines')
      .update({
        quantity: roundQty(linePayload.quantity),
        campaign_requirement: toNumber(linePayload.campaign_requirement) || 0,
        moq: toNumber(linePayload.moq) || 0,
        unit: linePayload.unit || null,
        predicted_stockout_date: linePayload.predicted_stockout_date || null,
        lead_time_days: linePayload.lead_time_days ?? null,
        trigger_reason: linePayload.trigger_reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    const { data: maxLine } = await supabase
      .from('purchase_order_lines')
      .select('line_no')
      .eq('purchase_order_id', poId)
      .order('line_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lineNo = (maxLine?.line_no || 0) + 1;
    await supabase.from('purchase_order_lines').insert({
      purchase_order_id: poId,
      line_no: lineNo,
      item_category: linePayload.item_category || 'raw_material',
      master_record_id: linePayload.master_record_id,
      quantity: roundQty(linePayload.quantity),
      unit: linePayload.unit || null,
      unit_rate: toNumber(linePayload.unit_rate) || 0,
      amount: computeLineAmount(linePayload.quantity, linePayload.unit_rate),
      campaign_requirement: toNumber(linePayload.campaign_requirement) || 0,
      moq: toNumber(linePayload.moq) || 0,
      predicted_stockout_date: linePayload.predicted_stockout_date || null,
      lead_time_days: linePayload.lead_time_days ?? null,
      trigger_reason: linePayload.trigger_reason || null,
    });
  }
  await recomputePoTotal(poId);
}

async function buildCampaignLineCandidates() {
  const [campaignMap, onHandMap, metaRows] = await Promise.all([
    getActiveCampaignRmRequirements(),
    loadOnHandByMasterRecordId('raw_material'),
    loadProcurementMetaForMaster('raw-material'),
  ]);

  const metaById = Object.fromEntries(metaRows.map((m) => [m.recordId, m]));
  const candidates = [];

  for (const [recordId, campaignReq] of campaignMap.entries()) {
    const meta = metaById[recordId] || { moq: 0, reorderLevel: 0, label: recordId };
    const stock = onHandMap.get(recordId) || { onHand: 0, unit: 'kg' };
    const netNeed = Math.max(0, toNumber(campaignReq) - stock.onHand);
    const qty = computeOrderQtyWithMoq({
      netNeed,
      moq: meta.moq,
      reorderLevel: meta.reorderLevel,
      onHand: stock.onHand,
      isRawMaterial: true,
    });
    if (qty <= 0) continue;

    const supplierId = await loadSupplierIdForMasterRecord(recordId, 'raw-material');
    candidates.push({
      master_record_id: recordId,
      item_category: 'raw_material',
      quantity: qty,
      campaign_requirement: netNeed,
      moq: toNumber(meta.moq),
      unit: stock.unit || 'kg',
      supplier_id: supplierId,
      item_label: meta.label,
    });
  }

  return candidates;
}

async function generateFromCampaigns(createdBy) {
  const candidates = await buildCampaignLineCandidates();
  if (!candidates.length) {
    return { purchase_orders: [], message: 'No raw material orders needed for active campaigns' };
  }

  const bySupplier = new Map();
  for (const c of candidates) {
    const key = c.supplier_id || '__none__';
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key).push(c);
  }

  const { data: campaigns } = await supabase
    .from('production_campaigns')
    .select('id, master_record_id, target_quantity, good_quantity')
    .eq('status', 'active');
  const campaignSnapshot = { campaigns: campaigns || [], generated_at: new Date().toISOString() };

  const purchase_orders = [];
  for (const [supplierKey, lines] of bySupplier.entries()) {
    const supplierId = supplierKey === '__none__' ? null : supplierKey;
    const po = await insertPoWithLines({
      supplierId,
      createdBy,
      campaignSnapshot,
      lines,
    });
    purchase_orders.push(po);
  }

  return { purchase_orders };
}

async function createFromAlert(payload, createdBy) {
  const {
    master_record_id: masterRecordId,
    item_category: itemCategory = 'raw_material',
    master_slug: masterSlug = 'raw-material',
    suggested_order_qty: suggestedQty,
    moq,
    campaign_requirement: campaignReq,
    unit,
    notification_id: notificationId,
    predicted_stockout_date: predictedStockoutDate,
    lead_time_days: leadTimeDays,
    trigger_reason: triggerReason,
  } = payload || {};

  if (!masterRecordId) throw httpError('master_record_id is required');

  const supplierId = await loadSupplierIdForMasterRecord(
    masterRecordId,
    masterSlug === 'tool' ? 'tool' : 'raw-material'
  );

  let poId = await findOpenDraftForSupplier(supplierId);
  if (!poId) {
    const po = await insertPoWithLines({
      supplierId,
      createdBy,
      lines: [],
    });
    poId = po.id;
  }

  const qty = roundQty(suggestedQty || computeOrderQtyWithMoq({
    netNeed: campaignReq || 0,
    moq,
    reorderLevel: 0,
    onHand: 0,
    isRawMaterial: itemCategory === 'raw_material',
  }));

  await upsertLineOnDraft(poId, {
    master_record_id: masterRecordId,
    item_category: itemCategory,
    quantity: qty,
    moq: toNumber(moq),
    campaign_requirement: toNumber(campaignReq),
    unit: unit || (itemCategory === 'raw_material' ? 'kg' : 'ea'),
    predicted_stockout_date: predictedStockoutDate || null,
    lead_time_days: leadTimeDays ?? null,
    trigger_reason: triggerReason || null,
  });

  if (notificationId) {
    await supabase
      .from('notifications')
      .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
      .eq('id', notificationId);
  }
  await dismissReorderNotification(itemCategory, masterRecordId);

  return getPurchaseOrderById(poId);
}

async function createPurchaseOrder(payload, createdBy) {
  return insertPoWithLines({
    supplierId: payload.supplier_id,
    createdBy,
    notes: payload.notes,
    lines: payload.lines || [],
  });
}

async function updatePurchaseOrder(id, payload) {
  const po = await getPurchaseOrderById(id);
  if (po.status !== 'draft') throw httpError('Only draft POs can be edited', 409);

  const updates = { updated_at: new Date().toISOString() };
  if (payload.supplier_id !== undefined) updates.supplier_id = payload.supplier_id || null;
  if (payload.notes !== undefined) updates.notes = payload.notes || null;

  if (Object.keys(updates).length > 1) {
    const { error } = await supabase.from('purchase_orders').update(updates).eq('id', id);
    if (error) throw error;
  }

  if (Array.isArray(payload.lines)) {
    await supabase.from('purchase_order_lines').delete().eq('purchase_order_id', id);
    const lineRows = payload.lines.map((l, idx) => ({
      purchase_order_id: id,
      line_no: idx + 1,
      item_category: l.item_category || 'raw_material',
      master_record_id: l.master_record_id,
      quantity: roundQty(l.quantity),
      received_qty: 0,
      invoiced_qty: 0,
      unit: l.unit || null,
      unit_rate: toNumber(l.unit_rate) || 0,
      amount: computeLineAmount(l.quantity, l.unit_rate),
      campaign_requirement: toNumber(l.campaign_requirement) || 0,
      moq: toNumber(l.moq) || 0,
      notes: l.notes || null,
    }));
    if (lineRows.length) {
      const { error: lineErr } = await supabase.from('purchase_order_lines').insert(lineRows);
      if (lineErr) throw lineErr;
    }
    await recomputePoTotal(id);
  }

  return getPurchaseOrderById(id);
}

async function sendPurchaseOrder(id) {
  const po = await getPurchaseOrderById(id);
  if (po.status !== 'draft') throw httpError('Only draft POs can be sent', 409);
  if (!po.supplier_id) throw httpError('Supplier is required before sending PO', 400);
  if (!po.lines?.length) throw httpError('PO must have at least one line', 400);

  const { data: supplier } = await supabase
    .from('suppliers')
    .select('lead_time_days, credit_period_days')
    .eq('id', po.supplier_id)
    .maybeSingle();

  const leadDays = supplier?.lead_time_days ?? 7;
  const creditDays = supplier?.credit_period_days ?? 30;
  const sentAt = new Date().toISOString();
  const expectedDelivery = addDays(todayDateString(), leadDays);
  const dueDate = addDays(expectedDelivery, creditDays);

  const { error } = await supabase
    .from('purchase_orders')
    .update({
      status: 'due',
      sent_at: sentAt,
      expected_delivery_date: expectedDelivery,
      due_date: dueDate,
      updated_at: sentAt,
    })
    .eq('id', id);
  if (error) throw error;

  return getPurchaseOrderById(id);
}

async function markPurchaseOrderPaid(id, actorId) {
  const po = await getPurchaseOrderById(id);
  if (po.status === 'paid') throw httpError('PO is already paid', 409);
  if (po.status !== 'due') throw httpError('Only due POs can be marked paid', 409);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('purchase_orders')
    .update({ status: 'paid', paid_at: now, updated_at: now })
    .eq('id', id);
  if (error) throw error;

  if (po.invoice_id) {
    await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: now, updated_at: now })
      .eq('id', po.invoice_id)
      .neq('status', 'paid');
  }

  return getPurchaseOrderById(id);
}

async function syncPoPaidFromInvoice(invoiceId) {
  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('id, status')
    .eq('invoice_id', invoiceId);
  const now = new Date().toISOString();
  for (const po of pos || []) {
    if (po.status === 'paid') continue;
    await supabase
      .from('purchase_orders')
      .update({ status: 'paid', paid_at: now, updated_at: now })
      .eq('id', po.id);
  }
}

async function cancelPurchaseOrder(id) {
  const po = await getPurchaseOrderById(id);
  if (po.status === 'paid') throw httpError('Paid POs cannot be cancelled', 409);
  const hasReceipt = (po.lines || []).some((l) => toNumber(l.received_qty) > 0);
  if (hasReceipt) throw httpError('PO with received goods cannot be cancelled', 409);

  const { error } = await supabase
    .from('purchase_orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
  return getPurchaseOrderById(id);
}

async function splitPurchaseOrder(id, createdBy) {
  const po = await getPurchaseOrderById(id);
  if (po.status !== 'draft') throw httpError('Only draft POs can be split', 409);
  if (!po.lines?.length) throw httpError('PO has no lines to split', 400);
  for (const line of po.lines) {
    if (toNumber(line.quantity) < 2) {
      throw httpError(`Line ${line.line_no} quantity must be at least 2 to split`, 400);
    }
  }

  const halfA = [];
  const halfB = [];
  for (const line of po.lines) {
    const q = toNumber(line.quantity);
    const a = Math.floor(q / 2);
    const b = Math.ceil(q / 2);
    const base = { ...line, quantity: a };
    halfA.push({ ...base, quantity: a });
    halfB.push({ ...base, quantity: b });
  }

  const poA = await insertPoWithLines({
    supplierId: po.supplier_id,
    createdBy,
    notes: `Split from ${po.po_number} (half A)`,
    lines: halfA,
    parentPoId: id,
  });
  const poB = await insertPoWithLines({
    supplierId: po.supplier_id,
    createdBy,
    notes: `Split from ${po.po_number} (half B)`,
    lines: halfB,
    parentPoId: id,
  });

  await supabase
    .from('purchase_orders')
    .update({
      status: 'cancelled',
      notes: `${po.notes || ''}\nSplit into ${poA.po_number} / ${poB.po_number}`.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  return { po_a: poA, po_b: poB, cancelled_id: id };
}

async function linkInvoiceToPo(id, invoiceId) {
  const po = await getPurchaseOrderById(id);
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, total_amount, due_date, supplier_id')
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) throw httpError('Invoice not found', 404);

  const updates = {
    invoice_id: invoiceId,
    updated_at: new Date().toISOString(),
  };
  if (!po.due_date && invoice.due_date) updates.due_date = invoice.due_date;
  if (!po.total_amount && invoice.total_amount) updates.total_amount = invoice.total_amount;

  await supabase.from('purchase_orders').update(updates).eq('id', id);

  const { runThreeWayMatch } = require('./purchaseOrderMatchEngine');
  await runThreeWayMatch(id);

  return getPurchaseOrderById(id);
}

async function buildGirnDraftFromPo(poId) {
  const po = await getPurchaseOrderById(poId);
  if (!po.supplier_id) throw httpError('PO has no supplier assigned', 400);

  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id, name, GSTIN, official_address')
    .eq('id', po.supplier_id)
    .maybeSingle();

  const openLines = (po.lines || []).filter((l) => l.open_qty > 0);
  const items = openLines.map((l) => ({
    item_category: l.item_category,
    master_record_id: l.master_record_id,
    master_record_label: l.item_label,
    purchase_order_line_id: l.id,
    quantity: l.open_qty,
    unit_rate: l.unit_rate || 0,
    unit: l.unit,
  }));

  return {
    purchase_order_id: po.id,
    po_number: po.po_number,
    supplier_id: supplier?.id,
    supplier_name: supplier?.name,
    supplier_gstin: supplier?.GSTIN,
    po_reference: po.po_number,
    received_date: todayDateString(),
    items,
  };
}

async function rollupReceivedQtyFromGirn(girnId) {
  const { data: girn } = await supabase
    .from('girns')
    .select('id, purchase_order_id, status')
    .eq('id', girnId)
    .maybeSingle();
  if (!girn?.purchase_order_id || girn.status !== 'approved') return;

  const { data: girns } = await supabase
    .from('girns')
    .select('id')
    .eq('purchase_order_id', girn.purchase_order_id)
    .eq('status', 'approved');
  const girnIds = (girns || []).map((g) => g.id);
  if (!girnIds.length) return;

  const { data: items } = await supabase
    .from('girn_items')
    .select('purchase_order_line_id, quantity')
    .in('girn_id', girnIds);

  const receivedByLine = {};
  for (const item of items || []) {
    if (!item.purchase_order_line_id) continue;
    receivedByLine[item.purchase_order_line_id] =
      (receivedByLine[item.purchase_order_line_id] || 0) + toNumber(item.quantity);
  }

  const { data: lines } = await supabase
    .from('purchase_order_lines')
    .select('id')
    .eq('purchase_order_id', girn.purchase_order_id);

  for (const line of lines || []) {
    const received = roundQty(receivedByLine[line.id] || 0);
    await supabase
      .from('purchase_order_lines')
      .update({ received_qty: received, updated_at: new Date().toISOString() })
      .eq('id', line.id);
  }

  const { runThreeWayMatch } = require('./purchaseOrderMatchEngine');
  await runThreeWayMatch(girn.purchase_order_id).catch((e) =>
    console.error('Three-way match failed:', e.message)
  );
}

module.exports = {
  listPurchaseOrders,
  getPurchaseOrderById,
  generateFromCampaigns,
  createFromAlert,
  createPurchaseOrder,
  updatePurchaseOrder,
  sendPurchaseOrder,
  markPurchaseOrderPaid,
  syncPoPaidFromInvoice,
  cancelPurchaseOrder,
  splitPurchaseOrder,
  linkInvoiceToPo,
  buildGirnDraftFromPo,
  rollupReceivedQtyFromGirn,
  buildCampaignLineCandidates,
};
