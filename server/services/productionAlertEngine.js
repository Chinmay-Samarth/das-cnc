const { createClient } = require('@supabase/supabase-js');
const { ensureNotification } = require('./notificationStore');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TZ = 'Asia/Kolkata';

function todayDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd)
    .split('-')
    .map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Op1 still open (READY/RUNNING) past delivery schedule due date.
 * Op1 = production_lot_id IS NULL.
 */
async function evaluateOp1ScheduleDelays() {
  const today = todayDateString();

  const { data: opRows, error } = await supabase
    .from('production_op_cards')
    .select(
      `
      id, parent_production_card_id, work_center_id, status,
      parent:production_cards!production_op_cards_parent_production_card_id_fkey(
        id, card_number, status, delivery_schedule_id, campaign_id, master_record_id,
        master:master_records!production_cards_master_record_id_fkey(id, name)
      )
    `
    )
    .is('production_lot_id', null)
    .in('status', ['READY', 'RUNNING']);
  if (error) throw error;

  const openParents = (opRows || []).filter((op) => {
    const p = op.parent;
    if (!p) return false;
    return ['READY', 'RUNNING', 'OVERDUE'].includes(String(p.status || '').toUpperCase());
  });
  if (!openParents.length) return { created: 0, checked: 0 };

  const scheduleIds = [
    ...new Set(openParents.map((op) => op.parent?.delivery_schedule_id).filter(Boolean)),
  ];
  const scheduleDueById = new Map();
  if (scheduleIds.length) {
    const { data: schedules, error: sErr } = await supabase
      .from('delivery_schedules')
      .select('id, due_date')
      .in('id', scheduleIds);
    if (sErr) throw sErr;
    for (const s of schedules || []) {
      if (s.due_date) scheduleDueById.set(s.id, String(s.due_date).slice(0, 10));
    }
  }

  const campaignIds = [
    ...new Set(
      openParents
        .filter((op) => !op.parent?.delivery_schedule_id && op.parent?.campaign_id)
        .map((op) => op.parent.campaign_id)
    ),
  ];
  const campaignEarliestDue = new Map();
  if (campaignIds.length) {
    const { data: cov, error: cErr } = await supabase
      .from('campaign_schedule_coverage')
      .select('campaign_id, schedule_qty, covered_qty, delivery_schedule_id')
      .in('campaign_id', campaignIds);
    if (cErr) throw cErr;
    const covScheduleIds = [...new Set((cov || []).map((r) => r.delivery_schedule_id).filter(Boolean))];
    const dueBySched = new Map();
    if (covScheduleIds.length) {
      const { data: scheds, error: dsErr } = await supabase
        .from('delivery_schedules')
        .select('id, due_date')
        .in('id', covScheduleIds);
      if (dsErr) throw dsErr;
      for (const s of scheds || []) {
        if (s.due_date) dueBySched.set(s.id, String(s.due_date).slice(0, 10));
      }
    }
    for (const row of cov || []) {
      if (toNumber(row.covered_qty) >= toNumber(row.schedule_qty)) continue;
      const due = dueBySched.get(row.delivery_schedule_id);
      if (!due) continue;
      const prev = campaignEarliestDue.get(row.campaign_id);
      if (!prev || due < prev) campaignEarliestDue.set(row.campaign_id, due);
    }
  }

  let created = 0;
  let checked = 0;
  for (const op of openParents) {
    const parent = op.parent;
    let dueDate = null;
    if (parent.delivery_schedule_id) {
      dueDate = scheduleDueById.get(parent.delivery_schedule_id) || null;
    } else if (parent.campaign_id) {
      dueDate = campaignEarliestDue.get(parent.campaign_id) || null;
    }
    if (!dueDate || dueDate >= today) continue;
    checked += 1;

    const cardLabel = parent.card_number || String(parent.id).slice(0, 8);
    const component = parent.master?.name || null;
    const result = await ensureNotification({
      category: 'production',
      type: 'op1_schedule_delay',
      severity: 'warning',
      priority: 2,
      title: 'Op1 past schedule due date',
      body: `Card ${cardLabel}${component ? ` (${component})` : ''} — Op1 still open; due ${dueDate}.`,
      dedupe_key: `prod:op1delay:${parent.id}:${dueDate}`,
      payload: {
        parent_card_id: parent.id,
        op_card_id: op.id,
        card_number: parent.card_number || null,
        component,
        due_date: dueDate,
        work_center_id: op.work_center_id || null,
        status: op.status,
        campaign_id: parent.campaign_id || null,
      },
    });
    if (result.created) created += 1;
  }

  return { created, checked };
}

