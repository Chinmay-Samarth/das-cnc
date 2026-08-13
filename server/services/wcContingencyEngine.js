/**
 * WC day contingency — acting manager when primary is ABSENT / LEAVE / missing attendance.
 */

const { createClient } = require('@supabase/supabase-js');
const { todayDateString } = require('./blanketPosEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PRESENT_STATUSES = new Set(['PRESENT', 'LATE', 'COMPLETED']);
const UNAVAILABLE_STATUSES = new Set(['ABSENT', 'LEAVE']);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function accessLevelFromUser(user) {
  return String(user?.access_level || user?.accessLevel || user?.job_description || '').toUpperCase();
}

function canPinActing(user) {
  const level = accessLevelFromUser(user);
  return level === 'ADMIN' || level === 'SUPERVISOR';
}

async function getAttendanceStatus(employeeId, date) {
  if (!isValidUUID(employeeId) || !date) return null;
  const { data, error } = await supabase
    .from('attendance_records')
    .select('status')
    .eq('employee_id', employeeId)
    .eq('shift_date', date)
    .maybeSingle();
  if (error) throw error;
  return data?.status || null;
}

function isPresentFamily(status) {
  return PRESENT_STATUSES.has(String(status || ''));
}

function reasonForUnavailable(status) {
  if (status === 'LEAVE') return 'manager_leave';
  if (status === 'ABSENT') return 'manager_absent';
  return 'manager_no_attendance';
}

async function isEmployeePresent(employeeId, date) {
  const status = await getAttendanceStatus(employeeId, date);
  return isPresentFamily(status);
}

/**
 * Least-load present WC member excluding the primary manager (same sort as pickAssignee).
 */
async function pickActingCandidate(workCenterId, workDate, primaryManagerId) {
  const { candidatesForWorkCenter, backlogStats } = require('./productionAssignEngine');
  const candidates = (await candidatesForWorkCenter(workCenterId, workDate)).filter(
    (emp) => emp.id !== primaryManagerId
  );
  if (!candidates.length) return null;

  const scored = [];
  for (const emp of candidates) {
    const stats = await backlogStats(emp.id, workDate, workCenterId);
    scored.push({
      ...emp,
      total_qty: stats.totalQty,
      total_tasks: stats.totalTasks,
    });
  }
  scored.sort((a, b) => {
    if (a.total_qty !== b.total_qty) return a.total_qty - b.total_qty;
    if (a.total_tasks !== b.total_tasks) return a.total_tasks - b.total_tasks;
    return String(a.employee_code || '').localeCompare(String(b.employee_code || ''));
  });
  return scored[0] || null;
}

async function loadContingencyRow(workCenterId, workDate) {
  const { data, error } = await supabase
    .from('wc_day_contingencies')
    .select('*')
    .eq('work_center_id', workCenterId)
    .eq('work_date', workDate)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function enrichActingEmployee(employeeId) {
  if (!isValidUUID(employeeId)) return null;
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, employee_code')
    .eq('id', employeeId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function emptyResult(primaryManagerId) {
  return {
    primary_manager_id: primaryManagerId || null,
    effective_manager_id: primaryManagerId || null,
    acting_employee_id: null,
    acting_employee: null,
    manager_unavailable: false,
    reason: null,
    pinned: false,
  };
}

/**
 * Resolve effective manager for a WC + plant day.
 * Creates a stable day contingency when primary is unavailable.
 */
async function resolveActingManager(workCenterId, workDate) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');
  const date = String(workDate || todayDateString()).slice(0, 10);

  const { data: wc, error: wcErr } = await supabase
    .from('work_centers')
    .select('id, manager_employee_id')
    .eq('id', workCenterId)
    .maybeSingle();
  if (wcErr) throw wcErr;
  if (!wc) throw httpError('Work center not found', 404);

  const primaryId = wc.manager_employee_id || null;
  if (!primaryId) {
    return emptyResult(null);
  }

  const status = await getAttendanceStatus(primaryId, date);
  if (isPresentFamily(status)) {
    return emptyResult(primaryId);
  }

  const reason = reasonForUnavailable(status);
  const existing = await loadContingencyRow(workCenterId, date);
  if (existing?.acting_employee_id) {
    const acting = await enrichActingEmployee(existing.acting_employee_id);
    return {
      primary_manager_id: primaryId,
      effective_manager_id: existing.acting_employee_id,
      acting_employee_id: existing.acting_employee_id,
      acting_employee: acting,
      manager_unavailable: true,
      reason: existing.reason || reason,
      pinned: !!existing.pinned,
    };
  }

  const picked = await pickActingCandidate(workCenterId, date, primaryId);
  if (!picked) {
    return {
      primary_manager_id: primaryId,
      effective_manager_id: null,
      acting_employee_id: null,
      acting_employee: null,
      manager_unavailable: true,
      reason,
      pinned: false,
    };
  }

  const now = new Date().toISOString();
  const { data: created, error: insErr } = await supabase
    .from('wc_day_contingencies')
    .upsert(
      {
        work_center_id: workCenterId,
        work_date: date,
        primary_manager_id: primaryId,
        acting_employee_id: picked.id,
        reason,
        pinned: false,
        updated_at: now,
      },
      { onConflict: 'work_center_id,work_date' }
    )
    .select('*')
    .single();
  if (insErr) throw insErr;

  // Race: another writer may have won — prefer DB row as source of truth
  const row = created || (await loadContingencyRow(workCenterId, date));
  const actingId = row?.acting_employee_id || picked.id;
  const acting = await enrichActingEmployee(actingId);

  return {
    primary_manager_id: primaryId,
    effective_manager_id: actingId,
    acting_employee_id: actingId,
    acting_employee: acting,
    manager_unavailable: true,
    reason: row?.reason || reason,
    pinned: !!row?.pinned,
  };
}

/**
 * Admin/supervisor pin override for the day.
 */
async function pinActingManager(workCenterId, workDate, actingEmployeeId, actorId) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');
  if (!isValidUUID(actingEmployeeId)) throw httpError('employee_id is required');
  const date = String(workDate || todayDateString()).slice(0, 10);

  const resolved = await resolveActingManager(workCenterId, date);
  if (!resolved.manager_unavailable) {
    throw httpError('Cannot pin acting manager while the regular WC manager is present', 409);
  }
  if (resolved.primary_manager_id && actingEmployeeId === resolved.primary_manager_id) {
    throw httpError('Cannot pin the regular manager as acting manager', 409);
  }

  const present = await isEmployeePresent(actingEmployeeId, date);
  if (!present) {
    throw httpError('Acting manager must be present (PRESENT / LATE / COMPLETED) today', 409);
  }

  const { data: membership, error: mErr } = await supabase
    .from('employee_work_centers')
    .select('id')
    .eq('work_center_id', workCenterId)
    .eq('employee_id', actingEmployeeId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!membership) throw httpError('Employee is not a member of this work center', 409);

  const now = new Date().toISOString();
  const reason = resolved.reason || 'manager_absent';
  const { data: row, error } = await supabase
    .from('wc_day_contingencies')
    .upsert(
      {
        work_center_id: workCenterId,
        work_date: date,
        primary_manager_id: resolved.primary_manager_id,
        acting_employee_id: actingEmployeeId,
        reason,
        pinned: true,
        pinned_by: actorId || null,
        pinned_at: now,
        updated_at: now,
      },
      { onConflict: 'work_center_id,work_date' }
    )
    .select('*')
    .single();
  if (error) throw error;

  const acting = await enrichActingEmployee(actingEmployeeId);
  return {
    primary_manager_id: resolved.primary_manager_id,
    effective_manager_id: actingEmployeeId,
    acting_employee_id: actingEmployeeId,
    acting_employee: acting,
    manager_unavailable: true,
    reason: row.reason,
    pinned: true,
  };
}

/**
 * Allow primary manager or today's acting manager. Supervisor bypass opt-in.
 */
async function assertEffectiveWCManager(
  workCenterId,
  actorId,
  workDate,
  { isSupervisor = false } = {}
) {
  if (isSupervisor) return true;
  if (!isValidUUID(actorId)) {
    throw httpError('Only the work center manager can perform this action', 403);
  }
  const date = String(workDate || todayDateString()).slice(0, 10);
  const contingency = await resolveActingManager(workCenterId, date);
  const effective = contingency.effective_manager_id || contingency.primary_manager_id;
  if (effective !== actorId) {
    throw httpError('Only the work center manager can perform this action', 403);
  }
  return true;
}

/**
 * WCs where employee is primary manager or today's acting.
 */
async function listActingWorkCenterIds(employeeId, workDate) {
  if (!isValidUUID(employeeId)) return [];
  const date = String(workDate || todayDateString()).slice(0, 10);
  const { data, error } = await supabase
    .from('wc_day_contingencies')
    .select('work_center_id')
    .eq('acting_employee_id', employeeId)
    .eq('work_date', date);
  if (error) throw error;
  return (data || []).map((r) => r.work_center_id).filter(Boolean);
}

/**
 * Job reassign allowed only when regular manager is unavailable.
 */
async function assertJobReassignAllowed(workCenterId, workDate, actorId, user) {
  const date = String(workDate || todayDateString()).slice(0, 10);
  const contingency = await resolveActingManager(workCenterId, date);
  if (!contingency.manager_unavailable) {
    throw httpError(
      'Job reassign is only available when the WC manager is absent or on leave',
      409
    );
  }

  const level = accessLevelFromUser(user);
  const isReviewer = level === 'ADMIN' || level === 'SUPERVISOR';
  const isActing = contingency.acting_employee_id && contingency.acting_employee_id === actorId;
  if (!isReviewer && !isActing) {
    throw httpError('Not allowed to reassign jobs', 403);
  }
  return contingency;
}

module.exports = {
  PRESENT_STATUSES,
  UNAVAILABLE_STATUSES,
  canPinActing,
  getAttendanceStatus,
  isEmployeePresent,
  isPresentFamily,
  resolveActingManager,
  pinActingManager,
  assertEffectiveWCManager,
  listActingWorkCenterIds,
  assertJobReassignAllowed,
  pickActingCandidate,
};
