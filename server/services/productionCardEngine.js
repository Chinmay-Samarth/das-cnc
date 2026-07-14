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
  const wcIds = [...new Set(cards.map((c) => c.work_center_id).filter(Boolean))];
  const nodeIds = [...new Set(cards.map((c) => c.current_activity_flow_node_id).filter(Boolean))];

  const [{ data: lookups }, { data: employees }, { data: schedules }, { data: workCenters }, { data: nodes }] =
    await Promise.all([
      recordIds.length
        ? supabase.from('v_master_lookup').select('record_id, label').in('record_id', recordIds)
        : Promise.resolve({ data: [] }),
      empIds.length
        ? supabase.from('employees').select('id, full_name, employee_code').in('id', empIds)
        : Promise.resolve({ data: [] }),
      scheduleIds.length
        ? supabase
            .from('delivery_schedules')
            .select(
              'id, schedule_number, due_date, quantity, status, bom_version_id, activity_flow_version_id, blanket_po_line_id'
            )
            .in('id', scheduleIds)
        : Promise.resolve({ data: [] }),
      wcIds.length
        ? supabase.from('work_centers').select('id, name, code').in('id', wcIds)
        : Promise.resolve({ data: [] }),
      nodeIds.length
        ? supabase.from('activity_flow_nodes').select('id, label, activity_type, sequence').in('id', nodeIds)
        : Promise.resolve({ data: [] }),
    ]);

  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));
  const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const schedById = Object.fromEntries((schedules || []).map((s) => [s.id, s]));
  const wcById = Object.fromEntries((workCenters || []).map((w) => [w.id, w]));
  const nodeById = Object.fromEntries((nodes || []).map((n) => [n.id, n]));

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

  return attachRouteCrew(
    cards.map((c) => {
    const sched = schedById[c.delivery_schedule_id];
    const meta = sched ? customerByLine[sched.blanket_po_line_id] || {} : {};
    const emp = empById[c.assigned_employee_id];
    const wc = wcById[c.work_center_id];
    const node = nodeById[c.current_activity_flow_node_id];
    return {
      ...c,
      component_label: labelById[c.master_record_id] || null,
      assigned_employee_name: emp?.full_name || null,
      assigned_employee_code: emp?.employee_code || null,
      work_center_name: wc?.name || null,
      work_center_code: wc?.code || null,
      current_node_label: node?.label || null,
      current_node_type: node?.activity_type || null,
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
      day_goal: dayGoal(c),
      remaining_qty: Math.max(0, dayGoal(c) - toNumber(c.total_good_produced)),
    };
  })
  );
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
  if (!isValidUUID(scheduleId)) throw httpError('delivery_schedule_id is required');

  const { data: schedule, error } = await supabase
    .from('delivery_schedules')
    .select('*')
    .eq('id', scheduleId)
    .maybeSingle();
  if (error) throw error;
  if (!schedule) throw httpError('Delivery schedule not found', 404);
  if (schedule.status === 'cancelled') throw httpError('Cannot release a cancelled schedule');
  if (schedule.status === 'released') {
    throw httpError('Already released to production', 409);
  }

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
        assigned_employee_id: null,
        work_date: workingDays[i],
        target_quantity: targets[i],
        overdue_quantity: 0,
        total_good_produced: 0,
        total_scrap_produced: 0,
        backflushed_good_qty: 0,
        status: 'READY',
        assignment_status: 'unassigned',
        created_by: createdBy || null,
      })
      .select('*')
      .single();
    if (insErr) throw insErr;
    cards.push(card);
  }

  // Auto-assign by earliest due date, equalizing backlog one card at a time
  const { assignCardsInDueOrder } = require('./productionAssignEngine');
  const assignments = await assignCardsInDueOrder(cards);
  const assignedRows = assignments.map((a) => a.card);

  return {
    schedule: releasedSchedule,
    cards: await enrichCards(assignedRows),
    assignments: assignments.map((a) => ({
      card_id: a.card?.id,
      employee_id: a.assignee?.id || null,
      employee_name: a.assignee?.full_name || null,
      work_center_id: a.node?.work_center_id || a.card?.work_center_id || null,
      node_id: a.node?.id || null,
      node_label: a.node?.label || null,
      assignment_status: a.card?.assignment_status,
      reason: a.reason || null,
    })),
    split_preview: workingDays.map((d, i) => ({ work_date: d, target_quantity: targets[i] })),
  };
}