/**
 * Outsource shipment still "sent" past AF node lead_time_days.
 */
async function evaluateOutsourceLeadDelays() {
  const today = todayDateString();

  const { data: shipments, error } = await supabase
    .from('outsource_shipments')
    .select(
      `
      id, status, sent_at, activity_flow_node_id, shipment_number, supplier_id,
      node:activity_flow_nodes!outsource_shipments_activity_flow_node_id_fkey(
        id, label, lead_time_days
      )
    `
    )
    .eq('status', 'sent')
    .not('sent_at', 'is', null);
  if (error) throw error;

  const supplierIds = [...new Set((shipments || []).map((s) => s.supplier_id).filter(Boolean))];
  const supplierNameById = new Map();
  if (supplierIds.length) {
    const { data: suppliers, error: supErr } = await supabase
      .from('suppliers')
      .select('id, name')
      .in('id', supplierIds);
    if (supErr) throw supErr;
    for (const s of suppliers || []) supplierNameById.set(s.id, s.name);
  }

  let created = 0;
  let checked = 0;
  for (const ship of shipments || []) {
    const leadDays = toNumber(ship.node?.lead_time_days);
    if (!(leadDays > 0)) continue;
    const sentYmd = ymdFromIso(ship.sent_at);
    if (!sentYmd) continue;
    const expectedReturn = addDaysYmd(sentYmd, leadDays);
    if (today <= expectedReturn) continue;
    checked += 1;

    const vendor = supplierNameById.get(ship.supplier_id) || 'Vendor';
    const nodeName = ship.node?.label || 'Outsource';
    const shipLabel = ship.shipment_number || String(ship.id).slice(0, 8);
    const result = await ensureNotification({
      category: 'production',
      type: 'outsource_lead_delay',
      severity: 'warning',
      priority: 2,
      title: 'Outsource return overdue',
      body: `${shipLabel}: ${vendor} / ${nodeName} expected return ${expectedReturn}; still sent (no GIRN/inward).`,
      dedupe_key: `prod:os_delay:${ship.id}:${expectedReturn}`,
      payload: {
        shipment_id: ship.id,
        shipment_number: ship.shipment_number || null,
        activity_flow_node_id: ship.activity_flow_node_id,
        supplier_id: ship.supplier_id || null,
        vendor_name: supplierNameById.get(ship.supplier_id) || null,
        sent_at: ship.sent_at,
        lead_time_days: leadDays,
        expected_return_ymd: expectedReturn,
        node_name: ship.node?.label || null,
      },
    });
    if (result.created) created += 1;
  }

  return { created, checked };
}

/**
 * GIRN stuck in pending_inspection longer than 1 day.
 */
async function evaluateGirnPendingInspection() {
  const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('girns')
    .select(
      `
      id, girn_number, status, created_at, supplier_id,
      supplier:suppliers!girns_supplier_id_fkey(id, name)
    `
    )
    .eq('status', 'pending_inspection')
    .lt('created_at', cutoffIso);
  if (error) throw error;

  let created = 0;
  for (const girn of rows || []) {
    const label = girn.girn_number || String(girn.id).slice(0, 8);
    const ageDays = Math.floor(
      (Date.now() - new Date(girn.created_at).getTime()) / (24 * 60 * 60 * 1000)
    );
    const supplierName = girn.supplier?.name || null;
    const result = await ensureNotification({
      category: 'inventory',
      type: 'girn_pending_inspection',
      severity: 'warning',
      priority: 2,
      title: 'GIRN pending inspection',
      body: `${label}${supplierName ? ` (${supplierName})` : ''} awaiting inspection for ${ageDays}+ day(s).`,
      dedupe_key: `inv:girn_pending:${girn.id}`,
      payload: {
        girn_id: girn.id,
        girn_number: girn.girn_number || null,
        created_at: girn.created_at,
        supplier_id: girn.supplier_id || null,
        vendor_name: supplierName,
        age_days: ageDays,
      },
    });
    if (result.created) created += 1;
  }

  return { created, checked: (rows || []).length };
}

