const { createClient } = require('@supabase/supabase-js');
const { getInvoice } = require('./invoiceOcrEngine');

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

  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: paidAt.toISOString(),
      payment_reference: txnId,
      payment_deduction: deduction || null,
      payment_remarks: remarks || null,
      payment_recorded_by: actorId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw httpError(error.message, 500);
  return getInvoice(id);
}

module.exports = {
  recordVendorInvoicePayment,
};