async function listCards(filters = {}) {
  let query = supabase.from('production_cards').select('*').order('work_date', { ascending: true });

  // employee_id: match parent assignee OR anyone on the route (filter after enrich)
  const filterEmployeeId = filters.employee_id || null;
  if (filters.work_center_id) query = query.eq('work_center_id', filters.work_center_id);
  if (filters.assignment_status) query = query.eq('assignment_status', filters.assignment_status);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.from) query = query.gte('work_date', filters.from);
  if (filters.to) query = query.lte('work_date', filters.to);
  if (filters.delivery_schedule_id) {
    query = query.eq('delivery_schedule_id', filters.delivery_schedule_id);
  }

  const { data, error } = await query;
  if (error) throw error;
  let enriched = await enrichCards(data || []);

  if (filterEmployeeId && isValidUUID(filterEmployeeId)) {
    enriched = enriched.filter(
      (c) =>
        c.assigned_employee_id === filterEmployeeId ||
        c.current_operator_id === filterEmployeeId ||
        (c.route_operators || []).some((o) => o.id === filterEmployeeId)
    );
  }

  return enriched.sort((a, b) => {
    const da = a.schedule_due_date || '9999-12-31';
    const db = b.schedule_due_date || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    if (a.work_date !== b.work_date) return a.work_date < b.work_date ? -1 : 1;
    return String(a.card_number || '').localeCompare(String(b.card_number || ''));
  });
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
  const enriched = await enrichCards(data || []);
  // Due date ascending, then status priority, then card number
  const statusRank = { OVERDUE: 0, RUNNING: 1, READY: 2, COMPLETED: 3 };
  const cards = enriched.sort((a, b) => {
    const da = a.schedule_due_date || '9999-12-31';
    const db = b.schedule_due_date || '9999-12-31';
    if (da !== db) return da < db ? -1 : 1;
    const sa = statusRank[a.status] ?? 9;
    const sb = statusRank[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return String(a.card_number || '').localeCompare(String(b.card_number || ''));
  });

  const { listMyTodayLots } = require('./lotTravelerEngine');
  const lots = await listMyTodayLots(employeeId);

  const { listMyTodayOpCards } = require('./productionOpCardEngine');
  const op_cards = await listMyTodayOpCards(employeeId);

  const completionStats = await sumOpCompletionsForEmployee(employeeId, today);
  const completed_ops_today = await listCompletedOpsTodayForEmployee(employeeId, today);
  const opsCompletedToday = completionStats.count;
  const completedGoodToday = completionStats.good_qty;
  const cardsCompletedToday = cards.filter((c) => c.status === 'COMPLETED').length;

  // Efficiency: current-op progress on open cards + ledgered good from finished ops today.
  // Completed-op good also counts toward the goal so handoffs don't zero out the index.
  const openCards = cards.filter((c) => c.status !== 'COMPLETED');
  const openGood = openCards.reduce((s, c) => s + toNumber(c.total_good_produced), 0);
  const openGoal = openCards.reduce((s, c) => s + dayGoal(c), 0);
  const goodToday = openGood + completedGoodToday;
  const goalToday = openGoal + completedGoodToday;
  const efficiencyPct = goalToday > 0 ? Math.round((goodToday / goalToday) * 100) : 0;

  return {
    cards,
    lots,
    op_cards,
    completed_ops_today,
    ops_completed_today: opsCompletedToday,
    cards_completed_today: cardsCompletedToday,
    // Credit = op handoffs finished by this employee today (primary), plus final cards if any
    completed_credit: Math.max(opsCompletedToday, cardsCompletedToday),
    good_today: goodToday,
    goal_today: goalToday,
    efficiency_pct: efficiencyPct,
  };
}

