const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { processBiometricEvent, isTerminalError } = require('./attendanceEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function punchIdNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function biometricAuth() {
  return {
    username: process.env.BIOMETRIC_API_USERNAME,
    password: process.env.BIOMETRIC_API_PASSWORD,
  };
}

/**
 * Advance last_record only through contiguous terminal punches (applied or dead-letter).
 * Never jump to API MaxRecord past a retriable failure.
 */
function nextSyncCursor(lastRecord, results) {
  let cursor = punchIdNumber(lastRecord) ?? 0;
  const ordered = [...(results || [])].sort(
    (a, b) => (punchIdNumber(a.punch_id) ?? 0) - (punchIdNumber(b.punch_id) ?? 0)
  );

  for (const result of ordered) {
    const id = punchIdNumber(result.punch_id);
    if (id == null) continue;

    const terminal =
      result.terminal === true ||
      isTerminalError(result.error) ||
      result.event_type === 'DUPLICATE_APPLIED' ||
      (result.success === true && result.applied === true);

    if (!terminal) {
      // Retriable failure — stop so this punch is fetched again on next sync
      break;
    }

    if (id > cursor) cursor = id;
  }

  return String(cursor);
}

function cappedSyncCursor(lastRecord, results, maxRecord) {
  const lastNum = punchIdNumber(lastRecord) ?? 0;
  const advancedNum = punchIdNumber(nextSyncCursor(lastRecord, results)) ?? 0;
  const maxNum = punchIdNumber(maxRecord);
  let cursor = Math.max(lastNum, advancedNum);
  if (maxNum != null && cursor > maxNum) cursor = maxNum;
  return String(cursor);
}

