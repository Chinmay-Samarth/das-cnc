/**
 * Lightweight verification for lunch-aware biometric classification.
 * Run: node server/scripts/verifyBiometricAttendance.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key';

const {
  minutesBetween,
  classifyPunchForSession,
  resolveShiftAndDate,
  isInLunchBand,
  parseLocalTimestamp,
  deviceCapturedAt,
} = require('../services/attendanceEngine');
const {
  nextSyncCursor,
  cappedSyncCursor,
  classifyInOutPunchRow,
  isMissingOutTime,
  parseClockToMinutes,
} = require('../services/biometricSync');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  const nightIn = '2026-01-27 22:10:00';
  const nightOut = '2026-01-28 06:40:00';
  assert(minutesBetween(nightIn, nightOut) === 510, 'night overnight minutes');

  const dayShift = {
    name: 'Men-Morning',
    start_time: '08:00:00',
    end_time: '16:30:00',
    crosses_midnight: false,
  };
  const womenShift = {
    name: 'Women-Morning',
    start_time: '09:00:00',
    end_time: '17:30:00',
    crosses_midnight: false,
  };
  const nightShift = {
    name: 'Night',
    start_time: '20:00:00',
    end_time: '08:00:00',
    crosses_midnight: true,
  };

  // Day attach window reaches evening outs past DB end
  assert(resolveShiftAndDate('2026-01-27 19:30:00', dayShift)?.shift_date === '2026-01-27', 'evening out attaches');
  assert(resolveShiftAndDate('2026-01-27 21:30:00', womenShift)?.shift_date === '2026-01-27', 'late out attaches');

  // Night same shift_date
  assert(resolveShiftAndDate(nightIn, nightShift)?.shift_date === '2026-01-27', 'night in date');
  assert(resolveShiftAndDate(nightOut, nightShift)?.shift_date === '2026-01-27', 'night out date');
  assert(resolveShiftAndDate('2026-01-27 14:00:00', nightShift) === null, 'midday not night');

  // Night: IN then OUT, never break
  assert(classifyPunchForSession(nightShift, null, nightIn) === 'CHECK_IN', 'night first → IN');
  assert(
    classifyPunchForSession(nightShift, { punched_in_at: nightIn, punched_out_at: null }, nightOut) ===
      'CHECK_OUT',
    'night second → OUT'
  );

  // Day sequence
  const dayIn = '2026-01-27 08:30:00';
  const lunchOut = '2026-01-27 13:10:00';
  const lunchIn = '2026-01-27 13:45:00';
  const eveningOut = '2026-01-27 19:30:00';

  assert(classifyPunchForSession(dayShift, null, dayIn) === 'CHECK_IN', 'day IN');
  assert(
    classifyPunchForSession(dayShift, { punched_in_at: dayIn, punched_out_at: null }, lunchOut) ===
      'BREAK_OUT',
    'lunch out is BREAK_OUT not CHECK_OUT'
  );
  assert(isInLunchBand(13 * 60 + 10), 'lunch band');
  assert(
    classifyPunchForSession(
      dayShift,
      { punched_in_at: dayIn, break_punch_out: lunchOut, punched_out_at: null },
      lunchIn
    ) === 'BREAK_IN',
    'lunch return BREAK_IN'
  );
  assert(
    classifyPunchForSession(
      dayShift,
      {
        punched_in_at: dayIn,
        break_punch_out: lunchOut,
        break_punch_in: lunchIn,
        punched_out_at: null,
      },
      eveningOut
    ) === 'CHECK_OUT',
    'evening CHECK_OUT'
  );

  // Late arrival after noon is CHECK_IN, not lunch
  assert(
    classifyPunchForSession(dayShift, null, '2026-01-27 13:10:00') === 'CHECK_IN',
    'first punch after 12 is late CHECK_IN'
  );

  // 15:40 is past lunch band (ends 15:30) — live path treats as DUPLICATE until evening;
  // INOUT recheck covers late lunch / missing outs.
  assert(!isInLunchBand(15 * 60 + 40), '15:40 outside lunch band (ends 15:30)');
  assert(
    classifyPunchForSession(
      dayShift,
      { punched_in_at: dayIn, punched_out_at: null },
      '2026-01-27 15:40:00'
    ) === 'DUPLICATE_CHECK_IN',
    '15:40 with morning IN is DUPLICATE_CHECK_IN (INOUT double-checks lunch)'
  );

  // Mid-morning second punch must NOT checkout
  assert(
    classifyPunchForSession(
      dayShift,
      { punched_in_at: dayIn, punched_out_at: null },
      '2026-01-27 10:15:00'
    ) === 'DUPLICATE_CHECK_IN',
    'mid-morning not checkout'
  );

  // Device double-tap seconds after lunch OUT must NOT fake BREAK_IN
  assert(
    classifyPunchForSession(
      dayShift,
      { punched_in_at: dayIn, break_punch_out: lunchOut, punched_out_at: null },
      '2026-01-27 13:12:00'
    ) === 'DUPLICATE_BREAK_OUT',
    'instant second punch after lunch out'
  );

  // After lunch complete, another midday punch must NOT checkout
  assert(
    classifyPunchForSession(
      dayShift,
      {
        punched_in_at: dayIn,
        break_punch_out: lunchOut,
        break_punch_in: lunchIn,
        punched_out_at: null,
      },
      '2026-01-27 14:05:00'
    ) === 'MIDDAY_AFTER_LUNCH',
    'post-lunch midday is not CHECK_OUT'
  );

  // Skipped lunch + evening → CHECK_OUT
  assert(
    classifyPunchForSession(
      dayShift,
      { punched_in_at: dayIn, punched_out_at: null },
      '2026-01-27 19:00:00'
    ) === 'CHECK_OUT',
    'skipped lunch evening out'
  );

  // Device dates are DD/MM. 10/06 is 10 June, not 6 October.
  const juneTen = parseLocalTimestamp('10/06/2026 20:07:00');
  assert(juneTen.dateStr === '2026-06-10' && juneTen.hours === 20 && juneTen.minutes === 7, '10/06 is 10 June 20:07');
  const octSix = parseLocalTimestamp('06/10/2026 08:01:00');
  assert(octSix.dateStr === '2026-10-06' && octSix.hours === 8, '06/10 is 6 October');
  assert(
    deviceCapturedAt('2026-10-06 20:07:00', { PunchDate: '10/06/2026 20:07:00' }) === '10/06/2026 20:07:00',
    'PunchDate wins over a swapped captured_at'
  );

  // Helper still stops at retriable; live sync uses MaxRecord so the plant never freezes.
  const cursor = nextSyncCursor('100', [
    { punch_id: 101, success: true, applied: true, terminal: true },
    { punch_id: 102, success: false, error: 'UNRESOLVABLE_SHIFT_TIME', terminal: false },
  ]);
  assert(cursor === '101', `cursor ${cursor}`);

  const capped = cappedSyncCursor(
    '100',
    [
      { punch_id: 101, success: true, applied: true, terminal: true },
      { punch_id: 102, success: false, error: 'UNRESOLVABLE_SHIFT_TIME', terminal: false },
    ],
    '500'
  );
  assert(capped === '101', `capped helper stops at retriable (${capped})`);

  // InOutPunchData helpers
  assert(isMissingOutTime('--'), 'missing --');
  assert(isMissingOutTime('00:00'), 'missing 00:00');
  assert(parseClockToMinutes('09:16') === 9 * 60 + 16, 'parse 09:16');
  assert(parseClockToMinutes('13:10') === 13 * 60 + 10, 'parse 13:10');

  const okRow = classifyInOutPunchRow({
    Empcode: '982',
    INTime: '09:16',
    OUTTime: '19:44',
    DateString: '18/11/2026',
    Name: 'Nayana IK',
  });
  assert(okRow.resolvedAction === 'ok' && !okRow.missingOut && !okRow.postNoonIn, 'ok inout row');

  const missingOutRow = classifyInOutPunchRow({
    Empcode: '0562',
    INTime: '09:16',
    OUTTime: '--',
    DateString: '18/11/2026',
  });
  assert(missingOutRow.missingOut && missingOutRow.resolvedAction === 'missing_out', 'missing out flagged');

  const lateArrival = classifyInOutPunchRow({
    Empcode: '0562',
    INTime: '13:10',
    OUTTime: '19:44',
    DateString: '18/11/2026',
  });
  assert(
    lateArrival.postNoonIn && lateArrival.resolvedAction === 'late_check_in',
    'post-12 IN alone is late_check_in, not auto lunch'
  );

  const lunchMisread = classifyInOutPunchRow(
    {
      Empcode: '0562',
      INTime: '13:10',
      OUTTime: '19:44',
      DateString: '18/11/2026',
    },
    { punched_in_at: '2026-11-18 08:30:00' }
  );
  assert(
    lunchMisread.postNoonIn && lunchMisread.resolvedAction === 'lunch_break_out',
    'post-12 IN with morning punched_in_at resolves to lunch_break_out'
  );

  console.log('verifyBiometricAttendance: all checks passed');
}

run();
