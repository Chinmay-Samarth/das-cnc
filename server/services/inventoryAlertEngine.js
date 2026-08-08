/**
 * Inventory delivery alerts — critical shortage when today's or tomorrow's
 * schedules need more on-hand component stock than available.
 */

const { createClient } = require('@supabase/supabase-js');
const { sumFgStock } = require('./campaignRankingEngine');
const { ensureNotification } = require('./notificationStore');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';

function todayDateString(tz = TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

function addDaysYmd(ymd, delta) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Alert when on-hand FG stock < required qty for schedules due on `dueDate`.
 */
async function evaluateStockShortagesForDueDate(dueDate, { today } = {}) {
  const { data: schedules, error } = await supabase
    .from('delivery_schedules')
    .select('id, due_date, quantity, status, schedule_number, blanket_po_line_id')
    .eq('due_date', dueDate)
    .in('status', ['planned', 'released']);
  if (error) throw error;

  if (!schedules?.length) return 0;

  const lineIds = [...new Set(schedules.map((s) => s.blanket_po_line_id).filter(Boolean))];
  const { data: lines, error: lErr } = await supabase
    .from('blanket_po_lines')
    .select('id, master_record_id')
    .in('id', lineIds);
  if (lErr) throw lErr;

  const lineById = Object.fromEntries((lines || []).map((l) => [l.id, l]));
  const byComponent = new Map();

  for (const sched of schedules) {
    const line = lineById[sched.blanket_po_line_id];
    const masterId = line?.master_record_id;
    if (!masterId) continue;

    if (!byComponent.has(masterId)) {
      byComponent.set(masterId, {
        master_record_id: masterId,
        required_qty: 0,
        schedule_ids: [],
        schedule_numbers: [],
      });
    }
    const bucket = byComponent.get(masterId);
    bucket.required_qty += toNumber(sched.quantity);
    bucket.schedule_ids.push(sched.id);
    if (sched.schedule_number) bucket.schedule_numbers.push(sched.schedule_number);
  }

  const recordIds = [...byComponent.keys()];
  const { data: lookups } = recordIds.length
    ? await supabase.from('v_master_lookup').select('record_id, label').in('record_id', recordIds)
    : { data: [] };
  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));

  const isToday = dueDate === today;
  const dayLabel = isToday ? 'today' : 'tomorrow';
  let created = 0;

  for (const bucket of byComponent.values()) {
    const onHand = await sumFgStock(bucket.master_record_id);
    if (onHand >= bucket.required_qty) continue;

    const shortfall = Math.max(0, bucket.required_qty - onHand);
    const label = labelById[bucket.master_record_id] || 'Component';
    const result = await ensureNotification({
      category: 'inventory',
      type: 'insufficient_stock',
      severity: 'critical',
      priority: 1,
      title: `Insufficient stock for ${dayLabel}'s delivery`,
      body: `${label}: need ${bucket.required_qty}, on hand ${onHand} (short ${shortfall}) for delivery ${dueDate}.`,
      dedupe_key: `inv:short:${bucket.master_record_id}:${dueDate}`,
      payload: {
        master_record_id: bucket.master_record_id,
        component_label: label,
        due_date: dueDate,
        required_qty: bucket.required_qty,
        on_hand_qty: onHand,
        shortfall_qty: shortfall,
        schedule_ids: bucket.schedule_ids,
        schedule_numbers: bucket.schedule_numbers,
        day: dayLabel,
      },
    });
    if (result.created) created += 1;
  }

  return created;
}

/**
 * Critical alerts for shortages on deliveries due today and tomorrow.
 */
async function evaluateTomorrowDeliveryStockAlerts() {
  const today = todayDateString();
  const tomorrow = addDaysYmd(today, 1);

  const todayCreated = await evaluateStockShortagesForDueDate(today, { today });
  const tomorrowCreated = await evaluateStockShortagesForDueDate(tomorrow, { today });
  const total = todayCreated + tomorrowCreated;

  return {
    ok: true,
    due_dates: [today, tomorrow],
    created: {
      insufficient_stock: total,
      today: todayCreated,
      tomorrow: tomorrowCreated,
      total,
    },
    evaluated_at: new Date().toISOString(),
  };
}

module.exports = {
  evaluateTomorrowDeliveryStockAlerts,
  evaluateStockShortagesForDueDate,
  todayDateString,
};
