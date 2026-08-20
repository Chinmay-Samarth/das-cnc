/**
 * DasCNC Attendance Engine
 * ─────────────────────────────────────────────
 * Biometric punches → attendance_records via a shift-aware session machine.
 *
 * Day (Men-/Women-/Morning): CHECK_IN → BREAK_OUT (lunch) → BREAK_IN → CHECK_OUT
 * Night: CHECK_IN → CHECK_OUT only (no lunch)
 * Duration uses full calendar minutes (overnight outs stay correct).
 */

const { createClient } = require('@supabase/supabase-js');
const { emitAttendanceUpdated } = require('../socket/emitter');
const { isWorkforceEmployee } = require('../utils/accessLevel');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LATE_GRACE_MINUTES = 10;
const HALF_DAY_THRESHOLD_MINUTES = 240;
const PRE_SHIFT_GRACE_MINUTES = 90;
const POST_SHIFT_GRACE_MINUTES = 240;
/** Day shifts often punch out after Men/Women DB end — allow outs until 22:00. */
const DAY_LATEST_OUT_MINUTES = 22 * 60;
/** Night morning OUT band: end_time + this grace (avoid midday mis-attach). */
const NIGHT_POST_GRACE_MINUTES = 120;
const OPEN_SESSION_LOOKBACK_DAYS = 2;

/** Plant-local lunch / phase bands (minutes from midnight). */
const LUNCH_START_MINUTES = 12 * 60; // 12:00
const LUNCH_END_MINUTES = 15 * 60 + 30; // 15:30
/** Day CHECK_OUT only from this clock time onward (lunch band must never close the day). */
const EVENING_OUT_START_MINUTES = 16 * 60; // 16:00
const MAX_SHORT_BREAK_GAP_MINUTES = 180; // incomplete lunch return vs evening out
/** Ignore near-instant second punch after lunch OUT (device double-tap → fake BREAK_IN). */
const MIN_BREAK_DURATION_MINUTES = 8;
/** Day IN→OUT must stay same calendar day (blocks next-day punches closing yesterday). */
const MAX_DAY_SESSION_MINUTES = 16 * 60;
/** Night IN→OUT across midnight; hard cap against multi-day attach. */
const MAX_NIGHT_SESSION_MINUTES = 14 * 60;

/** Permanent (non-retriable) error codes — sync may advance past these punch ids. */
const TERMINAL_ERRORS = new Set([
  'UNKNOWN_EMPLOYEE',
  'INACTIVE_EMPLOYEE',
  'ADMIN_EXCLUDED',
  'SESSION_ALREADY_CLOSED',
  'DUPLICATE_APPLIED',
  'DUPLICATE_CHECK_IN',
  'DUPLICATE_BREAK_OUT',
  'MIDDAY_AFTER_LUNCH',
  'OUT_BEFORE_IN',
  'SESSION_SPAN_TOO_LONG',
]);

async function notifyAttendanceRecordChange(employeeId, shiftDate, action) {
  try {
    const { data } = await supabase
      .from('attendance_records')
      .select('id, employee_id, shift_date')
      .eq('employee_id', employeeId)
      .eq('shift_date', shiftDate)
      .maybeSingle();

    if (data) {
      emitAttendanceUpdated({
        date: data.shift_date,
        recordId: data.id,
        employeeId: data.employee_id,
        action,
      });
    }
  } catch (err) {
    console.error('[DasCNC] socket attendance emit failed:', err);
  }
}

// ─────────────────────────────────────────────
// TIME HELPERS (plant-local wall clock, no TZ shift)
// ─────────────────────────────────────────────

function timeToMinutes(timeStr) {
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseLocalTimestamp(timestamp) {
  let year;
  let month;
  let day;
  let hours;
  let minutes;

  if (typeof timestamp === 'string') {
    const ddmm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timestamp);
    if (ddmm) {
      day = parseInt(ddmm[1], 10);
      month = parseInt(ddmm[2], 10);
      year = parseInt(ddmm[3], 10);
      hours = parseInt(ddmm[4], 10);
      minutes = parseInt(ddmm[5], 10);
    } else {
      const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timestamp);
      if (iso) {
        year = parseInt(iso[1], 10);
        month = parseInt(iso[2], 10);
        day = parseInt(iso[3], 10);
        hours = parseInt(iso[4], 10);
        minutes = parseInt(iso[5], 10);
      } else {
        const dateObj = new Date(timestamp);
        year = dateObj.getFullYear();
        month = dateObj.getMonth() + 1;
        day = dateObj.getDate();
        hours = dateObj.getHours();
        minutes = dateObj.getMinutes();
      }
    }
  } else {
    const dateObj = new Date(timestamp);
    year = dateObj.getFullYear();
    month = dateObj.getMonth() + 1;
    day = dateObj.getDate();
    hours = dateObj.getHours();
    minutes = dateObj.getMinutes();
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hours, minutes, dateStr };
}

