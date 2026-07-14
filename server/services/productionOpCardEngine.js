/**
 * Operation Cards — per-schedulable-AF-node work tickets.
 * Schedule cards = day demand; lots = material identity; op cards = floor execution.
 */
const { createClient } = require('@supabase/supabase-js');
const {
  SCHEDULABLE_TYPES,
  TERMINAL_DISPATCH_TYPES,
} = require('../config/activityFlowTypes');
const { todayDateString } = require('./blanketPosEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const OPEN_STATUSES = ['READY', 'RUNNING'];

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

async function getParentCard(parentId) {
  const { data, error } = await supabase
    .from('production_cards')
    .select('*')
    .eq('id', parentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError('Parent production card not found', 404);
  return data;
}

async function nextOpCardNumber(parentCard) {
  const base = parentCard.card_number || 'JOB';
  const { count, error } = await supabase
    .from('production_op_cards')
    .select('id', { count: 'exact', head: true })
    .eq('parent_production_card_id', parentCard.id);
  if (error) throw error;
  const seq = (count || 0) + 1;
  return `${base}-OP${String(seq).padStart(2, '0')}`;
}

/**
 * Spawn Op1 for a schedule card after release/assign.
 */
async function spawnOp1ForScheduleCard(card, node = null) {
  if (!card?.id) return null;
  const preferNodeId = node?.id || card.current_activity_flow_node_id;
  if (!preferNodeId) return null;

  const { data: existing } = await supabase
    .from('production_op_cards')
    .select('*')
    .eq('parent_production_card_id', card.id)
    .is('production_lot_id', null)
    .eq('activity_flow_node_id', preferNodeId)
    .in('status', OPEN_STATUSES)
    .maybeSingle();
  if (existing) {
    // Keep in sync with schedule card assignment
    const { data: synced, error } = await supabase
      .from('production_op_cards')
      .update({
        work_center_id: card.work_center_id || node?.work_center_id || existing.work_center_id,
        assigned_employee_id: card.assigned_employee_id,
        assignment_status: card.assignment_status || 'unassigned',
        target_quantity: Math.max(
          toNumber(card.target_quantity) + toNumber(card.overdue_quantity),
          0.0001
        ),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return synced;
  }

  const target = Math.max(
    toNumber(card.target_quantity) + toNumber(card.overdue_quantity),
    0.0001
  );
  const op_card_number = await nextOpCardNumber(card);
  const { data, error } = await supabase
    .from('production_op_cards')
    .insert({
      op_card_number,
      parent_production_card_id: card.id,
      production_lot_id: null,
      activity_flow_node_id: preferNodeId,
      work_center_id: card.work_center_id || node?.work_center_id || null,
      assigned_employee_id: card.assigned_employee_id || null,
      assignment_status: card.assignment_status || 'unassigned',
      target_quantity: target,
      good_qty: toNumber(card.total_good_produced),
      scrap_qty: toNumber(card.total_scrap_produced),
      status: card.status === 'RUNNING' || card.status === 'OVERDUE' ? 'RUNNING' : 'READY',
      started_at: card.started_at || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * After a lot is placed on a mid-route traveler node, ensure an open Op Card exists.
 * No-op when ready_for_dispatch / no node / non-schedulable.
 */
async function spawnOpCardForLotPlacement(placed, parentCard = null) {
  if (!placed?.lot || placed.ready_for_dispatch || !placed.node) return null;
  const node = placed.node;
  if (!SCHEDULABLE_TYPES.has(node.activity_type)) return null;
  if (TERMINAL_DISPATCH_TYPES.has(node.activity_type)) return null;

  const lot = placed.lot;
  const { data: existing } = await supabase
    .from('production_op_cards')
    .select('*')
    .eq('production_lot_id', lot.id)
    .eq('activity_flow_node_id', node.id)
    .in('status', OPEN_STATUSES)
    .maybeSingle();
  if (existing) {
    const { data: synced, error } = await supabase
      .from('production_op_cards')
      .update({
        work_center_id: lot.work_center_id || node.work_center_id,
        assigned_employee_id: lot.assigned_employee_id,
        assignment_status: lot.assignment_status || 'unassigned',
        target_quantity: Math.max(toNumber(lot.quantity), 0.0001),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return synced;
  }

  let parent = parentCard;
  if (!parent && lot.production_card_id) {
    parent = await getParentCard(lot.production_card_id);
  }
  if (!parent) throw httpError('Cannot spawn Op Card without parent schedule card');

  const op_card_number = await nextOpCardNumber(parent);
  const { data, error } = await supabase
    .from('production_op_cards')
    .insert({
      op_card_number,
      parent_production_card_id: parent.id,
      production_lot_id: lot.id,
      activity_flow_node_id: node.id,
      work_center_id: lot.work_center_id || node.work_center_id || null,
      assigned_employee_id: lot.assigned_employee_id || null,
      assignment_status: lot.assignment_status || 'unassigned',
      target_quantity: Math.max(toNumber(lot.quantity), 0.0001),
      good_qty: 0,
      scrap_qty: 0,
      status: 'READY',
    })
    .select('*')
    .single();
  if (error) {
    // Race on unique index — return existing
    if (error.code === '23505') {
      const { data: raced } = await supabase
        .from('production_op_cards')
        .select('*')
        .eq('production_lot_id', lot.id)
        .eq('activity_flow_node_id', node.id)
        .in('status', OPEN_STATUSES)
        .maybeSingle();
      return raced;
    }
    throw error;
  }
  return data;
}

async function closeOp1ForScheduleCard(card, snapshot = {}) {
  const { data: rows, error } = await supabase
    .from('production_op_cards')
    .select('*')
    .eq('parent_production_card_id', card.id)
    .is('production_lot_id', null)
    .in('status', OPEN_STATUSES);
  if (error) throw error;
  const now = new Date().toISOString();
  for (const op of rows || []) {
    await supabase
      .from('production_op_cards')
      .update({
        status: 'COMPLETED',
        good_qty: snapshot.good_qty != null ? toNumber(snapshot.good_qty) : toNumber(card.total_good_produced),
        scrap_qty:
          snapshot.scrap_qty != null ? toNumber(snapshot.scrap_qty) : toNumber(card.total_scrap_produced),
        completed_at: now,
        updated_at: now,
      })
      .eq('id', op.id);
  }
}

async function syncOp1Progress(card) {
  const { data: op } = await supabase
    .from('production_op_cards')
    .select('*')
    .eq('parent_production_card_id', card.id)
    .is('production_lot_id', null)
    .in('status', OPEN_STATUSES)
    .maybeSingle();
  if (!op) return null;
  const { data, error } = await supabase
    .from('production_op_cards')
    .update({
      good_qty: toNumber(card.total_good_produced),
      scrap_qty: toNumber(card.total_scrap_produced),
      status: card.status === 'COMPLETED' ? 'COMPLETED' : op.status === 'READY' ? 'RUNNING' : op.status,
      started_at: op.started_at || card.started_at || new Date().toISOString(),
      assigned_employee_id: card.assigned_employee_id,
      assignment_status: card.assignment_status || op.assignment_status,
      work_center_id: card.work_center_id || op.work_center_id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', op.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getOpCardById(opCardId) {
  if (!isValidUUID(opCardId)) throw httpError('Invalid op card id');
  const { data, error } = await supabase
    .from('production_op_cards')
    .select('*')
    .eq('id', opCardId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError('Operation card not found', 404);
  const [enriched] = await enrichOpCards([data]);
  return enriched;
}

async function enrichOpCards(rows) {
  if (!rows?.length) return [];
  const ops = rows.map((r) => ({
    ...r,
    target_quantity: toNumber(r.target_quantity),
    good_qty: toNumber(r.good_qty),
    scrap_qty: toNumber(r.scrap_qty),
    kind: 'op_card',
    remaining_qty: Math.max(0, toNumber(r.target_quantity) - toNumber(r.good_qty)),
  }));

  const parentIds = [...new Set(ops.map((o) => o.parent_production_card_id).filter(Boolean))];
  const lotIds = [...new Set(ops.map((o) => o.production_lot_id).filter(Boolean))];
  const empIds = [...new Set(ops.map((o) => o.assigned_employee_id).filter(Boolean))];
  const wcIds = [...new Set(ops.map((o) => o.work_center_id).filter(Boolean))];
  const nodeIds = [...new Set(ops.map((o) => o.activity_flow_node_id).filter(Boolean))];

  const [
    { data: parents },
    { data: lots },
    { data: employees },
    { data: workCenters },
    { data: nodes },
  ] = await Promise.all([
    parentIds.length
      ? supabase
          .from('production_cards')
          .select(
            'id, card_number, work_date, status, master_record_id, delivery_schedule_id, target_quantity, overdue_quantity'
          )
          .in('id', parentIds)
      : Promise.resolve({ data: [] }),
    lotIds.length
      ? supabase
          .from('production_lots')
          .select('id, lot_number, quantity, status, scrap_qty')
          .in('id', lotIds)
      : Promise.resolve({ data: [] }),
    empIds.length
      ? supabase.from('employees').select('id, full_name, employee_code').in('id', empIds)
      : Promise.resolve({ data: [] }),
    wcIds.length
      ? supabase.from('work_centers').select('id, code, name').in('id', wcIds)
      : Promise.resolve({ data: [] }),
    nodeIds.length
      ? supabase
          .from('activity_flow_nodes')
          .select('id, label, activity_type, sequence')
          .in('id', nodeIds)
      : Promise.resolve({ data: [] }),
  ]);

  const parentById = Object.fromEntries((parents || []).map((p) => [p.id, p]));
  const lotById = Object.fromEntries((lots || []).map((l) => [l.id, l]));
  const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const wcById = Object.fromEntries((workCenters || []).map((w) => [w.id, w]));
  const nodeById = Object.fromEntries((nodes || []).map((n) => [n.id, n]));

  const recordIds = [
    ...new Set((parents || []).map((p) => p.master_record_id).filter(Boolean)),
  ];
  const scheduleIds = [
    ...new Set((parents || []).map((p) => p.delivery_schedule_id).filter(Boolean)),
  ];
  let labelById = {};
  let scheduleById = {};
  if (recordIds.length) {
    const { data: lookups } = await supabase
      .from('v_master_lookup')
      .select('record_id, label')
      .in('record_id', recordIds);
    labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));
  }
  if (scheduleIds.length) {
    const { data: schedules } = await supabase
      .from('delivery_schedules')
      .select('id, schedule_number, due_date')
      .in('id', scheduleIds);
    scheduleById = Object.fromEntries((schedules || []).map((s) => [s.id, s]));
  }

  return ops.map((o) => {
    const parent = parentById[o.parent_production_card_id];
    const lot = o.production_lot_id ? lotById[o.production_lot_id] : null;
    const emp = o.assigned_employee_id ? empById[o.assigned_employee_id] : null;
    const wc = o.work_center_id ? wcById[o.work_center_id] : null;
    const node = nodeById[o.activity_flow_node_id];
    const sched = parent ? scheduleById[parent.delivery_schedule_id] : null;
    return {
      ...o,
      is_op1: !o.production_lot_id,
      card_number: o.op_card_number,
      parent_card_number: parent?.card_number || null,
      parent_status: parent?.status || null,
      work_date: parent?.work_date || null,
      lot_number: lot?.lot_number || null,
      lot_status: lot?.status || null,
      lot_quantity: lot ? toNumber(lot.quantity) : null,
      assigned_employee_name: emp?.full_name || null,
      assigned_employee_code: emp?.employee_code || null,
      work_center_code: wc?.code || null,
      work_center_name: wc?.name || null,
      current_node_label: node?.label || null,
      current_node_type: node?.activity_type || null,
      component_label: parent ? labelById[parent.master_record_id] || null : null,
      master_record_id: parent?.master_record_id || null,
      schedule_number: sched?.schedule_number || null,
      schedule_due_date: sched?.due_date || null,
      production_card_id: o.parent_production_card_id,
    };
  });
}

async function listMyTodayOpCards(employeeId) {
  if (!isValidUUID(employeeId)) throw httpError('Invalid employee id');
  const { data, error } = await supabase
    .from('production_op_cards')
    .select('*')
    .eq('assigned_employee_id', employeeId)
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return enrichOpCards(data || []);
}

async function listOpCardsForWorkCenter(workCenterId) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');
  const { data, error } = await supabase
    .from('production_op_cards')
    .select('*')
    .eq('work_center_id', workCenterId)
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return enrichOpCards(data || []);
}

async function listOpCardsForParent(parentCardId) {
  if (!isValidUUID(parentCardId)) throw httpError('Invalid card id');
  const { data, error } = await supabase
    .from('production_op_cards')
    .select('*')
    .eq('parent_production_card_id', parentCardId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return enrichOpCards(data || []);
}

async function startOpCard(opCardId, actorEmployeeId, { isManager = false } = {}) {
  const op = await getOpCardById(opCardId);
  if (!isManager && op.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee can start this operation card', 403);
  }
  if (op.status === 'COMPLETED' || op.status === 'CANCELLED') {
    throw httpError('Operation card is closed', 409);
  }

  // Op1: also start parent schedule card
  if (op.is_op1) {
    const { startCard } = require('./productionCardEngine');
    try {
      await startCard(op.parent_production_card_id, actorEmployeeId, { isManager });
    } catch (err) {
      if (!String(err.message || '').includes('already')) throw err;
    }
  }

  if (op.status === 'RUNNING') return getOpCardById(opCardId);

  const { data, error } = await supabase
    .from('production_op_cards')
    .update({
      status: 'RUNNING',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', opCardId)
    .select('*')
    .single();
  if (error) throw error;
  return getOpCardById(data.id);
}

/**
 * Progress / complete an operation card.
 * Op1 delegates to schedule card reportProgress (mint + next spawn).
 * Mid-route completes the lot op and advances.
 */
async function reportOpCardProgress(opCardId, payload, actorEmployeeId, opts = {}) {
  const op = await getOpCardById(opCardId);
  if (!opts.isManager && op.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee can update this operation card', 403);
  }
  if (!OPEN_STATUSES.includes(op.status)) {
    throw httpError('Operation card is not open', 409);
  }

  if (op.is_op1) {
    const { reportProgress } = require('./productionCardEngine');
    const result = await reportProgress(op.parent_production_card_id, payload, actorEmployeeId, opts);
    await syncOp1Progress({
      ...result,
      id: op.parent_production_card_id,
      total_good_produced: result.total_good_produced,
      total_scrap_produced: result.total_scrap_produced,
      status: result.status,
      assigned_employee_id: result.assigned_employee_id,
      assignment_status: result.assignment_status,
      work_center_id: result.work_center_id,
      started_at: result.started_at,
    });
    if (result.status === 'COMPLETED') {
      await closeOp1ForScheduleCard(result, {
        good_qty: result.total_good_produced,
        scrap_qty: result.total_scrap_produced,
      });
    }
    const refreshed = await getOpCardById(opCardId).catch(() => null);
    return {
      op_card: refreshed || { ...op, status: result.status === 'COMPLETED' ? 'COMPLETED' : op.status },
      parent: result,
      lot: result.lot || null,
      advance: result.advance || null,
    };
  }

  // Mid-route: completing the op advances the lot traveler
  const doneForDay = !!payload.done_for_day;
  const goodDelta = toNumber(payload.good_qty);
  const scrapDelta = toNumber(payload.scrap_qty);

  if (!doneForDay && goodDelta === 0 && scrapDelta === 0) {
    throw httpError('Enter good or scrap quantity');
  }

  const newGood = toNumber(op.good_qty) + goodDelta;
  const newScrap = toNumber(op.scrap_qty) + scrapDelta;

  if (!doneForDay && newGood < toNumber(op.target_quantity)) {
    const { data: updated, error } = await supabase
      .from('production_op_cards')
      .update({
        good_qty: newGood,
        scrap_qty: newScrap,
        status: 'RUNNING',
        started_at: op.started_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', opCardId)
      .select('*')
      .single();
    if (error) throw error;
    return { op_card: await getOpCardById(updated.id), advance: null, lot: null };
  }

  // Complete mid-route op → advance lot
  const { completeLotOp } = require('./lotTravelerEngine');
  const lotResult = await completeLotOp(
    op.production_lot_id,
    {
      good_qty: goodDelta > 0 ? goodDelta : toNumber(op.target_quantity) - toNumber(op.good_qty) || toNumber(op.target_quantity),
      scrap_qty: scrapDelta,
    },
    actorEmployeeId,
    opts
  );

  const { error: closeErr } = await supabase
    .from('production_op_cards')
    .update({
      status: 'COMPLETED',
      good_qty: Math.max(newGood, toNumber(op.target_quantity)),
      scrap_qty: newScrap,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', opCardId);
  if (closeErr) throw closeErr;

  // Next op card is spawned inside advanceLotAfterOp via hook
  return {
    op_card: await getOpCardById(opCardId),
    advance: {
      advanced: !!lotResult.advanced,
      ready_for_dispatch: !!lotResult.ready_for_dispatch,
      lot: lotResult.lot,
      node: lotResult.node,
      assignee: lotResult.assignee,
      from_work_center_id: lotResult.from_work_center_id,
      from_employee_id: lotResult.from_employee_id,
    },
    lot: lotResult.lot,
  };
}

async function completeOpCard(opCardId, payload, actorEmployeeId, opts = {}) {
  return reportOpCardProgress(
    opCardId,
    { ...payload, done_for_day: true, good_qty: payload?.good_qty ?? 0, scrap_qty: payload?.scrap_qty ?? 0 },
    actorEmployeeId,
    opts
  );
}

async function reassignOpCard(opCardId, employeeId) {
  const op = await getOpCardById(opCardId);
  if (!op.work_center_id) throw httpError('Operation card has no work center; cannot reassign');

  const previousEmployeeId = op.assigned_employee_id || null;

  if (op.is_op1) {
    const { reassignCard } = require('./productionAssignEngine');
    const result = await reassignCard(op.parent_production_card_id, employeeId);
    await syncOp1Progress({
      id: op.parent_production_card_id,
      ...result.card,
    });
    return {
      op_card: await getOpCardById(opCardId),
      assignee: result.assignee,
      previous_employee_id: previousEmployeeId,
    };
  }

  const { reassignLot } = require('./lotTravelerEngine');
  const result = await reassignLot(op.production_lot_id, employeeId);
  const { data: updated, error } = await supabase
    .from('production_op_cards')
    .update({
      assigned_employee_id: employeeId || null,
      assignment_status: employeeId ? 'assigned' : 'unassigned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', opCardId)
    .select('*')
    .single();
  if (error) throw error;
  return {
    op_card: await getOpCardById(updated.id),
    assignee: result.assignee,
    previous_employee_id: previousEmployeeId,
  };
}

/**
 * Heal false-RFD lots and spawn missing Op Cards for open in-process lots.
 */
async function healAndSpawnMissingOpCards(limit = 200) {
  const { healFalseReadyForDispatch } = require('./lotTravelerEngine');

  const results = { healed_rfd: 0, spawned: 0 };

  const { data: rfdLots, error } = await supabase
    .from('production_lots')
    .select('*')
    .eq('status', 'ready_for_dispatch')
    .limit(limit);
  if (error) throw error;

  for (const lot of rfdLots || []) {
    const before = lot.status;
    const healed = await healFalseReadyForDispatch(lot);
    if (healed.status !== before) results.healed_rfd += 1;
    if (healed.status === 'in_process' && healed.current_activity_flow_node_id) {
      const { data: node } = await supabase
        .from('activity_flow_nodes')
        .select('id, label, activity_type, sequence, work_center_id')
        .eq('id', healed.current_activity_flow_node_id)
        .maybeSingle();
      if (node && SCHEDULABLE_TYPES.has(node.activity_type)) {
        const spawned = await spawnOpCardForLotPlacement({
          lot: healed,
          node,
          ready_for_dispatch: false,
        });
        if (spawned) results.spawned += 1;
      }
    }
  }

  // Open lots at schedulable nodes without an open Op Card
  const { data: openLots, error: oErr } = await supabase
    .from('production_lots')
    .select('*')
    .in('status', ['in_process', 'received'])
    .not('current_activity_flow_node_id', 'is', null)
    .limit(limit);
  if (oErr) throw oErr;

  for (const lot of openLots || []) {
    const { data: node } = await supabase
      .from('activity_flow_nodes')
      .select('id, label, activity_type, sequence, work_center_id')
      .eq('id', lot.current_activity_flow_node_id)
      .maybeSingle();
    if (!node || !SCHEDULABLE_TYPES.has(node.activity_type)) continue;
    if (TERMINAL_DISPATCH_TYPES.has(node.activity_type)) continue;

    const { data: existing } = await supabase
      .from('production_op_cards')
      .select('id')
      .eq('production_lot_id', lot.id)
      .eq('activity_flow_node_id', node.id)
      .in('status', OPEN_STATUSES)
      .maybeSingle();
    if (existing) continue;

    const spawned = await spawnOpCardForLotPlacement({
      lot,
      node,
      ready_for_dispatch: false,
    });
    if (spawned) results.spawned += 1;
  }

  // Backfill Op1 for schedule cards that have none
  const { data: openCards, error: cErr } = await supabase
    .from('production_cards')
    .select('*')
    .in('status', ['READY', 'RUNNING', 'OVERDUE'])
    .not('current_activity_flow_node_id', 'is', null)
    .limit(limit);
  if (cErr) throw cErr;
  for (const card of openCards || []) {
    const { data: existing } = await supabase
      .from('production_op_cards')
      .select('id')
      .eq('parent_production_card_id', card.id)
      .is('production_lot_id', null)
      .in('status', OPEN_STATUSES)
      .maybeSingle();
    if (existing) continue;
    const spawned = await spawnOp1ForScheduleCard(card);
    if (spawned) results.spawned += 1;
  }

  return results;
}

module.exports = {
  spawnOp1ForScheduleCard,
  spawnOpCardForLotPlacement,
  closeOp1ForScheduleCard,
  syncOp1Progress,
  getOpCardById,
  enrichOpCards,
  listMyTodayOpCards,
  listOpCardsForWorkCenter,
  listOpCardsForParent,
  startOpCard,
  reportOpCardProgress,
  completeOpCard,
  reassignOpCard,
  healAndSpawnMissingOpCards,
};
