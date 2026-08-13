/**
 * Shortfall dispatch approvals — when lot qty < delivery schedule qty.
 */

const { createClient } = require('@supabase/supabase-js');
const { ensureNotification } = require('./notificationStore');
const { emitDispatchShortfallUpdated } = require('../socket/emitter');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function accessLevelFromUser(user) {
  return String(user?.access_level || user?.accessLevel || user?.job_description || '').toUpperCase();
}

function canRequestShortfall(user) {
  const level = accessLevelFromUser(user);
  return ['ADMIN', 'SUPERVISOR', 'MANAGER'].includes(level);
}

function canReviewShortfall(user) {
  const level = accessLevelFromUser(user);
  return level === 'ADMIN' || level === 'SUPERVISOR';
}

async function findActiveForLot(lotId) {
  if (!isValidUUID(lotId)) return null;
  const { data, error } = await supabase
    .from('dispatch_shortfall_requests')
    .select('*')
    .eq('lot_id', lotId)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findActiveForLots(lotIds) {
  const ids = [...new Set((lotIds || []).filter(isValidUUID))];
  if (!ids.length) return {};
  const { data, error } = await supabase
    .from('dispatch_shortfall_requests')
    .select('*')
    .in('lot_id', ids)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  const map = {};
  for (const row of data || []) {
    if (!map[row.lot_id]) map[row.lot_id] = row;
  }
  return map;
}

async function getApprovedForLot(lotId) {
  if (!isValidUUID(lotId)) return null;
  const { data, error } = await supabase
    .from('dispatch_shortfall_requests')
    .select('*')
    .eq('lot_id', lotId)
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function createShortfallRequest({
  lotId,
  requestedBy,
  reason,
  lotQty,
  scheduleId,
  scheduleQty,
}) {
  if (!isValidUUID(lotId)) throw httpError('Invalid lot id');
  if (!isValidUUID(scheduleId)) throw httpError('Invalid delivery schedule');
  const trimmedReason = String(reason || '').trim();
  if (!trimmedReason) throw httpError('Reason is required');

  const { data: lot, error: lotErr } = await supabase
    .from('production_lots')
    .select('id, lot_number, quantity, status, master_record_id')
    .eq('id', lotId)
    .maybeSingle();
  if (lotErr) throw lotErr;
  if (!lot) throw httpError('Lot not found', 404);
  if (lot.status !== 'ready_for_dispatch') {
    throw httpError('Lot is not ready for dispatch', 409);
  }

  const existing = await findActiveForLot(lotId);
  if (existing?.status === 'pending') {
    throw httpError('A shortfall approval request is already pending for this lot', 409);
  }
  if (existing?.status === 'approved') {
    throw httpError('Shortfall dispatch is already approved for this lot', 409);
  }

  const now = new Date().toISOString();
  const { data: created, error: insErr } = await supabase
    .from('dispatch_shortfall_requests')
    .insert({
      lot_id: lotId,
      delivery_schedule_id: scheduleId,
      lot_qty: toNumber(lotQty != null ? lotQty : lot.quantity),
      schedule_qty: toNumber(scheduleQty),
      reason: trimmedReason,
      status: 'pending',
      requested_by: requestedBy || null,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (insErr) throw insErr;

  let requesterName = 'User';
  if (requestedBy && isValidUUID(requestedBy)) {
    const { data: emp } = await supabase
      .from('employees')
      .select('full_name, employee_code')
      .eq('id', requestedBy)
      .maybeSingle();
    requesterName = emp?.full_name || emp?.employee_code || requesterName;
  }

  try {
    await ensureNotification({
      audience: 'admin',
      category: 'production',
      type: 'dispatch_shortfall_pending',
      severity: 'warning',
      priority: 2,
      title: 'Dispatch shortfall approval needed',
      body: `${requesterName} requested shortfall dispatch for lot ${lot.lot_number} (${toNumber(created.lot_qty)} of ${toNumber(created.schedule_qty)}).`,
      employee_id: requestedBy || null,
      dedupe_key: `prod:dispatch_shortfall:${created.id}`,
      payload: {
        dispatch_shortfall_request_id: created.id,
        lot_id: lotId,
        lot_number: lot.lot_number,
        delivery_schedule_id: scheduleId,
        lot_qty: toNumber(created.lot_qty),
        schedule_qty: toNumber(created.schedule_qty),
      },
    });
  } catch (notifyErr) {
    console.error('Dispatch shortfall notification failed:', notifyErr.message);
  }

  emitDispatchShortfallUpdated({
    action: 'created',
    requestId: created.id,
    lotId,
    status: 'pending',
  });

  return created;
}

async function listShortfallRequests({ status } = {}) {
  let query = supabase
    .from('dispatch_shortfall_requests')
    .select(
      `
      *,
      lot:production_lots!dispatch_shortfall_requests_lot_id_fkey(id, lot_number, quantity, status, master_record_id),
      schedule:delivery_schedules!dispatch_shortfall_requests_delivery_schedule_id_fkey(id, schedule_number, due_date, quantity),
      requester:employees!dispatch_shortfall_requests_requested_by_fkey(id, full_name, employee_code),
      reviewer:employees!dispatch_shortfall_requests_reviewed_by_fkey(id, full_name, employee_code)
    `
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;

  const recordIds = [
    ...new Set((data || []).map((r) => r.lot?.master_record_id).filter(Boolean)),
  ];
  let labelById = {};
  if (recordIds.length) {
    const { data: lookups } = await supabase
      .from('v_master_lookup')
      .select('record_id, label')
      .in('record_id', recordIds);
    labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));
  }

  return (data || []).map((row) => ({
    ...row,
    lot_number: row.lot?.lot_number || null,
    lot_status: row.lot?.status || null,
    component_label: row.lot?.master_record_id
      ? labelById[row.lot.master_record_id] || null
      : null,
    schedule_number: row.schedule?.schedule_number || null,
    schedule_due_date: row.schedule?.due_date || null,
    requester_name: row.requester?.full_name || null,
    requester_code: row.requester?.employee_code || null,
    reviewer_name: row.reviewer?.full_name || null,
    lot: undefined,
    schedule: undefined,
    requester: undefined,
    reviewer: undefined,
  }));
}

async function approveShortfallRequest(id, reviewerId, { reviewNote } = {}) {
  if (!isValidUUID(id)) throw httpError('Invalid request id');

  const { data: request, error } = await supabase
    .from('dispatch_shortfall_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!request) throw httpError('Request not found', 404);
  if (request.status !== 'pending') {
    throw httpError(`Request is already ${request.status}`, 409);
  }

  const now = new Date().toISOString();
  const { data: updated, error: upErr } = await supabase
    .from('dispatch_shortfall_requests')
    .update({
      status: 'approved',
      reviewed_by: reviewerId || null,
      reviewed_at: now,
      review_note: reviewNote ? String(reviewNote).trim() : null,
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (upErr) throw upErr;

  emitDispatchShortfallUpdated({
    action: 'approved',
    requestId: updated.id,
    lotId: updated.lot_id,
    status: 'approved',
  });

  return { request: updated };
}

async function denyShortfallRequest(id, reviewerId, { reviewNote } = {}) {
  if (!isValidUUID(id)) throw httpError('Invalid request id');

  const { data: request, error } = await supabase
    .from('dispatch_shortfall_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!request) throw httpError('Request not found', 404);
  if (request.status !== 'pending') {
    throw httpError(`Request is already ${request.status}`, 409);
  }

  const now = new Date().toISOString();
  const { data: updated, error: upErr } = await supabase
    .from('dispatch_shortfall_requests')
    .update({
      status: 'denied',
      reviewed_by: reviewerId || null,
      reviewed_at: now,
      review_note: reviewNote ? String(reviewNote).trim() : null,
      updated_at: now,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (upErr) throw upErr;

  emitDispatchShortfallUpdated({
    action: 'denied',
    requestId: updated.id,
    lotId: updated.lot_id,
    status: 'denied',
  });

  return { request: updated };
}

async function consumeShortfallRequest(requestId) {
  if (!isValidUUID(requestId)) return null;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('dispatch_shortfall_requests')
    .update({ status: 'consumed', updated_at: now })
    .eq('id', requestId)
    .eq('status', 'approved')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (data) {
    emitDispatchShortfallUpdated({
      action: 'consumed',
      requestId: data.id,
      lotId: data.lot_id,
      status: 'consumed',
    });
  }
  return data;
}

module.exports = {
  canRequestShortfall,
  canReviewShortfall,
  findActiveForLot,
  findActiveForLots,
  getApprovedForLot,
  createShortfallRequest,
  listShortfallRequests,
  approveShortfallRequest,
  denyShortfallRequest,
  consumeShortfallRequest,
};