async function sumOpCompletionsForEmployee(employeeId, date) {
  if (!isValidUUID(employeeId) || !date) {
    return { count: 0, good_qty: 0, scrap_qty: 0 };
  }
  const start = `${date}T00:00:00.000Z`;
  const endDate = new Date(`${date}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString();

  const [{ data, error }, { data: lotData, error: lotErr }] = await Promise.all([
    supabase
      .from('production_card_op_completions')
      .select('id, good_qty, scrap_qty')
      .eq('employee_id', employeeId)
      .gte('completed_at', start)
      .lt('completed_at', end),
    supabase
      .from('production_lot_op_completions')
      .select('id, good_qty, scrap_qty')
      .eq('employee_id', employeeId)
      .gte('completed_at', start)
      .lt('completed_at', end),
  ]);
  if (error) throw error;
  if (lotErr) throw lotErr;
  const rows = [...(data || []), ...(lotData || [])];
  return {
    count: rows.length,
    good_qty: rows.reduce((s, r) => s + toNumber(r.good_qty), 0),
    scrap_qty: rows.reduce((s, r) => s + toNumber(r.scrap_qty), 0),
  };
}

/**
 * Detailed Done-today rows for My Today (card + lot completion ledger).
 */
async function listCompletedOpsTodayForEmployee(employeeId, date) {
  if (!isValidUUID(employeeId) || !date) return [];
  const start = `${date}T00:00:00.000Z`;
  const endDate = new Date(`${date}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString();

  const [{ data: cardRows, error: cErr }, { data: lotRows, error: lErr }] = await Promise.all([
    supabase
      .from('production_card_op_completions')
      .select(
        'id, production_card_id, activity_flow_node_id, work_center_id, good_qty, scrap_qty, completed_at'
      )
      .eq('employee_id', employeeId)
      .gte('completed_at', start)
      .lt('completed_at', end)
      .order('completed_at', { ascending: false }),
    supabase
      .from('production_lot_op_completions')
      .select(
        'id, production_lot_id, activity_flow_node_id, work_center_id, good_qty, scrap_qty, completed_at'
      )
      .eq('employee_id', employeeId)
      .gte('completed_at', start)
      .lt('completed_at', end)
      .order('completed_at', { ascending: false }),
  ]);
  if (cErr) throw cErr;
  if (lErr) throw lErr;

  const lotIds = [...new Set((lotRows || []).map((r) => r.production_lot_id).filter(Boolean))];
  let lotsById = {};
  if (lotIds.length) {
    const { data: lots, error: lotErr } = await supabase
      .from('production_lots')
      .select('id, lot_number, production_card_id')
      .in('id', lotIds);
    if (lotErr) throw lotErr;
    lotsById = Object.fromEntries((lots || []).map((l) => [l.id, l]));
  }

  const cardIds = [
    ...new Set([
      ...(cardRows || []).map((r) => r.production_card_id).filter(Boolean),
      ...Object.values(lotsById)
        .map((l) => l.production_card_id)
        .filter(Boolean),
    ]),
  ];
  let cardsById = {};
  if (cardIds.length) {
    const { data: cards, error: cardErr } = await supabase
      .from('production_cards')
      .select('id, card_number')
      .in('id', cardIds);
    if (cardErr) throw cardErr;
    cardsById = Object.fromEntries((cards || []).map((c) => [c.id, c]));
  }

  const nodeIds = [
    ...new Set(
      [...(cardRows || []), ...(lotRows || [])]
        .map((r) => r.activity_flow_node_id)
        .filter(Boolean)
    ),
  ];
  const wcIds = [
    ...new Set(
      [...(cardRows || []), ...(lotRows || [])].map((r) => r.work_center_id).filter(Boolean)
    ),
  ];
  const [{ data: nodes }, { data: wcs }] = await Promise.all([
    nodeIds.length
      ? supabase.from('activity_flow_nodes').select('id, label, activity_type').in('id', nodeIds)
      : Promise.resolve({ data: [] }),
    wcIds.length
      ? supabase.from('work_centers').select('id, code, name').in('id', wcIds)
      : Promise.resolve({ data: [] }),
  ]);
  const nodeById = Object.fromEntries((nodes || []).map((n) => [n.id, n]));
  const wcById = Object.fromEntries((wcs || []).map((w) => [w.id, w]));

  const rows = [];
  for (const r of cardRows || []) {
    const card = cardsById[r.production_card_id];
    const node = nodeById[r.activity_flow_node_id];
    const wc = wcById[r.work_center_id];
    rows.push({
      id: r.id,
      source: 'card',
      completed_at: r.completed_at,
      good_qty: toNumber(r.good_qty),
      scrap_qty: toNumber(r.scrap_qty),
      op_label: node?.label || node?.activity_type || 'Operation',
      activity_type: node?.activity_type || null,
      work_center_code: wc?.code || null,
      production_card_id: r.production_card_id,
      card_number: card?.card_number || null,
      lot_number: null,
      production_lot_id: null,
    });
  }
  for (const r of lotRows || []) {
    const lot = lotsById[r.production_lot_id];
    const card = lot ? cardsById[lot.production_card_id] : null;
    const node = nodeById[r.activity_flow_node_id];
    const wc = wcById[r.work_center_id];
    rows.push({
      id: r.id,
      source: 'lot',
      completed_at: r.completed_at,
      good_qty: toNumber(r.good_qty),
      scrap_qty: toNumber(r.scrap_qty),
      op_label: node?.label || node?.activity_type || 'Operation',
      activity_type: node?.activity_type || null,
      work_center_code: wc?.code || null,
      production_card_id: lot?.production_card_id || null,
      card_number: card?.card_number || null,
      lot_number: lot?.lot_number || null,
      production_lot_id: r.production_lot_id,
    });
  }

  rows.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  return rows;
}

/**
 * Attach route_operators + current op context from Op Cards / completions.
 */
async function attachRouteCrew(enrichedCards) {
  if (!enrichedCards?.length) return enrichedCards;
  const cardIds = enrichedCards.map((c) => c.id).filter(Boolean);

  let opRows = [];
  try {
    const { data, error } = await supabase
      .from('production_op_cards')
      .select(
        'id, parent_production_card_id, production_lot_id, activity_flow_node_id, work_center_id, assigned_employee_id, status, created_at'
      )
      .in('parent_production_card_id', cardIds);
    if (error) throw error;
    opRows = data || [];
  } catch (e) {
    // Table may be missing during rollout
    return enrichedCards.map((c) => ({
      ...c,
      route_operators: c.assigned_employee_id
        ? [
            {
              id: c.assigned_employee_id,
              name: c.assigned_employee_name,
              code: c.assigned_employee_code,
            },
          ].filter((o) => o.name)
        : [],
      current_operator_id: c.assigned_employee_id || null,
      current_operator_name: c.assigned_employee_name || null,
      current_operator_code: c.assigned_employee_code || null,
      current_node_label: c.current_node_label || null,
      current_work_center_code: c.work_center_code || null,
    }));
  }

  const [{ data: cardComps }, { data: lots }] = await Promise.all([
    supabase
      .from('production_card_op_completions')
      .select('production_card_id, employee_id')
      .in('production_card_id', cardIds),
    supabase.from('production_lots').select('id, production_card_id').in('production_card_id', cardIds),
  ]);

  const lotIds = (lots || []).map((l) => l.id);
  const lotCardByLot = Object.fromEntries((lots || []).map((l) => [l.id, l.production_card_id]));
  let lotComps = [];
  if (lotIds.length) {
    const { data } = await supabase
      .from('production_lot_op_completions')
      .select('production_lot_id, employee_id')
      .in('production_lot_id', lotIds);
    lotComps = data || [];
  }

  const empIds = new Set();
  for (const c of enrichedCards) {
    if (c.assigned_employee_id) empIds.add(c.assigned_employee_id);
  }
  for (const o of opRows) {
    if (o.assigned_employee_id) empIds.add(o.assigned_employee_id);
  }
  for (const c of cardComps || []) {
    if (c.employee_id) empIds.add(c.employee_id);
  }
  for (const c of lotComps) {
    if (c.employee_id) empIds.add(c.employee_id);
  }

  const nodeIds = [
    ...new Set(opRows.map((o) => o.activity_flow_node_id).filter(Boolean)),
  ];
  const wcIds = [...new Set(opRows.map((o) => o.work_center_id).filter(Boolean))];

  const [{ data: employees }, { data: nodes }, { data: wcs }] = await Promise.all([
    empIds.size
      ? supabase
          .from('employees')
          .select('id, full_name, employee_code')
          .in('id', [...empIds])
      : Promise.resolve({ data: [] }),
    nodeIds.length
      ? supabase.from('activity_flow_nodes').select('id, label, sequence').in('id', nodeIds)
      : Promise.resolve({ data: [] }),
    wcIds.length
      ? supabase.from('work_centers').select('id, code').in('id', wcIds)
      : Promise.resolve({ data: [] }),
  ]);

  const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const nodeById = Object.fromEntries((nodes || []).map((n) => [n.id, n]));
  const wcById = Object.fromEntries((wcs || []).map((w) => [w.id, w]));

  const opsByCard = {};
  for (const o of opRows) {
    if (!opsByCard[o.parent_production_card_id]) opsByCard[o.parent_production_card_id] = [];
    opsByCard[o.parent_production_card_id].push(o);
  }
  const crewIdsByCard = {};
  function addCrew(cardId, empId) {
    if (!cardId || !empId) return;
    if (!crewIdsByCard[cardId]) crewIdsByCard[cardId] = new Set();
    crewIdsByCard[cardId].add(empId);
  }
  for (const c of enrichedCards) addCrew(c.id, c.assigned_employee_id);
  for (const o of opRows) addCrew(o.parent_production_card_id, o.assigned_employee_id);
  for (const c of cardComps || []) addCrew(c.production_card_id, c.employee_id);
  for (const c of lotComps) addCrew(lotCardByLot[c.production_lot_id], c.employee_id);

  return enrichedCards.map((c) => {
    const ops = opsByCard[c.id] || [];
    const openOps = ops.filter((o) => ['READY', 'RUNNING'].includes(o.status));
    // Prefer furthest open op by node sequence
    let currentOp = null;
    let bestSeq = -1;
    for (const o of openOps) {
      const seq = Number(nodeById[o.activity_flow_node_id]?.sequence) || 0;
      if (seq >= bestSeq) {
        bestSeq = seq;
        currentOp = o;
      }
    }
    const currentEmpId = currentOp?.assigned_employee_id || c.assigned_employee_id || null;
    const currentEmp = currentEmpId ? empById[currentEmpId] : null;
    const currentNode = currentOp
      ? nodeById[currentOp.activity_flow_node_id]
      : null;
    const currentWc = currentOp?.work_center_id
      ? wcById[currentOp.work_center_id]
      : null;

    const route_operators = [...(crewIdsByCard[c.id] || [])]
      .map((id) => {
        const e = empById[id];
        return e
          ? { id: e.id, name: e.full_name, code: e.employee_code }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));

    return {
      ...c,
      route_operators,
      current_operator_id: currentEmpId,
      current_operator_name: currentEmp?.full_name || c.assigned_employee_name || null,
      current_operator_code: currentEmp?.employee_code || c.assigned_employee_code || null,
      current_node_label: currentNode?.label || c.current_node_label || null,
      current_work_center_code: currentWc?.code || c.work_center_code || null,
    };
  });
}

async function countOpCompletionsForEmployee(employeeId, date) {
  const stats = await sumOpCompletionsForEmployee(employeeId, date);
  return stats.count;
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

function formatMintedLotPayload(mintedLot) {
  if (!mintedLot?.lot) return null;
  return {
    ...mintedLot.lot,
    quantity: toNumber(mintedLot.lot.quantity),
    current_node_label: mintedLot.next_node?.label || null,
    current_node_type: mintedLot.next_node?.activity_type || null,
    ready_for_dispatch: !!mintedLot.ready_for_dispatch,
  };
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

  const {
    resolveFirstSchedulableNode,
    recordOpCompletion,
  } = require('./productionAssignEngine');
  const { mintLotFromScheduleCard } = require('./lotTravelerEngine');

  // Backflush RM only on the first schedulable AF node (pieces already issued upstream)
  const firstNode = await resolveFirstSchedulableNode(card.activity_flow_version_id);
  const sourceNodeId = card.current_activity_flow_node_id || firstNode?.id || null;
  const isFirstOp =
    !card.current_activity_flow_node_id ||
    (firstNode && card.current_activity_flow_node_id === firstNode.id);

  let backflushedGood = toNumber(card.backflushed_good_qty);
  if (goodDelta > 0 && isFirstOp) {
    const bomVersionId = card.bom_version_id;
    await backflushRawMaterials({
      bomVersionId,
      deltaGood: goodDelta,
      productionCardId: cardId,
      parentMasterRecordId: card.master_record_id,
      cardNumber: card.card_number,
    });
    backflushedGood += goodDelta;
  }

  // Persist qty first; decide COMPLETED vs handoff after mint
  const updates = {
    total_good_produced: newGood,
    total_scrap_produced: newScrap,
    backflushed_good_qty: backflushedGood,
    status: 'RUNNING',
    completed_at: null,
  };

  const { data: qtyUpdated, error } = await supabase
    .from('production_cards')
    .update(updates)
    .eq('id', cardId)
    .select('*')
    .single();
  if (error) throw error;

  let mintedLot = null;

  // First machining: mint traveler immediately for newly reported good (lot number + next AF node)
  if (isFirstOp && goodDelta > 0 && card.activity_flow_version_id) {
    mintedLot = await mintLotFromScheduleCard(
      { ...card, ...qtyUpdated, activity_flow_version_id: card.activity_flow_version_id },
      {
        quantity: goodDelta,
        scrapQty: 0,
        sourceNodeId,
        actorEmployeeId: actorEmployeeId || card.assigned_employee_id,
      }
    );
  }

  if (doneForDay && newGood >= goal) {
    // First-op credit on schedule card — do NOT advance schedule card past Op1
    await recordOpCompletion(qtyUpdated, {
      good_qty: newGood,
      scrap_qty: newScrap,
      employee_id: actorEmployeeId || card.assigned_employee_id,
      work_center_id: card.work_center_id,
      activity_flow_node_id: sourceNodeId,
    });

    // Backfill any good that pre-dated auto-mint (or slipped past)
    if (isFirstOp && card.activity_flow_version_id) {
      const { data: existingLots } = await supabase
        .from('production_lots')
        .select('quantity, status')
        .eq('production_card_id', cardId)
        .not('status', 'eq', 'merged');
      const alreadyLotized = (existingLots || []).reduce((s, l) => s + toNumber(l.quantity), 0);
      const toMint = Math.max(0, newGood - alreadyLotized);
      if (toMint > 0) {
        mintedLot = await mintLotFromScheduleCard(
          { ...card, ...qtyUpdated, activity_flow_version_id: card.activity_flow_version_id },
          {
            quantity: toMint,
            scrapQty: 0,
            sourceNodeId,
            actorEmployeeId: actorEmployeeId || card.assigned_employee_id,
          }
        );
      }
    }

    const { data: completed, error: cErr } = await supabase
      .from('production_cards')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        total_good_produced: newGood,
        total_scrap_produced: newScrap,
      })
      .eq('id', cardId)
      .select('*')
      .single();
    if (cErr) throw cErr;

    try {
      const { closeOp1ForScheduleCard, syncOp1Progress } = require('./productionOpCardEngine');
      await syncOp1Progress(completed);
      await closeOp1ForScheduleCard(completed, { good_qty: newGood, scrap_qty: newScrap });
    } catch (e) {
      console.error('Op1 close after complete:', e.message);
    }

    const [enriched] = await enrichCards([completed]);
    const lotPayload = formatMintedLotPayload(mintedLot);
    return {
      ...enriched,
      advance: {
        advanced: false,
        lot_minted: !!lotPayload,
        lot: lotPayload,
        from_work_center_id: card.work_center_id,
        from_employee_id: actorEmployeeId || card.assigned_employee_id,
      },
      lot: lotPayload,
    };
  }

  try {
    const { syncOp1Progress } = require('./productionOpCardEngine');
    await syncOp1Progress(qtyUpdated);
  } catch (e) {
    console.error('syncOp1Progress:', e.message);
  }

  const [enriched] = await enrichCards([qtyUpdated]);
  const lotPayload = formatMintedLotPayload(mintedLot);
  return {
    ...enriched,
    advance: lotPayload
      ? {
          advanced: false,
          lot_minted: true,
          lot: lotPayload,
          from_work_center_id: card.work_center_id,
          from_employee_id: actorEmployeeId || card.assigned_employee_id,
        }
      : null,
    lot: lotPayload,
  };
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
    .eq('flow_version_id', card.activity_flow_version_id)
    .maybeSingle();
  if (nErr) throw nErr;
  if (!node) throw httpError('Activity flow node not found on this card’s routing', 404);
  if (node.activity_type !== 'machining') {
    throw httpError('Only machining nodes create lots');
  }

  const { data: existingLots } = await supabase
    .from('production_lots')
    .select('quantity, status')
    .eq('production_card_id', cardId)
    .not('status', 'eq', 'merged');
  const alreadyLotized = (existingLots || []).reduce((s, l) => s + toNumber(l.quantity), 0);

  // Card good may already include auto-minted progress; only add unreported qty
  const priorGood = toNumber(card.total_good_produced);
  const newGood = Math.max(priorGood, alreadyLotized + qty);
  const mintQty = Math.max(0, newGood - alreadyLotized);
  if (!(mintQty > 0)) {
    throw httpError('This good quantity is already covered by existing lots', 409);
  }

  const scrapForOp = toNumber(card.total_scrap_produced);

  const { recordOpCompletion } = require('./productionAssignEngine');
  const { mintLotFromScheduleCard } = require('./lotTravelerEngine');

  await recordOpCompletion(card, {
    good_qty: mintQty,
    scrap_qty: 0,
    employee_id: actorEmployeeId || card.assigned_employee_id,
    work_center_id: card.work_center_id,
    activity_flow_node_id: nodeId,
  });

  const goal = dayGoal(card);
  const cardComplete = newGood >= goal;
  const { data: qtyUpdated, error: qErr } = await supabase
    .from('production_cards')
    .update({
      total_good_produced: newGood,
      total_scrap_produced: scrapForOp,
      ...(cardComplete
        ? { status: 'COMPLETED', completed_at: new Date().toISOString() }
        : { status: 'RUNNING', completed_at: null }),
    })
    .eq('id', cardId)
    .select('*')
    .single();
  if (qErr) throw qErr;

  const minted = await mintLotFromScheduleCard(
    { ...card, activity_flow_version_id: card.activity_flow_version_id },
    {
      quantity: mintQty,
      scrapQty: 0,
      sourceNodeId: nodeId,
      actorEmployeeId: actorEmployeeId || card.assigned_employee_id,
    }
  );

  return {
    lot: {
      ...minted.lot,
      quantity: toNumber(minted.lot.quantity),
      node_label: node.label,
      current_node_label: minted.next_node?.label || null,
    },
    card: (await enrichCards([qtyUpdated]))[0],
    advance: {
      advanced: false,
      lot_minted: true,
      from_work_center_id: card.work_center_id,
      from_employee_id: actorEmployeeId || card.assigned_employee_id,
      ready_for_dispatch: minted.ready_for_dispatch,
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
    .select(
      'id, label, activity_type, sequence, supplier_id, lead_time_days, work_center_id, position_x, position_y'
    )
    .eq('flow_version_id', card.activity_flow_version_id)
    .order('sequence', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function listCardOpCompletions(cardId) {
  if (!isValidUUID(cardId)) throw httpError('Invalid card id');
  const { data, error } = await supabase
    .from('production_card_op_completions')
    .select('*')
    .eq('production_card_id', cardId)
    .order('completed_at', { ascending: true });
  if (error) throw error;

  const rows = data || [];
  const empIds = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))];
  const wcIds = [...new Set(rows.map((r) => r.work_center_id).filter(Boolean))];

  const [{ data: employees }, { data: workCenters }] = await Promise.all([
    empIds.length
      ? supabase.from('employees').select('id, full_name, employee_code').in('id', empIds)
      : Promise.resolve({ data: [] }),
    wcIds.length
      ? supabase.from('work_centers').select('id, code, name').in('id', wcIds)
      : Promise.resolve({ data: [] }),
  ]);

  const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
  const wcById = Object.fromEntries((workCenters || []).map((w) => [w.id, w]));

  return rows.map((r) => {
    const emp = r.employee_id ? empById[r.employee_id] : null;
    const wc = r.work_center_id ? wcById[r.work_center_id] : null;
    return {
      ...r,
      good_qty: toNumber(r.good_qty),
      scrap_qty: toNumber(r.scrap_qty),
      operator_name: emp?.full_name || null,
      operator_code: emp?.employee_code || null,
      work_center_code: wc?.code || null,
      work_center_name: wc?.name || null,
    };
  });
}

async function getCardTrackingDetail(cardId) {
  const { SCHEDULABLE_TYPES, TERMINAL_DISPATCH_TYPES } = require('../config/activityFlowTypes');
  const { getVersionById } = require('./activityFlowEngine');

  const card = await getCardById(cardId);
  let [lots, nodes, shipments, completions] = await Promise.all([
    listCardLots(cardId),
    listCardFlowNodes(cardId),
    listCardShipments(cardId),
    listCardOpCompletions(cardId),
  ]);

  const { healFalseReadyForDispatch } = require('./lotTravelerEngine');
  lots = await Promise.all(
    (lots || []).map(async (l) => {
      if (l.status !== 'ready_for_dispatch') return l;
      const healed = await healFalseReadyForDispatch(l);
      return { ...l, ...healed, quantity: toNumber(healed.quantity ?? l.quantity) };
    })
  );

  let flow = { nodes: [], edges: [] };
  if (card.activity_flow_version_id && card.master_record_id) {
    const version = await getVersionById(card.activity_flow_version_id, card.master_record_id);
    if (version) {
      flow = { nodes: version.nodes || [], edges: version.edges || [] };
    }
  }

  const goal = dayGoal(card);
  const rawFlowNodes = flow.nodes.length ? flow.nodes : nodes;
  // Order by primary default-edge path (same as traveler routing) — not bare sequence,
  // which can put Dispatch before a machining node added later mid-flow.
  const { walkPrimaryPath } = require('./activityFlowRoute');
  const pathOrdered = walkPrimaryPath(rawFlowNodes, flow.edges || []);
  const onPathIds = new Set(pathOrdered.map((n) => n.id));
  const offPath = rawFlowNodes.filter((n) => !onPathIds.has(n.id));
  const flowNodes = pathOrdered.length ? [...pathOrdered, ...offPath] : rawFlowNodes;
  const pathIndexById = Object.fromEntries(flowNodes.map((n, i) => [n.id, i]));
  const nodeById = Object.fromEntries(flowNodes.map((n) => [n.id, n]));

  // Merge schedule-card + lot op completions (lot traveler is source of truth mid/late route)
  const lotIds = (lots || []).map((l) => l.id).filter(Boolean);
  let lotCompletions = [];
  if (lotIds.length) {
    const { data: locRows, error: locErr } = await supabase
      .from('production_lot_op_completions')
      .select('*')
      .in('production_lot_id', lotIds)
      .order('completed_at', { ascending: true });
    if (locErr) throw locErr;
    lotCompletions = locRows || [];
  }

  const completionByNode = {};
  function ingestCompletion(c, source) {
    if (!c?.activity_flow_node_id) return;
    const prev = completionByNode[c.activity_flow_node_id];
    if (!prev || String(c.completed_at) > String(prev.completed_at)) {
      completionByNode[c.activity_flow_node_id] = { ...c, _source: source };
    }
  }
  for (const c of completions || []) ingestCompletion(c, 'card');
  for (const c of lotCompletions) ingestCompletion(c, 'lot');

  // Enrich merged completions with operator / WC names when missing (lot comps are raw)
  const enrichIds = Object.values(completionByNode);
  const needEmp = enrichIds.filter((c) => c.employee_id && !c.operator_name).map((c) => c.employee_id);
  const needWc = enrichIds.filter((c) => c.work_center_id && !c.work_center_code).map((c) => c.work_center_id);
  if (needEmp.length || needWc.length) {
    const [{ data: employees }, { data: workCenters }] = await Promise.all([
      needEmp.length
        ? supabase
            .from('employees')
            .select('id, full_name, employee_code')
            .in('id', [...new Set(needEmp)])
        : Promise.resolve({ data: [] }),
      needWc.length
        ? supabase
            .from('work_centers')
            .select('id, code, name')
            .in('id', [...new Set(needWc)])
        : Promise.resolve({ data: [] }),
    ]);
    const empById = Object.fromEntries((employees || []).map((e) => [e.id, e]));
    const wcById = Object.fromEntries((workCenters || []).map((w) => [w.id, w]));
    for (const c of enrichIds) {
      if (c.employee_id && !c.operator_name) {
        const emp = empById[c.employee_id];
        c.operator_name = emp?.full_name || null;
        c.operator_code = emp?.employee_code || null;
      }
      if (c.work_center_id && !c.work_center_code) {
        const wc = wcById[c.work_center_id];
        c.work_center_code = wc?.code || null;
        c.work_center_name = wc?.name || null;
      }
    }
  }

  const activeLots = (lots || []).filter((l) =>
    ['in_process', 'received', 'at_supplier', 'ready_for_dispatch', 'quarantine'].includes(
      String(l.status || '')
    )
  );
  const hasOpenLots = activeLots.length > 0;

  // Pointer: when open lots exist, use furthest lot current ONLY (ignore schedule Op1 seed)
  let pointerId = null;
  let pointerSeq = null;
  let pointerLot = null;
  let atDispatchNode = false;

  if (hasOpenLots) {
    for (const lot of activeLots) {
      const lid = lot.current_activity_flow_node_id || null;
      if (!lid) continue;
      const n = nodeById[lid];
      const pathIdx = pathIndexById[lid];
      const seq = pathIdx != null ? pathIdx : n != null ? Number(n.sequence) || 0 : -1;
      if (pointerSeq == null || seq > pointerSeq) {
        pointerSeq = seq;
        pointerId = lid;
        pointerLot = lot;
      }
      if (n && TERMINAL_DISPATCH_TYPES.has(n.activity_type)) {
        atDispatchNode = true;
      }
    }
  } else {
    pointerId = card.current_activity_flow_node_id || null;
    pointerSeq =
      pointerId && pathIndexById[pointerId] != null
        ? pathIndexById[pointerId]
        : pointerId && nodeById[pointerId]
          ? Number(nodeById[pointerId].sequence) || 0
          : null;
  }

  const anyFullyDispatched =
    (lots || []).length > 0 &&
    (lots || []).every((l) => ['dispatched', 'merged', 'consumed'].includes(String(l.status)));

  let opCards = [];
  try {
    const { listOpCardsForParent } = require('./productionOpCardEngine');
    opCards = await listOpCardsForParent(cardId);
  } catch (e) {
    // migration may not be applied yet
    opCards = [];
  }

  const tracking = flowNodes.map((n) => {
    const schedulable = SCHEDULABLE_TYPES.has(n.activity_type);
    const isDispatch = TERMINAL_DISPATCH_TYPES.has(n.activity_type);
    const completion = completionByNode[n.id] || null;
    const seq = pathIndexById[n.id] != null ? pathIndexById[n.id] : Number(n.sequence) || 0;

    let status = 'pending';
    let phase = null;

    if (!schedulable || isDispatch) {
      status = 'info';
      const pastByPointer = pointerSeq != null && seq < pointerSeq;
      const dispatchPassed =
        isDispatch &&
        (atDispatchNode ||
          anyFullyDispatched ||
          (pointerLot &&
            pointerLot.status === 'ready_for_dispatch' &&
            pointerId === n.id) ||
          (pointerLot && pointerLot.status === 'dispatched'));
      if (completion || pastByPointer || dispatchPassed) {
        phase = 'passed';
      } else {
        phase = 'ahead';
      }
    } else if (completion) {
      status = 'done';
    } else if (pointerId && n.id === pointerId) {
      status = 'running';
    } else if (
      !hasOpenLots &&
      card.current_activity_flow_node_id &&
      n.id === card.current_activity_flow_node_id &&
      card.status !== 'COMPLETED'
    ) {
      status = 'running';
    } else {
      status = 'pending';
    }

    const isRunning = status === 'running';
    const goodQty = completion
      ? toNumber(completion.good_qty)
      : isRunning && !hasOpenLots
        ? toNumber(card.total_good_produced)
        : isRunning && pointerLot
          ? toNumber(pointerLot.quantity)
          : 0;
    const scrapQty = completion
      ? toNumber(completion.scrap_qty)
      : isRunning && !hasOpenLots
        ? toNumber(card.total_scrap_produced)
        : isRunning && pointerLot
          ? toNumber(pointerLot.scrap_qty)
          : 0;
    const efficiencyPct =
      goal > 0 && goodQty > 0
        ? Math.round((goodQty / goal) * 100)
        : status === 'done' && goal > 0
          ? Math.round((goodQty / goal) * 100)
          : null;

    const operatorId =
      completion?.employee_id ||
      (isRunning
        ? pointerLot?.assigned_employee_id || (!hasOpenLots ? card.assigned_employee_id : null)
        : null);
    const operatorName =
      completion?.operator_name ||
      (isRunning
        ? pointerLot?.assigned_employee_name || (!hasOpenLots ? card.assigned_employee_name : null)
        : null);
    const operatorCode =
      completion?.operator_code ||
      (isRunning
        ? pointerLot?.assigned_employee_code || (!hasOpenLots ? card.assigned_employee_code : null)
        : null);

    return {
      node_id: n.id,
      status,
      phase,
      schedulable,
      activity_type: n.activity_type,
      label: n.label,
      sequence: seq,
      work_center_id:
        n.work_center_id ||
        (isRunning
          ? pointerLot?.work_center_id || (!hasOpenLots ? card.work_center_id : null)
          : null) ||
        completion?.work_center_id ||
        null,
      work_center_code:
        n.work_center_code ||
        (isRunning
          ? pointerLot?.work_center_code || (!hasOpenLots ? card.work_center_code : null)
          : null) ||
        completion?.work_center_code ||
        null,
      work_center_name:
        n.work_center_name ||
        (isRunning
          ? pointerLot?.work_center_name || (!hasOpenLots ? card.work_center_name : null)
          : null) ||
        completion?.work_center_name ||
        null,
      operator_id: operatorId,
      operator_name: operatorName,
      operator_code: operatorCode,
      good_qty: goodQty,
      scrap_qty: scrapQty,
      efficiency_pct: efficiencyPct,
      completed_at: completion?.completed_at || null,
    };
  });

  const pointerNode = pointerId ? nodeById[pointerId] : null;
  const trackingPointer = pointerId
    ? {
        node_id: pointerId,
        label: pointerNode?.label || null,
        activity_type: pointerNode?.activity_type || null,
        sequence: pointerSeq,
        lot_id: pointerLot?.id || null,
        lot_number: pointerLot?.lot_number || null,
        lot_status: pointerLot?.status || null,
      }
    : null;

  return {
    card,
    lots,
    op_cards: opCards,
    nodes,
    shipments,
    flow,
    tracking,
    tracking_pointer: trackingPointer,
    completions,
    lot_completions: lotCompletions,
  };
}

async function sendOutsource(payload, actorEmployeeId, opts = {}) {
  const cardId = payload.production_card_id;
  const nodeId = payload.activity_flow_node_id;
  const lotIds = Array.isArray(payload.lot_ids) ? payload.lot_ids : [];
  const merge = !!payload.merge;

  const card = await getCardById(cardId);
  if (!isValidUUID(nodeId)) throw httpError('activity_flow_node_id is required');
  if (!lotIds.length) throw httpError('lot_ids are required');

  const { data: node, error: nErr } = await supabase
    .from('activity_flow_nodes')
    .select('*')
    .eq('id', nodeId)
    .eq('flow_version_id', card.activity_flow_version_id)
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

  const canAct =
    opts.isManager ||
    card.assigned_employee_id === actorEmployeeId ||
    lots.some((l) => l.assigned_employee_id === actorEmployeeId);
  if (!canAct) throw httpError('Only the assigned employee can send outsource', 403);

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
        current_activity_flow_node_id: nodeId,
        work_center_id: node.work_center_id || null,
        quantity: sumQty,
        status: 'in_process',
        assignment_status: 'unassigned',
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
      .update({
        status: 'at_supplier',
        current_activity_flow_node_id: nodeId,
        assigned_employee_id: null,
        assignment_status: 'unassigned',
      })
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
    throw httpError('Only the assigned employee or a manager can receive this shipment', 403);
  }

  const { data: links, error: lErr } = await supabase
    .from('outsource_shipment_lots')
    .select('lot_id')
    .eq('shipment_id', shipmentId);
  if (lErr) throw lErr;

  const { advanceLotAfterOp } = require('./lotTravelerEngine');
  const advancedLots = [];

  for (const link of links || []) {
    const { error: lotUp } = await supabase
      .from('production_lots')
      .update({ status: 'received' })
      .eq('id', link.lot_id);
    if (lotUp) throw lotUp;

    const result = await advanceLotAfterOp(link.lot_id, shipment.activity_flow_node_id, {
      employee_id: actorEmployeeId,
      work_center_id: null,
    });
    advancedLots.push(result);
  }

  const { data: updated, error: upErr } = await supabase
    .from('outsource_shipments')
    .update({ status: 'received', received_at: new Date().toISOString() })
    .eq('id', shipmentId)
    .select('*')
    .single();
  if (upErr) throw upErr;

  return { shipment: updated, lots: advancedLots };
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
  getCardTrackingDetail,
  rolloverOverdue,
  startCard,
  reportProgress,
  completeMachiningOp,
  listCardLots,
  listCardFlowNodes,
  listCardOpCompletions,
  sendOutsource,
  receiveOutsource,
  listCardShipments,
  listWorkingDays,
  equalSplit,
  enrichCards,
};
