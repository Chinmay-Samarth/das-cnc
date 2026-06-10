/**
 * DasCNC Attendance Engine (Supabase Version)
 * ─────────────────────────────────────────────
 * Fixed: night-shift date resolution, UTC vs local time bugs,
 *        lateness calculation, and toLocalDate() footgun.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const LATE_GRACE_MINUTES        = 10;
const HALF_DAY_THRESHOLD_MINUTES = 240;
// const TZ = process.env.TIMEZONE || 'Asia/Kolkata';


// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function timeToMinutes(timeStr) {
  // Accepts HH:mm, HH:mm:ss, and DB time-like strings.
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h * 60 + m;
}

function isCrossesMidnightShift(shift) {
  const startMins = timeToMinutes(shift.start_time);
  const endMins = timeToMinutes(shift.end_time);
  // Some rows may have crosses_midnight unset/incorrect; infer from clock times.
  return Boolean(shift.crosses_midnight) || (
    Number.isFinite(startMins) &&
    Number.isFinite(endMins) &&
    endMins <= startMins
  );
}

/**
 * Parse local timestamp string without timezone conversion.
 * Handles: ISO (2024-01-27T22:45:00), DD/MM/YYYY HH:MM:SS, and Date objects.
 * Returns { year, month, day, hours, minutes, dateStr, raw } as stored (no TZ shift).
 */
function parseLocalTimestamp(timestamp) {
  let year, month, day, hours, minutes;

  if (typeof timestamp === 'string') {
    // Try DD/MM/YYYY HH:MM:SS format first (from biometric API)
    const ddmmFormat = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timestamp);
    if (ddmmFormat) {
      day   = parseInt(ddmmFormat[1], 10);
      month = parseInt(ddmmFormat[2], 10);
      year  = parseInt(ddmmFormat[3], 10);
      hours = parseInt(ddmmFormat[4], 10);
      minutes = parseInt(ddmmFormat[5], 10);
    } else {
      // Fall back to ISO format or auto-parsing
      const dateObj = new Date(timestamp.replace('T', ' '));
      year   = dateObj.getFullYear();
      month  = dateObj.getMonth() + 1;
      day    = dateObj.getDate();
      hours  = dateObj.getHours();
      minutes = dateObj.getMinutes();
    }
  } else {
    // Handle Date objects
    const dateObj = new Date(timestamp);
    year   = dateObj.getFullYear();
    month  = dateObj.getMonth() + 1;
    day    = dateObj.getDate();
    hours  = dateObj.getHours();
    minutes = dateObj.getMinutes();
  }

  // YYYY-MM-DD string
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, hours, minutes, dateStr };
}

/**
 * Calculate minutes between two local timestamp strings without timezone conversion.
 */
function calculateMinutesDifference(timestamp1, timestamp2) {
  const t1 = parseLocalTimestamp(timestamp1);
  const t2 = parseLocalTimestamp(timestamp2);
  
  const minutes1 = t1.hours * 60 + t1.minutes;
  const minutes2 = t2.hours * 60 + t2.minutes;
  
  return minutes2 - minutes1;
}

/**
 * Subtract one calendar day from a YYYY-MM-DD string.
 * Avoids any timezone-aware Date arithmetic.
 */
function subtractOneDay(dateStr) {
  // Parse the date string as a local date (no timezone shift)
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d); // local Date, no TZ offset issues
  date.setDate(date.getDate() - 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}


// ─────────────────────────────────────────────
// SHIFT RESOLUTION
// ─────────────────────────────────────────────

/**
 * FIX 2: Correct night-shift date resolution.
 *
 * For your scenario: punch-in 27th 22:45 IST, punch-out 28th 05:45 IST.
 *
 * Check-in  → punchMinutes=1365, windowStart=1230 → evening branch → shift_date="2024-01-27" ✅
 * Check-out → punchMinutes=345,  windowEnd=450    → morning branch → shift_date="2024-01-27" ✅
 *
 * Both resolve to the SAME shift_date so the DB lookup links them correctly.
 *
 * Old bug: the morning branch called:
 *   shiftDate.toLocaleDateString('en-CA')  ← no timezone arg → used server's UTC
 * This was harmless on UTC servers but broke on non-UTC hosts.
 * We now use subtractOneDay(dateStr) which is purely string arithmetic.
 */
