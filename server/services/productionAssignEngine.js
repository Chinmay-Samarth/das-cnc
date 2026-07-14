const { createClient } = require('@supabase/supabase-js');
const { SCHEDULABLE_TYPES } = require('../config/activityFlowTypes');
const {
  resolveFirstSchedulableNode,
  resolveNextSchedulableNode,
  loadFlowGraph,
} = require('./activityFlowRoute');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PRESENT_STATUSES = new Set(['PRESENT', 'LATE', 'COMPLETED']);
const OPEN_STATUSES = ['READY', 'RUNNING', 'OVERDUE'];

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

function dayGoal(card) {
  return toNumber(card.target_quantity) + toNumber(card.overdue_quantity);
}

function remainingQty(card) {
  return Math.max(0, dayGoal(card) - toNumber(card.total_good_produced));
}

async function listPresentEmployeeIds(date) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('employee_id, status')
    .eq('shift_date', date);

  if (error) throw error;

  return [
    ...new Set(
      (data || [])
        .filter((r) => PRESENT_STATUSES.has(r.status))
        .map((r) => r.employee_id)
        .filter(Boolean)
    ),
  ];
}

async function listWorkCenterMemberIds(workCenterId) {
  const { data, error } = await supabase
    .from('employee_work_centers')
    .select('employee_id')
    .eq('work_center_id', workCenterId);
  if (error) throw error;
  return (data || []).map((r) => r.employee_id);
}

async function candidatesForWorkCenter(workCenterId, date) {
  const [memberIds, presentIds] = await Promise.all([
    listWorkCenterMemberIds(workCenterId),
    listPresentEmployeeIds(date),
  ]);
  if (!memberIds.length) return [];

  const presentSet = new Set(presentIds);
  const candidateIds = memberIds.filter((id) => presentSet.has(id));
  if (!candidateIds.length) return [];

  const { data: employees, error } = await supabase
    .from('employees')
    .select('id, full_name, employee_code, is_active')
    .in('id', candidateIds)
    .eq('is_active', true)
    .order('employee_code', { ascending: true });

  if (error) throw error;
  return employees || [];
}