/**
 * Wave locked/in_progress past horizon_end for more than 1 calendar day.
 */
async function evaluateStuckHorizonWaves() {
  const today = todayDateString();
  const stuckCutoff = addDaysYmd(today, -1);

  const { data: waves, error } = await supabase
    .from('production_horizon_waves')
    .select(
      `
      id, work_center_id, horizon_index, horizon_start, horizon_end, status,
      wc:work_centers!production_horizon_waves_work_center_id_fkey(id, code, name)
    `
    )
    .in('status', ['locked', 'in_progress'])
    .lt('horizon_end', stuckCutoff);
  if (error) throw error;

  let created = 0;
  for (const wave of waves || []) {
    const wcLabel = wave.wc?.code || wave.wc?.name || 'Work center';
    const result = await ensureNotification({
      category: 'production',
      type: 'horizon_wave_stuck',
      severity: 'warning',
      priority: 2,
      title: 'Horizon wave stuck',
      body: `${wcLabel} wave #${wave.horizon_index} ended ${wave.horizon_end} but is still ${wave.status}.`,
      dedupe_key: `prod:wave_stuck:${wave.id}`,
      payload: {
        wave_id: wave.id,
        work_center_id: wave.work_center_id,
        work_center_code: wave.wc?.code || null,
        work_center_name: wave.wc?.name || null,
        horizon_index: wave.horizon_index,
        horizon_start: wave.horizon_start,
        horizon_end: wave.horizon_end,
        status: wave.status,
      },
    });
    if (result.created) created += 1;
  }

  return { created, checked: (waves || []).length };
}

/**
 * Event: N+1 unlocked / regenerated after a wave completes.
 */
async function notifyHorizonWaveRenewed({
  workCenterId,
  workCenterLabel,
  oldHorizonEnd,
  newHorizonStart,
  newHorizonEnd,
  newHorizonIndex,
}) {
  if (!workCenterId || newHorizonIndex == null) return { created: false };
  const label = workCenterLabel || 'Work center';
  return ensureNotification({
    category: 'production',
    type: 'horizon_wave_renewed',
    severity: 'info',
    priority: 3,
    title: 'Horizon wave renewed',
    body: `${label}: planning window ${newHorizonStart} → ${newHorizonEnd} (wave #${newHorizonIndex}).`,
    dedupe_key: `prod:wave_renew:${workCenterId}:${newHorizonIndex}`,
    payload: {
      work_center_id: workCenterId,
      work_center_label: label,
      old_horizon_end: oldHorizonEnd || null,
      new_horizon_start: newHorizonStart,
      new_horizon_end: newHorizonEnd,
      new_horizon_index: newHorizonIndex,
    },
  });
}

async function evaluateProductionAlerts() {
  const [op1, outsource, girn, stuck] = await Promise.all([
    evaluateOp1ScheduleDelays(),
    evaluateOutsourceLeadDelays(),
    evaluateGirnPendingInspection(),
    evaluateStuckHorizonWaves(),
  ]);

  return {
    ok: true,
    created: {
      op1_schedule_delay: op1.created,
      outsource_lead_delay: outsource.created,
      girn_pending_inspection: girn.created,
      horizon_wave_stuck: stuck.created,
      total: op1.created + outsource.created + girn.created + stuck.created,
    },
    checked: {
      op1_schedule_delay: op1.checked,
      outsource_lead_delay: outsource.checked,
      girn_pending_inspection: girn.checked,
      horizon_wave_stuck: stuck.checked,
    },
    evaluated_at: new Date().toISOString(),
  };
}

module.exports = {
  evaluateProductionAlerts,
  evaluateOp1ScheduleDelays,
  evaluateOutsourceLeadDelays,
  evaluateGirnPendingInspection,
  evaluateStuckHorizonWaves,
  notifyHorizonWaveRenewed,
};
