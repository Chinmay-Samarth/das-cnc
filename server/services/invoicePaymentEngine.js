const { createClient } = require('@supabase/supabase-js');
const { getInvoice } = require('./invoiceOcrEngine');
const { isValidExpenseType } = require('../config/tallyLedgers');
const {
  assertReadyForTallySync,
  syncPurchaseVoucherForInvoice,
} = require('./tallyPurchaseVoucher');
const { isTallyEnabled } = require('./tallyClient');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeExpenseType(value) {
  const raw = cleanText(value);
  if (!raw) return null;
  if (!isValidExpenseType(raw)) {
    throw httpError(
      'tally_expense_ledger_type must be labour, labour_service, or raw_material'
    );
  }
  return raw;
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

async function persistTallySyncResult(id, result) {
  const { error } = await supabase
    .from('invoices')
    .update({
      tally_sync_status: result.status,
      tally_sync_error: result.error || null,
      tally_synced_at: result.syncedAt || null,
      tally_voucher_number: result.voucherNumber || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('Unable to persist Tally sync status:', error.message);
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

  const overrideType =
    body.tally_expense_ledger_type !== undefined
      ? normalizeExpenseType(body.tally_expense_ledger_type)
      : undefined;

  const invoiceForTally =
    overrideType !== undefined
      ? { ...inv, tally_expense_ledger_type: overrideType }
      : inv;

  const supplier = inv.suppliers || null;
  const tallyBlockReason = assertReadyForTallySync(invoiceForTally, supplier);
  if (tallyBlockReason) {
    throw httpError(tallyBlockReason, 422);
  }

  const txnId = cleanText(body.transaction_id || body.reference);
  if (!txnId) throw httpError('transaction_id is required');

  const deduction =
    body.deduction == null || body.deduction === ''
      ? 0
      : round2(body.deduction);
  if (!Number.isFinite(deduction) || deduction < 0) {
    throw httpError('deduction must be a non-negative number');
  }

  const billTotal = round2(inv.total_amount);
  const amount =
    body.amount != null && body.amount !== ''
      ? round2(body.amount)
      : round2(billTotal - deduction);

  if (!(amount > 0)) throw httpError('amount must be > 0');
  if (amount + deduction < billTotal - 0.001) {
    throw httpError(
      `Payment plus deduction must cover the full invoice total (${inv.total_amount})`,
      422
    );
  }

  const paidAt = body.paid_at ? new Date(body.paid_at) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw httpError('Invalid paid_at date');

  const remarks = cleanText(body.remarks || body.notes);

  const paidPatch = {
    status: 'paid',
    paid_at: paidAt.toISOString(),
    payment_reference: txnId,
    payment_deduction: deduction || null,
    payment_remarks: remarks || null,
    payment_recorded_by: actorId || null,
    updated_at: new Date().toISOString(),
  };

  if (overrideType !== undefined) {
    paidPatch.tally_expense_ledger_type = overrideType;
  }

  if (isTallyEnabled()) {
    paidPatch.tally_sync_status = 'pending';
    paidPatch.tally_sync_error = null;
  }

  const { error } = await supabase.from('invoices').update(paidPatch).eq('id', id);

  if (error) throw httpError(error.message, 500);

  const { syncPoPaidFromInvoice } = require('./purchaseOrderEngine');
  await syncPoPaidFromInvoice(id).catch((e) =>
    console.error('PO paid sync failed:', e.message)
  );

  const paidInvoice = await getInvoice(id);

  if (isTallyEnabled()) {
    const syncResult = await syncPurchaseVoucherForInvoice(
      paidInvoice,
      paidInvoice.suppliers || supplier
    );
    await persistTallySyncResult(id, syncResult);
    return getInvoice(id);
  }

  await persistTallySyncResult(id, {
    status: 'skipped',
    error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
    voucherNumber: null,
    syncedAt: null,
  });

  return getInvoice(id);
}

async function retryVendorInvoiceTallySync(id) {
  const inv = await getInvoice(id);
  if (!inv) throw httpError('Invoice not found', 404);
  if (inv.status !== 'paid') {
    throw httpError('Only paid invoices can be synced to Tally', 409);
  }

  const supplier = inv.suppliers || null;

  if (!isTallyEnabled()) {
    await persistTallySyncResult(id, {
      status: 'skipped',
      error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
      voucherNumber: null,
      syncedAt: null,
    });
    return getInvoice(id);
  }

  const block = assertReadyForTallySync(inv, supplier);
  if (block) throw httpError(block, 422);

  await supabase
    .from('invoices')
    .update({
      tally_sync_status: 'pending',
      tally_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  const syncResult = await syncPurchaseVoucherForInvoice(inv, supplier);
  await persistTallySyncResult(id, syncResult);
  return getInvoice(id);
}

module.exports = {
  recordVendorInvoicePayment,
  updateInvoiceTallyFields,
  retryVendorInvoiceTallySync,
};
