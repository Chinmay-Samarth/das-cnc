/**
 * Admin P1 alerts for overdue unpaid vendor (purchase) invoices.
 * Daily re-fire via date-scoped dedupe_key.
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

async function evaluatePurchaseInvoiceOverdueAlerts() {
  const today = todayYmd();
  const { data: rows, error } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, due_date, total_amount, po_advance_amount, supplier_id, status, suppliers(name)'
    )
    .not('status', 'eq', 'paid')
    .not('due_date', 'is', null)
    .lt('due_date', today);

  if (error) throw error;

  let created = 0;
  for (const inv of rows || []) {
    if (['extracting', 'saving', 'error', 'cancelled'].includes(inv.status)) continue;

    const supplierName = inv.suppliers?.name || 'Supplier';
    const total = Number(inv.total_amount) || 0;
    const advance = Number(inv.po_advance_amount) || 0;
    const dueAmt = Math.max(total - advance, 0);

    const result = await ensureNotification({
      audience: 'admin',
      category: 'finance',
      severity: 'warning',
      priority: 1,
      type: 'purchase_invoice_overdue',
      title: `Overdue purchase invoice ${inv.invoice_number || inv.id}`,
      body: `${supplierName} — due ${inv.due_date} · ₹${dueAmt.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
      })} still unpaid.`,
      payload: {
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        due_date: inv.due_date,
        supplier_id: inv.supplier_id,
        path: `/invoices/${inv.id}`,
      },
      dedupe_key: `purchase_invoice_overdue:${inv.id}:${today}`,
    });
    if (result.created) created += 1;
  }

  return { scanned: (rows || []).length, created };
}

module.exports = {
  evaluatePurchaseInvoiceOverdueAlerts,
};
