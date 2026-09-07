/**
 * Weekly night-shift roster: assign members per ISO week (Monday start),
 * apply to employees.shift_id on Monday (Night vs Men-Morning).
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const NIGHT_SHIFT_NAME = 'Night';
const DEFAULT_DAY_SHIFT_NAME = 'Men-Morning';
const WEEK_HORIZON = 4; // current + next 3

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing ymd (YYYY-MM-DD). */
function startOfIsoWeekYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 Sun … 6 Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + mondayOffset);
  return dt.toISOString().slice(0, 10);
}

function todayYmdInTimezone(timeZone = process.env.TIMEZONE || 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatWeekLabel(weekStart) {
  const weekEnd = addDaysYmd(weekStart, 6);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  const [ys, ms, ds] = weekStart.split('-').map(Number);
  const [ye, me, de] = weekEnd.split('-').map(Number);
  const startLabel = fmt.format(new Date(Date.UTC(ys, ms - 1, ds)));
  const endLabel = fmt.format(new Date(Date.UTC(ye, me - 1, de)));
  return `${startLabel} – ${endLabel}`;
}

function weekTitle(offset) {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  return `In ${offset} weeks`;
}

function editableWeekStarts(referenceYmd = todayYmdInTimezone()) {
  const currentStart = startOfIsoWeekYmd(referenceYmd);
  return Array.from({ length: WEEK_HORIZON }, (_, i) => addDaysYmd(currentStart, i * 7));
}

async function resolveShiftIds() {
  const { data, error } = await supabase.from('shifts').select('id, name');
  if (error) throw error;
  const byName = Object.fromEntries((data || []).map((s) => [s.name, s.id]));
  const nightId = byName[NIGHT_SHIFT_NAME];
  const menMorningId = byName[DEFAULT_DAY_SHIFT_NAME];
  if (!nightId) {
    const err = new Error(`Shift "${NIGHT_SHIFT_NAME}" not found`);
    err.status = 500;
    throw err;
  }
  if (!menMorningId) {
    const err = new Error(`Shift "${DEFAULT_DAY_SHIFT_NAME}" not found`);
    err.status = 500;
    throw err;
  }
  return { nightId, menMorningId };
}

async function loadMembersForWeek(weekStart) {
  const { data: memberRows, error: memErr } = await supabase
    .from('night_shift_roster_members')
    .select('employee_id')
    .eq('week_start_date', weekStart);

  if (memErr) throw memErr;

  const ids = [...new Set((memberRows || []).map((r) => r.employee_id).filter(Boolean))];
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('employees')
    .select(
      `
      id,
      employee_code,
      full_name,
      is_active,
      departments ( name )
    `
    )
    .in('id', ids)
    .order('full_name', { ascending: true });

  if (error) throw error;

  return (data || []).map((emp) => ({
    id: emp.id,
    employee_code: emp.employee_code,
    full_name: emp.full_name,
    department: emp.departments?.name || null,
    is_active: emp.is_active,
  }));
}

function weekPayload(weekStart, employees, { offset = 0, isCurrent = false } = {}) {
  return {
    week_start: weekStart,
    week_end: addDaysYmd(weekStart, 6),
    label: formatWeekLabel(weekStart),
    title: weekTitle(offset),
    offset,
    is_current: isCurrent,
    employee_count: employees.length,
    employees,
  };
}

async function getRosterOverview(referenceYmd = todayYmdInTimezone()) {
  const starts = editableWeekStarts(referenceYmd);
  const memberLists = await Promise.all(starts.map((ws) => loadMembersForWeek(ws)));
  const weeks = starts.map((ws, offset) =>
    weekPayload(ws, memberLists[offset], { offset, isCurrent: offset === 0 })
  );
  return {
    weeks,
    // Back-compat for any older clients
    current: weeks[0] || null,
    upcoming: weeks[1] || null,
  };
}

async function assertEditableWeek(weekStart, referenceYmd = todayYmdInTimezone()) {
  const allowed = new Set(editableWeekStarts(referenceYmd));
  if (!allowed.has(weekStart)) {
    const err = new Error('Week is outside the editable window (this week + next 3)');
    err.status = 400;
    throw err;
  }
  return {
    isCurrent: weekStart === startOfIsoWeekYmd(referenceYmd),
    offset: editableWeekStarts(referenceYmd).indexOf(weekStart),
  };
}

/**
 * Replace all members for a week in the editable horizon.
 * Current week also syncs employees.shift_id immediately.
 */
async function setWeekRoster(
  weekStart,
  employeeIds,
  { createdBy = null, referenceYmd = todayYmdInTimezone() } = {}
) {
  const ids = [...new Set((employeeIds || []).map(String).filter(Boolean))];
  const { isCurrent, offset } = await assertEditableWeek(weekStart, referenceYmd);

  if (ids.length) {
    const { data: existing, error: empErr } = await supabase
      .from('employees')
      .select('id')
      .in('id', ids)
      .eq('is_active', true);
    if (empErr) throw empErr;
    const valid = new Set((existing || []).map((e) => e.id));
    const missing = ids.filter((id) => !valid.has(id));
    if (missing.length) {
      const err = new Error('One or more employees are invalid or inactive');
      err.status = 400;
      throw err;
    }
  }

  const { error: delErr } = await supabase
    .from('night_shift_roster_members')
    .delete()
    .eq('week_start_date', weekStart);
  if (delErr) throw delErr;

  if (ids.length) {
    const rows = ids.map((employee_id) => ({
      week_start_date: weekStart,
      employee_id,
      created_by: createdBy || null,
    }));
    const { error: insErr } = await supabase.from('night_shift_roster_members').insert(rows);
    if (insErr) throw insErr;
  }

  let applied = null;
  if (isCurrent) {
    applied = await applyWeek(weekStart);
  }

  const employees = await loadMembersForWeek(weekStart);
  return {
    week: weekPayload(weekStart, employees, { offset, isCurrent }),
    applied,
  };
}

/** @deprecated Prefer setWeekRoster — kept for older /upcoming route */
async function setUpcomingRoster(employeeIds, opts = {}) {
  const referenceYmd = opts.referenceYmd || todayYmdInTimezone();
  const upcomingStart = addDaysYmd(startOfIsoWeekYmd(referenceYmd), 7);
  const { week } = await setWeekRoster(upcomingStart, employeeIds, opts);
  return week;
}

/**
 * Apply roster for week_start to employees.shift_id:
 * - roster members → Night
 * - currently on Night but not on roster → Men-Morning
 * Idempotent.
 */
async function applyWeek(weekStart) {
  const start = weekStart || startOfIsoWeekYmd(todayYmdInTimezone());
  const { nightId, menMorningId } = await resolveShiftIds();

  const { data: memberRows, error: memErr } = await supabase
    .from('night_shift_roster_members')
    .select('employee_id')
    .eq('week_start_date', start);
  if (memErr) throw memErr;

  const rosterIds = [...new Set((memberRows || []).map((r) => r.employee_id))];
  const rosterSet = new Set(rosterIds);

  const { data: nightEmployees, error: nightErr } = await supabase
    .from('employees')
    .select('id')
    .eq('shift_id', nightId)
    .eq('is_active', true);
  if (nightErr) throw nightErr;

  const currentlyNight = (nightEmployees || []).map((e) => e.id);
  const toDay = currentlyNight.filter((id) => !rosterSet.has(id));

  let setNight = 0;
  let setDay = 0;

  if (rosterIds.length) {
    const { data, error } = await supabase
      .from('employees')
      .update({ shift_id: nightId })
      .in('id', rosterIds)
      .select('id');
    if (error) throw error;
    setNight = (data || []).length;
  }

  if (toDay.length) {
    const { data, error } = await supabase
      .from('employees')
      .update({ shift_id: menMorningId })
      .in('id', toDay)
      .select('id');
    if (error) throw error;
    setDay = (data || []).length;
  }

  return {
    week_start: start,
    assigned_night: setNight,
    reverted_to_men_morning: setDay,
    roster_count: rosterIds.length,
  };
}

async function applyCurrentWeek() {
  const start = startOfIsoWeekYmd(todayYmdInTimezone());
  return applyWeek(start);
}

module.exports = {
  NIGHT_SHIFT_NAME,
  DEFAULT_DAY_SHIFT_NAME,
  WEEK_HORIZON,
  addDaysYmd,
  startOfIsoWeekYmd,
  todayYmdInTimezone,
  formatWeekLabel,
  editableWeekStarts,
  getRosterOverview,
  setWeekRoster,
  setUpcomingRoster,
  applyWeek,
  applyCurrentWeek,
};
