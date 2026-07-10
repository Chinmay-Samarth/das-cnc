const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { processBiometricEvent } = require('./attendanceEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function syncBiometricData() {
  try {



    const result = {
      success: false,
      punchCount: 0,
      processedRecords: [],
      message: ''
    };

    // getting the last record from the database
    const { data: state, error: stateError } = await supabase
      .from('sync_state')
      .select('value')
      .eq('key', 'last_record')
      .single();

    if (stateError && stateError.code !== 'PGRST116') {
      throw stateError;
    }

    const lastRecord = state?.value ?? '0';
    if (!state) {
    }

    // calling biometric api
    const response = await axios.get(process.env.BIOMETRIC_API_URL + 'DownloadLastPunchData', {
      params: {
        Empcode: 'ALL',
        LastRecord: lastRecord
      },
      auth: {
        username: process.env.BIOMETRIC_API_USERNAME,
        password: process.env.BIOMETRIC_API_PASSWORD
      }
    });

    const { PunchData, MaxRecord } = response.data;
    // console.log('Biometric API response', {
    //   lastRecord,
    //   punchCount: PunchData?.length ?? 0,
    //   MaxRecord
    // });

    if (!PunchData?.length) {
      // console.log('No new Punches');
      result.success = true;
      result.message = 'No new Punches';
      return result;
    }

    // Log first few punch records to debug timestamp issue
    // console.log('First 3 punch records:', JSON.stringify(PunchData.slice(0, 3), null, 2));

    const recordsToProcess = PunchData.map((punch) => ({
      employee_code: punch.Empcode,
      punch_id: punch.ID,
      captured_at: punch.PunchDate,
      // M_Flag or EventType will be used by attendance engine to infer event type
      raw_payload: punch
    }));

    const processedResults = await processBiometricEvent(recordsToProcess);
    result.punchCount = Array.isArray(processedResults) ? processedResults.length : 0;
    result.processedRecords = processedResults;

    if (MaxRecord && MaxRecord !== '0') {
      const { data: syncData, error: syncError } = await supabase
        .from('sync_state')
        .upsert({
          key: 'last_record',
          value: MaxRecord
        });
      if (syncError) {
        console.error('sync_state update failed', syncError);
        throw syncError;
      }
      // console.log('Updated MaxRecords:', MaxRecord);
      result.maxRecord = MaxRecord;
    }

    result.success = true;
    result.message = 'Biometric sync completed successfully';
    // console.log(result.message);
    return result;
  } catch (err) {
    console.error('Sync Failed', err?.message ?? err, err?.stack ? err.stack : '');
    throw err;
  }
}

module.exports = { syncBiometricData };


