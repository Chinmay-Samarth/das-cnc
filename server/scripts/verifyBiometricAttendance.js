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
} = require('../services/attendanceEngine');
const { nextSyncCursor } = require('../services/biometricSync');

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

  // Mid-morning second punch must NOT checkout
  assert(
    classifyPunchForSession(
      dayShift,
      { punched_in_at: dayIn, punched_out_at: null },
      '2026-01-27 10:15:00'
    ) === 'DUPLICATE_CHECK_IN',
    'mid-morning not checkout'
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

  const cursor = nextSyncCursor('100', [
    { punch_id: 101, success: true, applied: true, terminal: true },
    { punch_id: 102, success: false, error: 'UNRESOLVABLE_SHIFT_TIME', terminal: false },
  ]);
  assert(cursor === '101', `cursor ${cursor}`);

  console.log('verifyBiometricAttendance: all checks passed');
}

run();
