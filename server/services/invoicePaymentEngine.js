const { createClient } = require('@supabase/supabase-js');
const { getInvoice } = require('./invoiceOcrEngine');
const { isValidExpenseType } = require('../config/tallyLedgers');
const { assertReadyForTallySync } = require('./tallyPurchaseVoucher');
const {
  syncPaymentVoucherForInvoice,
  syncPaymentVoucherForInvoices,
  amountDueAfterAdvance,
} = require('./tallyPaymentVoucher');
const { isTallyEnabled } = require('./tallyClient');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NON_PAYABLE_STATUSES = new Set([
  'paid',
  'extracting',
  'saving',
  'error',
  'cancelled',
]);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidUUID(value) {
  return UUID_RE.test(String(value || ''));
}

function cleanText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isPayableInvoice(inv) {
  if (!inv) return false;
  if (NON_PAYABLE_STATUSES.has(String(inv.status || ''))) return false;
  if (inv.review_status === 'needs_review' || inv.status === 'needs_review') return false;
  if (inv.review_status === 'superseded') return false;
  return true;
}

function normalizeExpenseType(value) {
  const raw = cleanText(value);
  if (!raw) return null;
  if (!isValidExpenseType(raw)) {
    throw httpError(
      'tally_expense_ledger_type must be labour, labour_service, consumable, raw_material, or spares_and_tools'
    );
  }
  return raw;
}

async function resolvePoAdvanceForInvoice(invoiceId) {
  const { data: po } = await supabase
    .from('purchase_orders')
    .select('id, advance_amount, po_number')
    .eq('invoice_id', invoiceId)
    .maybeSingle();

  if (po && Number(po.advance_amount) > 0) {
    return {
      po_id: po.id,
      po_number: po.po_number,
      advance_amount: round2(po.advance_amount),
    };
  }

  // Fallback: GIRN-linked PO
  const { data: girn } = await supabase
    .from('girns')
    .select('purchase_order_id')
    .eq('invoice_id', invoiceId)
    .not('purchase_order_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (girn?.purchase_order_id) {
    const { data: po2 } = await supabase
      .from('purchase_orders')
      .select('id, advance_amount, po_number')
      .eq('id', girn.purchase_order_id)
      .maybeSingle();
    if (po2 && Number(po2.advance_amount) > 0) {
      return {
        po_id: po2.id,
        po_number: po2.po_number,
        advance_amount: round2(po2.advance_amount),
      };
    }
  }

  return { po_id: null, po_number: null, advance_amount: 0 };
}

async function updateInvoiceTallyFields(id, body = {}) {
  const inv = await getInvoice(id);
  if (!inv) throw httpError('Invoice not found', 404);

  const patch = {};
  if (body.tally_expense_ledger_type !== undefined) {
    patch.tally_expense_ledger_type = normalizeExpenseType(body.tally_expense_ledger_type);
  }

  if (Object.keys(patch).length === 0) {
    throw httpError('No valid fields to update');
  }

  patch.updated_at = new Date().toISOString();

  const { error } = await supabase.from('invoices').update(patch).eq('id', id);
  if (error) throw httpError(error.message, 500);

  return getInvoice(id);
}

