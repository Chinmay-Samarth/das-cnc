/** ISO weekday: 1=Monday … 7=Sunday */
import { formatDisplayDate } from '../utils/dateFormat';

export const WEEKDAYS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' },
];

export function weekdayName(isoWeekday) {
  const n = Number(isoWeekday);
  return WEEKDAYS.find((w) => w.value === n)?.label || null;
}

export function weekdayShort(isoWeekday) {
  const n = Number(isoWeekday);
  return WEEKDAYS.find((w) => w.value === n)?.short || null;
}

/** ISO weekday (1–7) from YYYY-MM-DD using UTC */
export function isoWeekdayFromDate(dateStr) {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).slice(0, 10));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const js = d.getUTCDay(); // 0=Sun
  return js === 0 ? 7 : js;
}

/** Human-readable “when” for a rule (weekday / interval / month day / custom count). */
export function formatRuleWhen(rule) {
  if (!rule) return '';
  const cadence = rule.cadence;
  const interval = Number(rule.interval_weeks) || 1;

  if (cadence === 'weekly') {
    const day = weekdayName(rule.weekday) || `Weekday ${rule.weekday}`;
    if (interval <= 1) return `Every ${day}`;
    const from = rule.anchor_date ? ` (from ${formatDisplayDate(rule.anchor_date)})` : '';
    return `Every ${interval} weeks on ${day}${from}`;
  }
  if (cadence === 'monthly') {
    return `Monthly day ${rule.month_day}`;
  }
  if (cadence === 'custom') {
    const n = Array.isArray(rule.custom_dates)
      ? rule.custom_dates.length
      : Number(rule.custom_date_count) || 0;
    return n ? `Custom (${n} date${n === 1 ? '' : 's'})` : 'Custom';
  }
  return cadence || '';
}

/** Short cadence chip for schedule list rows. */
export function formatScheduleCadence(schedule) {
  if (!schedule) return '';
  const cadence = schedule.rule_cadence;
  if (!cadence) return '';
  const interval = Number(schedule.rule_interval_weeks) || 1;

  if (cadence === 'weekly') {
    const day =
      schedule.rule_weekday_label || weekdayName(schedule.rule_weekday) || null;
    if (interval <= 1) return day ? `weekly ${day}` : 'weekly';
    return day ? `every ${interval} weeks · ${day}` : `every ${interval} weeks`;
  }
  if (cadence === 'monthly') {
    return schedule.rule_month_day != null
      ? `monthly day ${schedule.rule_month_day}`
      : 'monthly';
  }
  if (cadence === 'custom') return 'custom';
  return cadence;
}

export function formatRuleLabel({
  cadence,
  weekday,
  month_day,
  interval_weeks,
  anchor_date,
  custom_dates,
  default_quantity,
  component_label,
} = {}) {
  const when = formatRuleWhen({
    cadence,
    weekday,
    month_day,
    interval_weeks,
    anchor_date,
    custom_dates,
  });
  const parts = [];
  if (component_label) parts.push(component_label);
  if (when) parts.push(when);
  if (default_quantity != null && default_quantity !== '') {
    parts.push(`qty ${default_quantity}`);
  }
  return parts.join(' · ') || 'Rule';
}

export function formatDueLabel(dueDate, weekdayLabel = null) {
  if (!dueDate) return '—';
  const formatted = formatDisplayDate(dueDate);
  const dayName = weekdayLabel || weekdayName(isoWeekdayFromDate(String(dueDate).slice(0, 10)));
  if (dayName && formatted !== '—') return `${dayName}, ${formatted}`;
  return formatted;
}

export function formatScheduleLabel(schedule) {
  if (!schedule) return 'Schedule';
  const due =
    schedule.due_weekday_label ||
    formatDueLabel(schedule.due_date);
  const qty = schedule.quantity != null ? String(schedule.quantity) : null;
  const uom = schedule.uom || 'pcs';
  const parts = [];
  if (schedule.schedule_number) parts.push(schedule.schedule_number);
  if (schedule.component_label) parts.push(schedule.component_label);
  if (due && due !== '—') parts.push(due);
  if (qty) parts.push(`${qty} ${uom}`);
  return parts.join(' · ') || 'Schedule';
}
