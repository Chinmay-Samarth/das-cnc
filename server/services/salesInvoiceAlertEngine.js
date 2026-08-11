/**
 * Admin alerts for overdue due sales invoices past payment terms / due_date.
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
    const customerName =
      inv.customer_snapshot?.name || 'Customer';
    const result = await ensureNotification({
      audience: 'admin',
      category: 'finance',
      severity: 'warning',
      priority: 2,
      type: 'invoice_overdue',
      title: `Overdue invoice ${inv.invoice_number || inv.id}`,
      body: `${customerName} — due ${inv.due_date} · ₹${Number(inv.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} still unpaid.`,
      payload: {
        sales_invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        due_date: inv.due_date,
        customer_id: inv.customer_id,
      },
      dedupe_key: `invoice_overdue:${inv.id}:${inv.due_date}`,
    });
    if (result.created) created += 1;
  }

  return { scanned: (rows || []).length, created };
}

module.exports = {
  evaluateSalesInvoiceOverdueAlerts,
};
