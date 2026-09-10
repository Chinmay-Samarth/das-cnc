const { createClient } = require('@supabase/supabase-js');
const { getInvoice } = require('./invoiceOcrEngine');
const { isValidExpenseType } = require('../config/tallyLedgers');
const { assertReadyForTallySync } = require('./tallyPurchaseVoucher');
const {
  syncPaymentVoucherForInvoice,
} = require('./tallyPaymentVoucher');
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

module.exports = {
  recordVendorInvoicePayment,
  updateInvoiceTallyFields,
  retryVendorInvoiceTallySync,
  retryVendorInvoicePurchaseSync,
  retryVendorInvoicePaymentSync,
  resolvePoAdvanceForInvoice,
};
