/** ISO weekday: 1=Monday … 7=Sunday */
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

export function formatRuleWhen(rule) {
  if (!rule) return '';
  if (rule.cadence === 'weekly') {
    return weekdayName(rule.weekday) || `Weekday ${rule.weekday}`;
  }
  if (rule.cadence === 'monthly') {
    return `Day ${rule.month_day}`;
  }
  return rule.cadence || '';
}

export function formatRuleLabel({
  cadence,
  weekday,
  month_day,
  default_quantity,
  component_label,
} = {}) {
  const when = formatRuleWhen({ cadence, weekday, month_day });
  const cadenceLabel = cadence === 'weekly' ? 'Weekly' : cadence === 'monthly' ? 'Monthly' : cadence || '';
  const parts = [];
  if (component_label) parts.push(component_label);
  if (cadenceLabel && when) parts.push(`${cadenceLabel} ${when}`);
  else if (when) parts.push(when);
  else if (cadenceLabel) parts.push(cadenceLabel);
  if (default_quantity != null && default_quantity !== '') {
    parts.push(`qty ${default_quantity}`);
  }
  return parts.join(' · ') || 'Rule';
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatDueLabel(dueDate, weekdayLabel = null) {
  if (!dueDate) return '—';
  const raw = String(dueDate).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return raw;
  const dayName = weekdayLabel || weekdayName(isoWeekdayFromDate(raw));
  const day = Number(m[3]);
  const month = MONTHS_SHORT[Number(m[2]) - 1] || m[2];
  const year = m[1];
  if (dayName) return `${dayName}, ${day} ${month} ${year}`;
  return `${day} ${month} ${year}`;
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