function resolveShiftAndDate(punchTime, emshift) {
  const { hours, minutes, dateStr } = parseLocalTimestamp(punchTime);
  const punchMinutes = hours * 60 + minutes;

  const startMins = timeToMinutes(emshift.start_time);
  const endMins   = timeToMinutes(emshift.end_time);
  const crossesMidnight = isCrossesMidnightShift(emshift);

  if (!Number.isFinite(startMins) || !Number.isFinite(endMins)) {
    return null;
  }

  if (!crossesMidnight) {
    // Regular shift: allow ±90 min window around shift boundaries
    if (punchMinutes >= startMins - 90 && punchMinutes <= endMins + 90) {
      return { shift: emshift, shift_date: dateStr };
    }
  } else {
    // Night shift (e.g. 22:00–06:00)
    const windowStart = startMins - 90; // 20:30 → 1230 mins
    const windowEnd   = endMins   + 90; //  7:30 →  450 mins

    // Evening portion: 20:30–23:59 → shift belongs to TODAY
    if (punchMinutes >= windowStart) {
      return { shift: emshift, shift_date: dateStr };
    }

    // Early-morning portion: 00:00–07:30 → shift belongs to YESTERDAY
    else {
      return { shift: emshift, shift_date: subtractOneDay(dateStr) };
    }
  }

  return null; // Punch time outside all shift windows
}


// ─────────────────────────────────────────────
// MAIN EVENT PROCESSOR
// ─────────────────────────────────────────────

async function processBiometricEvent(payload) {
  if (Array.isArray(payload)) {
    // Ensure we process synced biometric records in ascending order
    // of `punch_id` so lower punch ids are handled first.
    const sorted = [...payload].sort((a, b) => {
      const pa = a && a.punch_id != null ? Number(a.punch_id) : Number.POSITIVE_INFINITY;
      const pb = b && b.punch_id != null ? Number(b.punch_id) : Number.POSITIVE_INFINITY;
      return pa - pb;
    });

    const results = [];
    for (const record of sorted) {
      results.push(await processBiometricEvent(record));
    }
    return results;
  }

  const { employee_code, punch_id, captured_at, raw_payload } = payload;

  try {
    // 1. Save raw biometric log
    const newBiometricLog = {
      employee_code,
      punch_id,
      captured_at,
      raw_payload: raw_payload ?? null,
    };

    const { data: biometricLog, error: logError } = await supabase
      .from('biometric_logs')
      .upsert(newBiometricLog)
      .select()
      .single();

    if (logError) throw logError;

    const biometricLogId = biometricLog.id;

    // 2. Find employee + their assigned shift
    const { data: employee, error: empError } = await supabase
      .from('employees')
      .select('id, shift_id, full_name')
      .eq('employee_code', employee_code)
      .eq('is_active', true)
      .maybeSingle();

    if (empError || !employee) {
      return { success: false, error: 'UNKNOWN_EMPLOYEE', biometricLogId };
    }

    // 3. Load this employee's shift definition
    const { data: emshift, error: shiftError } = await supabase
      .from('shifts')
      .select('*')
      .eq('id', employee.shift_id)
      .single();

    if (shiftError) throw shiftError;

    // 4. Resolve shift_date (the core night-shift fix)
    const punchTime = captured_at;
    const resolved  = resolveShiftAndDate(punchTime, emshift);

    if (!resolved) {
      return { success: false, error: 'UNRESOLVABLE_SHIFT_TIME', biometricLogId };
    }

    const { shift, shift_date } = resolved;

    // 5. Find existing attendance log for this employee + shift_date
    const { data: existingRecord } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('employee_id', employee.id)
      .eq('shift_date', shift_date)
      .maybeSingle();

    const crossesMidnight = isCrossesMidnightShift(shift);

    // 6. Determine event type (always infer from record state since API doesn't provide it)
    const resolvedEventType = inferBiometricEventType(existingRecord, crossesMidnight, punchTime);

    if (!resolvedEventType) {
      return { success: false, error: 'UNRESOLVABLE_EVENT_TYPE', biometricLogId };
    }

    // 7. Process the event
    if (resolvedEventType === 'CHECK_IN') {
      await handleCheckIn({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord });
    } else if (resolvedEventType === 'BREAK_OUT') {
      await handleBreakOut({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord });
    } else if (resolvedEventType === 'BREAK_IN') {
      await handleBreakIn({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord });
    } else if (resolvedEventType === 'CHECK_OUT') {
      await handleCheckOut({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord });
    } else {
      return { success: false, error: 'UNSUPPORTED_EVENT_TYPE', biometricLogId };
    }

    // 8. Mark raw log as matched
    await supabase
      .from('biometric_logs')
      .update({ matched: true })
      .eq('id', biometricLogId);

    return {
      success: true,
      employee_name: employee.full_name,
      shift_name: shift.name,
      shift_date,
      event_type: resolvedEventType,
    };

  } catch (err) {
    console.error('[DasCNC] processBiometricEvent error:', err);
    return { success: false, error: err.message };
  }
}

