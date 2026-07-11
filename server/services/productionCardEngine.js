const { createClient } = require('@supabase/supabase-js');
const {
  nextDocumentNumber,
  getActiveBomVersionId,
  getActiveActivityFlowVersionId,
  getLineWithBlanket,
  todayDateString,
} = require('./blanketPosEngine');
const { generateComponentLotNumber } = require('./componentLotEngine');
const { backflushRawMaterials } = require('./backflushEngine');

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

function parseDateOnly(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) throw httpError('Invalid date format (YYYY-MM-DD)');
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/** Mon–Sat working days (UTC date math). Sunday = 0 skipped. */
function listWorkingDays(fromStr, toStr) {
  const start = parseDateOnly(fromStr);
  const end = parseDateOnly(toStr);
  if (end < start) return [];

  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay(); // 0=Sun
    if (dow !== 0) days.push(toDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function equalSplit(totalQty, nDays) {
  if (nDays <= 0) throw httpError('No working days to split into');
  const total = toNumber(totalQty);
  if (!(total > 0)) throw httpError('Schedule quantity must be > 0');

  // Use 4 decimal places; last day gets remainder
  const base = Math.floor((total / nDays) * 10000) / 10000;
  const targets = Array.from({ length: nDays }, () => base);
  const allocated = base * nDays;
  targets[nDays - 1] = Math.round((total - allocated + base) * 10000) / 10000;

  // Guard tiny float issues: if any day <= 0, put all on last day
  if (targets.some((t) => !(t > 0))) {
    return Array.from({ length: nDays }, (_, i) => (i === nDays - 1 ? total : 0.0001)).map(
      (t, i, arr) => {
        if (i < arr.length - 1) return 0.0001;
        return Math.round((total - 0.0001 * (nDays - 1)) * 10000) / 10000;
      }
    );
  }
  return targets;
}

function dayGoal(card) {
  return toNumber(card.target_quantity) + toNumber(card.overdue_quantity);
}

function mapCard(row) {
  if (!row) return row;
  return {
    ...row,
    target_quantity: toNumber(row.target_quantity),
    overdue_quantity: toNumber(row.overdue_quantity),
    total_good_produced: toNumber(row.total_good_produced),
    total_scrap_produced: toNumber(row.total_scrap_produced),
    backflushed_good_qty: toNumber(row.backflushed_good_qty),
    day_goal: dayGoal(row),
  };
}

async function enrichCards(rows) {
  if (!rows?.length) return [];

  const cards = rows.map(mapCard);
  const recordIds = [...new Set(cards.map((c) => c.master_record_id).filter(Boolean))];
  const empIds = [...new Set(cards.map((c) => c.assigned_employee_id).filter(Boolean))];
  const scheduleIds = [...new Set(cards.map((c) => c.delivery_schedule_id).filter(Boolean))];

  const [{ data: lookups }, { data: employees }, { data: schedules }] = await Promise.all([
    recordIds.length
      ? supabase.from('v_master_lookup').select('record_id, label').in('record_id', recordIds)
      : Promise.resolve({ data: [] }),
    empIds.length
      ? supabase.from('employees').select('id, full_name, employee_code').in('id', empIds)
      : Promise.resolve({ data: [] }),
    scheduleIds.length
      ? supabase
          .from('delivery_schedules')
          .select('id, schedule_number, due_date, quantity, status, bom_version_id, activity_flow_version_id, blanket_po_line_id')
          .in('id', scheduleIds)
      : Promise.resolve({ data: [] }),
  ]);

  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));
  const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const schedById = Object.fromEntries((schedules || []).map((s) => [s.id, s]));

  // customer names via lines → blankets
  const lineIds = [...new Set((schedules || []).map((s) => s.blanket_po_line_id).filter(Boolean))];
  let customerByLine = {};
  if (lineIds.length) {
    const { data: lines } = await supabase
      .from('blanket_po_lines')
      .select('id, blanket_po_id')
      .in('id', lineIds);
    const poIds = [...new Set((lines || []).map((l) => l.blanket_po_id))];
    const { data: pos } = poIds.length
      ? await supabase.from('blanket_pos').select('id, customer_id, blanket_number').in('id', poIds)
      : { data: [] };
    const custIds = [...new Set((pos || []).map((p) => p.customer_id).filter(Boolean))];
    const { data: customers } = custIds.length
      ? await supabase.from('customers').select('id, name').in('id', custIds)
      : { data: [] };
    const custById = Object.fromEntries((customers || []).map((c) => [c.id, c.name]));
    const poById = Object.fromEntries((pos || []).map((p) => [p.id, p]));
    for (const line of lines || []) {
      const po = poById[line.blanket_po_id];
      customerByLine[line.id] = {
        customer_name: po ? custById[po.customer_id] || null : null,
        blanket_number: po?.blanket_number || null,
      };
    }
  }

  return cards.map((c) => {
    const sched = schedById[c.delivery_schedule_id];
    const meta = sched ? customerByLine[sched.blanket_po_line_id] || {} : {};
    const emp = empById[c.assigned_employee_id];
    return {
      ...c,
      component_label: labelById[c.master_record_id] || null,
      assigned_employee_name: emp?.full_name || null,
      assigned_employee_code: emp?.employee_code || null,
      schedule_number: sched?.schedule_number || null,
      schedule_due_date: sched?.due_date || null,
      schedule_quantity: sched ? toNumber(sched.quantity) : null,
      schedule_due_weekday_label: (() => {
        if (!sched?.due_date) return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sched.due_date).slice(0, 10));
        if (!m) return null;
        const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        const js = d.getUTCDay();
        const iso = js === 0 ? 7 : js;
        return { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' }[iso] || null;
      })(),
      bom_version_id: sched?.bom_version_id || null,
      activity_flow_version_id: sched?.activity_flow_version_id || null,
      customer_name: meta.customer_name || null,
      blanket_number: meta.blanket_number || null,
    };
  });
}