async function persistPaymentSyncResult(id, result) {
  const { error } = await supabase
    .from('invoices')
    .update({
      tally_payment_sync_status: result.status,
      tally_payment_sync_error: result.error || null,
      tally_payment_synced_at: result.syncedAt || null,
      tally_payment_voucher_number: result.voucherNumber || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Unable to persist Tally payment sync status:', error.message);
  }
}

async function recordVendorInvoicePayment(id, actorId, body = {}) {
  const inv = await getInvoice(id);
  if (!inv) throw httpError('Invoice not found', 404);

  if (['extracting', 'saving', 'error'].includes(inv.status)) {
    throw httpError('Invoice is still processing and cannot be marked paid', 409);
  }
  if (inv.status === 'paid') {
    throw httpError('Invoice is already paid', 409);
  }

  const txnId = cleanText(body.transaction_id || body.reference);
  if (!txnId) throw httpError('transaction_id / reference is required');

  const paidAt = body.paid_at ? new Date(body.paid_at) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw httpError('Invalid paid_at date');

  const bankLedger = cleanText(body.bank_ledger || body.payment_bank_ledger);
  if (isTallyEnabled() && !bankLedger) {
    throw httpError('bank_ledger is required when Tally sync is enabled', 422);
  }

  const poAdvance = await resolvePoAdvanceForInvoice(id);
  const billTotal = round2(inv.total_amount);
  const advanceAmount = round2(
    Math.min(poAdvance.advance_amount || Number(inv.po_advance_amount) || 0, billTotal)
  );
  const amountDue = round2(Math.max(billTotal - advanceAmount, 0));

  // Optional override still accepted but default is full settlement of remaining
  const amount =
    body.amount != null && body.amount !== ''
      ? round2(body.amount)
      : amountDue;

  if (amountDue > 0 && amount < amountDue - 0.001) {
    throw httpError(
      `Payment must cover the remaining amount after advance (₹${amountDue})`,
      422
    );
  }

  const paidPatch = {
    status: 'paid',
    paid_at: paidAt.toISOString(),
    payment_reference: txnId,
    payment_deduction: null,
    payment_remarks: null,
    payment_recorded_by: actorId || null,
    payment_bank_ledger: bankLedger || null,
    po_advance_amount: advanceAmount || null,
    updated_at: new Date().toISOString(),
  };

  if (isTallyEnabled()) {
    paidPatch.tally_payment_sync_status = 'pending';
    paidPatch.tally_payment_sync_error = null;
  }

  const { error } = await supabase.from('invoices').update(paidPatch).eq('id', id);
  if (error) throw httpError(error.message, 500);

  const { syncPoPaidFromInvoice } = require('./purchaseOrderEngine');
  await syncPoPaidFromInvoice(id).catch((e) =>
    console.error('PO paid sync failed:', e.message)
  );

  const paidInvoice = await getInvoice(id);
  const supplier = paidInvoice.suppliers || inv.suppliers || null;

  if (isTallyEnabled()) {
    const syncResult = await syncPaymentVoucherForInvoice(paidInvoice, supplier, {
      bankLedger,
      amount: amountDue,
      reference: txnId,
    });
    await persistPaymentSyncResult(id, syncResult);
    return getInvoice(id);
  }

  await persistPaymentSyncResult(id, {
    status: 'skipped',
    error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
    voucherNumber: null,
    syncedAt: null,
  });

  return getInvoice(id);
}

/** Retry Purchase voucher (for GIRN-time sync failures). */
async function retryVendorInvoicePurchaseSync(id) {
  const { syncPurchaseVoucherForInvoice } = require('./tallyPurchaseVoucher');
  const inv = await getInvoice(id);
  if (!inv) throw httpError('Invoice not found', 404);

  const supplier = inv.suppliers || null;

  if (!isTallyEnabled()) {
    await supabase
      .from('invoices')
      .update({
        tally_sync_status: 'skipped',
        tally_sync_error: 'TALLY_ENABLED is not true',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return getInvoice(id);
  }

  const block = assertReadyForTallySync(inv, supplier);
  if (block) throw httpError(block, 422);

  if (inv.tally_sync_status === 'synced') {
    return inv;
  }

  await supabase
    .from('invoices')
    .update({
      tally_sync_status: 'pending',
      tally_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  const syncResult = await syncPurchaseVoucherForInvoice(inv, supplier);
  await supabase
    .from('invoices')
    .update({
      tally_sync_status: syncResult.status,
      tally_sync_error: syncResult.error || null,
      tally_synced_at: syncResult.syncedAt || null,
      tally_voucher_number: syncResult.voucherNumber || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  return getInvoice(id);
}

/** Retry Payment voucher for a paid invoice. */
async function retryVendorInvoicePaymentSync(id) {
  const inv = await getInvoice(id);
  if (!inv) throw httpError('Invoice not found', 404);
  if (inv.status !== 'paid') {
    throw httpError('Only paid invoices can sync Payment vouchers to Tally', 409);
  }

  const supplier = inv.suppliers || null;
  const bankLedger = cleanText(inv.payment_bank_ledger);
  if (isTallyEnabled() && !bankLedger) {
    throw httpError('payment_bank_ledger is missing — record payment with a bank again', 422);
  }

  if (!isTallyEnabled()) {
    await persistPaymentSyncResult(id, {
      status: 'skipped',
      error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
      voucherNumber: null,
      syncedAt: null,
    });
    return getInvoice(id);
  }

  await supabase
    .from('invoices')
    .update({
      tally_payment_sync_status: 'pending',
      tally_payment_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  const billTotal = round2(inv.total_amount);
  const advanceAmount = round2(Math.min(Number(inv.po_advance_amount) || 0, billTotal));
  const amountDue = round2(Math.max(billTotal - advanceAmount, 0));

  const syncResult = await syncPaymentVoucherForInvoice(inv, supplier, {
    bankLedger,
    amount: amountDue,
    reference: inv.payment_reference,
  });
  await persistPaymentSyncResult(id, syncResult);
  return getInvoice(id);
}

/** @deprecated use retryVendorInvoicePaymentSync or retryVendorInvoicePurchaseSync */
async function retryVendorInvoiceTallySync(id, { kind } = {}) {
  if (kind === 'purchase') return retryVendorInvoicePurchaseSync(id);
  return retryVendorInvoicePaymentSync(id);
}

/**
 * List unpaid purchase invoices (optionally for one supplier).
 */
async function listPayableInvoices({ supplierId } = {}) {
  let query = supabase
    .from('invoices')
    .select(
      `
      id,
      invoice_number,
      invoice_date,
      due_date,
      total_amount,
      tax_amount,
      base_amount,
      status,
      review_status,
      supplier_id,
      po_advance_amount,
      payment_bank_ledger,
      payment_reference,
      created_at,
      suppliers(id, name, ledger_name, GSTIN)
    `
    )
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (supplierId) {
    if (!isValidUUID(supplierId)) throw httpError('Invalid supplier id');
    query = query.eq('supplier_id', supplierId);
  }

  const { data, error } = await query;
  if (error) throw httpError(error.message, 500);

  return (data || [])
    .filter(isPayableInvoice)
    .map((inv) => {
      const amountDue = amountDueAfterAdvance(inv);
      return {
        ...inv,
        supplier_name: inv.suppliers?.name || null,
        ledger_name: inv.suppliers?.ledger_name || null,
        amount_due: amountDue,
      };
    })
    .filter((inv) => inv.amount_due > 0.001);
}

/**
 * Full-settle several due purchase invoices for one supplier (one Tally Payment).
 */
async function recordBulkVendorPayments(actorId, body = {}) {
  const supplierId = body.supplier_id;
  if (!isValidUUID(supplierId)) throw httpError('supplier_id is required');

  const invoiceIds = [...new Set((body.invoice_ids || []).filter(isValidUUID))];
  if (!invoiceIds.length) throw httpError('invoice_ids is required');

  const txnId = cleanText(body.transaction_id || body.reference);
  if (!txnId) throw httpError('transaction_id / reference is required');

  const bankLedger = cleanText(body.bank_ledger || body.payment_bank_ledger);
  if (isTallyEnabled() && !bankLedger) {
    throw httpError('bank_ledger is required when Tally sync is enabled', 422);
  }

  const { data: supplier, error: supErr } = await supabase
    .from('suppliers')
    .select('*')
    .eq('id', supplierId)
    .maybeSingle();
  if (supErr) throw httpError(supErr.message, 500);
  if (!supplier) throw httpError('Supplier not found', 404);

  if (isTallyEnabled() && !String(supplier.ledger_name || '').trim()) {
    throw httpError(
      'Set ledger name on the supplier before recording payment (Tally sync is enabled)',
      422
    );
  }

  const { data: rows, error } = await supabase
    .from('invoices')
    .select('*')
    .in('id', invoiceIds)
    .eq('supplier_id', supplierId);
  if (error) throw httpError(error.message, 500);

  const invoices = (rows || []).filter(isPayableInvoice);
  if (invoices.length !== invoiceIds.length) {
    throw httpError('All invoices must be unpaid and belong to the supplier', 422);
  }

  // Resolve advances per invoice for amount due
  const enriched = [];
  for (const inv of invoices) {
    const poAdvance = await resolvePoAdvanceForInvoice(inv.id);
    const billTotal = round2(inv.total_amount);
    const advanceAmount = round2(
      Math.min(poAdvance.advance_amount || Number(inv.po_advance_amount) || 0, billTotal)
    );
    const amountDue = round2(Math.max(billTotal - advanceAmount, 0));
    enriched.push({ ...inv, po_advance_amount: advanceAmount, amount_due: amountDue });
  }

  const sum = round2(enriched.reduce((s, inv) => s + inv.amount_due, 0));
  if (!(sum > 0)) {
    throw httpError('Selected invoices have nothing payable after advances', 422);
  }

  const amount = body.amount != null ? round2(body.amount) : sum;
  if (Math.abs(amount - sum) > 0.01) {
    throw httpError(
      `Bulk payment amount must equal selected invoices total due (${sum})`,
      422
    );
  }

  const paidAt = body.paid_at ? new Date(body.paid_at) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw httpError('Invalid paid_at date');
  const paidAtIso = paidAt.toISOString();
  const now = new Date().toISOString();

  for (const inv of enriched) {
    const paidPatch = {
      status: 'paid',
      paid_at: paidAtIso,
      payment_reference: txnId,
      payment_deduction: null,
      payment_remarks: cleanText(body.notes) || 'Bulk payment',
      payment_recorded_by: actorId || null,
      payment_bank_ledger: bankLedger || null,
      po_advance_amount: inv.po_advance_amount || null,
      updated_at: now,
    };
    if (isTallyEnabled()) {
      paidPatch.tally_payment_sync_status = 'pending';
      paidPatch.tally_payment_sync_error = null;
    }
    const { error: upErr } = await supabase
      .from('invoices')
      .update(paidPatch)
      .eq('id', inv.id);
    if (upErr) throw httpError(upErr.message, 500);

    const { syncPoPaidFromInvoice } = require('./purchaseOrderEngine');
    await syncPoPaidFromInvoice(inv.id).catch((e) =>
      console.error('PO paid sync failed:', e.message)
    );
  }

  let paymentResult = {
    status: 'skipped',
    error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
    voucherNumber: null,
    syncedAt: null,
  };

  if (isTallyEnabled()) {
    paymentResult = await syncPaymentVoucherForInvoices(enriched, supplier, {
      bankLedger,
      amount,
      reference: txnId,
    });
  }

  for (const inv of enriched) {
    await persistPaymentSyncResult(inv.id, paymentResult);
  }

  const paid = [];
  for (const inv of enriched) {
    paid.push(await getInvoice(inv.id));
  }

  return {
    invoices: paid,
    payment_sync: paymentResult,
  };
}

module.exports = {
  recordVendorInvoicePayment,
  recordBulkVendorPayments,
  listPayableInvoices,
  updateInvoiceTallyFields,
  retryVendorInvoiceTallySync,
  retryVendorInvoicePurchaseSync,
  retryVendorInvoicePaymentSync,
  resolvePoAdvanceForInvoice,
};
