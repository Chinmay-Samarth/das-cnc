/**
 * Leave request create / list / approve / deny.
 * Approve writes LEAVE attendance only for missing or ABSENT days (never present-family).
 */

const { createClient } = require('@supabase/supabase-js');
const { computeAccessLevel, isWorkforceEmployee } = require('../utils/accessLevel');
const { ensureNotification } = require('./notificationStore');
const { emitLeaveRequestUpdated, emitAttendanceUpdated } = require('../socket/emitter');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PRESENT_FAMILY = new Set(['PRESENT', 'COMPLETED', 'LATE', 'HALF_DAY']);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function isValidYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd)
    .split('-')
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function eachYmdInclusive(startYmd, endYmd) {
  const out = [];
  let cur = startYmd;
  while (cur <= endYmd) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

function accessLevelFromUser(user) {
  return String(user?.access_level || user?.accessLevel || user?.job_description || '').toUpperCase();
}

function canApplyLeave(user) {
  const level = accessLevelFromUser(user);
  return level === 'OPERATOR' || level === 'MANAGER';
}

function canReviewLeave(user) {
  const level = accessLevelFromUser(user);
  return level === 'ADMIN' || level === 'SUPERVISOR';
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

async function createLeaveRequest({ employeeId, startDate, days, reason }) {
  if (!isValidUUID(employeeId)) throw httpError('Invalid employee', 400);
  if (!isValidYmd(startDate)) throw httpError('Invalid start date', 400);
  const dayCount = Math.floor(Number(days));
  if (!(dayCount >= 1 && dayCount <= 365)) throw httpError('Days must be between 1 and 365', 400);
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw httpError('Reason is required', 400);

  const { data: employee, error: empErr } = await supabase
    .from('employees')
    .select('id, full_name, employee_code, is_active, job_description')
    .eq('id', employeeId)
    .maybeSingle();
  if (empErr) throw empErr;
  if (!employee) throw httpError('Employee not found', 404);
  if (!isWorkforceEmployee(employee)) {
    throw httpError('Only workforce employees can request leave', 403);
  }

  const endDate = addDaysYmd(startDate, dayCount - 1);

  const { data: existing, error: exErr } = await supabase
    .from('leave_requests')
    .select('id, start_date, end_date, status')
    .eq('employee_id', employeeId)
    .in('status', ['pending', 'approved']);
  if (exErr) throw exErr;

  for (const row of existing || []) {
    if (rangesOverlap(startDate, endDate, row.start_date, row.end_date)) {
      throw httpError(
        `Overlaps existing ${row.status} leave (${row.start_date} → ${row.end_date})`,
        409
      );
    }
  }

  const now = new Date().toISOString();
  const { data: created, error: insErr } = await supabase
    .from('leave_requests')
    .insert({
      employee_id: employeeId,
      start_date: startDate,
      days: dayCount,
      end_date: endDate,
      reason: trimmedReason,
      status: 'pending',
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (insErr) throw insErr;

  const name = employee.full_name || employee.employee_code || 'Employee';
  try {
    await ensureNotification({
      audience: 'admin',
      category: 'attendance',
      type: 'leave_request_pending',
      severity: 'info',
      priority: 3,
      title: 'Leave request pending',
      body: `${name} requested ${dayCount} day(s) leave (${startDate} → ${endDate}).`,
      employee_id: employeeId,
      dedupe_key: `att:leave_req:${created.id}`,
      payload: {
        leave_request_id: created.id,
        employee_id: employeeId,
        employee_name: name,
        employee_code: employee.employee_code || null,
        start_date: startDate,
        end_date: endDate,
        days: dayCount,
      },
    });
  } catch (notifyErr) {
    console.error('Leave request notification failed:', notifyErr.message);
  }

  emitLeaveRequestUpdated({
    action: 'created',
    leaveRequestId: created.id,
    employeeId: employeeId,
    status: 'pending',
    startDate: created.start_date,
    endDate: created.end_date,
    days: created.days,
  });

  return created;
}

async function listMyLeaveRequests(employeeId) {
  if (!isValidUUID(employeeId)) throw httpError('Invalid employee', 400);
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

async function listLeaveRequests({ status } = {}) {
  let query = supabase
    .from('leave_requests')
    .select(
      `
      *,
      employee:employees!leave_requests_employee_id_fkey(id, full_name, employee_code),
      reviewer:employees!leave_requests_reviewed_by_fkey(id, full_name, employee_code)
    `
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((row) => ({
    ...row,
    employee_name: row.employee?.full_name || null,
    employee_code: row.employee?.employee_code || null,
    reviewer_name: row.reviewer?.full_name || null,
    employee: undefined,
    reviewer: undefined,
  }));
}

async function writeLeaveDaysForRequest(request, reviewerId) {
  const days = eachYmdInclusive(request.start_date, request.end_date);
  let leaveDaysWritten = 0;
  let skippedPresentDays = 0;
  let alreadyLeaveDays = 0;

  const { data: employee } = await supabase
    .from('employees')
    .select('id, shift_id')
    .eq('id', request.employee_id)
    .maybeSingle();

  for (const ymd of days) {
    const { data: existing, error } = await supabase
      .from('attendance_records')
      .select('id, status')
      .eq('employee_id', request.employee_id)
      .eq('shift_date', ymd)
      .maybeSingle();
    if (error) throw error;

    const status = existing?.status || null;
    if (status && PRESENT_FAMILY.has(status)) {
      skippedPresentDays += 1;
      continue;
    }
    if (status === 'LEAVE') {
      alreadyLeaveDays += 1;
      continue;
    }

    const note = `Approved leave request ${request.id}`;
    if (existing) {
      const { error: uErr } = await supabase
        .from('attendance_records')
        .update({
          status: 'LEAVE',
          supervisor_note: note,
          approved_by: reviewerId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (uErr) throw uErr;
    } else {
      const { error: iErr } = await supabase.from('attendance_records').insert({
        employee_id: request.employee_id,
        shift_id: employee?.shift_id || null,
        shift_date: ymd,
        status: 'LEAVE',
        supervisor_note: note,
        approved_by: reviewerId || null,
      });
      if (iErr) throw iErr;
    }
    leaveDaysWritten += 1;
  }

  return { leaveDaysWritten, skippedPresentDays, alreadyLeaveDays };
}

async function approveLeaveRequest(requestId, reviewerId, { reviewNote } = {}) {
  if (!isValidUUID(requestId)) throw httpError('Invalid leave request id', 400);

  const { data: request, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  if (!request) throw httpError('Leave request not found', 404);
  if (request.status !== 'pending') {
    throw httpError(`Leave request is already ${request.status}`, 409);
  }

  const writeSummary = await writeLeaveDaysForRequest(request, reviewerId);
  const now = new Date().toISOString();
  const { data: updated, error: uErr } = await supabase
    .from('leave_requests')
    .update({
      status: 'approved',
      reviewed_by: reviewerId || null,
      reviewed_at: now,
      review_note: reviewNote ? String(reviewNote).trim() : null,
      updated_at: now,
    })
    .eq('id', requestId)
    .select('*')
    .single();
  if (uErr) throw uErr;

  emitLeaveRequestUpdated({
    action: 'approved',
    leaveRequestId: updated.id,
    employeeId: updated.employee_id,
    status: 'approved',
    startDate: updated.start_date,
    endDate: updated.end_date,
    days: updated.days,
    leaveDaysWritten: writeSummary.leaveDaysWritten,
    skippedPresentDays: writeSummary.skippedPresentDays,
  });

  // Refresh attendance boards for days that gained LEAVE rows
  for (const ymd of eachYmdInclusive(updated.start_date, updated.end_date)) {
    emitAttendanceUpdated({
      date: ymd,
      employeeId: updated.employee_id,
      action: 'leave_approved',
      leaveRequestId: updated.id,
    });
  }

  return {
    request: updated,
    leave_days_written: writeSummary.leaveDaysWritten,
    skipped_present_days: writeSummary.skippedPresentDays,
    already_leave_days: writeSummary.alreadyLeaveDays,
  };
}

async function denyLeaveRequest(requestId, reviewerId, { reviewNote } = {}) {
  if (!isValidUUID(requestId)) throw httpError('Invalid leave request id', 400);

  const { data: request, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  if (!request) throw httpError('Leave request not found', 404);
  if (request.status !== 'pending') {
    throw httpError(`Leave request is already ${request.status}`, 409);
  }

  const now = new Date().toISOString();
  const { data: updated, error: uErr } = await supabase
    .from('leave_requests')
    .update({
      status: 'denied',
      reviewed_by: reviewerId || null,
      reviewed_at: now,
      review_note: reviewNote ? String(reviewNote).trim() : null,
      updated_at: now,
    })
    .eq('id', requestId)
    .select('*')
    .single();
  if (uErr) throw uErr;

  emitLeaveRequestUpdated({
    action: 'denied',
    leaveRequestId: updated.id,
    employeeId: updated.employee_id,
    status: 'denied',
    startDate: updated.start_date,
    endDate: updated.end_date,
    days: updated.days,
  });

  return { request: updated };
}

module.exports = {
  createLeaveRequest,
  listMyLeaveRequests,
  listLeaveRequests,
  approveLeaveRequest,
  denyLeaveRequest,
  canApplyLeave,
  canReviewLeave,
  accessLevelFromUser,
  computeAccessLevel,
};