async function stampBiometricSyncSuccess() {
  const { error } = await supabase.from('sync_state').upsert({
    key: 'biometric_last_success_at',
    value: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error('Failed to stamp biometric_last_success_at:', error.message);
  }
}

function isMissingOutTime(value) {
  if (value == null) return true;
  const raw = String(value).trim();
  if (!raw) return true;
  const normalized = raw.toUpperCase().replace(/\s+/g, '');
  return (
    normalized === '--' ||
    normalized === '--:--' ||
    normalized === '-' ||
    normalized === '00:00' ||
    normalized === '0:00' ||
    normalized === 'NIL' ||
    normalized === 'NA' ||
    normalized === 'N/A'
  );
}

/** Parse HH:MM or H:MM into minutes from midnight; null if unusable. */
function parseClockToMinutes(value) {
  if (isMissingOutTime(value)) return null;
  const match = String(value)
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Classify a device daily summary row using INTime/OUTTime only.
 * Post-12 IN is late arrival unless DasCNC already has a morning punched_in_at.
 */
function classifyInOutPunchRow(row, attendanceRecord = null) {
  const empcode = String(row?.Empcode || row?.empcode || '').trim();
  const dateString = String(row?.DateString || row?.dateString || '').trim();
  const inTime = row?.INTime ?? row?.InTime ?? row?.inTime ?? null;
  const outTime = row?.OUTTime ?? row?.OutTime ?? row?.outTime ?? null;
  const inMinutes = parseClockToMinutes(inTime);
  const outMissing = isMissingOutTime(outTime);
  const outMinutes = outMissing ? null : parseClockToMinutes(outTime);

  const result = {
    empcode,
    dateString,
    name: row?.Name || row?.name || null,
    inTime: inTime == null ? null : String(inTime).trim(),
    outTime: outTime == null ? null : String(outTime).trim(),
    inMinutes,
    outMinutes,
    missingOut: false,
    postNoonIn: false,
    resolvedAction: null,
  };

  if (!empcode || !dateString) {
    result.resolvedAction = 'invalid_row';
    return result;
  }

  if (outMissing || outMinutes == null) {
    result.missingOut = true;
  }

  if (inMinutes != null && inMinutes >= 12 * 60) {
    result.postNoonIn = true;
    const morningIn = attendanceRecord?.punched_in_at
      ? parseClockToMinutes(
          String(attendanceRecord.punched_in_at).includes(' ')
            ? String(attendanceRecord.punched_in_at).slice(11, 16)
            : attendanceRecord.punched_in_at
        )
      : null;
    const hasMorningIn =
      Boolean(attendanceRecord?.punched_in_at) &&
      morningIn != null &&
      morningIn < 12 * 60;

    result.resolvedAction = hasMorningIn ? 'lunch_break_out' : 'late_check_in';
  } else if (result.missingOut) {
    result.resolvedAction = 'missing_out';
  } else if (inMinutes != null && outMinutes != null) {
    result.resolvedAction = 'ok';
  } else {
    result.resolvedAction = 'invalid_row';
  }

  return result;
}

async function fetchInOutPunchData({
  empcode = 'ALL',
  fromDate,
  toDate,
} = {}) {
  if (!fromDate || !toDate) {
    throw new Error('fromDate and toDate are required (DD/MM/YYYY)');
  }
  const base = process.env.BIOMETRIC_API_URL;
  if (!base) throw new Error('BIOMETRIC_API_URL is not configured');

  const response = await axios.get(`${base}DownloadInOutPunchData`, {
    params: {
      Empcode: empcode || 'ALL',
      FromDate: fromDate,
      ToDate: toDate,
    },
    auth: biometricAuth(),
  });

  const data = response.data || {};
  if (data.Error) {
    throw new Error(data.Msg || 'DownloadInOutPunchData returned Error=true');
  }

  return Array.isArray(data.InOutPunchData) ? data.InOutPunchData : [];
}

/**
 * Convert ISO YYYY-MM-DD or DD/MM/YYYY to device DD/MM/YYYY.
 */
function toDeviceDateString(value) {
  const raw = String(value || '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${d}/${m}/${y}`;
  }
  throw new Error(`Unrecognized date format: ${raw}`);
}

function deviceDateToIso(dateString) {
  const match = String(dateString || '')
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/**
 * Build plant-local `YYYY-MM-DD HH:MM:00` from ISO date + HH:MM clock.
 */
function isoDateAndClockToTimestamp(isoDate, clockValue) {
  const mins = parseClockToMinutes(clockValue);
  if (!isoDate || mins == null) return null;
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return (
    `${isoDate} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
  );
}

/**
 * Apply DownloadInOutPunchData OUTTime onto open DasCNC sessions.
 * Evening OUT (≥16:00) closes via the attendance engine; lunch-band OUT stamps break only.
 */
async function applyInOutOutTimes(entries) {
  const { processBiometricEvent } = require('./attendanceEngine');
  const summary = {
    eveningOutApplied: 0,
    lunchBreakOutApplied: 0,
    skipped: 0,
    errors: [],
  };

  for (const entry of entries || []) {
    if (!entry?.attendance_record_id || !entry.shift_date || !entry.empcode) {
      summary.skipped += 1;
      continue;
    }
    if (!entry.das_punched_in_at || entry.das_punched_out_at) {
      summary.skipped += 1;
      continue;
    }
    if (entry.outMinutes == null || entry.missingOut) {
      summary.skipped += 1;
      continue;
    }

    const punchTime = isoDateAndClockToTimestamp(entry.shift_date, entry.outTime);
    if (!punchTime) {
      summary.skipped += 1;
      continue;
    }

    try {
      if (entry.outMinutes >= 16 * 60) {
        // Stable synthetic id so force re-runs stay idempotent per day/employee
        const punchId = `inout-out-${entry.shift_date}-${entry.empcode}`;
        const result = await processBiometricEvent(
          {
            employee_code: entry.empcode,
            punch_id: punchId,
            captured_at: punchTime,
            event_type: 'CHECK_OUT',
            raw_payload: {
              source: 'DownloadInOutPunchData',
              OUTTime: entry.outTime,
              Empcode: entry.empcode,
              DateString: entry.dateString,
            },
          },
          { force: true }
        );
        if (result?.applied && result?.event_type === 'CHECK_OUT') {
          summary.eveningOutApplied += 1;
        } else {
          summary.skipped += 1;
        }
      } else if (entry.outMinutes >= 12 * 60) {
        const { error } = await supabase
          .from('attendance_records')
          .update({
            break_punch_out: punchTime,
            updated_at: new Date().toISOString(),
          })
          .eq('id', entry.attendance_record_id)
          .is('break_punch_out', null)
          .is('punched_out_at', null);
        if (error) throw error;
        summary.lunchBreakOutApplied += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (err) {
      summary.errors.push({
        attendance_record_id: entry.attendance_record_id,
        error: err?.message || String(err),
      });
    }
  }

  return summary;
}

/**
 * Recheck plant days via DownloadInOutPunchData (INTime/OUTTime only).
 * This is the double-check path for punch-out + lunch — live sync stays on LastPunchData.
 */
async function recheckInOutPunchData({
  fromDate,
  toDate,
  empcode = 'ALL',
  repair = true,
  lookbackDays = 14,
} = {}) {
  const deviceFrom = toDeviceDateString(fromDate);
  const deviceTo = toDeviceDateString(toDate);
  const rows = await fetchInOutPunchData({
    empcode,
    fromDate: deviceFrom,
    toDate: deviceTo,
  });

  const codes = [
    ...new Set(
      rows
        .map((row) => String(row?.Empcode || row?.empcode || '').trim())
        .filter(Boolean)
    ),
  ];

  const { data: employees, error: empErr } = await supabase
    .from('employees')
    .select('id, employee_code, full_name')
    .in('employee_code', codes.length ? codes : ['__none__']);
  if (empErr) throw empErr;

  const employeeByCode = new Map(
    (employees || []).map((emp) => [String(emp.employee_code).trim(), emp])
  );

  const isoDates = [
    ...new Set(
      rows
        .map((row) => deviceDateToIso(row?.DateString || row?.dateString))
        .filter(Boolean)
    ),
  ];

  const employeeIds = (employees || []).map((emp) => emp.id);
  let attendanceRows = [];
  if (employeeIds.length && isoDates.length) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('id, employee_id, shift_date, punched_in_at, punched_out_at, break_punch_out, break_punch_in, status')
      .in('employee_id', employeeIds)
      .in('shift_date', isoDates);
    if (error) throw error;
    attendanceRows = data || [];
  }

  const attendanceByKey = new Map(
    attendanceRows.map((row) => [`${row.employee_id}:${row.shift_date}`, row])
  );

  const missingOut = [];
  const postNoonInForReview = [];
  const applyCandidates = [];
  let okCount = 0;

  for (const row of rows) {
    const emp = employeeByCode.get(String(row?.Empcode || row?.empcode || '').trim());
    const isoDate = deviceDateToIso(row?.DateString || row?.dateString);
    const attendance = emp && isoDate ? attendanceByKey.get(`${emp.id}:${isoDate}`) || null : null;
    const classified = classifyInOutPunchRow(row, attendance);
    const entry = {
      ...classified,
      employee_id: emp?.id || null,
      employee_name: emp?.full_name || classified.name,
      shift_date: isoDate,
      attendance_record_id: attendance?.id || null,
      das_punched_in_at: attendance?.punched_in_at || null,
      das_punched_out_at: attendance?.punched_out_at || null,
    };

    if (classified.missingOut) missingOut.push(entry);
    if (classified.postNoonIn) postNoonInForReview.push(entry);
    if (classified.resolvedAction === 'ok') okCount += 1;

    if (
      attendance?.punched_in_at &&
      !attendance?.punched_out_at &&
      !classified.missingOut &&
      classified.outMinutes != null
    ) {
      applyCandidates.push(entry);
    }
  }

  let applySummary = null;
  let repairSummary = null;
  if (repair) {
    applySummary = await applyInOutOutTimes(applyCandidates);

    const needsLogRepair =
      missingOut.length > 0 ||
      postNoonInForReview.some((r) => r.resolvedAction === 'lunch_break_out') ||
      (applySummary?.lunchBreakOutApplied || 0) > 0 ||
      (applySummary?.eveningOutApplied || 0) > 0;

    if (needsLogRepair) {
      const { repairLunchFalseOuts, reprocessOpenPunchOuts } = require('./attendanceEngine');
      const lunchRepair = await repairLunchFalseOuts({ lookbackDays });
      const openRepair = await reprocessOpenPunchOuts({ lookbackDays });
      repairSummary = { lunchRepair, openRepair };
    }
  }

  return {
    fromDate: deviceFrom,
    toDate: deviceTo,
    scanned: rows.length,
    okCount,
    missingOut,
    postNoonInForReview,
    apply: applySummary,
    repair: repairSummary,
  };
}

function plantDateYmd(offsetDays = 0) {
  const tz = process.env.TIMEZONE || 'Asia/Kolkata';
  const now = new Date();
  if (offsetDays) now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * biometric_logs.punch_id is bigint — build a stable numeric id for INOUT-sourced punches.
 * kind: 1=IN, 2=lunch break out, 3=evening OUT
 */
function syntheticInOutPunchId(kind, isoDate, empcode) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const dayNum = y * 10000 + m * 100 + d;
  let hash = 0;
  const code = String(empcode || '');
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  return dayNum * 1_000_000 + Number(kind) * 100_000 + (hash % 100_000);
}

/**
 * Primary attendance sync via DownloadInOutPunchData.
 * etimeoffice DownloadLastPunchData currently returns Error for every LastRecord;
 * INOUT still has today's IN/OUT and is the reliable source.
 */
async function syncAttendanceFromInOut({
  fromDate,
  toDate,
  empcode = 'ALL',
} = {}) {
  const { processBiometricEvent } = require('./attendanceEngine');
  const deviceFrom = toDeviceDateString(fromDate || plantDateYmd(0));
  const deviceTo = toDeviceDateString(toDate || fromDate || plantDateYmd(0));
  const rows = await fetchInOutPunchData({
    empcode,
    fromDate: deviceFrom,
    toDate: deviceTo,
  });

  const summary = {
    success: true,
    source: 'DownloadInOutPunchData',
    fromDate: deviceFrom,
    toDate: deviceTo,
    scanned: rows.length,
    checkInsApplied: 0,
    breakOutsApplied: 0,
    checkOutsApplied: 0,
    skipped: 0,
    punchCount: 0,
    processedRecords: [],
    message: '',
  };

  for (const row of rows) {
    const code = String(row?.Empcode || row?.empcode || '').trim();
    const isoDate = deviceDateToIso(row?.DateString || row?.dateString);
    if (!code || !isoDate) {
      summary.skipped += 1;
      continue;
    }

    const inTime = row?.INTime ?? row?.InTime ?? null;
    const outTime = row?.OUTTime ?? row?.OutTime ?? null;
    const inMinutes = parseClockToMinutes(inTime);
    const outMissing = isMissingOutTime(outTime);
    const outMinutes = outMissing ? null : parseClockToMinutes(outTime);

    if (inMinutes != null) {
      const punchTime = isoDateAndClockToTimestamp(isoDate, inTime);
      const result = await processBiometricEvent(
        {
          employee_code: code,
          punch_id: syntheticInOutPunchId(1, isoDate, code),
          captured_at: punchTime,
          event_type: 'CHECK_IN',
          raw_payload: { source: 'DownloadInOutPunchData', ...row },
        },
        { force: true }
      );
      summary.processedRecords.push(result);
      summary.punchCount += 1;
      if (result?.applied && result?.event_type === 'CHECK_IN') {
        summary.checkInsApplied += 1;
      }
    }

    if (outMinutes != null) {
      const punchTime = isoDateAndClockToTimestamp(isoDate, outTime);
      const isLunchBand = outMinutes >= 12 * 60 && outMinutes < 16 * 60;

      // Lunch: stamp break_punch_out directly (classifier may call midday DUPLICATE).
      if (isLunchBand) {
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('employee_code', code)
          .maybeSingle();
        if (emp?.id) {
          const { data: att } = await supabase
            .from('attendance_records')
            .select('id, punched_in_at, punched_out_at, break_punch_out')
            .eq('employee_id', emp.id)
            .eq('shift_date', isoDate)
            .maybeSingle();
          if (att?.punched_in_at && !att.punched_out_at && !att.break_punch_out) {
            const { error } = await supabase
              .from('attendance_records')
              .update({
                break_punch_out: punchTime,
                updated_at: new Date().toISOString(),
              })
              .eq('id', att.id);
            if (!error) summary.breakOutsApplied += 1;
          } else {
            summary.skipped += 1;
          }
        } else {
          summary.skipped += 1;
        }
      } else {
        const result = await processBiometricEvent(
          {
            employee_code: code,
            punch_id: syntheticInOutPunchId(3, isoDate, code),
            captured_at: punchTime,
            event_type: 'CHECK_OUT',
            raw_payload: { source: 'DownloadInOutPunchData', ...row },
          },
          { force: true }
        );
        summary.processedRecords.push(result);
        summary.punchCount += 1;
        if (result?.applied && result?.event_type === 'CHECK_OUT') {
          summary.checkOutsApplied += 1;
        }
      }
    }
  }

  summary.message =
    `INOUT sync ${deviceFrom}→${deviceTo}: scanned=${summary.scanned} ` +
    `in=${summary.checkInsApplied} lunchOut=${summary.breakOutsApplied} out=${summary.checkOutsApplied}`;

  await stampBiometricSyncSuccess();
  return summary;
}

async function syncBiometricData() {
  try {
    const result = {
      success: false,
      punchCount: 0,
      processedRecords: [],
      message: '',
      cursorAdvancedTo: null,
      apiMax: null,
      retriableFailures: 0,
      source: 'DownloadLastPunchData',
      inoutFallback: null,
    };

    const { data: state, error: stateError } = await supabase
      .from('sync_state')
      .select('value')
      .eq('key', 'last_record')
      .single();

    if (stateError && stateError.code !== 'PGRST116') {
      throw stateError;
    }

    const lastRecord = state?.value ?? '0';
    let lastPunchFailed = false;
    let lastPunchMsg = null;

    try {
      const response = await axios.get(process.env.BIOMETRIC_API_URL + 'DownloadLastPunchData', {
        params: {
          Empcode: 'ALL',
          LastRecord: lastRecord,
        },
        auth: biometricAuth(),
      });

      const data = response.data || {};
      if (data.Error) {
        lastPunchFailed = true;
        lastPunchMsg = data.Msg || 'DownloadLastPunchData Error=true';
      } else {
        const { PunchData, MaxRecord } = data;
        result.apiMax = MaxRecord == null ? null : String(MaxRecord);

        if (PunchData?.length) {
          const recordsToProcess = PunchData.map((punch) => ({
            employee_code: punch.Empcode,
            punch_id: punch.ID,
            captured_at: punch.PunchDate,
            raw_payload: punch,
          }));

          const processedResults = await processBiometricEvent(recordsToProcess);
          result.punchCount = Array.isArray(processedResults) ? processedResults.length : 0;
          result.processedRecords = processedResults;

          const newCursor = MaxRecord == null ? String(lastRecord) : String(MaxRecord);
          const { error: syncError } = await supabase.from('sync_state').upsert({
            key: 'last_record',
            value: newCursor,
          });
          if (syncError) {
            console.error('sync_state update failed', syncError);
            throw syncError;
          }
          result.cursorAdvancedTo = String(newCursor);

          const failed = (processedResults || []).filter(
            (r) => !r.success && !r.terminal && !isTerminalError(r.error)
          );
          result.retriableFailures = failed.length;
          result.success = true;
          result.message = failed.length
            ? `Biometric sync partially completed; ${failed.length} retriable failure(s); cursor=${result.cursorAdvancedTo}; apiMax=${MaxRecord}`
            : `Biometric sync completed successfully; cursor=${result.cursorAdvancedTo}`;

          await stampBiometricSyncSuccess();
          // Still refresh today from INOUT so lunch/out stay aligned.
          result.inoutFallback = await syncAttendanceFromInOut({
            fromDate: plantDateYmd(-1),
            toDate: plantDateYmd(0),
          });
          return result;
        }
      }
    } catch (err) {
      lastPunchFailed = true;
      lastPunchMsg = err?.message || String(err);
      console.error('DownloadLastPunchData failed, falling back to INOUT:', lastPunchMsg);
    }

    // LastPunch empty or broken → seed/refresh from INOUT (today + yesterday).
    const inout = await syncAttendanceFromInOut({
      fromDate: plantDateYmd(-1),
      toDate: plantDateYmd(0),
    });
    result.success = true;
    result.source = 'DownloadInOutPunchData';
    result.inoutFallback = inout;
    result.punchCount = inout.punchCount;
    result.processedRecords = inout.processedRecords;
    result.cursorAdvancedTo = String(lastRecord);
    result.message = lastPunchFailed
      ? `LastPunch unavailable (${lastPunchMsg}); ${inout.message}`
      : `No LastPunch rows; ${inout.message}`;
    return result;
  } catch (err) {
    console.error('Sync Failed', err?.message ?? err, err?.stack ? err.stack : '');
    throw err;
  }
}

module.exports = {
  syncBiometricData,
  syncAttendanceFromInOut,
  nextSyncCursor,
  cappedSyncCursor,
  stampBiometricSyncSuccess,
  fetchInOutPunchData,
  classifyInOutPunchRow,
  recheckInOutPunchData,
  applyInOutOutTimes,
  isMissingOutTime,
  parseClockToMinutes,
  toDeviceDateString,
  deviceDateToIso,
  isoDateAndClockToTimestamp,
  plantDateYmd,
  syntheticInOutPunchId,
};
