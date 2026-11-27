/**
 * Admin P1 alerts for overdue unpaid vendor (purchase) invoices.
 * Reappears once per calendar day until the invoice is marked paid.
 */

const { createClient } = require('@supabase/supabase-js');
const {
  ensureDailyRecurringNotification,
  todayYmd,
} = require('./notificationStore');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const SKIP_STATUSES = new Set([
  'paid',
  'extracting',
  'saving',
  'error',
  'cancelled',
  'needs_review',
]);

function daysOverdue(dueDate, today) {
  const due = String(dueDate || '').slice(0, 10);
  if (!due || due >= today) return 0;
  const a = new Date(`${due}T00:00:00.000Z`);
  const b = new Date(`${today}T00:00:00.000Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

async function evaluatePurchaseInvoiceOverdueAlerts() {
  const today = todayYmd();
  const { data: rows, error } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, due_date, total_amount, po_advance_amount, supplier_id, status, review_status, suppliers(name)'
    )
    .not('status', 'eq', 'paid')
    .not('due_date', 'is', null)
    .lt('due_date', today);

  if (error) throw error;

  let created = 0;
  for (const inv of rows || []) {
    if (SKIP_STATUSES.has(String(inv.status || ''))) continue;
    if (inv.review_status === 'needs_review' || inv.review_status === 'superseded') continue;

    const supplierName = inv.suppliers?.name || 'Supplier';
    const total = Number(inv.total_amount) || 0;
    const advance = Number(inv.po_advance_amount) || 0;
    const dueAmt = Math.max(total - advance, 0);
    if (dueAmt <= 0.001) continue;

    const overdueDays = daysOverdue(inv.due_date, today);
    const dayLabel = overdueDays === 1 ? '1 day overdue' : `${overdueDays} days overdue`;

    const result = await ensureDailyRecurringNotification(
      {
        audience: 'admin',
        category: 'finance',
        severity: 'warning',
        priority: 1,
        type: 'purchase_invoice_overdue',
        title: `Overdue purchase invoice ${inv.invoice_number || inv.id}`,
        body: `${supplierName} — ${dayLabel} (due ${inv.due_date}) · ₹${dueAmt.toLocaleString('en-IN', {
          minimumFractionDigits: 2,
        })} still unpaid.`,
        payload: {
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          due_date: inv.due_date,
          supplier_id: inv.supplier_id,
          supplier_name: supplierName,
          days_overdue: overdueDays,
          path: `/purchase-payments?highlightInvoice=${inv.id}${
            inv.supplier_id ? `&supplierId=${inv.supplier_id}` : ''
          }`,
        },
        dedupe_key: `purchase_invoice_overdue:${inv.id}`,
      },
      { today }
    );
    if (result.created || result.revived || result.refreshed) created += 1;
  }

  return { scanned: (rows || []).length, created };
}

module.exports = {
  evaluatePurchaseInvoiceOverdueAlerts,
};