async function getCardById(id) {
  if (!isValidUUID(id)) throw httpError('Invalid card id');
  const { data, error } = await supabase.from('production_cards').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError('Production card not found', 404);
  const [enriched] = await enrichCards([data]);
  return enriched;
}

async function assertEmployee(employeeId) {
  if (!isValidUUID(employeeId)) throw httpError('assigned_employee_id is required');
  const { data, error } = await supabase
    .from('employees')
    .select('id, full_name, employee_code')
    .eq('id', employeeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError('Employee not found', 404);
  return data;
}

function previewDailySplit(quantity, dueDate, fromDate = todayDateString()) {
  const start = fromDate > dueDate ? dueDate : fromDate;
  const days = listWorkingDays(start, dueDate);
  if (!days.length) throw httpError('No working days between release and due date');
  const targets = equalSplit(quantity, days.length);
  return days.map((work_date, i) => ({ work_date, target_quantity: targets[i] }));
}

async function releaseToProduction(payload, createdBy) {
  const scheduleId = payload.delivery_schedule_id;
  const employeeId = payload.assigned_employee_id;
  if (!isValidUUID(scheduleId)) throw httpError('delivery_schedule_id is required');
  await assertEmployee(employeeId);

  const { data: schedule, error } = await supabase
    .from('delivery_schedules')
    .select('*')
    .eq('id', scheduleId)
    .maybeSingle();
  if (error) throw error;
  if (!schedule) throw httpError('Delivery schedule not found', 404);
  if (schedule.status === 'cancelled') throw httpError('Cannot release a cancelled schedule');

  const { data: existing } = await supabase
    .from('production_cards')
    .select('id')
    .eq('delivery_schedule_id', scheduleId)
    .limit(1);
  if (existing?.length) throw httpError('Daily production cards already exist for this schedule', 409);

  const { line } = await getLineWithBlanket(schedule.blanket_po_line_id);

  let bomVersionId = schedule.bom_version_id;
  let afVersionId = schedule.activity_flow_version_id;
  let releasedSchedule = schedule;

  if (schedule.status === 'planned') {
    bomVersionId = await getActiveBomVersionId(line.master_record_id);
    afVersionId = await getActiveActivityFlowVersionId(line.master_record_id);
    if (!bomVersionId) throw httpError('Cannot release: component has no active BOM');
    if (!afVersionId) throw httpError('Cannot release: component has no active Activity Flow');

    const { data: updated, error: upErr } = await supabase
      .from('delivery_schedules')
      .update({
        status: 'released',
        bom_version_id: bomVersionId,
        activity_flow_version_id: afVersionId,
      })
      .eq('id', scheduleId)
      .select('*')
      .single();
    if (upErr) throw upErr;
    releasedSchedule = updated;
  } else if (schedule.status === 'released') {
    if (!bomVersionId || !afVersionId) {
      throw httpError('Released schedule is missing frozen BOM or Activity Flow');
    }
  } else {
    throw httpError('Schedule cannot be released to production');
  }

  const today = todayDateString();
  const start = today > releasedSchedule.due_date ? releasedSchedule.due_date : today;
  const workingDays = listWorkingDays(start, releasedSchedule.due_date);
  if (!workingDays.length) {
    throw httpError('No working days (Mon–Sat) from today through the due date');
  }

  const targets = equalSplit(releasedSchedule.quantity, workingDays.length);
  const cards = [];

  for (let i = 0; i < workingDays.length; i++) {
    const cardNumber = await nextDocumentNumber('production_card', 'JOB');
    const { data: card, error: insErr } = await supabase
      .from('production_cards')
      .insert({
        card_number: cardNumber,
        delivery_schedule_id: scheduleId,
        master_record_id: line.master_record_id,
        assigned_employee_id: employeeId,
        work_date: workingDays[i],
        target_quantity: targets[i],
        overdue_quantity: 0,
        total_good_produced: 0,
        total_scrap_produced: 0,
        backflushed_good_qty: 0,
        status: 'READY',
        created_by: createdBy || null,
      })
      .select('*')
      .single();
    if (insErr) throw insErr;
    cards.push(card);
  }

  return {
    schedule: releasedSchedule,
    cards: await enrichCards(cards),
    split_preview: workingDays.map((d, i) => ({ work_date: d, target_quantity: targets[i] })),
  };
}

async function listCards(filters = {}) {
  let query = supabase.from('production_cards').select('*').order('work_date', { ascending: true });

  if (filters.employee_id) query = query.eq('assigned_employee_id', filters.employee_id);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.from) query = query.gte('work_date', filters.from);
  if (filters.to) query = query.lte('work_date', filters.to);
  if (filters.delivery_schedule_id) {
    query = query.eq('delivery_schedule_id', filters.delivery_schedule_id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return enrichCards(data || []);
}

async function listMyToday(employeeId) {
  if (!isValidUUID(employeeId)) throw httpError('Invalid employee id');
  const today = todayDateString();

  const { data, error } = await supabase
    .from('production_cards')
    .select('*')
    .eq('assigned_employee_id', employeeId)
    .or(`work_date.eq.${today},status.in.(OVERDUE,RUNNING)`)
    .order('work_date', { ascending: true });

  if (error) throw error;
  return enrichCards(data || []);
}

async function rolloverOverdue() {
  const today = todayDateString();

  const { data: stale, error } = await supabase
    .from('production_cards')
    .select('*')
    .lt('work_date', today)
    .in('status', ['READY', 'RUNNING']);

  if (error) throw error;

  const updated = [];

  for (const card of stale || []) {
    const goal = dayGoal(card);
    const good = toNumber(card.total_good_produced);
    const shortfall = Math.max(0, goal - good);

    const { data: marked, error: markErr } = await supabase
      .from('production_cards')
      .update({
        status: shortfall > 0 ? 'OVERDUE' : 'COMPLETED',
        completed_at: shortfall > 0 ? null : card.completed_at || new Date().toISOString(),
      })
      .eq('id', card.id)
      .select('*')
      .single();
    if (markErr) throw markErr;

    if (shortfall > 0) {
      const { data: nextCards, error: nextErr } = await supabase
        .from('production_cards')
        .select('*')
        .eq('delivery_schedule_id', card.delivery_schedule_id)
        .gt('work_date', card.work_date)
        .order('work_date', { ascending: true })
        .limit(1);
      if (nextErr) throw nextErr;

      if (nextCards?.length) {
        const next = nextCards[0];
        const { error: carryErr } = await supabase
          .from('production_cards')
          .update({ overdue_quantity: toNumber(next.overdue_quantity) + shortfall })
          .eq('id', next.id);
        if (carryErr) throw carryErr;
      }
    }

    updated.push(mapCard(marked));
  }

  return { rolled: updated.length, cards: updated };
}

async function startCard(cardId, actorEmployeeId, { isManager = false } = {}) {
  const card = await getCardById(cardId);
  if (!isManager && card.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee can start this card', 403);
  }
  if (!['READY', 'OVERDUE'].includes(card.status)) {
    throw httpError('Only READY or OVERDUE cards can be started');
  }

  const { data, error } = await supabase
    .from('production_cards')
    .update({ status: 'RUNNING', started_at: new Date().toISOString() })
    .eq('id', cardId)
    .select('*')
    .single();
  if (error) throw error;
  const [enriched] = await enrichCards([data]);
  return enriched;
}

async function reportProgress(cardId, payload, actorEmployeeId, { isManager = false } = {}) {
  const card = await getCardById(cardId);
  if (!isManager && card.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee can update this card', 403);
  }
  if (!['RUNNING', 'OVERDUE'].includes(card.status) && card.status !== 'READY') {
    // allow READY only after start — force RUNNING
  }
  if (card.status === 'COMPLETED') throw httpError('Card is already completed');
  if (card.status === 'READY') throw httpError('Start the card before reporting progress');

  const goodDelta = toNumber(payload.good_qty);
  const scrapDelta = toNumber(payload.scrap_qty);
  if (goodDelta < 0 || scrapDelta < 0) throw httpError('Quantities cannot be negative');
  if (goodDelta === 0 && scrapDelta === 0) throw httpError('Enter good or scrap quantity');

  const newGood = toNumber(card.total_good_produced) + goodDelta;
  const newScrap = toNumber(card.total_scrap_produced) + scrapDelta;
  const goal = dayGoal(card);
  const doneForDay = !!payload.done_for_day || newGood >= goal;

  if (goodDelta > 0) {
    const bomVersionId = card.bom_version_id;
    await backflushRawMaterials({
      bomVersionId,
      deltaGood: goodDelta,
      productionCardId: cardId,
      parentMasterRecordId: card.master_record_id,
      cardNumber: card.card_number,
    });
  }

  const updates = {
    total_good_produced: newGood,
    total_scrap_produced: newScrap,
    backflushed_good_qty: toNumber(card.backflushed_good_qty) + goodDelta,
    status: doneForDay && newGood >= goal ? 'COMPLETED' : 'RUNNING',
  };
  if (updates.status === 'COMPLETED') {
    updates.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('production_cards')
    .update(updates)
    .eq('id', cardId)
    .select('*')
    .single();
  if (error) throw error;
  const [enriched] = await enrichCards([data]);
  return enriched;
}

async function completeMachiningOp(cardId, nodeId, payload, actorEmployeeId, opts = {}) {
  const card = await getCardById(cardId);
  if (!opts.isManager && card.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee can complete machining', 403);
  }
  if (!['RUNNING', 'OVERDUE'].includes(card.status)) {
    throw httpError('Card must be RUNNING to complete a machining operation');
  }
  if (!isValidUUID(nodeId)) throw httpError('Invalid activity flow node id');

  const qty = toNumber(payload.quantity);
  if (!(qty > 0)) throw httpError('quantity must be > 0');

  if (!card.activity_flow_version_id) {
    throw httpError('Schedule has no frozen activity flow');
  }

  const { data: node, error: nErr } = await supabase
    .from('activity_flow_nodes')
    .select('*')
    .eq('id', nodeId)
    .eq('activity_flow_version_id', card.activity_flow_version_id)
    .maybeSingle();
  if (nErr) throw nErr;
  if (!node) throw httpError('Activity flow node not found on this card’s routing', 404);
  if (node.activity_type !== 'machining') {
    throw httpError('Only machining nodes create lots');
  }

  const lotNumber = await generateComponentLotNumber(card.master_record_id);
  const { data: lot, error } = await supabase
    .from('production_lots')
    .insert({
      lot_number: lotNumber,
      master_record_id: card.master_record_id,
      production_card_id: cardId,
      activity_flow_node_id: nodeId,
      quantity: qty,
      status: 'in_process',
    })
    .select('*')
    .single();
  if (error) throw error;

  return {
    lot: {
      ...lot,
      quantity: toNumber(lot.quantity),
      node_label: node.label,
    },
  };
}

async function listCardLots(cardId) {
  if (!isValidUUID(cardId)) throw httpError('Invalid card id');
  const { data, error } = await supabase
    .from('production_lots')
    .select('*')
    .eq('production_card_id', cardId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((l) => ({ ...l, quantity: toNumber(l.quantity) }));
}

async function listCardFlowNodes(cardId) {
  const card = await getCardById(cardId);
  if (!card.activity_flow_version_id) return [];
  const { data, error } = await supabase
    .from('activity_flow_nodes')
    .select('id, label, activity_type, sequence, supplier_id, lead_time_days, work_center_id')
    .eq('activity_flow_version_id', card.activity_flow_version_id)
    .order('sequence', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function sendOutsource(payload, actorEmployeeId, opts = {}) {
  const cardId = payload.production_card_id;
  const nodeId = payload.activity_flow_node_id;
  const lotIds = Array.isArray(payload.lot_ids) ? payload.lot_ids : [];
  const merge = !!payload.merge;

  const card = await getCardById(cardId);
  if (!opts.isManager && card.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee can send outsource', 403);
  }
  if (!isValidUUID(nodeId)) throw httpError('activity_flow_node_id is required');
  if (!lotIds.length) throw httpError('lot_ids are required');

  const { data: node, error: nErr } = await supabase
    .from('activity_flow_nodes')
    .select('*')
    .eq('id', nodeId)
    .eq('activity_flow_version_id', card.activity_flow_version_id)
    .maybeSingle();
  if (nErr) throw nErr;
  if (!node) throw httpError('Outsource node not found on this routing', 404);
  if (node.activity_type !== 'outsource') throw httpError('Node must be an outsource activity');

  const { data: lots, error: lErr } = await supabase
    .from('production_lots')
    .select('*')
    .in('id', lotIds)
    .eq('production_card_id', cardId);
  if (lErr) throw lErr;
  if (!lots?.length || lots.length !== lotIds.length) {
    throw httpError('One or more lots not found on this card');
  }
  if (lots.some((l) => !['in_process', 'received'].includes(l.status))) {
    throw httpError('Lots must be in_process or received to send');
  }

  let shipLotIds = lotIds;

  if (merge) {
    if (lots.length < 2) throw httpError('Merge requires at least two lots');
    const sumQty = lots.reduce((s, l) => s + toNumber(l.quantity), 0);
    const lotNumber = await generateComponentLotNumber(card.master_record_id);
    const { data: mergedLot, error: mErr } = await supabase
      .from('production_lots')
      .insert({
        lot_number: lotNumber,
        master_record_id: card.master_record_id,
        production_card_id: cardId,
        activity_flow_node_id: nodeId,
        quantity: sumQty,
        status: 'in_process',
      })
      .select('*')
      .single();
    if (mErr) throw mErr;

    for (const src of lots) {
      const { error: uErr } = await supabase
        .from('production_lots')
        .update({ status: 'merged', merged_into_lot_id: mergedLot.id })
        .eq('id', src.id);
      if (uErr) throw uErr;
      const { error: jErr } = await supabase.from('production_lot_merges').insert({
        result_lot_id: mergedLot.id,
        source_lot_id: src.id,
      });
      if (jErr) throw jErr;
    }
    shipLotIds = [mergedLot.id];
  }

  const shipmentNumber = await nextDocumentNumber('outsource_shipment', 'OS');
  const { data: shipment, error: sErr } = await supabase
    .from('outsource_shipments')
    .insert({
      shipment_number: shipmentNumber,
      production_card_id: cardId,
      activity_flow_node_id: nodeId,
      supplier_id: node.supplier_id || null,
      status: 'sent',
      sent_at: new Date().toISOString(),
      notes: payload.notes || null,
    })
    .select('*')
    .single();
  if (sErr) throw sErr;

  for (const lotId of shipLotIds) {
    const { error: linkErr } = await supabase.from('outsource_shipment_lots').insert({
      shipment_id: shipment.id,
      lot_id: lotId,
    });
    if (linkErr) throw linkErr;
    const { error: lotUp } = await supabase
      .from('production_lots')
      .update({ status: 'at_supplier' })
      .eq('id', lotId);
    if (lotUp) throw lotUp;
  }

  return { shipment, lot_ids: shipLotIds };
}

async function receiveOutsource(shipmentId, actorEmployeeId, opts = {}) {
  if (!isValidUUID(shipmentId)) throw httpError('Invalid shipment id');

  const { data: shipment, error } = await supabase
    .from('outsource_shipments')
    .select('*')
    .eq('id', shipmentId)
    .maybeSingle();
  if (error) throw error;
  if (!shipment) throw httpError('Shipment not found', 404);
  if (shipment.status !== 'sent') throw httpError('Only sent shipments can be received');

  const card = await getCardById(shipment.production_card_id);
  if (!opts.isManager && card.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee can receive this shipment', 403);
  }

  const { data: links, error: lErr } = await supabase
    .from('outsource_shipment_lots')
    .select('lot_id')
    .eq('shipment_id', shipmentId);
  if (lErr) throw lErr;

  for (const link of links || []) {
    const { error: lotUp } = await supabase
      .from('production_lots')
      .update({ status: 'received' })
      .eq('id', link.lot_id);
    if (lotUp) throw lotUp;
  }

  const { data: updated, error: upErr } = await supabase
    .from('outsource_shipments')
    .update({ status: 'received', received_at: new Date().toISOString() })
    .eq('id', shipmentId)
    .select('*')
    .single();
  if (upErr) throw upErr;

  return { shipment: updated };
}

async function listCardShipments(cardId) {
  if (!isValidUUID(cardId)) throw httpError('Invalid card id');
  const { data, error } = await supabase
    .from('outsource_shipments')
    .select('*')
    .eq('production_card_id', cardId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

module.exports = {
  previewDailySplit,
  releaseToProduction,
  listCards,
  listMyToday,
  getCardById,
  rolloverOverdue,
  startCard,
  reportProgress,
  completeMachiningOp,
  listCardLots,
  listCardFlowNodes,
  sendOutsource,
  receiveOutsource,
  listCardShipments,
  listWorkingDays,
  equalSplit,
};
