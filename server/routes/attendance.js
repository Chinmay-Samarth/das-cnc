/**
 * DasCNC Attendance API Routes (Supabase Version)
 * ─────────────────────────────────────────────
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const { createClient } = require('@supabase/supabase-js');
const TZ = process.env.TIMEZONE || 'Asia/Kolkata';
const IST_OFFSET = '+05:30';

const {
  processBiometricEvent
} = require('../services/attendanceEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

// TO IST FUNCTION 
function toIST(value) {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(date).map(p => [p.type, p.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${IST_OFFSET}`;
}




// ─────────────────────────────────────────────
// DEVICE AUTH MIDDLEWARE
// ─────────────────────────────────────────────

function verifyDevice(req, res, next) {
  const secret = req.headers['x-device-secret'];

  if (secret !== process.env.DEVICE_SECRET) {
    return res
      .status(401)
      .json({ error: 'Unauthorized device' });
  }

  next();
}

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─────────────────────────────────────────────
// POST /api/attendance/biometric
// ─────────────────────────────────────────────

router.post(
  '/biometric',
  verifyDevice,
  async (req, res) => {

    try {
      const {
        employee_code,
        punch_id,
        captured_at
      } = req.body;

      if (
        !employee_code ||
        !punch_id ||
        !captured_at
      ) {
        return res.status(400).json({
          error: 'Missing required fields'
        });
      }

      // if (
      //   !['CHECK_IN', 'CHECK_OUT']
      //     .includes(event_type)
      // ) {
      //   return res.status(400).json({
      //     error:
      //       'event_type must be CHECK_IN or CHECK_OUT'
      //   });
      // }

      const result =
        await processBiometricEvent({
          employee_code,
          punch_id,
          captured_at,
          event_type: req.body.event_type
        });

      if (!result.success) {
        return res
          .status(422)
          .json({ error: result.error });
      }

      return res.json({
        message:
          result.event_type === 'CHECK_IN'
            ? 'Checked in successfully'
            : 'Checked out successfully',

        ...result
      });

    } catch (err) {

      console.error(
        'Biometric event error:',
        err
      );

      return res.status(500).json({
        error: 'Internal server error'
      });
    }
  }
);

// ─────────────────────────────────────────────
// POST /api/attendance/manual
// ─────────────────────────────────────────────

router.post('/manual', verifyEmployeeAuth, async (req, res) => {

  // TODO:
  // Add ADMIN / SUPERVISOR AUTH

  try {

    const {
      employee_id,
      shift_date,
      status,
      punched_in_at,
      punched_out_at,
      note
    } = req.body;

    const validStatuses = [
      'PRESENT',
      'COMPLETED',
      'ABSENT',
      'LATE',
      'HALF_DAY',
      'LEAVE'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status`
      });
    }

    // GET EMPLOYEE
    const {
      data: employee,
      error: empError
    } = await supabase
      .from('employees')
      .select('id, shift_id')
      .eq('id', employee_id)
      .single();

    if (!employee || empError) {
      return res.status(404).json({
        error: 'Employee not found'
      });
    }

    // CHECK EXISTING RECORD
    const {
      data: existingRecord
    } = await supabase
      .from('attendance_records')
      .select('*')
      .eq('employee_id', employee_id)
      .eq('shift_date', shift_date)
      .maybeSingle();

    // UPDATE
    if (existingRecord) {

      const { error } = await supabase
        .from('attendance_records')
        .update({
          status,

          punched_in_at:
            punched_in_at ||
            existingRecord.punched_in_at,

          punched_out_at:
            punched_out_at ||
            existingRecord.punched_out_at,

          supervisor_note: note || null,

          updated_at: new Date()
        })
        .eq('id', existingRecord.id);

      if (error) throw error;

    } else {

      // INSERT
      const { error } = await supabase
        .from('attendance_records')
        .insert({
          employee_id,
          shift_id: employee.shift_id,
          shift_date,

          punched_in_at:
            punched_in_at || null,

          punched_out_at:
            punched_out_at || null,

          status,

          supervisor_note:
            note || null
        });

      if (error) throw error;
    }

    return res.json({
      message:
        'Record updated successfully'
    });

  } catch (err) {

    console.error(
      'Manual override error:',
      err
    );

    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// ─────────────────────────────────────────────
// GET /api/attendance/daily
// ─────────────────────────────────────────────

router.get('/daily', verifyEmployeeAuth, async (req, res) => {

  try {

    const tz =
      process.env.TIMEZONE ||
      'Asia/Kolkata';

    const date =
      req.query.date ||
      new Date().toLocaleDateString(
        'en-CA',
        { timeZone: tz }
      );

    // FETCH EMPLOYEES + ATTENDANCE
    let query = supabase
      .from('employees')
      .select(`
        id,
        employee_code,
        full_name,
        role,
        department:departments(name),
        shift:shifts(name,start_time),
        attendance_records!attendance_records_employee_id_fkey (
          shift_date,
          status,
          punched_in_at,
          punched_out_at,
          minutes_worked,
          overtime_minutes,
          supervisor_note
        )
      `)
      .eq('is_active', true);

    const { data, error } =
      await query;

    if (error) throw error;

    let rows = [];

    for (const emp of data) {

      const attendance =
        emp.attendance_records.find(
          r => r.shift_date === date
        );

      if (
        req.query.shift &&
        emp.shift?.name !== req.query.shift
      ) {
        continue;
      }

      rows.push({
        id: emp.id,
        employee_code: emp.employee_code,
        full_name: emp.full_name,
        role: emp.role,

        department:
          emp.department?.name || null,

        shift:
          emp.shift?.name || null,

        shift_date:
          attendance?.shift_date || date,

        status:
          attendance?.status || 'ABSENT',

        local_in:
          attendance?.punched_in_at || null,

        local_out:
          attendance?.punched_out_at || null,

        minutes_worked:
          attendance?.minutes_worked || 0,

        overtime_minutes:
          attendance?.overtime_minutes || 0,

        source: null,

        supervisor_note:
          attendance?.supervisor_note || null
      });
    }

    rows.sort((a, b) =>
      a.full_name.localeCompare(b.full_name)
    );

    // SUMMARY
    const summary = {
      total: rows.length,

      present: rows.filter(r =>
        ['PRESENT', 'COMPLETED', 'LATE']
          .includes(r.status)
      ).length,

      absent: rows.filter(r =>
        r.status === 'ABSENT'
      ).length,

      late: rows.filter(r =>
        r.status === 'LATE'
      ).length,

      on_leave: rows.filter(r =>
        r.status === 'LEAVE'
      ).length
    };

    return res.json({
      date,
      summary,
      records: rows
    });

  } catch (err) {

    console.error(
      'Daily attendance error:',
      err.message
    );

    return res.status(500).json({
      error: 'Internal server error',
      message: err.message
    });
  }
});

// ─────────────────────────────────────────────
// GET /api/attendance/employee/:id
// ─────────────────────────────────────────────

router.get(
  '/employee/:id',
  verifyEmployeeAuth,
  async (req, res) => {

    try {

      const { id } = req.params;

      const from =
        req.query.from ||
        new Date(
          Date.now() - 30 * 86400000
        )
          .toISOString()
          .slice(0, 10);

      const to =
        req.query.to ||
        new Date()
          .toISOString()
          .slice(0, 10);

      const {
        data: rows,
        error
      } = await supabase
        .from('attendance_records')
        .select(`
          shift_date,
          status,
          punched_in_at,
          punched_out_at,
          minutes_worked,
          overtime_minutes,
          supervisor_note,
          shifts(name)
        `)
        .eq('employee_id', id)
        .gte('shift_date', from)
        .lte('shift_date', to)
        .order('shift_date', {
          ascending: false
        });

      if (error) throw error;

      // FORMAT
      const formatted = rows.map(r => ({
        shift_date: r.shift_date,

        shift: r.shifts?.name || null,

        status: r.status,

        punched_in_at:
          toIST(r.punched_in_at),

        punched_out_at:
          toIST(r.punched_out_at),

        minutes_worked:
          r.minutes_worked,

        overtime_minutes:
          r.overtime_minutes,

        supervisor_note:
          r.supervisor_note
      }));

      // STATS
      const totalDays =
        formatted.length;

      const presentDays =
        formatted.filter(r =>
          ['PRESENT', 'COMPLETED', 'LATE']
            .includes(r.status)
        ).length;

      const totalOvertime =
        formatted.reduce(
          (sum, r) =>
            sum +
            (r.overtime_minutes || 0),
          0
        );

      return res.json({
        employee_id: id,

        from,
        to,

        stats: {
          total_days:
            totalDays,

          present_days:
            presentDays,

          absent_days:
            formatted.filter(r =>
              r.status === 'ABSENT'
            ).length,

          late_days:
            formatted.filter(r =>
              r.status === 'LATE'
            ).length,

          leave_days:
            formatted.filter(r =>
              r.status === 'LEAVE'
            ).length,

          total_overtime_h:
            Math.round(
              totalOvertime / 60 * 10
            ) / 10,

          attendance_pct:
            totalDays
              ? Math.round(
                  (presentDays /
                    totalDays) *
                    100
                )
              : 0
        },

        records: formatted
      });

    } catch (err) {

      console.error(
        'Employee history error:',
        err
      );

      return res.status(500).json({
        error: 'Internal server error',
        message: err.message
      });
    }
  }
);

// ─────────────────────────────────────────────
// GET /api/attendance/employee/:id/recent
// ─────────────────────────────────────────────
router.get(
  '/employee/:id/recent',
  verifyEmployeeAuth,
  async (req, res) => {
    const today = new Date()
    try {
      const { id } = req.params;
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(today.setDate(1))
        .toISOString()
        .slice(0, 10);

      const {
        data: rows,
        error
      } = await supabase
        .from('attendance_records')
        .select(`
          shift_date,
          status,
          punched_in_at,
          punched_out_at,
          minutes_worked,
          overtime_minutes,
          supervisor_note,
          shifts(name)
        `)
        .eq('employee_id', id)
        .gte('shift_date', from)
        .lte('shift_date', to)
        .order('shift_date', { ascending: false });

      if (error) throw error;

      const formatted = rows.map((r) => ({
        shift_date: r.shift_date,
        shift: r.shifts?.name || null,
        status: r.status,
        punched_in_at: toIST(r.punched_in_at),
        punched_out_at: toIST(r.punched_out_at),
        minutes_worked: r.minutes_worked,
        overtime_minutes: r.overtime_minutes,
        supervisor_note: r.supervisor_note,
      }));

      return res.json({
        employee_id: id,
        from,
        to,
        records: formatted,
      });
    } catch (err) {
      console.error('Recent employee attendance error:', err);
      return res.status(500).json({
        error: 'Internal server error',
        message: err.message,
      });
    }
  }
);

module.exports = router;