function localTimestampToISO(timestamp) {
  const p = parseLocalTimestamp(timestamp);
  return (
    `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ` +
    `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}:00`
  );
}

/** Absolute plant-local minutes since epoch (date+time, not clock-of-day). */
function toEpochMinutes(timestamp) {
  const p = parseLocalTimestamp(timestamp);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day, p.hours, p.minutes, 0) / 60000);
}

/**
 * Full datetime minute delta (out - in). Overnight work returns positive values.
 */
function minutesBetween(earlier, later) {
  return toEpochMinutes(later) - toEpochMinutes(earlier);
}

/** @deprecated alias — kept for any external callers */
function calculateMinutesDifference(timestamp1, timestamp2) {
  return minutesBetween(timestamp1, timestamp2);
}

function subtractOneDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDaysYmd(dateStr, delta) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function isCrossesMidnightShift(shift) {
  const startMins = timeToMinutes(shift.start_time);
  const endMins = timeToMinutes(shift.end_time);
  return Boolean(shift.crosses_midnight) || (
    Number.isFinite(startMins) &&
    Number.isFinite(endMins) &&
    endMins <= startMins
  );
}

function isTerminalError(code) {
  return TERMINAL_ERRORS.has(String(code || ''));
}

function failResult(error, extra = {}) {
  return {
    success: false,
    applied: false,
    error,
    terminal: isTerminalError(error),
    ...extra,
  };
}

// ─────────────────────────────────────────────
// SHIFT INSTANCE RESOLUTION
// ─────────────────────────────────────────────

/**
 * Map a punch wall-clock to { shift, shift_date }.
 * Night: evening portion → today; early-morning within end+grace → yesterday.
 */
function resolveShiftAndDate(punchTime, emshift) {
  const { hours, minutes, dateStr } = parseLocalTimestamp(punchTime);
  const punchMinutes = hours * 60 + minutes;
  const startMins = timeToMinutes(emshift.start_time);
  const endMins = timeToMinutes(emshift.end_time);
  const crossesMidnight = isCrossesMidnightShift(emshift);

  if (!Number.isFinite(startMins) || !Number.isFinite(endMins)) {
    return null;
  }

  if (!crossesMidnight) {
    // Day: allow in from start-grace through the later of (end+grace) and 22:00
    const dayLatest = Math.max(endMins + POST_SHIFT_GRACE_MINUTES, DAY_LATEST_OUT_MINUTES);
    if (
      punchMinutes >= startMins - PRE_SHIFT_GRACE_MINUTES &&
      punchMinutes <= dayLatest
    ) {
      return { shift: emshift, shift_date: dateStr };
    }
    return null;
  }

  const windowStart = startMins - PRE_SHIFT_GRACE_MINUTES;
  const windowEnd = endMins + NIGHT_POST_GRACE_MINUTES;

  // Evening / night portion of the shift day
  if (punchMinutes >= windowStart) {
    return { shift: emshift, shift_date: dateStr };
  }

  // Early morning after midnight (belongs to previous calendar day's shift)
  if (punchMinutes <= windowEnd) {
    return { shift: emshift, shift_date: subtractOneDay(dateStr) };
  }

  return null;
}