function dayWindowUtc(date) {
  const start = `${date}T00:00:00.000Z`;
  const endDate = new Date(`${date}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  return { start, end: endDate.toISOString() };
}

async function backlogStats(employeeId, date, workCenterId = null) {
  let query = supabase
    .from('production_cards')
    .select('target_quantity, overdue_quantity, total_good_produced, status')
    .eq('assigned_employee_id', employeeId)
    .eq('work_date', date)
    .in('status', OPEN_STATUSES);

  if (workCenterId) query = query.eq('work_center_id', workCenterId);

  const { data, error } = await query;
  if (error) throw error;

  const cards = data || [];
  let backlog = cards.reduce((sum, c) => sum + remainingQty(c), 0);
  let openCards = cards.length;

  // Traveler lots assigned to this operator at the WC
  {
    let lotQuery = supabase
      .from('production_lots')
      .select('quantity')
      .eq('assigned_employee_id', employeeId)
      .in('status', ['in_process', 'received']);
    if (workCenterId) lotQuery = lotQuery.eq('work_center_id', workCenterId);
    const { data: lots, error: lotErr } = await lotQuery;
    if (lotErr) throw lotErr;
    const lotRows = lots || [];
    backlog += lotRows.reduce((sum, l) => sum + toNumber(l.quantity), 0);
    openCards += lotRows.length;
  }

  // Operation cards (primary floor work tokens)
  {
    let opQuery = supabase
      .from('production_op_cards')
      .select('target_quantity, good_qty')
      .eq('assigned_employee_id', employeeId)
      .in('status', ['READY', 'RUNNING']);
    if (workCenterId) opQuery = opQuery.eq('work_center_id', workCenterId);
    const { data: ops, error: opErr } = await opQuery;
    if (opErr) {
      // Table may not exist yet during rollout
      if (opErr.code !== '42P01' && !String(opErr.message || '').includes('production_op_cards')) {
        throw opErr;
      }
    } else {
      const opRows = ops || [];
      // Prefer op-card remaining over double-counting schedule cards / lots when ops exist
      const opBacklog = opRows.reduce(
        (sum, o) => sum + Math.max(0, toNumber(o.target_quantity) - toNumber(o.good_qty)),
        0
      );
      if (opRows.length) {
        backlog = opBacklog;
        openCards = opRows.length;
      }
    }
  }

  let completedGood = 0;
  let completedOps = 0;

  // Finished ops at this WC today — keeps load fair after handoff resets open backlog to 0
  if (workCenterId && date && isValidUUID(employeeId)) {
    const { start, end } = dayWindowUtc(date);
    const [{ data: completions, error: cErr }, { data: lotCompletions, error: lcErr }] =
      await Promise.all([
        supabase
          .from('production_card_op_completions')
          .select('good_qty')
          .eq('employee_id', employeeId)
          .eq('work_center_id', workCenterId)
          .gte('completed_at', start)
          .lt('completed_at', end),
        supabase
          .from('production_lot_op_completions')
          .select('good_qty')
          .eq('employee_id', employeeId)
          .eq('work_center_id', workCenterId)
          .gte('completed_at', start)
          .lt('completed_at', end),
      ]);
    if (cErr) throw cErr;
    if (lcErr) throw lcErr;
    const all = [...(completions || []), ...(lotCompletions || [])];
    completedOps = all.length;
    completedGood = all.reduce((sum, r) => sum + toNumber(r.good_qty), 0);
  }

  return {
    backlog,
    openCards,
    completedGood,
    completedOps,
    totalQty: backlog + completedGood,
    totalTasks: openCards + completedOps,
  };
}

async function pickAssignee(workCenterId, date) {
  const candidates = await candidatesForWorkCenter(workCenterId, date);
  if (!candidates.length) return null;

  const scored = [];
  for (const emp of candidates) {
    const stats = await backlogStats(emp.id, date, workCenterId);
    scored.push({
      ...emp,
      backlog: stats.backlog,
      open_cards: stats.openCards,
      completed_good: stats.completedGood,
      completed_ops: stats.completedOps,
      total_qty: stats.totalQty,
      total_tasks: stats.totalTasks,
    });
  }

  scored.sort((a, b) => {
    if (a.total_qty !== b.total_qty) return a.total_qty - b.total_qty;
    if (a.total_tasks !== b.total_tasks) return a.total_tasks - b.total_tasks;
    return String(a.employee_code || '').localeCompare(String(b.employee_code || ''));
  });

  return scored[0];
}

async function listSchedulableNodes(activityFlowVersionId) {
  if (!activityFlowVersionId) return [];
  const { nodes, edges } = await loadFlowGraph(activityFlowVersionId);
  const { walkPrimaryPath } = require('./activityFlowRoute');
  const pathNodes = walkPrimaryPath(nodes, edges).filter(
    (n) => SCHEDULABLE_TYPES.has(n.activity_type) && n.work_center_id
  );
  if (pathNodes.length) return pathNodes;
  return (nodes || []).filter(
    (n) => SCHEDULABLE_TYPES.has(n.activity_type) && n.work_center_id
  );
}

// resolveFirstSchedulableNode / resolveNextSchedulableNode imported from activityFlowRoute

async function assignCardToCurrentOp(cardId, { preferNodeId = null } = {}) {
  if (!isValidUUID(cardId)) throw httpError('Invalid card id');

  const { data: card, error } = await supabase
    .from('production_cards')
    .select('*')
    .eq('id', cardId)
    .maybeSingle();
  if (error) throw error;
  if (!card) throw httpError('Production card not found', 404);

  const { data: schedule, error: sErr } = await supabase
    .from('delivery_schedules')
    .select('id, due_date, activity_flow_version_id')
    .eq('id', card.delivery_schedule_id)
    .maybeSingle();
  if (sErr) throw sErr;

  const afVersionId = schedule?.activity_flow_version_id;
  let node = null;
  if (preferNodeId) {
    const nodes = await listSchedulableNodes(afVersionId);
    node = nodes.find((n) => n.id === preferNodeId) || null;
  }
  if (!node) {
    node =
      (card.current_activity_flow_node_id
        ? (await listSchedulableNodes(afVersionId)).find(
            (n) => n.id === card.current_activity_flow_node_id
          )
        : null) || (await resolveFirstSchedulableNode(afVersionId));
  }

  if (!node || !node.work_center_id) {
    const { data: updated, error: upErr } = await supabase
      .from('production_cards')
      .update({
        assigned_employee_id: null,
        work_center_id: null,
        current_activity_flow_node_id: null,
        assignment_status: 'blocked',
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (upErr) throw upErr;
    return {
      card: updated,
      assignee: null,
      node: null,
      reason: 'No schedulable activity-flow node with a work center',
    };
  }

  const assignee = await pickAssignee(node.work_center_id, card.work_date);
  if (!assignee) {
    const { data: updated, error: upErr } = await supabase
      .from('production_cards')
      .update({
        assigned_employee_id: null,
        work_center_id: node.work_center_id,
        current_activity_flow_node_id: node.id,
        assignment_status: 'unassigned',
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (upErr) throw upErr;
    try {
      const { spawnOp1ForScheduleCard } = require('./productionOpCardEngine');
      await spawnOp1ForScheduleCard(updated, node);
    } catch (e) {
      console.error('spawnOp1ForScheduleCard:', e.message);
    }
    return {
      card: updated,
      assignee: null,
      node,
      reason: 'No present operator at this work center',
    };
  }

  const { data: updated, error: upErr } = await supabase
    .from('production_cards')
    .update({
      assigned_employee_id: assignee.id,
      work_center_id: node.work_center_id,
      current_activity_flow_node_id: node.id,
      assignment_status: 'assigned',
    })
    .eq('id', cardId)
    .select('*')
    .single();
  if (upErr) throw upErr;

  const result = { card: updated, assignee, node, reason: null };
  try {
    const { spawnOp1ForScheduleCard } = require('./productionOpCardEngine');
    await spawnOp1ForScheduleCard(updated, node);
  } catch (e) {
    console.error('spawnOp1ForScheduleCard:', e.message);
  }
  return result;
}

async function recordOpCompletion(card, snapshot = {}) {
  const goodQty =
    snapshot.good_qty != null ? toNumber(snapshot.good_qty) : toNumber(card.total_good_produced);
  const scrapQty =
    snapshot.scrap_qty != null ? toNumber(snapshot.scrap_qty) : toNumber(card.total_scrap_produced);
  const employeeId = snapshot.employee_id || card.assigned_employee_id || null;
  const nodeId =
    snapshot.activity_flow_node_id ||
    snapshot.node_id ||
    card.current_activity_flow_node_id ||
    null;
  const workCenterId = snapshot.work_center_id || card.work_center_id || null;

  if (!(goodQty > 0 || scrapQty > 0) && !nodeId) {
    return null;
  }

  const { data, error } = await supabase
    .from('production_card_op_completions')
    .insert({
      production_card_id: card.id,
      activity_flow_node_id: nodeId,
      work_center_id: workCenterId,
      employee_id: employeeId,
      good_qty: goodQty,
      scrap_qty: scrapQty,
      completed_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function advanceCardAfterOp(cardId, completedNodeId, snapshot = {}) {
  if (!isValidUUID(cardId)) throw httpError('Invalid card id');

  const { data: card, error } = await supabase
    .from('production_cards')
    .select('*')
    .eq('id', cardId)
    .maybeSingle();
  if (error) throw error;
  if (!card) throw httpError('Production card not found', 404);

  const finishedNodeId = completedNodeId || card.current_activity_flow_node_id;
  const completion = await recordOpCompletion(card, {
    ...snapshot,
    activity_flow_node_id: finishedNodeId,
    work_center_id: snapshot.work_center_id || card.work_center_id,
    employee_id: snapshot.employee_id || card.assigned_employee_id,
  });

  const { data: schedule, error: sErr } = await supabase
    .from('delivery_schedules')
    .select('activity_flow_version_id')
    .eq('id', card.delivery_schedule_id)
    .maybeSingle();
  if (sErr) throw sErr;

  const next = await resolveNextSchedulableNode(
    schedule?.activity_flow_version_id,
    finishedNodeId
  );

  if (!next) {
    const { data: updated, error: upErr } = await supabase
      .from('production_cards')
      .update({
        current_activity_flow_node_id: null,
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (upErr) throw upErr;
    return {
      card: updated,
      advanced: false,
      node: null,
      assignee: null,
      completion,
      from_work_center_id: card.work_center_id || null,
      from_employee_id: card.assigned_employee_id || null,
    };
  }

  const result = await assignCardToCurrentOp(cardId, { preferNodeId: next.id });

  // Reset current-op counters so next WC does not accumulate prior good
  const { data: resetCard, error: resetErr } = await supabase
    .from('production_cards')
    .update({
      total_good_produced: 0,
      total_scrap_produced: 0,
      completed_at: null,
      status: result.card?.status === 'COMPLETED' ? 'READY' : result.card?.status || 'READY',
    })
    .eq('id', cardId)
    .select('*')
    .single();
  if (resetErr) throw resetErr;

  // Prefer READY/RUNNING from assign; if unassigned stay READY
  const status =
    resetCard.assignment_status === 'assigned' && resetCard.assigned_employee_id
      ? resetCard.status === 'RUNNING' || resetCard.status === 'OVERDUE'
        ? resetCard.status
        : 'READY'
      : 'READY';

  let finalCard = resetCard;
  if (status !== resetCard.status) {
    const { data: statusCard, error: stErr } = await supabase
      .from('production_cards')
      .update({ status })
      .eq('id', cardId)
      .select('*')
      .single();
    if (stErr) throw stErr;
    finalCard = statusCard;
  }

  return {
    ...result,
    card: finalCard,
    advanced: true,
    completion,
    from_work_center_id: card.work_center_id || null,
    from_employee_id: card.assigned_employee_id || null,
  };
}

async function sortCardsByDueDate(cards) {
  if (!cards?.length) return [];
  const scheduleIds = [...new Set(cards.map((c) => c.delivery_schedule_id).filter(Boolean))];
  const { data: schedules, error } = await supabase
    .from('delivery_schedules')
    .select('id, due_date')
    .in('id', scheduleIds.length ? scheduleIds : ['00000000-0000-0000-0000-000000000000']);
  if (error) throw error;
  const dueById = Object.fromEntries((schedules || []).map((s) => [s.id, s.due_date]));

  return [...cards].sort((a, b) => {
    const da = dueById[a.delivery_schedule_id] || '9999-12-31';
    const db = dueById[b.delivery_schedule_id] || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    if (a.work_date !== b.work_date) return a.work_date < b.work_date ? -1 : 1;
    return String(a.card_number || '').localeCompare(String(b.card_number || ''));
  });
}

async function assignCardsInDueOrder(cardRows) {
  const ordered = await sortCardsByDueDate(cardRows);
  const results = [];
  for (const card of ordered) {
    const result = await assignCardToCurrentOp(card.id);
    results.push(result);
  }
  return results;
}

async function assignUnassignedForDate(date) {
  const { data, error } = await supabase
    .from('production_cards')
    .select('*')
    .eq('work_date', date)
    .in('assignment_status', ['unassigned', 'blocked'])
    .in('status', OPEN_STATUSES);
  if (error) throw error;
  return assignCardsInDueOrder(data || []);
}

async function reassignCard(cardId, employeeId) {
  if (!isValidUUID(cardId)) throw httpError('Invalid card id');
  if (!isValidUUID(employeeId)) throw httpError('employee_id is required');

  const { data: card, error } = await supabase
    .from('production_cards')
    .select('*')
    .eq('id', cardId)
    .maybeSingle();
  if (error) throw error;
  if (!card) throw httpError('Production card not found', 404);
  if (!card.work_center_id) throw httpError('Card has no work center; cannot reassign');

  const { data: membership, error: mErr } = await supabase
    .from('employee_work_centers')
    .select('id')
    .eq('work_center_id', card.work_center_id)
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!membership) throw httpError('Employee is not a member of this work center');

  const { data: emp, error: eErr } = await supabase
    .from('employees')
    .select('id, full_name, employee_code, is_active')
    .eq('id', employeeId)
    .eq('is_active', true)
    .maybeSingle();
  if (eErr) throw eErr;
  if (!emp) throw httpError('Employee not found or inactive', 404);

  const previousEmployeeId = card.assigned_employee_id || null;

  const { data: updated, error: upErr } = await supabase
    .from('production_cards')
    .update({
      assigned_employee_id: employeeId,
      assignment_status: 'assigned',
    })
    .eq('id', cardId)
    .select('*')
    .single();
  if (upErr) throw upErr;
  try {
    const { spawnOp1ForScheduleCard, syncOp1Progress } = require('./productionOpCardEngine');
    await spawnOp1ForScheduleCard(updated);
    await syncOp1Progress(updated);
  } catch (e) {
    console.error('Op1 sync after reassignCard:', e.message);
  }
  return { card: updated, assignee: emp, previous_employee_id: previousEmployeeId };
}

async function previewAssigneeForSchedule(activityFlowVersionId, workDate) {
  const node = await resolveFirstSchedulableNode(activityFlowVersionId);
  if (!node) {
    return { node: null, work_center_id: null, assignee: null, reason: 'No schedulable node' };
  }
  const assignee = await pickAssignee(node.work_center_id, workDate);
  return {
    node,
    work_center_id: node.work_center_id,
    assignee,
    reason: assignee ? null : 'No present operator at this work center',
  };
}

// ─── employee ↔ work center membership ──────────────────────────────────────

async function listOperatorsForWorkCenter(workCenterId) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');
  const { data, error } = await supabase
    .from('employee_work_centers')
    .select('id, employee_id, is_primary, employees(id, full_name, employee_code, is_active)')
    .eq('work_center_id', workCenterId);
  if (error) throw error;

  return (data || []).map((row) => {
    const emp = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    return {
      id: row.id,
      employee_id: row.employee_id,
      is_primary: row.is_primary,
      full_name: emp?.full_name || null,
      employee_code: emp?.employee_code || null,
      is_active: emp?.is_active ?? null,
    };
  });
}

async function setOperatorsForWorkCenter(workCenterId, employeeIds = []) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');
  const ids = [...new Set((employeeIds || []).filter((id) => isValidUUID(id)))];

  const { error: delErr } = await supabase
    .from('employee_work_centers')
    .delete()
    .eq('work_center_id', workCenterId);
  if (delErr) throw delErr;

  if (ids.length) {
    const rows = ids.map((employee_id, idx) => ({
      employee_id,
      work_center_id: workCenterId,
      is_primary: idx === 0,
    }));
    const { error: insErr } = await supabase.from('employee_work_centers').insert(rows);
    if (insErr) throw insErr;
  }

  return listOperatorsForWorkCenter(workCenterId);
}

async function getWorkCenterBoard(workCenterId, date) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');

  const { data: cards, error } = await supabase
    .from('production_cards')
    .select('*')
    .eq('work_center_id', workCenterId)
    .eq('work_date', date)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const ordered = await sortCardsByDueDate(cards || []);
  const { enrichCards } = require('./productionCardEngine');
  const enriched = await enrichCards(ordered);

  // due date already applied; refine status then card number
  const statusRank = { OVERDUE: 0, RUNNING: 1, READY: 2, COMPLETED: 3 };
  enriched.sort((a, b) => {
    const da = a.schedule_due_date || '9999-12-31';
    const db = b.schedule_due_date || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    const sa = statusRank[a.status] ?? 9;
    const sb = statusRank[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.card_number || '').localeCompare(String(b.card_number || ''));
  });

  const { listLotsForWorkCenter } = require('./lotTravelerEngine');
  const lots = await listLotsForWorkCenter(workCenterId, date);

  const { listOpCardsForWorkCenter } = require('./productionOpCardEngine');
  const op_cards = await listOpCardsForWorkCenter(workCenterId);

  const operators = await listOperatorsForWorkCenter(workCenterId);
  const loads = [];
  for (const op of operators) {
    const stats = await backlogStats(op.employee_id, date, workCenterId);
    loads.push({
      ...op,
      backlog: stats.backlog,
      open_cards: stats.openCards,
      completed_good: stats.completedGood,
      completed_ops: stats.completedOps,
      total_qty: stats.totalQty,
      total_tasks: stats.totalTasks,
    });
  }
  loads.sort(
    (a, b) =>
      a.total_qty - b.total_qty ||
      a.total_tasks - b.total_tasks ||
      String(a.employee_code || '').localeCompare(String(b.employee_code || ''))
  );

  return { cards: enriched, lots, op_cards, operator_loads: loads };
}

module.exports = {
  listPresentEmployeeIds,
  candidatesForWorkCenter,
  backlogStats,
  pickAssignee,
  resolveFirstSchedulableNode,
  resolveNextSchedulableNode,
  assignCardToCurrentOp,
  advanceCardAfterOp,
  recordOpCompletion,
  sortCardsByDueDate,
  assignCardsInDueOrder,
  assignUnassignedForDate,
  reassignCard,
  previewAssigneeForSchedule,
  listOperatorsForWorkCenter,
  setOperatorsForWorkCenter,
  getWorkCenterBoard,
  remainingQty,
};