function inferExpectedEventType(hour, crossesMidnight) {
  // Night shift
  if (crossesMidnight) {
    if (hour >= 18) return "CHECK_IN";
    return "CHECK_OUT";
  }

  // Day shift
  if (hour < 11) return "CHECK_IN";

  if (hour < 14) return "BREAK_OUT";

  if (hour < 16) return "BREAK_IN";

  return "CHECK_OUT";
}

function inferBiometricEventType(existingRecord,crossesMidnight,punchTime) {
  const hour = new Date(punchTime).getHours();

  const expected = inferExpectedEventType(hour,crossesMidnight);

  // First punch of the day
  if (!existingRecord) {
    return "CHECK_IN";
  }

  // Night shift employees
  if (crossesMidnight) {
    if (!existingRecord.punched_in_at) {
      return "CHECK_IN";
    }

    if (!existingRecord.punched_out_at) {
      return "CHECK_OUT";
    }

    return null;
  }

  // -------------------------
  // Day shift employees
  // -------------------------

  // No check-in yet
  if (!existingRecord.punched_in_at) {
    return "CHECK_IN";
  }

  // BREAK_OUT window
  if (expected === "BREAK_OUT") {
    if (existingRecord.break_punch_out === null) {
      return "BREAK_OUT";
    }

    // Same-hour lunch return
    if (existingRecord.break_punch_in === null) {
      return "BREAK_IN";
    }
  }

  // BREAK_IN window
  if (expected === "BREAK_IN") {
    if (
      existingRecord.break_punch_out &&
      !existingRecord.break_punch_in
    ) {
      return "BREAK_IN";
    }
  }

  // CHECK_OUT window
  if (expected === "CHECK_OUT") {
    // Employee skipped lunch punches
    if (
      !existingRecord.break_punch_out &&
      !existingRecord.break_punch_in
    ) {
      return "CHECK_OUT";
    }

    // Normal checkout
    if (
      existingRecord.break_punch_in &&
      !existingRecord.punched_out_at
    ) {
      return "CHECK_OUT";
    }
  }

  return null;
}

async function handleBreakOut({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord }) {
  if (!existingRecord || !existingRecord.punched_in_at) {
    console.warn(`[DasCNC] BREAK_OUT without CHECK_IN — employee ${employee.id}, shift_date ${shift_date}`);
    return;
  }

  if (existingRecord.break_punch_out) {
    console.log(`[DasCNC] Duplicate BREAK_OUT ignored — employee ${employee.id}, shift_date ${shift_date}`);
    return;
  }

  const { error } = await supabase
    .from('attendance_records')
    .update({
      break_punch_out: punchTime,
      updated_at:      new Date(),
    })
    .eq('id', existingRecord.id)
    .single();

  if (error) throw error;
}

async function handleBreakIn({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord }) {
  if (!existingRecord || !existingRecord.break_punch_out) {
    console.warn(`[DasCNC] BREAK_IN without BREAK_OUT — employee ${employee.id}, shift_date ${shift_date}`);
    return;
  }

  if (existingRecord.break_punch_in) {
    console.log(`[DasCNC] Duplicate BREAK_IN ignored — employee ${employee.id}, shift_date ${shift_date}`);
    return;
  }

  const breakMinutes = calculateMinutesDifference(existingRecord.break_punch_out, punchTime);

  const { error } = await supabase
    .from('attendance_records')
    .update({
      break_punch_in: punchTime,
      break_minutes:  Math.max(0, breakMinutes),
      updated_at:     new Date(),
    })
    .eq('id', existingRecord.id);

  if (error) throw error;
}


// ─────────────────────────────────────────────
// CHECK IN
// ─────────────────────────────────────────────