async function findOpenSession(employeeId, notAfterDateStr) {
  const lookback = addDaysYmd(notAfterDateStr, -OPEN_SESSION_LOOKBACK_DAYS);
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('employee_id', employeeId)
    .not('punched_in_at', 'is', null)
    .is('punched_out_at', null)
    .gte('shift_date', lookback)
    .lte('shift_date', notAfterDateStr)
    .order('shift_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Whether an unfinished session may absorb this punch.
 * Day shifts: same calendar shift_date only (never steal tomorrow's lunch/out).
 * Night shifts: today or yesterday, within a sane span.
 */
function canAttachOpenSession(open, punchTime, shiftForOpen) {
  if (!open?.punched_in_at || open.punched_out_at) return false;
  const span = minutesBetween(open.punched_in_at, punchTime);
  if (!(span > 0)) return false;

  const punchDate = parseLocalTimestamp(punchTime).dateStr;
  const night = isCrossesMidnightShift(shiftForOpen);

  if (night) {
    if (open.shift_date !== punchDate && open.shift_date !== subtractOneDay(punchDate)) {
      return false;
    }
    return span <= MAX_NIGHT_SESSION_MINUTES;
  }

  if (open.shift_date !== punchDate) return false;
  return span <= MAX_DAY_SESSION_MINUTES;
}

// ─────────────────────────────────────────────
// SESSION CLASSIFICATION (shift-aware state machine)
// ─────────────────────────────────────────────

function punchClockMinutes(punchTime) {
  const { hours, minutes } = parseLocalTimestamp(punchTime);
  return hours * 60 + minutes;
}

function isInLunchBand(punchMinutes) {
  return punchMinutes >= LUNCH_START_MINUTES && punchMinutes < LUNCH_END_MINUTES;
}

/**
 * Decide action from shift type + session state + plant time bands.
 * Night: IN → OUT only.
 * Day: IN → lunch BREAK_OUT/IN → evening CHECK_OUT (≥ 16:00 only).
 * Lunch-band punches must never become CHECK_OUT.
 */
function classifyPunchForSession(shift, existingRecord, punchTime) {
  const punchMinutes = punchClockMinutes(punchTime);
  const night = isCrossesMidnightShift(shift);

  if (!existingRecord || !existingRecord.punched_in_at) {
    return 'CHECK_IN';
  }

  if (existingRecord.punched_out_at) {
    return 'SESSION_CLOSED';
  }

  if (night) {
    return 'CHECK_OUT';
  }

  // ── Day shift (Men-/Women-/Morning) ──
  if (!existingRecord.break_punch_out) {
    if (isInLunchBand(punchMinutes)) {
      return 'BREAK_OUT';
    }
    if (punchMinutes >= EVENING_OUT_START_MINUTES) {
      return 'CHECK_OUT'; // rare skipped lunch
    }
    // Mid-morning duplicate punches — not checkout
    return 'DUPLICATE_CHECK_IN';
  }

  if (existingRecord.break_punch_out && !existingRecord.break_punch_in) {
    const gap = minutesBetween(existingRecord.break_punch_out, punchTime);
    // Device double-tap seconds after lunch OUT — do not fake a completed break
    if (gap >= 0 && gap < MIN_BREAK_DURATION_MINUTES) {
      return 'DUPLICATE_BREAK_OUT';
    }
    // Lunch return only within a short window; long gaps are abandoned lunch
    if (gap < 0 || gap > MAX_SHORT_BREAK_GAP_MINUTES) {
      if (punchMinutes >= EVENING_OUT_START_MINUTES) {
        return 'CHECK_OUT';
      }
      return 'MIDDAY_AFTER_LUNCH';
    }
    return 'BREAK_IN';
  }

  // Lunch completed — only evening/late punches may close the day
  if (punchMinutes < EVENING_OUT_START_MINUTES) {
    return 'MIDDAY_AFTER_LUNCH';
  }
  return 'CHECK_OUT';
}

// ─────────────────────────────────────────────
// INGEST
// ─────────────────────────────────────────────

async function ingestBiometricLog({ employee_code, punch_id, captured_at, raw_payload }) {
  const code = String(employee_code).trim();

  const { data: existing, error: findErr } = await supabase
    .from('biometric_logs')
    .select('*')
    .eq('employee_code', code)
    .eq('punch_id', punch_id)
    .order('matched', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing;

  const row = {
    employee_code: code,
    punch_id,
    captured_at,
    raw_payload: raw_payload ?? null,
    matched: false,
    process_error: null,
  };

  // Prefer unique upsert when index exists; fall back to insert.
  const { data: created, error: insErr } = await supabase
    .from('biometric_logs')
    .upsert(row, { onConflict: 'employee_code,punch_id' })
    .select('*')
    .single();

  if (!insErr && created) return created;

  // Race / missing unique: re-select or plain insert
  const { data: inserted, error: plainErr } = await supabase
    .from('biometric_logs')
    .insert(row)
    .select('*')
    .single();

  if (!plainErr && inserted) return inserted;

  const { data: again, error: againErr } = await supabase
    .from('biometric_logs')
    .select('*')
    .eq('employee_code', code)
    .eq('punch_id', punch_id)
    .limit(1)
    .maybeSingle();
  if (againErr) throw againErr || plainErr || insErr;
  if (again) return again;
  throw plainErr || insErr || new Error('BIOMETRIC_INGEST_FAILED');
}

async function markLogOutcome(biometricLogId, { matched, process_error = null }) {
  const payload = { matched: Boolean(matched) };
  // process_error column may not exist until migration applies — try with, fall back without
  payload.process_error = process_error;
  const { error } = await supabase
    .from('biometric_logs')
    .update(payload)
    .eq('id', biometricLogId);

  if (error && String(error.message || '').includes('process_error')) {
    const { error: e2 } = await supabase
      .from('biometric_logs')
      .update({ matched: Boolean(matched) })
      .eq('id', biometricLogId);
    if (e2) throw e2;
    return;
  }
  if (error) throw error;
}

// ─────────────────────────────────────────────
// APPLY HANDLERS (return { applied, reason? })
// ─────────────────────────────────────────────

async function applyCheckIn({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord }) {
  const { hours, minutes } = parseLocalTimestamp(punchTime);
  const punchMins = hours * 60 + minutes;
  const shiftStartMins = timeToMinutes(shift.start_time);

  let minutesLate = 0;
  if (!isCrossesMidnightShift(shift)) {
    minutesLate = Math.max(0, punchMins - shiftStartMins);
  } else if (punchMins < 720) {
    minutesLate = (1440 - shiftStartMins) + punchMins;
  } else {
    minutesLate = Math.max(0, punchMins - shiftStartMins);
  }

  const status = minutesLate > LATE_GRACE_MINUTES ? 'LATE' : 'PRESENT';

  if (!existingRecord) {
    const { error } = await supabase.from('attendance_records').insert({
      employee_id: employee.id,
      shift_id: shift.id,
      shift_date,
      punched_in_at: punchTime,
      status,
      biometric_in_id: biometricLogId,
    });
    if (error) throw error;
    return { applied: true, event_type: 'CHECK_IN' };
  }

  if (!existingRecord.punched_in_at) {
    const { error } = await supabase
      .from('attendance_records')
      .update({
        punched_in_at: punchTime,
        status,
        biometric_in_id: biometricLogId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingRecord.id);
    if (error) throw error;
    return { applied: true, event_type: 'CHECK_IN' };
  }

  return { applied: false, reason: 'DUPLICATE_CHECK_IN', event_type: 'CHECK_IN' };
}

async function applyBreakOut({ existingRecord, punchTime }) {
  if (!existingRecord || !existingRecord.punched_in_at) {
    return { applied: false, reason: 'BREAK_OUT_WITHOUT_IN', event_type: 'BREAK_OUT' };
  }
  if (existingRecord.punched_out_at) {
    return { applied: false, reason: 'SESSION_ALREADY_CLOSED', terminal: true, event_type: 'BREAK_OUT' };
  }
  if (existingRecord.break_punch_out) {
    return { applied: false, reason: 'DUPLICATE_BREAK_OUT', event_type: 'BREAK_OUT' };
  }

  const { error } = await supabase
    .from('attendance_records')
    .update({
      break_punch_out: punchTime,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingRecord.id);
  if (error) throw error;
  return { applied: true, event_type: 'BREAK_OUT' };
}

async function applyBreakIn({ existingRecord, punchTime }) {
  if (!existingRecord || !existingRecord.break_punch_out) {
    return { applied: false, reason: 'BREAK_IN_WITHOUT_BREAK_OUT', event_type: 'BREAK_IN' };
  }
  if (existingRecord.break_punch_in) {
    return { applied: false, reason: 'DUPLICATE_BREAK_IN', event_type: 'BREAK_IN' };
  }
  if (existingRecord.punched_out_at) {
    return { applied: false, reason: 'SESSION_ALREADY_CLOSED', terminal: true, event_type: 'BREAK_IN' };
  }

  const breakMinutes = Math.max(0, minutesBetween(existingRecord.break_punch_out, punchTime));
  if (breakMinutes < MIN_BREAK_DURATION_MINUTES) {
    return { applied: false, reason: 'DUPLICATE_BREAK_OUT', event_type: 'BREAK_IN' };
  }
  if (breakMinutes > MAX_SHORT_BREAK_GAP_MINUTES) {
    return { applied: false, reason: 'BREAK_SPAN_TOO_LONG', event_type: 'BREAK_IN' };
  }

  const { error } = await supabase
    .from('attendance_records')
    .update({
      break_punch_in: punchTime,
      break_minutes: breakMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingRecord.id);
  if (error) throw error;
  return { applied: true, event_type: 'BREAK_IN', break_minutes: breakMinutes };
}

async function applyCheckOut({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord }) {
  if (!existingRecord || !existingRecord.punched_in_at) {
    return { applied: false, reason: 'CHECK_OUT_WITHOUT_IN', event_type: 'CHECK_OUT' };
  }

  if (existingRecord.punched_out_at) {
    return {
      applied: false,
      reason: 'SESSION_ALREADY_CLOSED',
      terminal: true,
      event_type: 'CHECK_OUT',
    };
  }

  // Hard gate: day shifts cannot check out during / before the evening band
  if (!isCrossesMidnightShift(shift)) {
    const punchMinutes = punchClockMinutes(punchTime);
    if (punchMinutes < EVENING_OUT_START_MINUTES) {
      return {
        applied: false,
        reason: 'LUNCH_BAND_NOT_CHECK_OUT',
        event_type: 'CHECK_OUT',
      };
    }
  }

  const rawMinutes = minutesBetween(existingRecord.punched_in_at, punchTime);
  if (rawMinutes < 0) {
    return { applied: false, reason: 'OUT_BEFORE_IN', terminal: true, event_type: 'CHECK_OUT' };
  }

  const maxSpan = isCrossesMidnightShift(shift)
    ? MAX_NIGHT_SESSION_MINUTES
    : MAX_DAY_SESSION_MINUTES;
  if (rawMinutes > maxSpan) {
    return {
      applied: false,
      reason: 'SESSION_SPAN_TOO_LONG',
      terminal: true,
      event_type: 'CHECK_OUT',
    };
  }

  let breakMinutes = 0;
  if (existingRecord.break_punch_out && existingRecord.break_punch_in) {
    const span = minutesBetween(existingRecord.break_punch_out, existingRecord.break_punch_in);
    // Zero-length / fake break pairs do not count as a completed lunch
    if (span >= MIN_BREAK_DURATION_MINUTES) {
      breakMinutes =
        existingRecord.break_minutes ?? Math.max(0, span);
    }
  }

  const minutesWorked = Math.max(0, rawMinutes - breakMinutes);
  const expectedMinutes = Number(shift.duration_hours || 0) * 60;
  const overtimeMinutes = Math.max(0, minutesWorked - expectedMinutes);
  const earlyMinutes = Math.max(0, expectedMinutes - minutesWorked);

  let status;
  if (minutesWorked < HALF_DAY_THRESHOLD_MINUTES) {
    status = 'HALF_DAY';
  } else if (minutesWorked < expectedMinutes) {
    status = existingRecord.status === 'LATE' ? 'LATE' : 'PRESENT';
  } else {
    status = existingRecord.status === 'LATE' ? 'LATE' : 'COMPLETED';
  }

  const { error } = await supabase
    .from('attendance_records')
    .update({
      punched_out_at: punchTime,
      minutes_worked: minutesWorked,
      overtime_minutes: overtimeMinutes,
      early_minutes: earlyMinutes,
      status,
      biometric_out_id: biometricLogId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingRecord.id);
  if (error) throw error;

  return {
    applied: true,
    event_type: 'CHECK_OUT',
    minutes_worked: minutesWorked,
  };
}

// ─────────────────────────────────────────────
// MAIN PROCESSOR
// ─────────────────────────────────────────────

async function processBiometricEvent(payload, options = {}) {
  const force = Boolean(options.force);

  if (Array.isArray(payload)) {
    const sorted = [...payload].sort((a, b) => {
      const pa = a?.punch_id != null ? Number(a.punch_id) : Number.POSITIVE_INFINITY;
      const pb = b?.punch_id != null ? Number(b.punch_id) : Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      const ta = a?.captured_at ? toEpochMinutes(a.captured_at) : 0;
      const tb = b?.captured_at ? toEpochMinutes(b.captured_at) : 0;
      return ta - tb;
    });

    const results = [];
    for (const record of sorted) {
      results.push(await processBiometricEvent(record, options));
    }
    return results;
  }

  const { employee_code, punch_id, captured_at, raw_payload, event_type: softHint } = payload || {};
  if (!employee_code || punch_id == null || !captured_at) {
    return failResult('MISSING_FIELDS');
  }

  const punchTime = localTimestampToISO(captured_at);
  let biometricLogId = null;

  try {
    const biometricLog = await ingestBiometricLog({
      employee_code,
      punch_id,
      captured_at: punchTime,
      raw_payload: raw_payload ?? null,
    });
    biometricLogId = biometricLog.id;

    if (biometricLog.matched && !force) {
      return {
        success: true,
        applied: false,
        terminal: true,
        error: null,
        event_type: 'DUPLICATE_APPLIED',
        punch_id,
        biometricLogId,
      };
    }

    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('id, shift_id, full_name, employee_code, is_active, job_description')
      .eq('employee_code', String(employee_code).trim())
      .maybeSingle();

    if (empError || !employee) {
      await markLogOutcome(biometricLogId, { matched: false, process_error: 'UNKNOWN_EMPLOYEE' });
      return failResult('UNKNOWN_EMPLOYEE', { punch_id, biometricLogId });
    }

    if (!isWorkforceEmployee(employee)) {
      const code = employee.is_active === false ? 'INACTIVE_EMPLOYEE' : 'ADMIN_EXCLUDED';
      await markLogOutcome(biometricLogId, { matched: false, process_error: code });
      return failResult(code, { punch_id, biometricLogId });
    }

    const { data: emshift, error: shiftError } = await supabase
      .from('shifts')
      .select('*')
      .eq('id', employee.shift_id)
      .single();
    if (shiftError) throw shiftError;

    let resolved = resolveShiftAndDate(punchTime, emshift);
    let existingRecord = null;
    let shift = emshift;
    let shift_date = resolved?.shift_date || null;

    if (resolved) {
      const { data } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('shift_date', shift_date)
        .maybeSingle();
      existingRecord = data || null;
    }

    if (!resolved) {
      const open = await findOpenSession(employee.id, parseLocalTimestamp(punchTime).dateStr);
      if (open && open.punched_in_at && !open.punched_out_at) {
        let openShift = emshift;
        if (open.shift_id && open.shift_id !== emshift.id) {
          const { data: fetchedShift } = await supabase
            .from('shifts')
            .select('*')
            .eq('id', open.shift_id)
            .maybeSingle();
          if (fetchedShift) openShift = fetchedShift;
        }
        // Day shifts: only same-calendar-day late outs (e.g. after 22:00).
        // Never attach yesterday's open IN to today's lunch/evening punches.
        if (canAttachOpenSession(open, punchTime, openShift)) {
          existingRecord = open;
          shift_date = open.shift_date;
          shift = openShift;
          resolved = { shift, shift_date };
        }
      }
    }

    if (!resolved) {
      await markLogOutcome(biometricLogId, {
        matched: false,
        process_error: 'UNRESOLVABLE_SHIFT_TIME',
      });
      return failResult('UNRESOLVABLE_SHIFT_TIME', { punch_id, biometricLogId });
    }

    if (!existingRecord) {
      const { data } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('shift_date', shift_date)
        .maybeSingle();
      existingRecord = data || null;
    }

    let action = classifyPunchForSession(shift, existingRecord, punchTime);
    const punchMinutes = punchClockMinutes(punchTime);
    const nightShift = isCrossesMidnightShift(shift);

    // Soft device hint — never override lunch-band punches into CHECK_OUT on day shifts
    const hint = String(softHint || raw_payload?.EventType || raw_payload?.M_Flag || '')
      .toUpperCase();
    if (
      (hint.includes('OUT') || hint === 'AO') &&
      existingRecord?.punched_in_at &&
      !existingRecord?.punched_out_at
    ) {
      if (nightShift) {
        action = 'CHECK_OUT';
      } else if (
        punchMinutes >= EVENING_OUT_START_MINUTES &&
        (existingRecord.break_punch_in || !existingRecord.break_punch_out)
      ) {
        // Evening OUT hint only after lunch is done, or skipped-lunch evening leave
        action = 'CHECK_OUT';
      }
      // Lunch-band OUT hints keep classifier (BREAK_OUT / BREAK_IN) — never CHECK_OUT
    }

    // Safety net: day CHECK_OUT before 16:00 is always remapped
    if (!nightShift && action === 'CHECK_OUT' && punchMinutes < EVENING_OUT_START_MINUTES) {
      if (!existingRecord?.break_punch_out && isInLunchBand(punchMinutes)) {
        action = 'BREAK_OUT';
      } else if (existingRecord?.break_punch_out && !existingRecord?.break_punch_in) {
        const gap = minutesBetween(existingRecord.break_punch_out, punchTime);
        action =
          gap >= 0 && gap < MIN_BREAK_DURATION_MINUTES
            ? 'DUPLICATE_BREAK_OUT'
            : 'BREAK_IN';
      } else {
        action = 'MIDDAY_AFTER_LUNCH';
      }
    }

    if (action === 'SESSION_CLOSED') {
      await markLogOutcome(biometricLogId, {
        matched: true,
        process_error: 'SESSION_ALREADY_CLOSED',
      });
      return failResult('SESSION_ALREADY_CLOSED', {
        punch_id,
        biometricLogId,
        shift_date,
        employee_name: employee.full_name,
      });
    }

    if (action === 'DUPLICATE_CHECK_IN' || action === 'DUPLICATE_BREAK_OUT' || action === 'MIDDAY_AFTER_LUNCH') {
      await markLogOutcome(biometricLogId, {
        matched: true,
        process_error: action,
      });
      return failResult(action, {
        punch_id,
        biometricLogId,
        shift_date,
        employee_name: employee.full_name,
        event_type: action === 'DUPLICATE_BREAK_OUT' ? 'BREAK_OUT' : 'CHECK_IN',
      });
    }

    let applyResult;
    if (action === 'CHECK_IN') {
      applyResult = await applyCheckIn({
        employee,
        shift,
        shift_date,
        punchTime,
        biometricLogId,
        existingRecord,
      });
    } else if (action === 'BREAK_OUT') {
      applyResult = await applyBreakOut({ existingRecord, punchTime });
    } else if (action === 'BREAK_IN') {
      applyResult = await applyBreakIn({ existingRecord, punchTime });
    } else if (action === 'CHECK_OUT') {
      applyResult = await applyCheckOut({
        employee,
        shift,
        shift_date,
        punchTime,
        biometricLogId,
        existingRecord,
      });
    } else {
      await markLogOutcome(biometricLogId, {
        matched: false,
        process_error: 'UNSUPPORTED_EVENT_TYPE',
      });
      return failResult('UNSUPPORTED_EVENT_TYPE', { punch_id, biometricLogId });
    }

    if (!applyResult.applied) {
      const reason = applyResult.reason || 'NOT_APPLIED';
      const terminal = Boolean(applyResult.terminal) || isTerminalError(reason);
      // Duplicate check-in while already punched in: treat as terminal matched so sync can advance,
      // unless this is the checkout path that somehow didn't apply for non-terminal reasons.
      const markMatched = terminal || reason === 'DUPLICATE_CHECK_IN';
      await markLogOutcome(biometricLogId, {
        matched: markMatched,
        process_error: reason,
      });
      return {
        success: false,
        applied: false,
        terminal,
        error: reason,
        event_type: applyResult.event_type || action,
        punch_id,
        biometricLogId,
        shift_date,
        employee_name: employee.full_name,
      };
    }

    await markLogOutcome(biometricLogId, { matched: true, process_error: null });
    await notifyAttendanceRecordChange(employee.id, shift_date, 'punch');

    return {
      success: true,
      applied: true,
      terminal: true,
      error: null,
      employee_name: employee.full_name,
      shift_name: shift.name,
      shift_date,
      event_type: applyResult.event_type,
      punch_id,
      biometricLogId,
      minutes_worked: applyResult.minutes_worked,
    };
  } catch (err) {
    // console.error('[DasCNC] processBiometricEvent error:', err);
    if (biometricLogId) {
      try {
        await markLogOutcome(biometricLogId, {
          matched: false,
          process_error: err.message || 'INTERNAL_ERROR',
        });
      } catch {
        /* ignore secondary */
      }
    }
    return failResult(err.message || 'INTERNAL_ERROR', { punch_id, biometricLogId });
  }
}

// ─────────────────────────────────────────────
// REPROCESS OPEN PUNCH-OUTS (admin / backfill)
// ─────────────────────────────────────────────

async function reprocessOpenPunchOuts({ lookbackDays = 14 } = {}) {
  const today = parseLocalTimestamp(new Date()).dateStr;
  const fromDate = addDaysYmd(today, -Math.max(1, Number(lookbackDays) || 14));

  const { data: openRows, error } = await supabase
    .from('attendance_records')
    .select(
      'id, employee_id, shift_date, punched_in_at, punched_out_at, employees!attendance_records_employee_id_fkey(employee_code)'
    )
    .not('punched_in_at', 'is', null)
    .is('punched_out_at', null)
    .gte('shift_date', fromDate)
    .lte('shift_date', today);
  if (error) throw error;

  const summary = {
    scanned: (openRows || []).length,
    closed: 0,
    attempted: 0,
    results: [],
  };

  for (const row of openRows || []) {
    const employeeCode = row.employees?.employee_code;
    if (!employeeCode || !row.punched_in_at) continue;

    const { data: logs, error: logErr } = await supabase
      .from('biometric_logs')
      .select('employee_code, punch_id, captured_at, raw_payload, matched')
      .eq('employee_code', employeeCode)
      .gt('captured_at', row.punched_in_at)
      .order('punch_id', { ascending: true });
    if (logErr) throw logErr;

    if (!logs?.length) continue;

    for (const log of logs) {
      summary.attempted += 1;
      const result = await processBiometricEvent(
        {
          employee_code: log.employee_code,
          punch_id: log.punch_id,
          captured_at: log.captured_at,
          raw_payload: log.raw_payload,
        },
        { force: true }
      );
      summary.results.push({
        attendance_id: row.id,
        punch_id: log.punch_id,
        ...result,
      });

      if (result.applied && result.event_type === 'CHECK_OUT') {
        summary.closed += 1;
        break;
      }
    }
  }

  return summary;
}

/**
 * Demote false end-of-day outs that landed before the evening band (incl. lunch)
 * back to open sessions, repair fake instant break_in pairs, then reprocess later punches.
 */
async function repairLunchFalseOuts({ lookbackDays = 14 } = {}) {
  const machineToday = parseLocalTimestamp(new Date()).dateStr;
  const { data: latestRow } = await supabase
    .from('attendance_records')
    .select('shift_date')
    .order('shift_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const plantLatest = latestRow?.shift_date || machineToday;
  const toDate = plantLatest > machineToday ? plantLatest : machineToday;
  const lookback = Math.max(1, Number(lookbackDays) || 14);
  // Cover both server-clock "today" and plant punch calendar (device clocks can drift ahead)
  const fromA = addDaysYmd(machineToday, -lookback);
  const fromB = addDaysYmd(toDate, -lookback);
  const fromDate = fromA < fromB ? fromA : fromB;

  const { data: rows, error } = await supabase
    .from('attendance_records')
    .select(
      `
      id,
      employee_id,
      shift_id,
      shift_date,
      punched_in_at,
      punched_out_at,
      break_punch_out,
      break_punch_in,
      break_minutes,
      status,
      employees!attendance_records_employee_id_fkey(employee_code),
      shifts!attendance_records_shift_id_fkey(id, crosses_midnight, start_time, end_time)
    `
    )
    .not('punched_in_at', 'is', null)
    .not('punched_out_at', 'is', null)
    .gte('shift_date', fromDate)
    .lte('shift_date', toDate)
    .order('shift_date', { ascending: false })
    .limit(5000);
  if (error) throw error;

  const summary = {
    scanned: (rows || []).length,
    fromDate,
    toDate,
    repaired: 0,
    attempted: 0,
    closed: 0,
    skippedEvening: 0,
    skippedNight: 0,
    skippedNoCode: 0,
    results: [],
  };

  for (const row of rows || []) {
    const shift = row.shifts;
    if (!shift || isCrossesMidnightShift(shift)) {
      summary.skippedNight += 1;
      continue;
    }

    const outMins = punchClockMinutes(row.punched_out_at);
    // False closes are anything before the evening band (16:00)
    if (!(outMins < EVENING_OUT_START_MINUTES)) {
      summary.skippedEvening += 1;
      continue;
    }

    const employeeCode = row.employees?.employee_code;
    if (!employeeCode) {
      summary.skippedNoCode += 1;
      continue;
    }

    let breakOut = row.break_punch_out;
    let breakIn = row.break_punch_in;

    // If out was the lunch leave punch itself, promote it to break_out
    if (!breakOut || breakOut === row.punched_out_at) {
      breakOut = row.punched_out_at;
      breakIn = null;
    } else if (breakOut && breakIn) {
      const span = minutesBetween(breakOut, breakIn);
      // Fake zero-length break (double-tap) — clear break_in and reopen
      if (span < MIN_BREAK_DURATION_MINUTES) {
        breakIn = null;
      }
      // Lunch return incorrectly mirrored onto punched_out — clear out, keep break pair if valid
      if (breakIn && breakIn === row.punched_out_at && span >= MIN_BREAK_DURATION_MINUTES) {
        // keep breakOut/breakIn; just clear punched_out below
      }
    }

    // Prefer earliest lunch-band punch as break_out when out itself is in lunch band
    if (!row.break_punch_out && isInLunchBand(outMins)) {
      breakOut = row.punched_out_at;
      breakIn = null;
    }

    const previousStatus =
      row.status === 'LATE' || row.status === 'PRESENT' || row.status === 'ABSENT'
        ? row.status
        : 'PRESENT';

    const { error: updErr } = await supabase
      .from('attendance_records')
      .update({
        break_punch_out: breakOut,
        break_punch_in: breakIn,
        break_minutes:
          breakOut && breakIn
            ? Math.max(0, minutesBetween(breakOut, breakIn))
            : null,
        punched_out_at: null,
        minutes_worked: 0,
        overtime_minutes: 0,
        early_minutes: 0,
        biometric_out_id: null,
        status:
          previousStatus === 'HALF_DAY' || previousStatus === 'COMPLETED'
            ? 'PRESENT'
            : previousStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (updErr) throw updErr;

    summary.repaired += 1;

    // Re-feed punches after the original morning in (covers lunch return + evening out)
    const afterTime = row.punched_in_at;
    const { data: logs, error: logErr } = await supabase
      .from('biometric_logs')
      .select('employee_code, punch_id, captured_at, raw_payload')
      .eq('employee_code', employeeCode)
      .gt('captured_at', afterTime)
      .order('punch_id', { ascending: true });
    if (logErr) throw logErr;

    for (const log of logs || []) {
      summary.attempted += 1;
      const result = await processBiometricEvent(
        {
          employee_code: log.employee_code,
          punch_id: log.punch_id,
          captured_at: log.captured_at,
          raw_payload: log.raw_payload,
        },
        { force: true }
      );
      summary.results.push({
        attendance_id: row.id,
        punch_id: log.punch_id,
        ...result,
      });
      if (result.applied && result.event_type === 'CHECK_OUT') {
        summary.closed += 1;
        break;
      }
    }
  }

  return summary;
}

// ─────────────────────────────────────────────
// DAILY ABSENT SWEEP
// ─────────────────────────────────────────────

async function markAbsentees() {
  const { dateStr: today } = parseLocalTimestamp(new Date());
  const yesterday = subtractOneDay(today);

  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('id, shift_id, is_active, job_description')
    .eq('is_active', true);
  if (empError) throw empError;

  const workforce = (employees || []).filter(isWorkforceEmployee);

  const { data: existing, error: recError } = await supabase
    .from('attendance_records')
    .select('employee_id')
    .eq('shift_date', yesterday);
  if (recError) throw recError;

  const alreadyRecorded = new Set((existing || []).map((r) => r.employee_id));

  const toInsert = workforce
    .filter((e) => !alreadyRecorded.has(e.id))
    .map((e) => ({
      employee_id: e.id,
      shift_id: e.shift_id,
      shift_date: yesterday,
      status: 'ABSENT',
      minutes_worked: 0,
      overtime_minutes: 0,
      early_minutes: 0,
      biometric_in_id: null,
      biometric_out_id: null,
    }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('attendance_records').insert(toInsert);
    if (insertError) throw insertError;
  }

  console.log(`[DasCNC] Absent sweep: marked ${toInsert.length} employees absent for ${yesterday}`);
  if (toInsert.length > 0) {
    emitAttendanceUpdated({ date: yesterday, action: 'absent' });
  }
}

module.exports = {
  processBiometricEvent,
  resolveShiftAndDate,
  markAbsentees,
  reprocessOpenPunchOuts,
  repairLunchFalseOuts,
  minutesBetween,
  calculateMinutesDifference,
  classifyPunchForSession,
  canAttachOpenSession,
  isTerminalError,
  TERMINAL_ERRORS,
  parseLocalTimestamp,
  localTimestampToISO,
  isInLunchBand,
  LUNCH_START_MINUTES,
  LUNCH_END_MINUTES,
  EVENING_OUT_START_MINUTES,
  MAX_DAY_SESSION_MINUTES,
  MAX_NIGHT_SESSION_MINUTES,
};
