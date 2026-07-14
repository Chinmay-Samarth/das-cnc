const { createClient } = require('@supabase/supabase-js');
const {
  TERMINAL_DISPATCH_TYPES,
} = require('../config/activityFlowTypes');
const { generateComponentLotNumber } = require('./componentLotEngine');
const { todayDateString } = require('./blanketPosEngine');
const {
  loadFlowGraph,
  resolveNextTravelerNode,
  priorSchedulableOnPath,
} = require('./activityFlowRoute');

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

/**
 * Completions for a lot: lot ledger + Op1 card ledger for the parent schedule card.
 */
async function completedNodeIdsForLot(lot) {
  const done = new Set();
  if (!lot?.id) return done;

  const { data: lotComps, error: lcErr } = await supabase
    .from('production_lot_op_completions')
    .select('activity_flow_node_id')
    .eq('production_lot_id', lot.id);
  if (lcErr) throw lcErr;
  for (const c of lotComps || []) {
    if (c.activity_flow_node_id) done.add(c.activity_flow_node_id);
  }

  if (lot.production_card_id) {
    const { data: cardComps, error: ccErr } = await supabase
      .from('production_card_op_completions')
      .select('activity_flow_node_id')
      .eq('production_card_id', lot.production_card_id);
    if (ccErr) throw ccErr;
    for (const c of cardComps || []) {
      if (c.activity_flow_node_id) done.add(c.activity_flow_node_id);
    }
    // Create-site node (Op1) counts as done once lot was minted from it
    if (lot.activity_flow_node_id) done.add(lot.activity_flow_node_id);
  }

  return done;
}

/**
 * If intending to place on dispatch, ensure every prior schedulable on the
 * primary path is complete. Otherwise redirect to the first incomplete node.
 */
async function gateDispatchOrRedirect(lot, intendedNode, activityFlowVersionId) {
  if (!intendedNode || !TERMINAL_DISPATCH_TYPES.has(intendedNode.activity_type)) {
    return intendedNode;
  }
  if (!activityFlowVersionId) return intendedNode;

  const { nodes, edges } = await loadFlowGraph(activityFlowVersionId);
  const priors = priorSchedulableOnPath(nodes, edges, intendedNode.id);
  const done = await completedNodeIdsForLot(lot);
  const missing = priors.find((n) => !done.has(n.id));
  if (missing) return missing;
  return intendedNode;
}

async function getAfVersionIdForLot(lot) {
  if (!lot?.production_card_id) return null;
  const { data: card, error } = await supabase
    .from('production_cards')
    .select('id, delivery_schedule_id')
    .eq('id', lot.production_card_id)
    .maybeSingle();
  if (error) throw error;
  if (!card?.delivery_schedule_id) return null;
  const { data: schedule, error: sErr } = await supabase
    .from('delivery_schedules')
    .select('activity_flow_version_id')
    .eq('id', card.delivery_schedule_id)
    .maybeSingle();
  if (sErr) throw sErr;
  return schedule?.activity_flow_version_id || null;
}