async function handleCheckIn({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord }) {

  // Parse local timestamp without timezone conversion
  const { hours, minutes } = parseLocalTimestamp(punchTime);
  const punchMins          = hours * 60 + minutes;
  const shiftStartMins     = timeToMinutes(shift.start_time);

  let minutesLate = 0;

  if (!isCrossesMidnightShift(shift)) {
    minutesLate = Math.max(0, punchMins - shiftStartMins);
  } else {
    if (punchMins < 720) {
      // Punched in after midnight — very late; calculate from shift start crossing midnight
      minutesLate = (1440 - shiftStartMins) + punchMins;
    } else {
      // Punched in during the evening portion
      minutesLate = Math.max(0, punchMins - shiftStartMins);
    }
  }

  const status = minutesLate > LATE_GRACE_MINUTES ? 'LATE' : 'PRESENT';

  if (!existingRecord) {
    const { error } = await supabase
      .from('attendance_records')
      .insert({
        employee_id:     employee.id,
        shift_id:        shift.id,
        shift_date,
        punched_in_at:   punchTime,
        status,
        biometric_in_id: biometricLogId,
      });
    if (error) throw error;
    return;
  }

  if (!existingRecord.punched_in_at) {
    const { error } = await supabase
      .from('attendance_records')
      .update({
        punched_in_at:   punchTime,
        status,
        biometric_in_id: biometricLogId,
        updated_at:      new Date(),
      })
      .eq('id', existingRecord.id);
    if (error) throw error;
    return;
  }

  console.log(`[DasCNC] Duplicate CHECK_IN ignored — employee ${employee.id}, shift_date ${shift_date}`);
}


// ─────────────────────────────────────────────
// CHECK OUT
// ─────────────────────────────────────────────

async function handleCheckOut({ employee, shift, shift_date, punchTime, biometricLogId, existingRecord }) {

  if (!existingRecord || !existingRecord.punched_in_at) {
    console.warn(`[DasCNC] CHECK_OUT without CHECK_IN — employee ${employee.id}, shift_date ${shift_date}`);
    return;
  }

  const rawMinutes = calculateMinutesDifference(existingRecord.punched_in_at, punchTime);

  if (rawMinutes < 0) {
    console.warn(`[DasCNC] Negative minutesWorked (${rawMinutes}) for employee ${employee.id} — skipping checkout`);
    return;
  }

  let breakMinutes = 0;
  if (existingRecord.break_punch_out && existingRecord.break_punch_in) {
    breakMinutes = existingRecord.break_minutes ?? calculateMinutesDifference(existingRecord.break_punch_out, existingRecord.break_punch_in);
  }

  const minutesWorked = Math.max(0, rawMinutes - breakMinutes);
  const expectedMinutes = shift.duration_hours * 60;
  const overtimeMinutes = Math.max(0, minutesWorked - expectedMinutes);
  const earlyMinutes    = Math.max(0, expectedMinutes - minutesWorked);
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
      punched_out_at:   punchTime,
      minutes_worked:   minutesWorked,
      overtime_minutes: overtimeMinutes,
      early_minutes:    earlyMinutes,
      status,
      biometric_out_id: biometricLogId,
      updated_at:       new Date(),
    })
    .eq('id', existingRecord.id);

  if (error) throw error;
}


// ─────────────────────────────────────────────
// DAILY ABSENT SWEEP (cron — run at 07:00 IST)
// FIX 4: batch insert instead of N+1 queries
// ─────────────────────────────────────────────

async function markAbsentees() {
  const { dateStr: today } = parseLocalTimestamp(new Date());
  const yesterday          = subtractOneDay(today);

  const { data: employees, error: empError } = await supabase
    .from('employees')
    .select('id, shift_id')
    .eq('is_active', true);

  if (empError) throw empError;

  const { data: existing, error: recError } = await supabase
    .from('attendance_records')
    .select('employee_id')
    .eq('shift_date', yesterday);

  if (recError) throw recError;

  const alreadyRecorded = new Set(existing.map(r => r.employee_id));

  const toInsert = employees
    .filter(e => !alreadyRecorded.has(e.id))
    .map(e => ({
      employee_id:  e.id,
      shift_id:     e.shift_id,
      shift_date:   yesterday,
      status:       'ABSENT',
      minutes_worked: 0,
      overtime_minutes: 0,
      early_minutes: 0,
      biometric_in_id: null,
      biometric_out_id: null,
    }));

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('attendance_records')
      .insert(toInsert);
    if (insertError) throw insertError;
  }

  console.log(`[DasCNC] Absent sweep: marked ${toInsert.length} employees absent for ${yesterday}`);
}


module.exports = { processBiometricEvent, resolveShiftAndDate, markAbsentees };