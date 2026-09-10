/**
 * After GIRN register: ensure invoice due_date and post Purchase voucher to Tally.
 */

const { createClient } = require('@supabase/supabase-js');
const { getInvoice } = require('./invoiceOcrEngine');
const {
  assertReadyForTallySync,
  syncPurchaseVoucherForInvoice,
} = require('./tallyPurchaseVoucher');
const { isTallyEnabled } = require('./tallyClient');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DEFAULT_CREDIT_DAYS = 30;

function addDaysYmd(isoDate, days) {
  if (!isoDate) return null;
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

async function ensureInvoiceDueDate(invoiceId) {
  const inv = await getInvoice(invoiceId);
  if (!inv) return null;
  if (inv.due_date) return inv;

  let creditDays = Number(inv.credit_period_days);
  if (!Number.isFinite(creditDays) || creditDays <= 0) {
    const supplierId = inv.supplier_id || inv.suppliers?.id;
    if (supplierId) {
      const { data: supplier } = await supabase
        .from('suppliers')
        .select('credit_period_days')
        .eq('id', supplierId)
        .maybeSingle();
      creditDays = Number(supplier?.credit_period_days);
    }
  }
  if (!Number.isFinite(creditDays) || creditDays <= 0) creditDays = DEFAULT_CREDIT_DAYS;

  const baseDate = inv.invoice_date || new Date().toISOString().slice(0, 10);
  const dueDate = addDaysYmd(baseDate, creditDays);
  if (!dueDate) return inv;

  await supabase
    .from('invoices')
    .update({
      due_date: dueDate,
      credit_period_days: creditDays,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId);

  return getInvoice(invoiceId);
}

async function persistPurchaseSyncResult(id, result) {
  await supabase
    .from('invoices')
    .update({
      tally_sync_status: result.status,
      tally_sync_error: result.error || null,
      tally_synced_at: result.syncedAt || null,
      tally_voucher_number: result.voucherNumber || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}

/**
 * Call after GIRN create/submit when invoice_id is linked.
 * Idempotent if Purchase already synced.
 */
async function syncPurchaseVoucherOnGirnRegister(invoiceId) {
  if (!invoiceId) {
    return { skipped: true, reason: 'no_invoice' };
  }

  let inv = await ensureInvoiceDueDate(invoiceId);
  if (!inv) {
    return { skipped: true, reason: 'invoice_not_found' };
  }

  // Copy PO advance onto invoice for display / payment netting
  try {
    const { data: po } = await supabase
      .from('purchase_orders')
      .select('id, advance_amount')
      .eq('invoice_id', invoiceId)
      .maybeSingle();
    if (po && Number(po.advance_amount) > 0) {
      await supabase
        .from('invoices')
        .update({
          po_advance_amount: Number(po.advance_amount),
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoiceId);
      inv = await getInvoice(invoiceId);
    }
  } catch (e) {
    console.error('PO advance copy to invoice failed:', e.message);
  }

  if (!isTallyEnabled()) {
    await persistPurchaseSyncResult(invoiceId, {
      status: 'skipped',
      error: 'TALLY_ENABLED is not true',
      voucherNumber: null,
      syncedAt: null,
    });
    return { skipped: true, reason: 'tally_disabled', invoice: inv };
  }

  if (inv.tally_sync_status === 'synced') {
    return { skipped: true, reason: 'already_synced', invoice: inv };
  }

  const supplier = inv.suppliers || null;
  const block = assertReadyForTallySync(inv, supplier);
  if (block) {
    const err = new Error(block);
    err.status = 422;
    err.code = 'TALLY_NOT_READY';
    throw err;
  }

  await supabase
    .from('invoices')
    .update({
      tally_sync_status: 'pending',
      tally_sync_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId);

  const syncResult = await syncPurchaseVoucherForInvoice(inv, supplier);
  await persistPurchaseSyncResult(invoiceId, syncResult);
  return { syncResult, invoice: await getInvoice(invoiceId) };
}

module.exports = {
  syncPurchaseVoucherOnGirnRegister,
  ensureInvoiceDueDate,
  DEFAULT_CREDIT_DAYS,
};
