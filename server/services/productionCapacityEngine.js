function parseDateOnly(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) throw new Error('Invalid date format (YYYY-MM-DD)');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/** Mon–Sat working days (UTC). */
function listWorkingDays(fromStr, toStr) {
  const start = parseDateOnly(fromStr);
  const end = parseDateOnly(toStr);
  if (end < start) return [];
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    if (cursor.getUTCDay() !== 0) days.push(toDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function clampHoursPerDay(hours) {
  const h = toNumber(hours) || 9;
  return Math.min(10, Math.max(8, h));
}

/**
 * Estimate production hours and split target qty into daily pcs from AF standards.
 */
function estimateCampaignCapacity({
  targetQuantity,
  runTimePerUnitMinutes,
  setupTimeMinutes = 0,
  hoursPerDay = 9,
  templatePcsPerDay = null,
}) {
  const target = toNumber(targetQuantity);
  const runMin = toNumber(runTimePerUnitMinutes);
  const setupMin = toNumber(setupTimeMinutes);
  const dayHours = clampHoursPerDay(hoursPerDay);

  if (!(target > 0)) {
    return { error: 'target_quantity must be > 0', totalHours: 0, productionDays: 0, dailyPlan: [] };
  }
  if (!(runMin > 0)) {
    return { error: 'run_time_per_unit_minutes is required', totalHours: 0, productionDays: 0, dailyPlan: [] };
  }

  const setupHours = setupMin / 60;
  const runHours = (target * runMin) / 60;
  const totalHours = setupHours + runHours;
  const productionDays = Math.max(1, Math.ceil(totalHours / dayHours));

  const pcsPerFullDay = templatePcsPerDay
    ? toNumber(templatePcsPerDay)
    : Math.floor((dayHours * 60) / runMin);

  if (!(pcsPerFullDay > 0)) {
    return { error: 'Cannot derive pcs per day from run time', totalHours, productionDays: 0, dailyPlan: [] };
  }

  let remaining = target;
  const dailyPlan = [];

  for (let i = 0; i < productionDays; i++) {
    const isFirst = i === 0;
    const isLast = i === productionDays - 1;
    let dayHoursBudget = dayHours;

    if (isFirst && setupHours > 0) {
      dayHoursBudget = Math.max(0, dayHours - setupHours);
    }

    let dayQty;
    if (isLast) {
      dayQty = Math.round(remaining * 10000) / 10000;
    } else if (isFirst && setupHours > 0) {
      dayQty = Math.min(remaining, Math.floor((dayHoursBudget * 60) / runMin));
    } else {
      dayQty = Math.min(remaining, pcsPerFullDay);
    }

    if (!(dayQty > 0)) dayQty = Math.min(remaining, 0.0001);

    dailyPlan.push({
      day_index: i + 1,
      committed_qty: dayQty,
      hours_budget: isFirst ? dayHours : dayHours,
    });
    remaining = Math.round((remaining - dayQty) * 10000) / 10000;
    if (remaining <= 0) break;
  }

  if (remaining > 0 && dailyPlan.length) {
    dailyPlan[dailyPlan.length - 1].committed_qty =
      Math.round((dailyPlan[dailyPlan.length - 1].committed_qty + remaining) * 10000) / 10000;
  }

  return {
    error: null,
    totalHours: Math.round(totalHours * 100) / 100,
    productionDays: dailyPlan.length,
    pcsPerFullDay,
    setupHours: Math.round(setupHours * 100) / 100,
    runHours: Math.round(runHours * 100) / 100,
    dailyPlan,
  };
}

function addMonths(dateStr, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).slice(0, 10));
  if (!m) throw new Error('Invalid date');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, Number(m[3])));
  return d.toISOString().slice(0, 10);
}

function nextHorizonWindow(horizonEnd, months = 5) {
  const clamped = Math.min(6, Math.max(4, months));
  const start = addMonths(horizonEnd, 0);
  const endDate = new Date(`${start}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const nextStart = endDate.toISOString().slice(0, 10);
  const nextEnd = addMonths(nextStart, clamped);
  return { horizon_start: nextStart, horizon_end: nextEnd };
}

function scheduleCommitmentDates(fromStr, nDays) {
  const end = new Date(`${fromStr}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + Math.max(nDays * 2, 30));
  const working = listWorkingDays(fromStr, end.toISOString().slice(0, 10));
  return working.slice(0, nDays);
}

/**
 * Advance by n working days (Mon–Sat). n=0 returns fromStr.
 * After n production days starting on fromStr, the next start is addDaysWorking(fromStr, n).
 */
function addDaysWorking(fromStr, nWorkingDays) {
  const n = Math.max(0, Math.floor(toNumber(nWorkingDays)));
  if (n === 0) return String(fromStr).slice(0, 10);
  const dates = scheduleCommitmentDates(fromStr, n + 1);
  return dates[Math.min(n, dates.length - 1)] || String(fromStr).slice(0, 10);
}

module.exports = {
  toNumber,
  clampHoursPerDay,
  estimateCampaignCapacity,
  addMonths,
  nextHorizonWindow,
  scheduleCommitmentDates,
  listWorkingDays,
  addDaysWorking,
  parseDateOnly,
  toDateString,
};
