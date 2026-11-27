/**
 * Admin alerts for overdue sales invoices.
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

function daysOverdue(dueDate, today) {
  const due = String(dueDate || '').slice(0, 10);
  if (!due || due >= today) return 0;
  const a = new Date(`${due}T00:00:00.000Z`);
  const b = new Date(`${today}T00:00:00.000Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

async function evaluateSalesInvoiceOverdueAlerts() {
  const today = todayYmd();
  const { data: rows, error } = await supabase
    .from('sales_invoices')
    .select(
      'id, invoice_number, due_date, total_amount, customer_id, customer_snapshot, payment_terms'
    )
    .eq('status', 'due')
    .not('due_date', 'is', null)
    .lt('due_date', today);

  if (error) throw error;

  let created = 0;
  for (const inv of rows || []) {
    const customerName = inv.customer_snapshot?.name || 'Customer';
    const amount = Number(inv.total_amount || 0);
    const overdueDays = daysOverdue(inv.due_date, today);
    const dayLabel = overdueDays === 1 ? '1 day overdue' : `${overdueDays} days overdue`;

    const result = await ensureDailyRecurringNotification(
      {
        audience: 'admin',
        category: 'finance',
        severity: 'warning',
        priority: 2,
        type: 'invoice_overdue',
        title: `Overdue invoice ${inv.invoice_number || inv.id}`,
        body: `${customerName} — ${dayLabel} (due ${inv.due_date}) · ₹${amount.toLocaleString('en-IN', {
          minimumFractionDigits: 2,
        })} still unpaid.`,
        payload: {
          sales_invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          due_date: inv.due_date,
          customer_id: inv.customer_id,
          days_overdue: overdueDays,
        },
        dedupe_key: `invoice_overdue:${inv.id}`,
      },
      { today }
    );
    if (result.created || result.revived || result.refreshed) created += 1;
  }

  return { scanned: (rows || []).length, created };
}

module.exports = {
  evaluateSalesInvoiceOverdueAlerts,
};