async function recordLotOpCompletion(lot, snapshot = {}) {
  const goodQty =
    snapshot.good_qty != null ? toNumber(snapshot.good_qty) : toNumber(lot.quantity);
  const scrapQty =
    snapshot.scrap_qty != null ? toNumber(snapshot.scrap_qty) : toNumber(lot.scrap_qty);
  const employeeId = snapshot.employee_id || lot.assigned_employee_id || null;
  const nodeId =
    snapshot.activity_flow_node_id ||
    snapshot.node_id ||
    lot.current_activity_flow_node_id ||
    lot.activity_flow_node_id ||
    null;
  const workCenterId = snapshot.work_center_id || lot.work_center_id || null;

  const { data, error } = await supabase
    .from('production_lot_op_completions')
    .insert({
      production_lot_id: lot.id,
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

async function getActivityTypeForNode(nodeId) {
  if (!nodeId) return null;
  const { data, error } = await supabase
    .from('activity_flow_nodes')
    .select('id, activity_type')
    .eq('id', nodeId)
    .maybeSingle();
  if (error) throw error;
  return data?.activity_type || null;
}

/**
 * Ready for Dispatch is valid only when standing on an AF dispatch node
 * with all prior primary-path schedulable ops complete.
 * Mid-route false RFD → heal back to in_process (and redirect pointer if needed).
 */
async function healFalseReadyForDispatch(lot) {
  if (!lot || lot.status !== 'ready_for_dispatch') return lot;

  const currentType = await getActivityTypeForNode(lot.current_activity_flow_node_id);
  if (currentType && TERMINAL_DISPATCH_TYPES.has(currentType)) {
    const afVersionId = await getAfVersionIdForLot(lot);
    if (afVersionId) {
      const { nodes, edges } = await loadFlowGraph(afVersionId);
      const dispatchNode = (nodes || []).find((n) => n.id === lot.current_activity_flow_node_id);
      const priors = priorSchedulableOnPath(nodes, edges, dispatchNode?.id);
      const done = await completedNodeIdsForLot(lot);
      const missing = priors.find((n) => !done.has(n.id));
      if (missing) {
        // Redirect onto first incomplete op instead of RFD
        const workDate = null;
        const placed = await assignLotToNode(lot.id, missing, workDate, { afVersionId, skipGate: true });
        return placed.lot;
      }
    }
    return lot; // legitimate RFD at dispatch
  }

  const { data: healed, error } = await supabase
    .from('production_lots')
    .update({
      status: 'in_process',
      assignment_status: lot.assigned_employee_id ? 'assigned' : 'unassigned',
    })
    .eq('id', lot.id)
    .eq('status', 'ready_for_dispatch')
    .select('*')
    .single();
  if (error) throw error;
  return healed || lot;
}

async function assignLotToNode(lotId, node, workDate, opts = {}) {
  const { pickAssignee } = require('./productionAssignEngine');

  // No further traveler node — do NOT auto RFD (only AF dispatch node is the gate)
  if (!node) {
    const { data: existing, error } = await supabase
      .from('production_lots')
      .select('*')
      .eq('id', lotId)
      .maybeSingle();
    if (error) throw error;
    if (!existing) throw httpError('Production lot not found', 404);

    let lot = existing;
    if (lot.status === 'ready_for_dispatch') {
      const { data: fixed, error: fErr } = await supabase
        .from('production_lots')
        .update({
          status: 'in_process',
          assignment_status: lot.assigned_employee_id ? 'assigned' : 'unassigned',
        })
        .eq('id', lotId)
        .select('*')
        .single();
      if (fErr) throw fErr;
      lot = fixed;
    }

    return {
      lot,
      assignee: null,
      node: null,
      ready_for_dispatch: false,
      reason: 'No further AF node including dispatch',
    };
  }

  // Fail-closed: never RFD if prior schedulable ops on primary path are incomplete
  if (!opts.skipGate && TERMINAL_DISPATCH_TYPES.has(node.activity_type)) {
    const { data: existingLot, error: exErr } = await supabase
      .from('production_lots')
      .select('*')
      .eq('id', lotId)
      .maybeSingle();
    if (exErr) throw exErr;
    const afVersionId = opts.afVersionId || (await getAfVersionIdForLot(existingLot));
    const gated = await gateDispatchOrRedirect(existingLot, node, afVersionId);
    if (gated && gated.id !== node.id) {
      return assignLotToNode(lotId, gated, workDate, { ...opts, skipGate: true });
    }
  }

  // Only an AF dispatch node is the Ready for Dispatch gate
  if (TERMINAL_DISPATCH_TYPES.has(node.activity_type)) {
    const { data, error } = await supabase
      .from('production_lots')
      .update({
        current_activity_flow_node_id: node.id,
        work_center_id: node.work_center_id || null,
        assigned_employee_id: null,
        assignment_status: 'unassigned',
        status: 'ready_for_dispatch',
      })
      .eq('id', lotId)
      .select('*')
      .single();
    if (error) throw error;
    return { lot: data, assignee: null, node, ready_for_dispatch: true };
  }

  // Mid-route shop node without WC: stay in process unassigned (do NOT jump to RFD)
  if (!node.work_center_id) {
    const { data, error } = await supabase
      .from('production_lots')
      .update({
        current_activity_flow_node_id: node.id,
        work_center_id: null,
        assigned_employee_id: null,
        assignment_status: 'unassigned',
        status: 'in_process',
      })
      .eq('id', lotId)
      .select('*')
      .single();
    if (error) throw error;
    return {
      lot: data,
      assignee: null,
      node,
      ready_for_dispatch: false,
      reason: 'Activity-flow node has no work center',
    };
  }

  const assignee = await pickAssignee(node.work_center_id, workDate || todayDateString());
  if (!assignee) {
    const { data, error } = await supabase
      .from('production_lots')
      .update({
        current_activity_flow_node_id: node.id,
        work_center_id: node.work_center_id,
        assigned_employee_id: null,
        assignment_status: 'unassigned',
        status: 'in_process',
      })
      .eq('id', lotId)
      .select('*')
      .single();
    if (error) throw error;
    return {
      lot: data,
      assignee: null,
      node,
      ready_for_dispatch: false,
      reason: 'No present operator at this work center',
    };
  }

  const { data, error } = await supabase
    .from('production_lots')
    .update({
      current_activity_flow_node_id: node.id,
      work_center_id: node.work_center_id,
      assigned_employee_id: assignee.id,
      assignment_status: 'assigned',
      status: 'in_process',
    })
    .eq('id', lotId)
    .select('*')
    .single();
  if (error) throw error;
  return { lot: data, assignee, node, ready_for_dispatch: false };
}

async function mintLotFromScheduleCard(card, { quantity, scrapQty = 0, sourceNodeId, actorEmployeeId } = {}) {
  const qty = toNumber(quantity);
  if (!(qty > 0)) throw httpError('Lot quantity must be > 0');
  if (!card?.activity_flow_version_id) throw httpError('Schedule has no frozen activity flow');

  const sourceNode = sourceNodeId || card.current_activity_flow_node_id || null;
  const next = await resolveNextTravelerNode(card.activity_flow_version_id, sourceNode);

  const lotNumber = await generateComponentLotNumber(card.master_record_id);
  const { data: lot, error } = await supabase
    .from('production_lots')
    .insert({
      lot_number: lotNumber,
      master_record_id: card.master_record_id,
      production_card_id: card.id,
      activity_flow_node_id: sourceNode,
      current_activity_flow_node_id: sourceNode,
      quantity: qty,
      scrap_qty: toNumber(scrapQty),
      status: 'in_process',
      assignment_status: 'unassigned',
      work_center_id: null,
      assigned_employee_id: null,
    })
    .select('*')
    .single();
  if (error) throw error;

  // Op1 credit stays on production_card_op_completions (Done for day / Create lot).
  // Lot ledger starts when the traveler completes mid/late ops via advanceLotAfterOp.

  const placed = await assignLotToNode(lot.id, next, card.work_date);
  try {
    const { spawnOpCardForLotPlacement } = require('./productionOpCardEngine');
    await spawnOpCardForLotPlacement(placed, card);
  } catch (e) {
    console.error('spawnOpCardForLotPlacement after mint:', e.message);
  }
  return {
    lot: placed.lot,
    next_node: placed.node,
    assignee: placed.assignee,
    ready_for_dispatch: !!placed.ready_for_dispatch,
    from_work_center_id: card.work_center_id || null,
    from_employee_id: actorEmployeeId || card.assigned_employee_id || null,
  };
}

async function advanceLotAfterOp(lotId, completedNodeId, snapshot = {}) {
  if (!isValidUUID(lotId)) throw httpError('Invalid lot id');

  const { data: lot, error } = await supabase
    .from('production_lots')
    .select('*')
    .eq('id', lotId)
    .maybeSingle();
  if (error) throw error;
  if (!lot) throw httpError('Production lot not found', 404);
  if (['merged', 'dispatched', 'consumed'].includes(lot.status)) {
    throw httpError(`Lot cannot advance from status ${lot.status}`, 409);
  }

  const finishedNodeId =
    completedNodeId || lot.current_activity_flow_node_id || lot.activity_flow_node_id;

  const completion = await recordLotOpCompletion(lot, {
    ...snapshot,
    activity_flow_node_id: finishedNodeId,
    work_center_id: snapshot.work_center_id || lot.work_center_id,
    employee_id: snapshot.employee_id || lot.assigned_employee_id,
    good_qty: snapshot.good_qty != null ? snapshot.good_qty : toNumber(lot.quantity),
    scrap_qty: snapshot.scrap_qty != null ? snapshot.scrap_qty : 0,
  });

  const scrapDelta = snapshot.scrap_qty != null ? toNumber(snapshot.scrap_qty) : 0;
  let quantity = toNumber(lot.quantity);
  let scrapQty = toNumber(lot.scrap_qty) + scrapDelta;
  if (scrapDelta > 0) {
    quantity = Math.max(0, quantity - scrapDelta);
  }
  if (quantity <= 0) {
    const { data: emptied, error: eErr } = await supabase
      .from('production_lots')
      .update({
        // quantity CHECK (> 0) — keep prior qty for audit; scrap_qty holds yield loss
        scrap_qty: scrapQty,
        status: 'consumed',
        assigned_employee_id: null,
        assignment_status: 'unassigned',
        work_center_id: null,
      })
      .eq('id', lotId)
      .select('*')
      .single();
    if (eErr) throw eErr;
    return {
      lot: emptied,
      advanced: false,
      completion,
      ready_for_dispatch: false,
      from_work_center_id: lot.work_center_id,
      from_employee_id: lot.assigned_employee_id,
    };
  }

  const { data: card, error: cErr } = await supabase
    .from('production_cards')
    .select('id, work_date, delivery_schedule_id')
    .eq('id', lot.production_card_id)
    .maybeSingle();
  if (cErr) throw cErr;

  let afVersionId = null;
  if (card?.delivery_schedule_id) {
    const { data: schedule } = await supabase
      .from('delivery_schedules')
      .select('activity_flow_version_id')
      .eq('id', card.delivery_schedule_id)
      .maybeSingle();
    afVersionId = schedule?.activity_flow_version_id || null;
  }

  await supabase
    .from('production_lots')
    .update({ quantity, scrap_qty: scrapQty })
    .eq('id', lotId);

  const next = await resolveNextTravelerNode(afVersionId, finishedNodeId);
  const placed = await assignLotToNode(lotId, next, card?.work_date || todayDateString());

  // Close any open Op Card for the finished node; spawn next if mid-route
  try {
    const { spawnOpCardForLotPlacement } = require('./productionOpCardEngine');
    const { data: openOps } = await supabase
      .from('production_op_cards')
      .select('id')
      .eq('production_lot_id', lotId)
      .eq('activity_flow_node_id', finishedNodeId)
      .in('status', ['READY', 'RUNNING']);
    const now = new Date().toISOString();
    for (const o of openOps || []) {
      await supabase
        .from('production_op_cards')
        .update({
          status: 'COMPLETED',
          completed_at: now,
          updated_at: now,
          good_qty: snapshot.good_qty != null ? toNumber(snapshot.good_qty) : quantity,
          scrap_qty: snapshot.scrap_qty != null ? toNumber(snapshot.scrap_qty) : scrapQty,
        })
        .eq('id', o.id);
    }
    await spawnOpCardForLotPlacement(placed, card);
  } catch (e) {
    console.error('Op card sync after advanceLotAfterOp:', e.message);
  }

  return {
    lot: placed.lot,
    advanced: !placed.ready_for_dispatch && !!placed.node,
    ready_for_dispatch: !!placed.ready_for_dispatch,
    node: placed.node,
    assignee: placed.assignee,
    completion,
    from_work_center_id: lot.work_center_id,
    from_employee_id: lot.assigned_employee_id,
  };
}

async function enrichLots(rows) {
  if (!rows?.length) return [];
  const lots = rows.map((l) => ({
    ...l,
    quantity: toNumber(l.quantity),
    scrap_qty: toNumber(l.scrap_qty),
    kind: 'lot',
  }));

  const recordIds = [...new Set(lots.map((l) => l.master_record_id).filter(Boolean))];
  const empIds = [...new Set(lots.map((l) => l.assigned_employee_id).filter(Boolean))];
  const wcIds = [...new Set(lots.map((l) => l.work_center_id).filter(Boolean))];
  const nodeIds = [
    ...new Set(
      lots
        .flatMap((l) => [l.current_activity_flow_node_id, l.activity_flow_node_id])
        .filter(Boolean)
    ),
  ];
  const cardIds = [...new Set(lots.map((l) => l.production_card_id).filter(Boolean))];

  const [
    { data: lookups },
    { data: employees },
    { data: workCenters },
    { data: nodes },
    { data: cards },
  ] = await Promise.all([
    recordIds.length
      ? supabase.from('v_master_lookup').select('record_id, label').in('record_id', recordIds)
      : Promise.resolve({ data: [] }),
    empIds.length
      ? supabase.from('employees').select('id, full_name, employee_code').in('id', empIds)
      : Promise.resolve({ data: [] }),
    wcIds.length
      ? supabase.from('work_centers').select('id, name, code').in('id', wcIds)
      : Promise.resolve({ data: [] }),
    nodeIds.length
      ? supabase
          .from('activity_flow_nodes')
          .select('id, label, activity_type, sequence')
          .in('id', nodeIds)
      : Promise.resolve({ data: [] }),
    cardIds.length
      ? supabase
          .from('production_cards')
          .select('id, card_number, work_date, delivery_schedule_id, status')
          .in('id', cardIds)
      : Promise.resolve({ data: [] }),
  ]);

  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));
  const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const wcById = Object.fromEntries((workCenters || []).map((w) => [w.id, w]));
  const nodeById = Object.fromEntries((nodes || []).map((n) => [n.id, n]));
  const cardById = Object.fromEntries((cards || []).map((c) => [c.id, c]));

  const scheduleIds = [
    ...new Set((cards || []).map((c) => c.delivery_schedule_id).filter(Boolean)),
  ];
  let scheduleById = {};
  if (scheduleIds.length) {
    const { data: schedules } = await supabase
      .from('delivery_schedules')
      .select('id, schedule_number, due_date, blanket_po_line_id')
      .in('id', scheduleIds);
    scheduleById = Object.fromEntries((schedules || []).map((s) => [s.id, s]));
  }

  return lots.map((l) => {
    const card = cardById[l.production_card_id];
    const sched = card ? scheduleById[card.delivery_schedule_id] : null;
    const cur = l.current_activity_flow_node_id
      ? nodeById[l.current_activity_flow_node_id]
      : null;
    const emp = l.assigned_employee_id ? empById[l.assigned_employee_id] : null;
    const wc = l.work_center_id ? wcById[l.work_center_id] : null;
    return {
      ...l,
      component_label: labelById[l.master_record_id] || null,
      assigned_employee_name: emp?.full_name || null,
      assigned_employee_code: emp?.employee_code || null,
      work_center_code: wc?.code || null,
      work_center_name: wc?.name || null,
      current_node_label: cur?.label || null,
      current_node_type: cur?.activity_type || null,
      card_number: card?.card_number || null,
      work_date: card?.work_date || null,
      schedule_number: sched?.schedule_number || null,
      schedule_due_date: sched?.due_date || null,
      production_card_status: card?.status || null,
    };
  });
}

async function getLotById(lotId) {
  if (!isValidUUID(lotId)) throw httpError('Invalid lot id');
  const { data, error } = await supabase
    .from('production_lots')
    .select('*')
    .eq('id', lotId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError('Production lot not found', 404);
  const healed = await healFalseReadyForDispatch(data);
  const [enriched] = await enrichLots([healed]);
  return enriched;
}

async function listMyTodayLots(employeeId) {
  if (!isValidUUID(employeeId)) throw httpError('Invalid employee id');
  const { data, error } = await supabase
    .from('production_lots')
    .select('*')
    .eq('assigned_employee_id', employeeId)
    .in('status', ['in_process', 'received', 'at_supplier'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return enrichLots(data || []);
}

async function listLotsForWorkCenter(workCenterId, _date) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');
  // Traveler lots span days — show all open WIP at this WC (not filtered by schedule card work_date)
  const { data, error } = await supabase
    .from('production_lots')
    .select('*')
    .eq('work_center_id', workCenterId)
    .in('status', ['in_process', 'received'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return enrichLots(data || []);
}

async function listReadyForDispatch() {
  const { data, error } = await supabase
    .from('production_lots')
    .select('*')
    .eq('status', 'ready_for_dispatch')
    .order('updated_at', { ascending: true });
  if (error) throw error;

  const trueRfd = [];
  for (const lot of data || []) {
    const healed = await healFalseReadyForDispatch(lot);
    if (healed.status !== 'ready_for_dispatch') continue;
    const type = await getActivityTypeForNode(healed.current_activity_flow_node_id);
    if (type && TERMINAL_DISPATCH_TYPES.has(type)) {
      trueRfd.push(healed);
    }
  }
  return enrichLots(trueRfd);
}

async function completeLotOp(lotId, payload, actorEmployeeId, { isManager = false } = {}) {
  const lot = await getLotById(lotId);
  if (!isManager && lot.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee can complete this lot operation', 403);
  }
  if (!['in_process', 'received'].includes(lot.status)) {
    throw httpError('Lot is not ready for operation completion', 409);
  }

  const scrapQty = toNumber(payload?.scrap_qty);
  const goodQty =
    payload?.good_qty != null
      ? toNumber(payload.good_qty)
      : Math.max(0, toNumber(lot.quantity) - scrapQty);

  return advanceLotAfterOp(lotId, lot.current_activity_flow_node_id, {
    good_qty: goodQty,
    scrap_qty: scrapQty,
    employee_id: actorEmployeeId || lot.assigned_employee_id,
    work_center_id: lot.work_center_id,
  });
}

async function dispatchLot(lotId, actorEmployeeId) {
  const lot = await getLotById(lotId);
  if (lot.status !== 'ready_for_dispatch') {
    throw httpError('Lot is not ready for dispatch', 409);
  }
  const nodeType = await getActivityTypeForNode(lot.current_activity_flow_node_id);
  if (!nodeType || !TERMINAL_DISPATCH_TYPES.has(nodeType)) {
    throw httpError('Lot is not at an AF dispatch node', 409);
  }

  const { data: updated, error } = await supabase
    .from('production_lots')
    .update({
      status: 'dispatched',
      assigned_employee_id: null,
      assignment_status: 'unassigned',
      work_center_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lotId)
    .select('*')
    .single();
  if (error) throw error;

  await recordLotOpCompletion(updated, {
    good_qty: toNumber(updated.quantity),
    scrap_qty: 0,
    employee_id: actorEmployeeId || null,
    activity_flow_node_id: lot.current_activity_flow_node_id,
    work_center_id: lot.work_center_id,
  });

  const [enriched] = await enrichLots([updated]);
  return enriched;
}

async function reassignLot(lotId, employeeId) {
  if (!isValidUUID(lotId)) throw httpError('Invalid lot id');
  const { data: lot, error } = await supabase
    .from('production_lots')
    .select('*')
    .eq('id', lotId)
    .maybeSingle();
  if (error) throw error;
  if (!lot) throw httpError('Production lot not found', 404);
  if (!lot.work_center_id) throw httpError('Lot has no work center; cannot reassign');

  const previousEmployeeId = lot.assigned_employee_id || null;

  if (!employeeId) {
    const { data: updated, error: upErr } = await supabase
      .from('production_lots')
      .update({
        assigned_employee_id: null,
        assignment_status: 'unassigned',
      })
      .eq('id', lotId)
      .select('*')
      .single();
    if (upErr) throw upErr;
    return { lot: updated, assignee: null, previous_employee_id: previousEmployeeId };
  }

  if (!isValidUUID(employeeId)) throw httpError('employee_id is required');

  const { data: membership, error: mErr } = await supabase
    .from('employee_work_centers')
    .select('id')
    .eq('work_center_id', lot.work_center_id)
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

  const { data: updated, error: upErr } = await supabase
    .from('production_lots')
    .update({
      assigned_employee_id: employeeId,
      assignment_status: 'assigned',
    })
    .eq('id', lotId)
    .select('*')
    .single();
  if (upErr) throw upErr;
  return { lot: updated, assignee: emp, previous_employee_id: previousEmployeeId };
}

async function listLotOpCompletions(lotId) {
  if (!isValidUUID(lotId)) throw httpError('Invalid lot id');
  const { data, error } = await supabase
    .from('production_lot_op_completions')
    .select('*')
    .eq('production_lot_id', lotId)
    .order('completed_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

module.exports = {
  mintLotFromScheduleCard,
  advanceLotAfterOp,
  assignLotToNode,
  resolveNextTravelerNode,
  getLotById,
  enrichLots,
  listMyTodayLots,
  listLotsForWorkCenter,
  listReadyForDispatch,
  completeLotOp,
  dispatchLot,
  reassignLot,
  listLotOpCompletions,
  recordLotOpCompletion,
  healFalseReadyForDispatch,
};
