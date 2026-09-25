/**
 * Admin P2 alerts for purchase / sales invoices not synced to Tally.
 */

const { createClient } = require('@supabase/supabase-js');
const { ensureNotification } = require('./notificationStore');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

function todayYmd(tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isTallyUnsynced(status) {
  return status !== 'synced';
}

async function evaluatePurchaseInvoiceTallyUnsyncedAlerts() {
  const today = todayYmd();
  const { data: rows, error } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, status, review_status, tally_sync_status, tally_sync_error, supplier_id, total_amount, suppliers(name)'
    )
    .not('status', 'in', '("extracting","saving","error","cancelled","needs_review")');

  if (error) throw error;

  let created = 0;
  let scanned = 0;
  for (const inv of rows || []) {
    if (inv.review_status === 'needs_review' || inv.review_status === 'superseded') continue;
    if (!isTallyUnsynced(inv.tally_sync_status)) continue;
    scanned += 1;

    const supplierName = inv.suppliers?.name || 'Supplier';
    const syncLabel = inv.tally_sync_status || 'not started';
    const result = await ensureNotification({
      audience: 'admin',
      category: 'finance',
      severity: 'warning',
      priority: 2,
      type: 'purchase_invoice_tally_unsynced',
      title: `Purchase invoice not Tally synced · ${inv.invoice_number || inv.id}`,
      body: `${supplierName} — Tally status: ${syncLabel}${
        inv.tally_sync_error ? ` · ${inv.tally_sync_error}` : ''
      }. Sync runs when the GIRN is registered.`,
      payload: {
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        supplier_id: inv.supplier_id,
        tally_sync_status: inv.tally_sync_status || null,
        path: `/invoices/${inv.id}`,
      },
      dedupe_key: `purchase_invoice_tally_unsynced:${inv.id}:${today}`,
    });
    if (result.created) created += 1;
  }

  return { scanned, created };
}

async function evaluateSalesInvoiceTallyUnsyncedAlerts() {
  const today = todayYmd();
  const { data: rows, error } = await supabase
    .from('sales_invoices')
    .select(
      'id, invoice_number, status, tally_sync_status, tally_sync_error, customer_id, customer_snapshot, total_amount'
    )
    .in('status', ['due', 'paid']);

  if (error) throw error;

  let created = 0;
  let scanned = 0;
  for (const inv of rows || []) {
    if (!isTallyUnsynced(inv.tally_sync_status)) continue;
    scanned += 1;

    const customerName = inv.customer_snapshot?.name || 'Customer';
    const syncLabel = inv.tally_sync_status || 'not started';
    const result = await ensureNotification({
      audience: 'admin',
      category: 'finance',
      severity: 'warning',
      priority: 2,
      type: 'sales_invoice_tally_unsynced',
      title: `Sales invoice not Tally synced · ${inv.invoice_number || inv.id}`,
      body: `${customerName} — Tally status: ${syncLabel}${
        inv.tally_sync_error ? ` · ${inv.tally_sync_error}` : ''
      }.`,
      payload: {
        sales_invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        customer_id: inv.customer_id,
        tally_sync_status: inv.tally_sync_status || null,
        path: `/sales-invoices/${inv.id}`,
      },
      dedupe_key: `sales_invoice_tally_unsynced:${inv.id}:${today}`,
    });
    if (result.created) created += 1;
  }

  return { scanned, created };
}

module.exports = {
  evaluatePurchaseInvoiceTallyUnsyncedAlerts,
  evaluateSalesInvoiceTallyUnsyncedAlerts,
};
