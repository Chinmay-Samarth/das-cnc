/**
 * Admin factory dashboard — one payload for the home command center.
 */

const { createClient } = require('@supabase/supabase-js');
const { isAdminJob } = require('../utils/accessLevel');
const { listCards } = require('./productionCardEngine');
const { listSchedules } = require('./blanketPosEngine');
const { listReadyForDispatch } = require('./lotTravelerEngine');
const { listShortfallRequests } = require('./dispatchShortfallEngine');
const { listGirnsForApproval } = require('./girnApprovalEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = process.env.TIMEZONE || 'Asia/Kolkata';
const TOP_N = 6;

function todayDateString(tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd)
    .split('-')
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function ymdFromIso(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function slimPerson(row) {
  return {
    id: row.id,
    full_name: row.full_name,
    employee_code: row.employee_code,
    department: row.department || null,
    status: row.status,
  };
}

function slimCard(card) {
  return {
    id: card.id,
    card_number: card.card_number,
    status: card.status,
    work_date: card.work_date,
    component_label: card.component_label || null,
    work_center_id: card.work_center_id || null,
    work_center_name: card.work_center_name || card.work_center_code || null,
    assigned_employee_name: card.assigned_employee_name || null,
    target_quantity: toNumber(card.target_quantity),
    total_good_produced: toNumber(card.total_good_produced),
    remaining_qty: toNumber(card.remaining_qty),
  };
}

async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Factory dashboard ${label} failed:`, err.message || err);
    return fallback;
  }
}

async function loadAttendance(date) {
  const { data, error } = await supabase
    .from('employees')
    .select(
      `
      id,
      employee_code,
      full_name,
      job_description,
      department:departments(name),
      attendance_records!attendance_records_employee_id_fkey (
        shift_date,
        status
      )
    `
    )
    .eq('is_active', true);
  if (error) throw error;

  const workforce = (data || []).filter((emp) => !isAdminJob(emp.job_description));
  const records = workforce.map((emp) => {
    const attendance = (emp.attendance_records || []).find((r) => r.shift_date === date);
    return {
      id: emp.id,
      employee_code: emp.employee_code,
      full_name: emp.full_name,
      department: emp.department?.name || null,
      status: attendance?.status || 'ABSENT',
    };
  });

  const summary = {
    total: records.length,
    present: records.filter((r) => ['PRESENT', 'COMPLETED', 'LATE'].includes(r.status)).length,
    absent: records.filter((r) => r.status === 'ABSENT').length,
    late: records.filter((r) => r.status === 'LATE').length,
    on_leave: records.filter((r) => r.status === 'LEAVE').length,
  };

  return {
    summary,
    on_duty: summary.present,
    absentees: records.filter((r) => r.status === 'ABSENT').slice(0, TOP_N).map(slimPerson),
    on_leave: records.filter((r) => r.status === 'LEAVE').slice(0, TOP_N).map(slimPerson),
  };
}

async function loadProduction(date) {
  const cards = await listCards({ from: date, to: date });
  const running = cards.filter((c) => c.status === 'RUNNING').map(slimCard);
  const scheduled = cards.filter((c) => c.status === 'READY').map(slimCard);
  const overdue = cards.filter((c) => c.status === 'OVERDUE');
  return {
    running: running.slice(0, TOP_N),
    scheduled: scheduled.slice(0, TOP_N),
    counts: {
      running: running.length,
      scheduled: scheduled.length,
      overdue: overdue.length,
    },
    all_today: cards.map(slimCard),
  };
}

async function loadDeliverySchedules(date) {
  const to = addDaysYmd(date, 13);
  const rows = await listSchedules({ from: date, to });
  const upcoming = rows.filter((r) => ['planned', 'released'].includes(r.status));
  const slim = upcoming.map((r) => ({
    id: r.id,
    schedule_number: r.schedule_number,
    due_date: r.due_date,
    quantity: toNumber(r.quantity),
    status: r.status,
    component_label: r.component_label || null,
    customer_name: r.customer_name || null,
    blanket_po_id: r.blanket_po_id || null,
    blanket_number: r.blanket_number || null,
  }));

  const week = [];
  for (let i = 0; i < 7; i += 1) {
    const ymd = addDaysYmd(date, i);
    const dayRows = slim.filter((r) => String(r.due_date || '').slice(0, 10) === ymd);
    week.push({
      date: ymd,
      qty: dayRows.reduce((sum, r) => sum + toNumber(r.quantity), 0),
      count: dayRows.length,
    });
  }

  const delivery_series = [];
  for (let i = 0; i < 14; i += 1) {
    const ymd = addDaysYmd(date, i);
    const dayRows = slim.filter((r) => String(r.due_date || '').slice(0, 10) === ymd);
    delivery_series.push({
      date: ymd,
      qty: dayRows.reduce((sum, r) => sum + toNumber(r.quantity), 0),
      count: dayRows.length,
    });
  }

  return {
    upcoming: slim,
    week,
    delivery_series,
    count_7d: week.reduce((sum, d) => sum + d.count, 0),
    qty_7d: week.reduce((sum, d) => sum + d.qty, 0),
  };
}

function startOfIsoWeekYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 Sun … 6 Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + mondayOffset);
  return dt.toISOString().slice(0, 10);
}

function emptyDaySeries(fromYmd, toYmd, extra = {}) {
  const out = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push({ date: cur, ...extra });
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

async function loadAnalytics(day) {
  const from30 = addDaysYmd(day, -29);
  const from14 = addDaysYmd(day, -13);
  const from56 = addDaysYmd(day, -55);
  const monthStart = `${String(day).slice(0, 7)}-01`;

  const [
    invoicesRes,
    posRes,
    girnsRes,
    cardsRes,
    openPosRes,
    overdueSchedRes,
    otRes,
  ] = await Promise.all([
    supabase
      .from('sales_invoices')
      .select('id, status, total_amount, issued_at, created_at, paid_at')
      .in('status', ['due', 'paid'])
      .gte('created_at', `${from30}T00:00:00.000Z`),
    supabase
      .from('purchase_orders')
      .select('id, status, total_amount, created_at, sent_at')
      .neq('status', 'cancelled')
      .gte('created_at', `${from56}T00:00:00.000Z`),
    supabase
      .from('girns')
      .select('id, status, grand_total, received_date, created_at')
      .gte('received_date', from56),
    supabase
      .from('production_cards')
      .select('id, work_date, total_good_produced, total_scrap_produced, work_center_id')
      .gte('work_date', from14)
      .lte('work_date', day),
    supabase
      .from('purchase_orders')
      .select('id, total_amount, status')
      .in('status', ['draft', 'due', 'delivered']),
    listSchedules({ from: addDaysYmd(day, -30), to: addDaysYmd(day, -1) }).catch(() => []),
    supabase
      .from('attendance_records')
      .select('shift_date, overtime_minutes, minutes_worked')
      .gte('shift_date', monthStart)
      .lte('shift_date', day),
  ]);

  if (invoicesRes.error) throw invoicesRes.error;
  if (posRes.error) throw posRes.error;
  if (girnsRes.error) throw girnsRes.error;
  if (cardsRes.error) throw cardsRes.error;
  if (openPosRes.error) throw openPosRes.error;
  if (otRes.error) throw otRes.error;

  // Revenue series (30d) — billed by issue/create day; paid by paid_at day
  const revenueMap = new Map(
    emptyDaySeries(from30, day, { billed: 0, paid: 0 }).map((r) => [r.date, r])
  );
  for (const inv of invoicesRes.data || []) {
    const billedYmd =
      ymdFromIso(inv.issued_at) || ymdFromIso(inv.created_at) || String(inv.created_at || '').slice(0, 10);
    const amt = toNumber(inv.total_amount);
    if (billedYmd && revenueMap.has(billedYmd)) {
      revenueMap.get(billedYmd).billed += amt;
    }
    if (inv.status === 'paid') {
      const paidYmd = ymdFromIso(inv.paid_at) || billedYmd;
      if (paidYmd && revenueMap.has(paidYmd)) {
        revenueMap.get(paidYmd).paid += amt;
      }
    }
  }
  const revenue_series = [...revenueMap.values()].map((r) => ({
    date: r.date,
    billed: Math.round(r.billed * 100) / 100,
    paid: Math.round(r.paid * 100) / 100,
  }));

  // Procurement by ISO week (last 8 weeks)
  const weekStarts = [];
  let wk = startOfIsoWeekYmd(from56);
  const lastWeek = startOfIsoWeekYmd(day);
  while (wk <= lastWeek) {
    weekStarts.push(wk);
    wk = addDaysYmd(wk, 7);
  }
  const procMap = new Map(
    weekStarts.map((w) => [w, { week: w, po_opened: 0, girn_received: 0 }])
  );
  for (const po of posRes.data || []) {
    const ymd = ymdFromIso(po.sent_at) || ymdFromIso(po.created_at);
    if (!ymd) continue;
    const bucket = startOfIsoWeekYmd(ymd);
    if (procMap.has(bucket)) {
      procMap.get(bucket).po_opened += toNumber(po.total_amount);
    }
  }
  for (const g of girnsRes.data || []) {
    const ymd = String(g.received_date || '').slice(0, 10) || ymdFromIso(g.created_at);
    if (!ymd) continue;
    const bucket = startOfIsoWeekYmd(ymd);
    if (procMap.has(bucket)) {
      procMap.get(bucket).girn_received += toNumber(g.grand_total);
    }
  }
  const procurement_series = [...procMap.values()]
    .slice(-8)
    .map((r) => ({
      week: r.week,
      po_opened: Math.round(r.po_opened * 100) / 100,
      girn_received: Math.round(r.girn_received * 100) / 100,
    }));

  // Yield series (14d)
  const yieldMap = new Map(
    emptyDaySeries(from14, day, { good: 0, scrap: 0 }).map((r) => [r.date, r])
  );
  for (const card of cardsRes.data || []) {
    const ymd = String(card.work_date || '').slice(0, 10);
    if (!ymd || !yieldMap.has(ymd)) continue;
    yieldMap.get(ymd).good += toNumber(card.total_good_produced);
    yieldMap.get(ymd).scrap += toNumber(card.total_scrap_produced);
  }
  const yield_series = [...yieldMap.values()].map((r) => ({
    date: r.date,
    good: Math.round(r.good * 1000) / 1000,
    scrap: Math.round(r.scrap * 1000) / 1000,
  }));

  const goodTotal = yield_series.reduce((s, r) => s + r.good, 0);
  const scrapTotal = yield_series.reduce((s, r) => s + r.scrap, 0);
  const produced = goodTotal + scrapTotal;
  const scrap_rate_pct = produced > 0 ? Math.round((scrapTotal / produced) * 1000) / 10 : 0;

  const revenue_mtd = revenue_series
    .filter((r) => r.date >= monthStart)
    .reduce((s, r) => s + r.billed, 0);
  const revenue_7d = revenue_series.slice(-7).map((r) => ({ date: r.date, value: r.billed }));

  const open_po_exposure = (openPosRes.data || []).reduce(
    (s, r) => s + toNumber(r.total_amount),
    0
  );

  const overdueRows = (overdueSchedRes || []).filter(
    (r) =>
      ['planned', 'released'].includes(r.status) &&
      String(r.due_date || '').slice(0, 10) < day
  );
  const overdue_qty = overdueRows.reduce((s, r) => s + toNumber(r.quantity), 0);

  const otByDay = new Map(
    emptyDaySeries(monthStart, day, { ot_minutes: 0 }).map((r) => [r.date, r])
  );
  for (const row of otRes.data || []) {
    const ymd = String(row.shift_date || '').slice(0, 10);
    if (!ymd || !otByDay.has(ymd)) continue;
    otByDay.get(ymd).ot_minutes += toNumber(row.overtime_minutes);
  }
  const ot_series = [...otByDay.values()];
  const ot_minutes_mtd = ot_series.reduce((s, r) => s + r.ot_minutes, 0);

  const scrap_spark = yield_series.slice(-7).map((r) => {
    const t = r.good + r.scrap;
    return { date: r.date, value: t > 0 ? Math.round((r.scrap / t) * 1000) / 10 : 0 };
  });

  return {
    revenue_series,
    procurement_series,
    yield_series,
    delivery_series: null, // filled by caller from schedules
    kpis: {
      revenue_mtd: Math.round(revenue_mtd * 100) / 100,
      revenue_7d,
      scrap_rate_pct,
      scrap_spark,
      overdue_qty: Math.round(overdue_qty * 1000) / 1000,
      open_po_exposure: Math.round(open_po_exposure * 100) / 100,
      ot_minutes_mtd: Math.round(ot_minutes_mtd),
      ot_series,
    },
  };
}

async function loadCampaigns() {
  const { data, error } = await supabase
    .from('production_campaigns')
    .select(
      `
      id, status, master_record_id, target_quantity, good_quantity,
      work_center_id, demand_rank, queue_sequence, run_out_days,
      wc:work_centers!production_campaigns_work_center_id_fkey(id, code, name)
    `
    )
    .eq('status', 'active')
    .order('queue_sequence', { ascending: true })
    .limit(20);
  if (error) throw error;

  const recordIds = [...new Set((data || []).map((c) => c.master_record_id).filter(Boolean))];
  let labelById = {};
  if (recordIds.length) {
    const { data: lookups } = await supabase
      .from('v_master_lookup')
      .select('record_id, label')
      .in('record_id', recordIds);
    labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));
  }

  const items = (data || []).map((c) => {
    const target = toNumber(c.target_quantity);
    const good = toNumber(c.good_quantity);
    return {
      id: c.id,
      status: c.status,
      work_center_id: c.work_center_id,
      work_center_code: c.wc?.code || null,
      work_center_name: c.wc?.name || c.wc?.code || null,
      component_label: labelById[c.master_record_id] || null,
      target_quantity: target,
      good_quantity: good,
      remaining_qty: Math.max(0, target - good),
      progress_pct: target > 0 ? Math.round((good / target) * 100) : 0,
      run_out_days: c.run_out_days != null ? toNumber(c.run_out_days) : null,
    };
  });

  return { active: items, count: items.length };
}

async function loadOutsource(date) {
  const { data: shipments, error } = await supabase
    .from('outsource_shipments')
    .select(
      `
      id, status, sent_at, activity_flow_node_id, shipment_number, supplier_id, production_card_id,
      node:activity_flow_nodes!outsource_shipments_activity_flow_node_id_fkey(
        id, label, lead_time_days
      )
    `
    )
    .eq('status', 'sent')
    .not('sent_at', 'is', null);
  if (error) throw error;

  const supplierIds = [...new Set((shipments || []).map((s) => s.supplier_id).filter(Boolean))];
  const cardIds = [...new Set((shipments || []).map((s) => s.production_card_id).filter(Boolean))];

  const [{ data: suppliers }, { data: cards }] = await Promise.all([
    supplierIds.length
      ? supabase.from('suppliers').select('id, name').in('id', supplierIds)
      : Promise.resolve({ data: [] }),
    cardIds.length
      ? supabase.from('production_cards').select('id, master_record_id').in('id', cardIds)
      : Promise.resolve({ data: [] }),
  ]);

  const supplierNameById = new Map((suppliers || []).map((s) => [s.id, s.name]));
  const cardById = new Map((cards || []).map((c) => [c.id, c]));
  const masterIds = [...new Set((cards || []).map((c) => c.master_record_id).filter(Boolean))];
  const { data: lookups } = masterIds.length
    ? await supabase.from('v_master_lookup').select('record_id, label').in('record_id', masterIds)
    : { data: [] };
  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));

  const dueToday = [];
  const overdue = [];

  for (const ship of shipments || []) {
    const leadDays = toNumber(ship.node?.lead_time_days);
    const sentYmd = ymdFromIso(ship.sent_at);
    if (!sentYmd) continue;
    const expected = leadDays > 0 ? addDaysYmd(sentYmd, leadDays) : null;
    if (!expected) continue;
    const card = cardById.get(ship.production_card_id);
    const row = {
      id: ship.id,
      shipment_number: ship.shipment_number,
      supplier_name: supplierNameById.get(ship.supplier_id) || null,
      component_label: card?.master_record_id ? labelById[card.master_record_id] || null : null,
      node_label: ship.node?.label || null,
      sent_at: ship.sent_at,
      expected_return_ymd: expected,
      overdue: date > expected,
    };
    if (date > expected) overdue.push(row);
    else if (expected === date) dueToday.push(row);
  }

  return {
    due_today: dueToday.slice(0, TOP_N),
    overdue: overdue.slice(0, TOP_N),
    counts: { due_today: dueToday.length, overdue: overdue.length },
  };
}

async function loadDispatch() {
  const lots = await listReadyForDispatch();
  const dispatchable = lots.filter((l) => l.can_dispatch);
  const blocked = lots.filter((l) => !l.can_dispatch);
  return {
    lots: lots.slice(0, TOP_N).map((l) => ({
      id: l.id,
      lot_number: l.lot_number,
      component_label: l.component_label || null,
      quantity: toNumber(l.quantity),
      can_dispatch: !!l.can_dispatch,
      schedule_number: l.schedule_number || null,
      schedule_due_date: l.schedule_due_date || null,
    })),
    counts: {
      total: lots.length,
      dispatchable: dispatchable.length,
      blocked: blocked.length,
    },
  };
}

async function loadNotificationsP1() {
  const filters = (query) =>
    query.eq('audience', 'admin').eq('priority', 1).eq('status', 'unread');

  const [{ count, error: countError }, { data, error }] = await Promise.all([
    filters(supabase.from('notifications').select('id', { count: 'exact', head: true })),
    filters(
      supabase
        .from('notifications')
        .select('id, type, title, body, payload, created_at, priority, category, severity, status')
        .order('created_at', { ascending: false })
        .limit(12)
    ),
  ]);
  if (countError) throw countError;
  if (error) throw error;
  return { count: count || 0, items: data || [] };
}

async function loadInventoryP1() {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, payload, created_at, priority, category, severity, status')
    .eq('audience', 'admin')
    .eq('priority', 1)
    .eq('status', 'unread')
    .in('type', ['insufficient_stock', 'reorder_purchase_required'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const insufficient_stock = rows.filter((r) => r.type === 'insufficient_stock').length;
  const reorder_purchase_required = rows.filter((r) => r.type === 'reorder_purchase_required').length;
  return {
    insufficient_stock,
    reorder_purchase_required,
    count: insufficient_stock + reorder_purchase_required,
    items: rows,
  };
}

async function loadApprovals() {
  const [shortfall, girn] = await Promise.all([
    listShortfallRequests({ status: 'pending' }),
    listGirnsForApproval({ status: 'ready' }),
  ]);
  return {
    dispatch_shortfall_pending: shortfall.length,
    girn_ready: girn.length,
    shortfall: shortfall.slice(0, 4).map((r) => ({
      id: r.id,
      lot_number: r.lot_number,
      component_label: r.component_label,
      lot_qty: r.lot_qty,
      schedule_qty: r.schedule_qty,
      requester_name: r.requester_name,
    })),
    girn: girn.slice(0, 4).map((r) => ({
      id: r.id,
      girn_number: r.girn_number,
      supplier_name: r.supplier_name,
      inspection_passed: r.inspection_passed,
      inspection_total: r.inspection_total,
    })),
  };
}

async function loadHorizonWaves(date) {
  const stuckCutoff = addDaysYmd(date, -1);
  const { data, error } = await supabase
    .from('production_horizon_waves')
    .select(
      `
      id, work_center_id, horizon_index, horizon_start, horizon_end, status,
      wc:work_centers!production_horizon_waves_work_center_id_fkey(id, code, name)
    `
    )
    .in('status', ['locked', 'in_progress'])
    .order('horizon_end', { ascending: true })
    .limit(40);
  if (error) throw error;

  const rows = (data || []).map((w) => {
    const stuck = String(w.horizon_end) < stuckCutoff;
    return {
      id: w.id,
      work_center_id: w.work_center_id,
      work_center_code: w.wc?.code || null,
      work_center_name: w.wc?.name || w.wc?.code || null,
      horizon_index: w.horizon_index,
      horizon_start: w.horizon_start,
      horizon_end: w.horizon_end,
      status: w.status,
      stuck,
    };
  });

  const stuck = rows.filter((w) => w.stuck);
  const inWindow = rows.filter((w) => !w.stuck);
  return {
    stuck: stuck.slice(0, TOP_N),
    in_window: inWindow.slice(0, TOP_N),
    counts: {
      stuck: stuck.length,
      in_progress: rows.filter((w) => w.status === 'in_progress').length,
      locked: rows.filter((w) => w.status === 'locked').length,
    },
  };
}

async function loadWorkCenterHeatmap(todayCards) {
  const { data, error } = await supabase
    .from('work_centers')
    .select('id, code, name')
    .eq('is_active', true)
    .order('code', { ascending: true });
  if (error) throw error;

  const byWc = new Map();
  for (const card of todayCards || []) {
    const id = card.work_center_id;
    if (!id) continue;
    if (!byWc.has(id)) byWc.set(id, { running: 0, scheduled: 0, overdue: 0 });
    const bucket = byWc.get(id);
    if (card.status === 'RUNNING') bucket.running += 1;
    else if (card.status === 'READY') bucket.scheduled += 1;
    else if (card.status === 'OVERDUE') bucket.overdue += 1;
  }

  const items = (data || []).map((wc) => {
    const stats = byWc.get(wc.id) || { running: 0, scheduled: 0, overdue: 0 };
    let status = 'idle';
    if (stats.overdue > 0) status = 'overdue';
    else if (stats.running > 0) status = 'running';
    return {
      id: wc.id,
      code: wc.code,
      name: wc.name,
      status,
      running_cards: stats.running,
      scheduled_cards: stats.scheduled,
      overdue_cards: stats.overdue,
    };
  });

  return {
    items,
    counts: {
      running: items.filter((i) => i.status === 'running').length,
      idle: items.filter((i) => i.status === 'idle').length,
      overdue: items.filter((i) => i.status === 'overdue').length,
    },
  };
}

async function getFactoryDashboard({ date } = {}) {
  const day = date || todayDateString();

  const emptyAttendance = {
    summary: { total: 0, present: 0, absent: 0, late: 0, on_leave: 0 },
    on_duty: 0,
    absentees: [],
    on_leave: [],
  };
  const emptyProduction = {
    running: [],
    scheduled: [],
    counts: { running: 0, scheduled: 0, overdue: 0 },
    all_today: [],
  };

  const [
    attendance,
    production,
    delivery_schedules,
    campaigns,
    outsource,
    dispatch,
    notifications_p1,
    inventory_p1,
    approvals,
    horizon_waves,
    analyticsRaw,
  ] = await Promise.all([
    safe('attendance', () => loadAttendance(day), emptyAttendance),
    safe('production', () => loadProduction(day), emptyProduction),
    safe(
      'schedules',
      () => loadDeliverySchedules(day),
      { upcoming: [], week: [], delivery_series: [], count_7d: 0, qty_7d: 0 }
    ),
    safe('campaigns', () => loadCampaigns(), { active: [], count: 0 }),
    safe('outsource', () => loadOutsource(day), {
      due_today: [],
      overdue: [],
      counts: { due_today: 0, overdue: 0 },
    }),
    safe('dispatch', () => loadDispatch(), {
      lots: [],
      counts: { total: 0, dispatchable: 0, blocked: 0 },
    }),
    safe('p1', () => loadNotificationsP1(), { count: 0, items: [] }),
    safe('inventory_p1', () => loadInventoryP1(), {
      insufficient_stock: 0,
      reorder_purchase_required: 0,
      count: 0,
      items: [],
    }),
    safe('approvals', () => loadApprovals(), {
      dispatch_shortfall_pending: 0,
      girn_ready: 0,
      shortfall: [],
      girn: [],
    }),
    safe('waves', () => loadHorizonWaves(day), {
      stuck: [],
      in_window: [],
      counts: { stuck: 0, in_progress: 0, locked: 0 },
    }),
    safe('analytics', () => loadAnalytics(day), {
      revenue_series: [],
      procurement_series: [],
      yield_series: [],
      delivery_series: null,
      kpis: {
        revenue_mtd: 0,
        revenue_7d: [],
        scrap_rate_pct: 0,
        scrap_spark: [],
        overdue_qty: 0,
        open_po_exposure: 0,
        ot_minutes_mtd: 0,
        ot_series: [],
      },
    }),
  ]);

  const work_centers = await safe(
    'heatmap',
    () => loadWorkCenterHeatmap(production.all_today),
    { items: [], counts: { running: 0, idle: 0, overdue: 0 } }
  );

  const { all_today, ...productionOut } = production;

  const analytics = {
    ...analyticsRaw,
    delivery_series:
      delivery_schedules.delivery_series || analyticsRaw.delivery_series || [],
  };

  return {
    date: day,
    attendance,
    production: productionOut,
    delivery_schedules,
    campaigns,
    outsource,
    dispatch,
    notifications_p1,
    inventory_p1,
    approvals,
    horizon_waves,
    work_centers,
    analytics,
  };
}

module.exports = {
  getFactoryDashboard,
};
