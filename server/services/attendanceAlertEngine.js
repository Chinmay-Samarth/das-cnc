/**
 * Attendance alert evaluator — creates persisted admin notifications.
 * Rules: missed punch-out (next day), low monthly attendance %, consecutive absences.
 */

const { createClient } = require('@supabase/supabase-js');
const { isWorkforceEmployee } = require('../utils/accessLevel');
const { ensureNotification } = require('./notificationStore');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';
const PRESENT_STATUSES = new Set(['PRESENT', 'COMPLETED', 'LATE', 'HALF_DAY']);
const LEAVE_STATUS = 'LEAVE';
const CONSECUTIVE_ABSENT_DAYS = 3;

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

function monthBounds(ymd) {
  const [y, m] = String(ymd).split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end, year: y, month: m, yyyyMm: `${y}-${String(m).padStart(2, '0')}` };
}

function daysInclusive(fromYmd, toYmd) {
  const out = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

async function getNotificationSettings() {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('*')
    .eq('key', 'default')
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: cErr } = await supabase
    .from('notification_settings')
    .insert({ key: 'default', attendance_pct_threshold: 80 })
    .select('*')
    .single();
  if (cErr) throw cErr;
  return created;
}

async function updateNotificationSettings(patch, actorId = null) {
  const threshold = toNumber(patch.attendance_pct_threshold);
  if (!(threshold >= 0 && threshold <= 100)) {
    const err = new Error('attendance_pct_threshold must be between 0 and 100');
    err.status = 400;
    throw err;
  }

  const { data, error } = await supabase
    .from('notification_settings')
    .upsert(
      {
        key: 'default',
        attendance_pct_threshold: threshold,
        updated_at: new Date().toISOString(),
        updated_by: actorId || null,
      },
      { onConflict: 'key' }
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Missing punch-out: notify the day *after* the open shift.
 * Same-day still-punched-in is not alerted; yesterday (and older lookback) open shifts are.
 * Gated: requires a successful biometric sync stamped today (plant calendar).
 */
async function evaluateOpenPunchOuts(employeesById) {
  const today = todayDateString();
  const yesterday = addDaysYmd(today, -1);
  const lookback = addDaysYmd(today, -7);

  const { data: syncStamp, error: syncErr } = await supabase
    .from('sync_state')
    .select('value')
    .eq('key', 'biometric_last_success_at')
    .maybeSingle();
  if (syncErr) throw syncErr;

  const stampIso = syncStamp?.value || null;
  const stampDay = stampIso
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(stampIso))
    : null;

  if (!stampDay || stampDay < today) {
    return { created: 0, skipped: 'sync_not_completed_today', sync_stamp: stampIso };
  }

  const { data: rows, error } = await supabase
    .from('attendance_records')
    .select('id, employee_id, shift_date, punched_in_at, punched_out_at, status')
    .not('punched_in_at', 'is', null)
    .is('punched_out_at', null)
    .gte('shift_date', lookback)
    .lte('shift_date', yesterday);
  if (error) throw error;

  let created = 0;
  for (const row of rows || []) {
    const emp = employeesById.get(row.employee_id);
    if (!emp) continue;
    const name = emp.full_name || emp.employee_code || 'Employee';
    const result = await ensureNotification({
      category: 'attendance',
      type: 'open_punch_out',
      severity: 'warning',
      priority: 3,
      title: 'Missing punch-out',
      body: `${name} missed punch-out on ${row.shift_date}.`,
      employee_id: row.employee_id,
      dedupe_key: `att:open:${row.employee_id}:${row.shift_date}`,
      payload: {
        employee_id: row.employee_id,
        employee_name: name,
        employee_code: emp.employee_code || null,
        shift_date: row.shift_date,
        attendance_record_id: row.id,
        status: row.status,
        notified_next_day: true,
        sync_verified_at: stampIso,
      },
    });
    if (result.created) created += 1;
  }
  return { created, skipped: null, sync_stamp: stampIso };
}

async function evaluateLowAttendance(employees, threshold) {
  const today = todayDateString();
  const { start, end, yyyyMm } = monthBounds(today);
  const employeeIds = employees.map((e) => e.id);
  if (!employeeIds.length) return 0;

  const { data: records, error } = await supabase
    .from('attendance_records')
    .select('employee_id, shift_date, status')
    .in('employee_id', employeeIds)
    .gte('shift_date', start)
    .lte('shift_date', end);
  if (error) throw error;

  const byEmp = new Map();
  for (const r of records || []) {
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
    byEmp.get(r.employee_id).push(r);
  }

  let created = 0;
  for (const emp of employees) {
    const joinDay = emp.created_at ? String(emp.created_at).slice(0, 10) : start;
    const rangeStart = joinDay > start ? joinDay : start;
    if (rangeStart > today) continue;

    const days = daysInclusive(rangeStart, today <= end ? today : end);
    if (!days.length) continue;

    const attendanceDates = new Set();
    const leaveDates = new Set();
    for (const r of byEmp.get(emp.id) || []) {
      const d = String(r.shift_date).slice(0, 10);
      const status = String(r.status || '').toUpperCase();
      if (PRESENT_STATUSES.has(status)) attendanceDates.add(d);
      if (status === LEAVE_STATUS) leaveDates.add(d);
    }

    // Align with EmployeeDetails summarizeMonth: leave excludes from present but
    // absence = days without attend and without leave. Score = present / totalDays.
    let presentDays = 0;
    for (const d of days) {
      if (attendanceDates.has(d)) presentDays += 1;
    }
    const score = Math.min(100, Math.round((presentDays / days.length) * 100));
    if (score >= threshold) continue;

    const name = emp.full_name || emp.employee_code || 'Employee';
    const result = await ensureNotification({
      category: 'attendance',
      type: 'low_attendance',
      severity: 'warning',
      priority: 3,
      title: 'Low attendance',
      body: `${name} is at ${score}% this month (threshold ${threshold}%).`,
      employee_id: emp.id,
      dedupe_key: `att:low:${emp.id}:${yyyyMm}`,
      payload: {
        employee_id: emp.id,
        employee_name: name,
        employee_code: emp.employee_code || null,
        score,
        threshold,
        present_days: presentDays,
        total_days: days.length,
        month: yyyyMm,
      },
    });
    if (result.created) created += 1;
  }
  return created;
}

async function evaluateConsecutiveAbsent(employees) {
  const today = todayDateString();
  // Need enough lookback to find a 3-day ending streak ending today or recently
  const lookback = addDaysYmd(today, -(CONSECUTIVE_ABSENT_DAYS + 14));
  const employeeIds = employees.map((e) => e.id);
  if (!employeeIds.length) return 0;

  const { data: records, error } = await supabase
    .from('attendance_records')
    .select('employee_id, shift_date, status')
    .in('employee_id', employeeIds)
    .gte('shift_date', lookback)
    .lte('shift_date', today);
  if (error) throw error;

  const statusByEmpDate = new Map();
  for (const r of records || []) {
    const key = `${r.employee_id}|${String(r.shift_date).slice(0, 10)}`;
    statusByEmpDate.set(key, String(r.status || '').toUpperCase());
  }

  const dayWindow = daysInclusive(lookback, today);
  let created = 0;

  for (const emp of employees) {
    const joinDay = emp.created_at ? String(emp.created_at).slice(0, 10) : lookback;
    let streak = 0;
    let streakEnd = null;

    for (const d of dayWindow) {
      if (d < joinDay) {
        streak = 0;
        streakEnd = null;
        continue;
      }
      const status = statusByEmpDate.get(`${emp.id}|${d}`);
      const isPresent = status && PRESENT_STATUSES.has(status);
      const isLeave = status === LEAVE_STATUS;
      if (isPresent || isLeave) {
        streak = 0;
        streakEnd = null;
      } else {
        // Absent: explicit ABSENT, or no row for that day
        streak += 1;
        streakEnd = d;
      }
    }

    if (streak < CONSECUTIVE_ABSENT_DAYS || !streakEnd) continue;

    const streakStart = addDaysYmd(streakEnd, -(CONSECUTIVE_ABSENT_DAYS - 1));
    const name = emp.full_name || emp.employee_code || 'Employee';
    const result = await ensureNotification({
      category: 'attendance',
      type: 'consecutive_absent',
      severity: 'warning',
      priority: 2,
      title: 'Consecutive absences',
      body: `${name} has been absent for ${CONSECUTIVE_ABSENT_DAYS}+ consecutive days (through ${streakEnd}).`,
      employee_id: emp.id,
      dedupe_key: `att:absent3:${emp.id}:${streakEnd}`,
      payload: {
        employee_id: emp.id,
        employee_name: name,
        employee_code: emp.employee_code || null,
        days: streak,
        streak_start: streakStart,
        streak_end: streakEnd,
      },
    });
    if (result.created) created += 1;
  }
  return created;
}

async function evaluateAttendanceAlerts() {
  const settings = await getNotificationSettings();
  const threshold = toNumber(settings.attendance_pct_threshold) || 80;

  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, full_name, employee_code, created_at, is_active, job_description')
    .eq('is_active', true);
  if (error) throw error;

  const list = (employees || []).filter(isWorkforceEmployee);
  const employeesById = new Map(list.map((e) => [e.id, e]));

  const openResult = await evaluateOpenPunchOuts(employeesById);
  const openCreated = Number(openResult?.created || 0);
  const lowCreated = await evaluateLowAttendance(list, threshold);
  const absentCreated = await evaluateConsecutiveAbsent(list);

  return {
    ok: true,
    threshold,
    created: {
      open_punch_out: openCreated,
      low_attendance: lowCreated,
      consecutive_absent: absentCreated,
      total: openCreated + lowCreated + absentCreated,
    },
    open_punch_out_meta: {
      skipped: openResult?.skipped || null,
      sync_stamp: openResult?.sync_stamp || null,
    },
    evaluated_at: new Date().toISOString(),
  };
}

module.exports = {
  evaluateAttendanceAlerts,
  getNotificationSettings,
  updateNotificationSettings,
  todayDateString,
  CONSECUTIVE_ABSENT_DAYS,
};
