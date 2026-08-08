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

async function syncBiometricData() {
  try {
    const result = {
      success: false,
      punchCount: 0,
      processedRecords: [],
      message: '',
      cursorAdvancedTo: null,
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

    const response = await axios.get(process.env.BIOMETRIC_API_URL + 'DownloadLastPunchData', {
      params: {
        Empcode: 'ALL',
        LastRecord: lastRecord,
      },
      auth: {
        username: process.env.BIOMETRIC_API_USERNAME,
        password: process.env.BIOMETRIC_API_PASSWORD,
      },
    });

    const { PunchData, MaxRecord } = response.data;

    if (!PunchData?.length) {
      result.success = true;
      result.message = 'No new Punches';
      return result;
    }

    const recordsToProcess = PunchData.map((punch) => ({
      employee_code: punch.Empcode,
      punch_id: punch.ID,
      captured_at: punch.PunchDate,
      raw_payload: punch,
    }));

    const processedResults = await processBiometricEvent(recordsToProcess);
    result.punchCount = Array.isArray(processedResults) ? processedResults.length : 0;
    result.processedRecords = processedResults;

    const newCursor = nextSyncCursor(lastRecord, processedResults);
    const lastNum = punchIdNumber(lastRecord) ?? 0;
    const newNum = punchIdNumber(newCursor) ?? 0;

    if (newNum > lastNum) {
      const { error: syncError } = await supabase.from('sync_state').upsert({
        key: 'last_record',
        value: newCursor,
      });
      if (syncError) {
        console.error('sync_state update failed', syncError);
        throw syncError;
      }
      result.cursorAdvancedTo = newCursor;
    }

    const failed = (processedResults || []).filter((r) => !r.success && !r.terminal && !isTerminalError(r.error));
    result.success = true;
    result.message = failed.length
      ? `Biometric sync partially completed; ${failed.length} retriable failure(s); cursor=${result.cursorAdvancedTo || lastRecord}; apiMax=${MaxRecord}`
      : `Biometric sync completed successfully; cursor=${result.cursorAdvancedTo || lastRecord}`;
    return result;
  } catch (err) {
    console.error('Sync Failed', err?.message ?? err, err?.stack ? err.stack : '');
    throw err;
  }
}

module.exports = { syncBiometricData, nextSyncCursor };
