const { createClient } = require('@supabase/supabase-js');
const { SCHEDULABLE_TYPES } = require('../config/activityFlowTypes');
const {
  generateFromRule,
  getActiveBomVersionId,
  getActiveActivityFlowVersionId,
  todayDateString,
  nextDocumentNumber,
} = require('./blanketPosEngine');
const {
  estimateCampaignCapacity,
  clampHoursPerDay,
  nextHorizonWindow,
  scheduleCommitmentDates,
  addDaysWorking,
  toNumber,
  listWorkingDays,
} = require('./productionCapacityEngine');
const {
  rankHorizonDemand,
  finalizeCampaignPriorityScores,
  computeRunOutDays,
  SAFETY_BUFFER_DAYS,
} = require('./campaignRankingEngine');

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

async function assertWCManager(workCenterId, employeeId, { isSupervisor = false } = {}) {
  // Role bypass is opt-in only; My Today / commitment actions require assigned WC manager.
  if (isSupervisor) return true;
  if (!isValidUUID(employeeId)) {
    throw httpError('Only the work center manager can perform this action', 403);
  }
  const { data: wc, error } = await supabase
    .from('work_centers')
    .select('id, manager_employee_id')
    .eq('id', workCenterId)
    .maybeSingle();
  if (error) throw error;
  if (!wc) throw httpError('Work center not found', 404);
  if (wc.manager_employee_id !== employeeId) {
    throw httpError('Only the work center manager can perform this action', 403);
  }
  return true;
}

async function getNodeStandards(nodeId) {
  if (!nodeId) return { run_time_per_unit_minutes: null, setup_time_minutes: 0 };
  const { data, error } = await supabase
    .from('activity_flow_nodes')
    .select('id, label, run_time_per_unit_minutes, setup_time_minutes, work_center_id, activity_type, flow_version_id')
    .eq('id', nodeId)
    .maybeSingle();
  if (error) throw error;
  return data || { run_time_per_unit_minutes: null, setup_time_minutes: 0 };
}

async function findMatchingTemplate(workCenterId, masterRecordId, nodeId) {
  let query = supabase
    .from('commitment_templates')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).filter((t) => {
    if (t.work_center_id && t.work_center_id !== workCenterId) return false;
    if (t.master_record_id && t.master_record_id !== masterRecordId) return false;
    if (t.activity_flow_node_id && t.activity_flow_node_id !== nodeId) return false;
    return true;
  });

  return rows.sort((a, b) => {
    const score = (t) =>
      (t.master_record_id ? 4 : 0) + (t.activity_flow_node_id ? 2 : 0) + (t.work_center_id ? 1 : 0);
    return score(b) - score(a);
  })[0] || null;
}

/**
 * Aggregate delivery demand per component for schedulable ops at a WC in a horizon window.
 */
async function findSchedulableNodeAtWC(afVersionId, workCenterId) {
  const { data: nodes, error } = await supabase
    .from('activity_flow_nodes')
    .select(
      'id, label, activity_type, run_time_per_unit_minutes, setup_time_minutes, work_center_id, sequence, flow_version_id'
    )
    .eq('flow_version_id', afVersionId)
    .eq('work_center_id', workCenterId)
    .order('sequence', { ascending: true });
  if (error) throw error;
  return (nodes || []).find((n) => SCHEDULABLE_TYPES.has(n.activity_type)) || null;
}

async function aggregateHorizonDemand({ workCenterId, horizonStart, horizonEnd }) {
  const { data: schedules, error } = await supabase
    .from('delivery_schedules')
    .select(
      'id, due_date, quantity, status, activity_flow_version_id, blanket_po_line_id'
    )
    .gte('due_date', horizonStart)
    .lte('due_date', horizonEnd)
    .in('status', ['planned', 'released']);
  if (error) throw error;

  const lineIds = [...new Set((schedules || []).map((s) => s.blanket_po_line_id).filter(Boolean))];
  if (!lineIds.length) return [];

  const { data: lines, error: lErr } = await supabase
    .from('blanket_po_lines')
    .select('id, master_record_id')
    .in('id', lineIds);
  if (lErr) throw lErr;

  const lineById = Object.fromEntries((lines || []).map((l) => [l.id, l]));
  const afCache = {};
  const bomCache = {};
  const byComponent = {};

  for (const sched of schedules || []) {
    const line = lineById[sched.blanket_po_line_id];
    if (!line?.master_record_id) continue;

    const compId = line.master_record_id;
    let afVersionId = sched.activity_flow_version_id;
    if (!afVersionId) {
      if (!(compId in afCache)) {
        afCache[compId] = await getActiveActivityFlowVersionId(compId);
      }
      afVersionId = afCache[compId];
    }
    if (!afVersionId) continue;

    if (!(compId in bomCache)) {
      bomCache[compId] = await getActiveBomVersionId(compId);
    }

    const node = await findSchedulableNodeAtWC(afVersionId, workCenterId);
    if (!node) continue;

    if (!byComponent[compId]) {
      byComponent[compId] = {
        master_record_id: compId,
        activity_flow_version_id: afVersionId,
        activity_flow_node_id: node.id,
        bom_version_id: bomCache[compId] || null,
        demand_qty: 0,
        schedules: [],
        run_time_per_unit_minutes: node.run_time_per_unit_minutes,
        setup_time_minutes: node.setup_time_minutes,
        earliest_due: sched.due_date,
      };
    }
    byComponent[compId].demand_qty += toNumber(sched.quantity);
    byComponent[compId].schedules.push({
      id: sched.id,
      due_date: sched.due_date,
      quantity: toNumber(sched.quantity),
      status: sched.status,
    });
    if (sched.due_date < byComponent[compId].earliest_due) {
      byComponent[compId].earliest_due = sched.due_date;
    }
  }

  const recordIds = Object.keys(byComponent);
  const { data: lookups } = recordIds.length
    ? await supabase.from('v_master_lookup').select('record_id, label').in('record_id', recordIds)
    : { data: [] };
  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));

  const withLabels = Object.values(byComponent).map((r) => ({
    ...r,
    component_label: labelById[r.master_record_id] || null,
  }));

  // TOC / DBR: rank by run-out + demand (priority finalized after capacity estimate)
  return rankHorizonDemand(withLabels, { horizonStart, horizonEnd });
}

async function enrichCampaigns(rows) {
  if (!rows?.length) return [];
  const recordIds = [...new Set(rows.map((r) => r.master_record_id).filter(Boolean))];
  const { data: lookups } = recordIds.length
    ? await supabase.from('v_master_lookup').select('record_id, label').in('record_id', recordIds)
    : { data: [] };
  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));
  return rows.map((r) => ({
    ...r,
    target_quantity: toNumber(r.target_quantity),
    good_quantity: toNumber(r.good_quantity),
    scrap_quantity: toNumber(r.scrap_quantity),
    horizon_demand_qty: toNumber(r.horizon_demand_qty),
    remaining_qty: Math.max(0, toNumber(r.target_quantity) - toNumber(r.good_quantity)),
    run_out_days: r.run_out_days != null ? toNumber(r.run_out_days) : null,
    priority_score: r.priority_score != null ? toNumber(r.priority_score) : null,
    component_label: labelById[r.master_record_id] || null,
  }));
}

async function runMutualProtectionChecks(preview, workCenterId) {
  const hard = [];
  const soft = [];

  for (const b of preview.blockers || []) {
    hard.push({
      type: 'capacity',
      code: 'capacity',
      master_record_id: b.master_record_id,
      reason: b.reason,
      message: b.reason,
    });
  }

  const { data: openWaves, error: wErr } = await supabase
    .from('production_horizon_waves')
    .select('id, horizon_index, status')
    .eq('work_center_id', workCenterId)
    .in('status', ['locked', 'in_progress'])
    .order('horizon_index', { ascending: true });
  if (wErr) throw wErr;

  if (openWaves?.length) {
    const prior = openWaves[openWaves.length - 1];
    hard.push({
      type: 'prior_wave',
      code: 'prior_wave',
      wave_id: prior.id,
      horizon_index: prior.horizon_index,
      status: prior.status,
      reason: `Horizon ${prior.horizon_index} (${prior.status}) must complete before releasing the next wave`,
      message: `Horizon ${prior.horizon_index} must complete before locking N+1`,
    });
  }

  const scheduleIds = [
    ...new Set(
      (preview.campaigns || []).flatMap((c) => (c.schedules || []).map((s) => s.id).filter(Boolean))
    ),
  ];
  if (scheduleIds.length) {
    const { data: covered, error: covErr } = await supabase
      .from('campaign_schedule_coverage')
      .select('delivery_schedule_id, campaign_id')
      .in('delivery_schedule_id', scheduleIds);
    if (covErr) throw covErr;

    const campIds = [...new Set((covered || []).map((r) => r.campaign_id).filter(Boolean))];
    if (campIds.length) {
      const { data: camps, error: cErr } = await supabase
        .from('production_campaigns')
        .select('id, horizon_wave_id, status')
        .in('id', campIds);
      if (cErr) throw cErr;

      const waveIds = [...new Set((camps || []).map((c) => c.horizon_wave_id).filter(Boolean))];
      const { data: waves, error: wvErr } = waveIds.length
        ? await supabase
            .from('production_horizon_waves')
            .select('id, status, horizon_index')
            .in('id', waveIds)
            .in('status', ['locked', 'in_progress'])
        : { data: [], error: null };
      if (wvErr) throw wvErr;

      const blockingWaveIds = new Set((waves || []).map((w) => w.id));
      const conflicts = (covered || []).filter((row) => {
        const camp = (camps || []).find((c) => c.id === row.campaign_id);
        return camp && blockingWaveIds.has(camp.horizon_wave_id);
      });
      if (conflicts.length) {
        hard.push({
          type: 'schedule_coverage',
          code: 'double_lock',
          reason: `${conflicts.length} schedule(s) already covered by another in-progress or locked wave`,
          message: `${conflicts.length} schedule(s) already covered by another in-progress or locked wave`,
          schedules: conflicts,
        });
      }
    }
  }

  let offsetDays = 0;
  const startDate = preview.start_date || todayDateString();
  for (let i = 0; i < (preview.campaigns || []).length; i++) {
    const camp = preview.campaigns[i];
    const days = camp.capacity?.productionDays || camp.production_days || 0;
    const startOffset = offsetDays;
    const startAt = addDaysWorking(startDate, startOffset);
    const endAt = days > 0 ? addDaysWorking(startDate, startOffset + days - 1) : startAt;
    camp.start_offset_days = startOffset;
    camp.production_days = days;
    camp.earliest_due = camp.earliest_due || null;
    camp.planned_start = startAt;
    camp.planned_end = endAt;
    camp.estimated_start = startAt;

    // Mutual protection: projected run-out at campaign start vs safety buffer
    const runOutAtStart = Number.isFinite(camp.run_out_days)
      ? toNumber(camp.run_out_days) - startOffset
      : null;
    if (runOutAtStart != null && runOutAtStart < SAFETY_BUFFER_DAYS) {
      soft.push({
        type: 'starvation',
        code: 'run_out_buffer',
        reason: `${camp.component_label || camp.master_record_id} projected run-out is ${runOutAtStart.toFixed(1)} days at campaign start (buffer ${SAFETY_BUFFER_DAYS} days)`,
        message: `${camp.component_label || camp.master_record_id} may stock-out before its campaign starts (run-out ${runOutAtStart.toFixed(1)}d < ${SAFETY_BUFFER_DAYS}d buffer)`,
        master_record_id: camp.master_record_id,
        run_out_days: camp.run_out_days,
        projected_run_out_at_start: runOutAtStart,
        estimated_start: startAt,
        earliest_due: camp.earliest_due,
      });
    }

    if (i > 0 && camp.earliest_due && startAt && String(startAt) > String(camp.earliest_due)) {
      const prior = preview.campaigns[i - 1];
      const monthsApprox = Math.max(1, Math.round(((prior.production_days || 0) / 26) * 10) / 10);
      const aLabel = prior.component_label || prior.master_record_id;
      const bLabel = camp.component_label || camp.master_record_id;
      soft.push({
        type: 'starvation',
        code: 'starvation',
        reason: `Running ${aLabel} for ~${monthsApprox} months may starve ${bLabel} before its due dates`,
        message: `Running ${aLabel} for ~${monthsApprox} months may starve ${bLabel} before its due dates`,
        prior_master_record_id: prior.master_record_id,
        master_record_id: camp.master_record_id,
        prior_production_days: prior.production_days,
        estimated_start: startAt,
        earliest_due: camp.earliest_due,
      });
    }
    offsetDays += days;
  }

  return { hard, soft };
}

async function previewHorizonWave(payload) {
  const workCenterId = payload.work_center_id;
  const nodeId = payload.activity_flow_node_id || null; // optional
  const horizonStart = payload.horizon_start;
  const horizonEnd = payload.horizon_end;
  if (!isValidUUID(workCenterId)) throw httpError('work_center_id is required');
  if (!horizonStart || !horizonEnd) throw httpError('horizon_start and horizon_end are required');

  const { data: wc } = await supabase
    .from('work_centers')
    .select('hours_per_day, horizon_months_default')
    .eq('id', workCenterId)
    .maybeSingle();
  const hoursPerDay = clampHoursPerDay(payload.hours_per_day ?? wc?.hours_per_day ?? 9);
  const startDate = payload.start_date || todayDateString();

  const demandRows = await aggregateHorizonDemand({
    workCenterId,
    horizonStart,
    horizonEnd,
  });

  const campaignsRaw = [];
  const capacityBlockers = [];

  for (const row of demandRows) {
    const template = await findMatchingTemplate(workCenterId, row.master_record_id, row.activity_flow_node_id);
    const capacity = estimateCampaignCapacity({
      targetQuantity: row.demand_qty,
      runTimePerUnitMinutes: row.run_time_per_unit_minutes,
      setupTimeMinutes: row.setup_time_minutes,
      hoursPerDay,
      templatePcsPerDay: template?.pcs_per_day,
    });
    if (capacity.error) {
      capacityBlockers.push({
        master_record_id: row.master_record_id,
        reason: capacity.error,
        component_label: row.component_label,
      });
    }
    campaignsRaw.push({
      ...row,
      target_quantity: row.demand_qty,
      template: template ? { id: template.id, name: template.name, pcs_per_day: template.pcs_per_day } : null,
      capacity,
      production_days: capacity.productionDays || 0,
      earliest_due: row.earliest_due,
    });
  }

  // Re-sequence by finalized priority score (run-out + duration + demand)
  const campaigns = finalizeCampaignPriorityScores(campaignsRaw);

  const draft = {
    work_center_id: workCenterId,
    activity_flow_node_id: nodeId || campaigns[0]?.activity_flow_node_id || null,
    horizon_start: horizonStart,
    horizon_end: horizonEnd,
    hours_per_day: hoursPerDay,
    start_date: startDate,
    horizon_working_days: listWorkingDays(horizonStart, horizonEnd).length,
    safety_buffer_days: SAFETY_BUFFER_DAYS,
    campaigns,
    blockers: capacityBlockers,
  };

  const { hard, soft: warnings } = await runMutualProtectionChecks(draft, workCenterId);
  const canRelease = hard.length === 0 && campaigns.length > 0;

  return {
    ...draft,
    blockers: hard,
    warnings,
    can_lock: canRelease,
    can_release: canRelease,
  };
}

async function bulkReleaseSchedules(scheduleIds) {
  const released = [];
  for (const scheduleId of scheduleIds || []) {
    const { data: schedule, error } = await supabase
      .from('delivery_schedules')
      .select('id, status, blanket_po_line_id, activity_flow_version_id, bom_version_id')
      .eq('id', scheduleId)
      .maybeSingle();
    if (error) throw error;
    if (!schedule || schedule.status === 'cancelled') continue;
    if (schedule.status === 'released' && schedule.activity_flow_version_id) {
      released.push(schedule);
      continue;
    }

    const { data: line } = await supabase
      .from('blanket_po_lines')
      .select('master_record_id')
      .eq('id', schedule.blanket_po_line_id)
      .maybeSingle();
    if (!line?.master_record_id) continue;

    const bomVersionId = schedule.bom_version_id || (await getActiveBomVersionId(line.master_record_id));
    const afVersionId =
      schedule.activity_flow_version_id || (await getActiveActivityFlowVersionId(line.master_record_id));
    if (!bomVersionId || !afVersionId) {
      throw httpError(`Cannot release schedule ${scheduleId}: missing active BOM or Activity Flow`);
    }

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
    released.push(updated);
  }
  return released;
}

async function autoGenerateNextHorizonSchedules(horizonEnd, createdBy) {
  const { horizon_start, horizon_end } = nextHorizonWindow(horizonEnd, 5);
  const { data: rules } = await supabase
    .from('delivery_schedule_rules')
    .select('id')
    .eq('is_active', true);
  const results = [];
  for (const rule of rules || []) {
    try {
      const result = await generateFromRule(
        { rule_id: rule.id, horizon_start, horizon_end },
        createdBy
      );
      results.push({ rule_id: rule.id, ...result });
    } catch (e) {
      results.push({ rule_id: rule.id, error: e.message });
    }
  }
  return { horizon_start, horizon_end, results };
}

/**
 * Generate stay-open daily production cards for an active campaign.
 * Replaces wc_daily_commitments as the floor work unit.
 */
async function generateCampaignDailyCards(campaign, hoursPerDay, startDate) {
  const template = await findMatchingTemplate(
    campaign.work_center_id,
    campaign.master_record_id,
    campaign.activity_flow_node_id
  );
  const capacity = estimateCampaignCapacity({
    targetQuantity: campaign.target_quantity,
    runTimePerUnitMinutes: campaign.run_time_per_unit_minutes,
    setupTimeMinutes: campaign.setup_time_minutes,
    hoursPerDay,
    templatePcsPerDay: template?.pcs_per_day,
  });
  if (capacity.error) throw httpError(capacity.error);

  const dates = scheduleCommitmentDates(startDate || todayDateString(), capacity.dailyPlan.length);
  const bomVersionId =
    campaign.bom_version_id || (await getActiveBomVersionId(campaign.master_record_id));
  const afVersionId = campaign.activity_flow_version_id;

  const inserted = [];
  for (let i = 0; i < capacity.dailyPlan.length; i++) {
    const day = capacity.dailyPlan[i];
    const qty = toNumber(day.committed_qty);
    if (!(qty > 0)) continue;
    const cardNumber = await nextDocumentNumber('production_card', 'JOB');
    const row = {
      card_number: cardNumber,
      delivery_schedule_id: null,
      campaign_id: campaign.id,
      master_record_id: campaign.master_record_id,
      assigned_employee_id: null,
      work_center_id: campaign.work_center_id,
      current_activity_flow_node_id: campaign.activity_flow_node_id,
      activity_flow_version_id: afVersionId,
      bom_version_id: bomVersionId,
      work_date: dates[i] || dates[dates.length - 1],
      target_quantity: qty,
      overdue_quantity: 0,
      total_good_produced: 0,
      total_scrap_produced: 0,
      backflushed_good_qty: 0,
      day_index: day.day_index,
      status: i === 0 ? 'READY' : 'READY',
      assignment_status: 'unassigned',
      created_by: null,
    };
    const { data, error } = await supabase.from('production_cards').insert(row).select('*').single();
    if (error) throw error;
    inserted.push(data);
    try {
      const { spawnOp1ForScheduleCard } = require('./productionOpCardEngine');
      await spawnOp1ForScheduleCard(data);
    } catch (e) {
      console.error('spawnOp1ForScheduleCard after campaign card create:', e.message);
    }
  }

  await supabase
    .from('production_campaigns')
    .update({
      estimated_hours: capacity.totalHours,
      production_days: capacity.productionDays,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaign.id);

  return inserted;
}

/** @deprecated Use generateCampaignDailyCards — commitments are frozen. */
async function generateCampaignCommitments(campaign, hoursPerDay, startDate) {
  return generateCampaignDailyCards(campaign, hoursPerDay, startDate);
}

async function lockHorizonWave(payload, actorId) {
  const preview = await previewHorizonWave(payload);
  if (!preview.can_lock) {
    throw httpError(
      preview.blockers.length
        ? `Cannot release: ${preview.blockers.map((b) => b.reason || b.message).join('; ')}`
        : 'No campaigns to release'
    );
  }
  if (preview.warnings?.length && payload.acknowledge_warnings !== true) {
    const err = httpError('Starvation warnings must be acknowledged before release', 409);
    err.warnings = preview.warnings;
    throw err;
  }

  const { work_center_id: workCenterId, horizon_start: horizonStart, horizon_end: horizonEnd } = payload;
  const nodeId = payload.activity_flow_node_id || preview.campaigns[0]?.activity_flow_node_id || null;

  const scheduleIds = preview.campaigns.flatMap((c) => (c.schedules || []).map((s) => s.id));
  await bulkReleaseSchedules(scheduleIds);

  const { data: existingWaves } = await supabase
    .from('production_horizon_waves')
    .select('id, horizon_index, status')
    .eq('work_center_id', workCenterId)
    .order('horizon_index', { ascending: false });

  const openWave = (existingWaves || []).find((w) => ['locked', 'in_progress'].includes(w.status));
  if (openWave) {
    throw httpError(`Horizon ${openWave.horizon_index} must complete before releasing the next wave`, 409);
  }

  const reusable = (existingWaves || []).find((w) => ['planning', 'blocked'].includes(w.status));
  const completedMax = Math.max(
    0,
    ...(existingWaves || []).filter((w) => w.status === 'completed').map((w) => w.horizon_index)
  );
  const horizonIndex = reusable?.horizon_index || completedMax + 1;
  const now = new Date().toISOString();

  let wave;
  if (reusable) {
    const { data: updated, error: wErr } = await supabase
      .from('production_horizon_waves')
      .update({
        horizon_start: horizonStart,
        horizon_end: horizonEnd,
        activity_flow_node_id: nodeId,
        status: 'locked',
        hours_per_day: preview.hours_per_day,
        locked_at: now,
        unlocked_at: null,
        updated_at: now,
        created_by: actorId || reusable.created_by || null,
      })
      .eq('id', reusable.id)
      .select('*')
      .single();
    if (wErr) throw wErr;
    wave = updated;
  } else {
    const { data: inserted, error: wErr } = await supabase
      .from('production_horizon_waves')
      .insert({
        work_center_id: workCenterId,
        horizon_index: horizonIndex,
        horizon_start: horizonStart,
        horizon_end: horizonEnd,
        activity_flow_node_id: nodeId,
        status: 'locked',
        hours_per_day: preview.hours_per_day,
        locked_at: now,
        created_by: actorId || null,
      })
      .select('*')
      .single();
    if (wErr) throw wErr;
    wave = inserted;
  }

  const campaignRows = [];
  for (let i = 0; i < preview.campaigns.length; i++) {
    const c = preview.campaigns[i];
    campaignRows.push({
      horizon_wave_id: wave.id,
      work_center_id: workCenterId,
      master_record_id: c.master_record_id,
      activity_flow_node_id: c.activity_flow_node_id || nodeId,
      activity_flow_version_id: c.activity_flow_version_id,
      target_quantity: c.demand_qty,
      horizon_demand_qty: c.demand_qty,
      demand_rank: c.demand_rank,
      run_out_days: Number.isFinite(c.run_out_days) ? c.run_out_days : null,
      priority_score: c.priority_score != null ? c.priority_score : null,
      queue_sequence: i + 1,
      status: i === 0 ? 'active' : 'queued',
      run_time_per_unit_minutes: c.run_time_per_unit_minutes,
      setup_time_minutes: c.setup_time_minutes,
      estimated_hours: c.capacity.totalHours,
      production_days: c.capacity.productionDays,
      started_at: i === 0 ? now : null,
    });
  }

  const { data: campaigns, error: cErr } = await supabase
    .from('production_campaigns')
    .insert(campaignRows)
    .select('*');
  if (cErr) throw cErr;

  for (let i = 0; i < campaigns.length; i++) {
    const camp = campaigns[i];
    const previewCamp = preview.campaigns[i];
    const coverageRows = (previewCamp.schedules || []).map((s) => ({
      campaign_id: camp.id,
      delivery_schedule_id: s.id,
      schedule_qty: s.quantity,
      covered_qty: 0,
    }));
    if (coverageRows.length) {
      const { error: covErr } = await supabase.from('campaign_schedule_coverage').insert(coverageRows);
      if (covErr) throw covErr;
    }
    if (camp.status === 'active') {
      await generateCampaignDailyCards(camp, preview.hours_per_day, payload.start_date || todayDateString());
    }
  }

  await supabase
    .from('production_horizon_waves')
    .update({ status: 'in_progress', updated_at: now })
    .eq('id', wave.id);

  const nextHorizon = await autoGenerateNextHorizonSchedules(horizonEnd, actorId);
  const nextWindow = nextHorizonWindow(horizonEnd, 5);
  const { data: existingNext } = await supabase
    .from('production_horizon_waves')
    .select('id')
    .eq('work_center_id', workCenterId)
    .eq('horizon_index', horizonIndex + 1)
    .maybeSingle();

  let blockedWave = null;
  if (!existingNext) {
    const { data: inserted } = await supabase
      .from('production_horizon_waves')
      .insert({
        work_center_id: workCenterId,
        horizon_index: horizonIndex + 1,
        horizon_start: nextWindow.horizon_start,
        horizon_end: nextWindow.horizon_end,
        activity_flow_node_id: nodeId,
        status: 'blocked',
        hours_per_day: preview.hours_per_day,
        created_by: actorId || null,
      })
      .select('*')
      .maybeSingle();
    blockedWave = inserted;
  }

  return {
    wave,
    campaigns: await enrichCampaigns(campaigns),
    next_horizon_schedules: nextHorizon,
    blocked_next_wave: blockedWave,
    released_schedules: scheduleIds.length,
  };
}

async function activateNextCampaign(waveId) {
  const { data: active } = await supabase
    .from('production_campaigns')
    .select('id')
    .eq('horizon_wave_id', waveId)
    .eq('status', 'active')
    .maybeSingle();
  if (active) return null;

  const { data: next, error } = await supabase
    .from('production_campaigns')
    .select('*')
    .eq('horizon_wave_id', waveId)
    .eq('status', 'queued')
    .order('queue_sequence', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!next) return null;

  const now = new Date().toISOString();
  const { data: updated, error: uErr } = await supabase
    .from('production_campaigns')
    .update({ status: 'active', started_at: now, updated_at: now })
    .eq('id', next.id)
    .select('*')
    .single();
  if (uErr) throw uErr;

  const { data: wave } = await supabase
    .from('production_horizon_waves')
    .select('hours_per_day')
    .eq('id', waveId)
    .maybeSingle();

  await generateCampaignDailyCards(updated, wave?.hours_per_day || 9, todayDateString());
  return enrichCampaigns([updated]).then(([c]) => c);
}

async function checkWaveCompletion(waveId) {
  const { data: open } = await supabase
    .from('production_campaigns')
    .select('id')
    .eq('horizon_wave_id', waveId)
    .not('status', 'in', '("completed","cancelled")');
  if (open?.length) return false;

  const now = new Date().toISOString();
  await supabase
    .from('production_horizon_waves')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('id', waveId);

  const { data: wave } = await supabase
    .from('production_horizon_waves')
    .select('id, work_center_id, horizon_index, horizon_end, hours_per_day, activity_flow_node_id')
    .eq('id', waveId)
    .maybeSingle();

  if (wave) {
    // Unlock N+1 blocked wave into planning
    await supabase
      .from('production_horizon_waves')
      .update({ status: 'planning', unlocked_at: now, updated_at: now })
      .eq('work_center_id', wave.work_center_id)
      .eq('horizon_index', wave.horizon_index + 1)
      .eq('status', 'blocked');

    // Auto-seed next horizon demand + ensure N+1 / N+2 window exists
    try {
      const months = 5;
      const { data: wc } = await supabase
        .from('work_centers')
        .select('horizon_months_default, hours_per_day')
        .eq('id', wave.work_center_id)
        .maybeSingle();
      const horizonMonths = Math.min(6, Math.max(4, wc?.horizon_months_default || months));
      await autoGenerateNextHorizonSchedules(wave.horizon_end, null);

      const nextWindow = nextHorizonWindow(wave.horizon_end, horizonMonths);
      const nextIndex = wave.horizon_index + 1;
      const { data: existingNext } = await supabase
        .from('production_horizon_waves')
        .select('id, status')
        .eq('work_center_id', wave.work_center_id)
        .eq('horizon_index', nextIndex)
        .maybeSingle();

      if (!existingNext) {
        await supabase.from('production_horizon_waves').insert({
          work_center_id: wave.work_center_id,
          horizon_index: nextIndex,
          horizon_start: nextWindow.horizon_start,
          horizon_end: nextWindow.horizon_end,
          activity_flow_node_id: wave.activity_flow_node_id,
          status: 'planning',
          hours_per_day: wave.hours_per_day || wc?.hours_per_day || 9,
          unlocked_at: now,
        });
      } else if (['blocked', 'planning'].includes(existingNext.status)) {
        await supabase
          .from('production_horizon_waves')
          .update({
            horizon_start: nextWindow.horizon_start,
            horizon_end: nextWindow.horizon_end,
            status: 'planning',
            unlocked_at: now,
            updated_at: now,
          })
          .eq('id', existingNext.id);
      }

      // Seed N+2 as blocked for continuity
      const n2 = nextIndex + 1;
      const { data: existingN2 } = await supabase
        .from('production_horizon_waves')
        .select('id')
        .eq('work_center_id', wave.work_center_id)
        .eq('horizon_index', n2)
        .maybeSingle();
      if (!existingN2) {
        const n2Window = nextHorizonWindow(nextWindow.horizon_end, horizonMonths);
        await supabase.from('production_horizon_waves').insert({
          work_center_id: wave.work_center_id,
          horizon_index: n2,
          horizon_start: n2Window.horizon_start,
          horizon_end: n2Window.horizon_end,
          activity_flow_node_id: wave.activity_flow_node_id,
          status: 'blocked',
          hours_per_day: wave.hours_per_day || wc?.hours_per_day || 9,
        });
      }
    } catch (e) {
      console.error('Horizon auto-refresh after wave complete:', e.message);
    }
  }
  return true;
}

async function completeCampaignIfDone(campaignId) {
  const { data: camp, error } = await supabase
    .from('production_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (error) throw error;
  if (!camp) return null;

  if (toNumber(camp.good_quantity) >= toNumber(camp.target_quantity) && camp.status === 'active') {
    const now = new Date().toISOString();
    await supabase
      .from('production_campaigns')
      .update({ status: 'completed', completed_at: now, updated_at: now })
      .eq('id', campaignId);

    await activateNextCampaign(camp.horizon_wave_id);
    await checkWaveCompletion(camp.horizon_wave_id);
    return { completed: true };
  }
  return { completed: false };
}

async function allocateCoverage(campaignId, goodQty) {
  let remaining = toNumber(goodQty);
  const { data: rows, error } = await supabase
    .from('campaign_schedule_coverage')
    .select('id, schedule_qty, covered_qty, delivery_schedule_id')
    .eq('campaign_id', campaignId)
    .order('delivery_schedule_id');
  if (error) throw error;

  for (const row of rows || []) {
    if (remaining <= 0) break;
    const need = Math.max(0, toNumber(row.schedule_qty) - toNumber(row.covered_qty));
    if (need <= 0) continue;
    const take = Math.min(need, remaining);
    await supabase
      .from('campaign_schedule_coverage')
      .update({ covered_qty: toNumber(row.covered_qty) + take })
      .eq('id', row.id);
    remaining -= take;
  }
}

async function getWCCommand(workCenterId, workDate) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');
  const date = workDate || todayDateString();

  const { data: wc, error: wcErr } = await supabase
    .from('work_centers')
    .select('id, name, code, manager_employee_id, hours_per_day')
    .eq('id', workCenterId)
    .maybeSingle();
  if (wcErr) throw wcErr;
  if (!wc) throw httpError('Work center not found', 404);

  const { data: activeCampaign } = await supabase
    .from('production_campaigns')
    .select('*')
    .eq('work_center_id', workCenterId)
    .eq('status', 'active')
    .maybeSingle();

  const { data: queue } = await supabase
    .from('production_campaigns')
    .select('*')
    .eq('work_center_id', workCenterId)
    .in('status', ['queued', 'active'])
    .order('queue_sequence', { ascending: true });

  const { data: wave } = activeCampaign
    ? await supabase
        .from('production_horizon_waves')
        .select('*')
        .eq('id', activeCampaign.horizon_wave_id)
        .maybeSingle()
    : { data: null };

  const { data: members } = await supabase
    .from('employee_work_centers')
    .select('employee_id, employees(id, full_name, employee_code)')
    .eq('work_center_id', workCenterId);

  const { data: efficiencies } = await supabase
    .from('worker_efficiency_entries')
    .select('*')
    .eq('work_center_id', workCenterId)
    .eq('work_date', date);

  const enriched = activeCampaign ? (await enrichCampaigns([activeCampaign]))[0] : null;

  let nodeLabel = null;
  if (activeCampaign?.activity_flow_node_id) {
    const { data: node } = await supabase
      .from('activity_flow_nodes')
      .select('id, label')
      .eq('id', activeCampaign.activity_flow_node_id)
      .maybeSingle();
    nodeLabel = node?.label || null;
  }

  // Stay-open rope: earliest unfinished card whose work_date is today or earlier.
  // Do not surface tomorrow's (or later) card until that calendar day.
  let actionableCard = null;
  let openCards = [];
  let completedToday = [];
  let nextCardDate = null;

  if (activeCampaign) {
    const { data: cards, error: cErr } = await supabase
      .from('production_cards')
      .select('*')
      .eq('campaign_id', activeCampaign.id)
      .order('day_index', { ascending: true })
      .order('work_date', { ascending: true });
    if (cErr) throw cErr;

    openCards = (cards || []).filter((c) => !['COMPLETED'].includes(c.status));
    const dueOrOpen = openCards.filter(
      (c) =>
        ['READY', 'RUNNING', 'OVERDUE'].includes(c.status) &&
        String(c.work_date || '').slice(0, 10) <= date
    );
    actionableCard = dueOrOpen[0] || null;

    const futureOpen = openCards.find(
      (c) =>
        ['READY', 'RUNNING', 'OVERDUE'].includes(c.status) &&
        String(c.work_date || '').slice(0, 10) > date
    );
    nextCardDate = futureOpen?.work_date ? String(futureOpen.work_date).slice(0, 10) : null;

    completedToday = (cards || []).filter(
      (c) => c.status === 'COMPLETED' && (c.completed_at || '').slice(0, 10) === date
    );
  }

  const mapCardOut = (c) => {
    if (!c) return null;
    const target = toNumber(c.target_quantity);
    const good = toNumber(c.total_good_produced);
    return {
      ...c,
      // Legacy commitment-shaped aliases for My Today compatibility
      id: c.id,
      card_number: c.card_number || null,
      committed_qty: target,
      good_qty: good,
      scrap_qty: toNumber(c.total_scrap_produced),
      remaining: Math.max(0, target - good),
      current_node_label: nodeLabel,
      op_label: nodeLabel || 'Operation',
      component_label: enriched?.component_label || null,
      efficiency_unlocked: !!c.lot_minted_at,
      target_quantity: target,
      total_good_produced: good,
      day_goal: target + toNumber(c.overdue_quantity),
    };
  };

  let closedList = completedToday.map(mapCardOut);

  // Attach minted lot numbers for Done today chips
  const closedIds = closedList.map((c) => c.id).filter(Boolean);
  if (closedIds.length) {
    const { data: lots } = await supabase
      .from('production_lots')
      .select('id, lot_number, quantity, production_card_id, created_at')
      .in('production_card_id', closedIds)
      .not('status', 'eq', 'merged')
      .order('created_at', { ascending: false });
    const lotsByCard = {};
    for (const lot of lots || []) {
      if (!lotsByCard[lot.production_card_id]) lotsByCard[lot.production_card_id] = [];
      lotsByCard[lot.production_card_id].push(lot);
    }
    closedList = closedList.map((c) => {
      const cardLots = lotsByCard[c.id] || [];
      const primary = cardLots[0] || null;
      return {
        ...c,
        lot_number: primary?.lot_number || null,
        lot_numbers: cardLots.map((l) => l.lot_number).filter(Boolean),
        lots: cardLots,
      };
    });
  }

  const teamRaw = (members || []).map((m) => m.employees).filter(Boolean);
  const effByEmp = Object.fromEntries((efficiencies || []).map((e) => [e.employee_id, e]));
  const team = teamRaw.map((emp) => {
    const eff = effByEmp[emp.id];
    return {
      ...emp,
      employee_id: emp.id,
      efficiency_pct: eff?.efficiency_pct != null ? toNumber(eff.efficiency_pct) : '',
      notes: eff?.notes || '',
      efficiency_saved: !!eff,
    };
  });

  const goodClosed = closedList.reduce((s, c) => s + toNumber(c.good_qty), 0);
  const goalClosed = closedList.reduce((s, c) => s + toNumber(c.committed_qty), 0);
  const activeMapped = mapCardOut(actionableCard);
  const goodToday = goodClosed + (activeMapped ? toNumber(activeMapped.good_qty) : 0);
  const goalToday = goalClosed + (activeMapped ? toNumber(activeMapped.committed_qty) : 0);

  return {
    work_center: wc,
    work_date: date,
    active_campaign: enriched
      ? { ...enriched, operation_label: nodeLabel }
      : null,
    today_card: activeMapped,
    // Alias kept so older clients reading today_commitment still work during cutover
    today_commitment: activeMapped,
    open_cards: openCards.map(mapCardOut),
    campaign_queue: await enrichCampaigns(queue || []),
    horizon_wave: wave,
    team,
    efficiencies: efficiencies || [],
    efficiency_saved: (efficiencies || []).length > 0,
    closed_cards: closedList,
    closed_commitments: closedList,
    ops_completed_today: closedList.length,
    today_good_qty: goodToday,
    today_goal_qty: goalToday,
    next_card_date: nextCardDate,
  };
}

async function postCommitmentProgress(
  commitmentId,
  { good_qty: goodQty, scrap_qty: scrapQty } = {},
  actorId,
  { isSupervisor = false } = {}
) {
  if (!isValidUUID(commitmentId)) throw httpError('Invalid id');

  // Prefer campaign daily cards (rebuild path)
  const { data: card } = await supabase
    .from('production_cards')
    .select('id, campaign_id')
    .eq('id', commitmentId)
    .maybeSingle();

  if (card?.campaign_id) {
    const { reportProgress } = require('./productionCardEngine');
    const result = await reportProgress(
      commitmentId,
      { good_qty: goodQty, scrap_qty: scrapQty, done_for_day: true },
      actorId,
      { isManager: isSupervisor }
    );
    const lot = result?.lot || result?.advance?.lot || null;
    const target = toNumber(result.target_quantity);
    const good = toNumber(result.total_good_produced);
    return {
      commitment: {
        ...result,
        committed_qty: target,
        good_qty: good,
        scrap_qty: toNumber(result.total_scrap_produced),
        remaining: Math.max(0, target - good),
        efficiency_unlocked: !!result.lot_minted_at || result.efficiency_unlocked,
        work_center_id: result.work_center_id,
      },
      minted_lot: lot ? { lot } : result.minted_lot || null,
      advance: result.advance || null,
    };
  }

  throw httpError(
    'Daily commitments are replaced by campaign production cards. Use My Today / production cards.',
    410
  );
}

function enrichMintPayload(minted) {
  if (!minted?.lot) return null;
  const lot = {
    ...minted.lot,
    current_node_label:
      minted.next_node?.label || minted.lot.current_node_label || null,
    current_node_type:
      minted.next_node?.activity_type || minted.lot.current_node_type || null,
  };
  return {
    lot,
    next_node: minted.next_node || null,
    ready_for_dispatch: !!minted.ready_for_dispatch,
    assignee: minted.assignee || null,
  };
}

async function sumCommitmentLotQty(commitmentId) {
  const { data: lots, error } = await supabase
    .from('production_lots')
    .select('quantity, status')
    .eq('wc_daily_commitment_id', commitmentId)
    .not('status', 'eq', 'merged');
  if (error) throw error;
  return (lots || []).reduce((s, l) => s + toNumber(l.quantity), 0);
}

async function closeCommitment(commitmentId, actorId, { isSupervisor = false, force = false } = {}) {
  if (!isValidUUID(commitmentId)) throw httpError('Invalid id');

  // Stay-open daily cards: no separate "close" — complete via progress when goal met.
  const { data: card } = await supabase
    .from('production_cards')
    .select('id, campaign_id, status, lot_minted_at')
    .eq('id', commitmentId)
    .maybeSingle();
  if (card?.campaign_id) {
    if (card.status === 'COMPLETED') {
      const full = await require('./productionCardEngine').getCardById(commitmentId);
      return {
        commitment: {
          ...full,
          committed_qty: toNumber(full.target_quantity),
          good_qty: toNumber(full.total_good_produced),
          scrap_qty: toNumber(full.total_scrap_produced),
          efficiency_unlocked: !!full.lot_minted_at,
        },
        minted_lot: null,
        advance: null,
      };
    }
    throw httpError(
      'Daily cards stay open until the goal is met — post remaining good via My Today (no separate close).',
      409
    );
  }

  throw httpError('Daily commitments retired — use campaign production cards', 410);
}

async function upsertWorkerEfficiency(
  { work_center_id: wcId, work_date: workDate, employee_id: empId, efficiency_pct: pct, notes },
  actorId,
  { isSupervisor = false } = {}
) {
  await assertWCManager(wcId, actorId, { isSupervisor });
  const { data, error } = await supabase
    .from('worker_efficiency_entries')
    .upsert(
      {
        work_center_id: wcId,
        work_date: workDate,
        employee_id: empId,
        efficiency_pct: toNumber(pct),
        notes: notes || null,
        entered_by: actorId,
      },
      { onConflict: 'work_center_id,work_date,employee_id' }
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function getCoverageCalendar(workCenterId, { horizonStart, horizonEnd } = {}) {
  const { data: campaigns } = await supabase
    .from('production_campaigns')
    .select('id, master_record_id, status, target_quantity, good_quantity')
    .eq('work_center_id', workCenterId);

  const campIds = (campaigns || []).map((c) => c.id);
  if (!campIds.length) return { entries: [] };

  let covQuery = supabase
    .from('campaign_schedule_coverage')
    .select('*, delivery_schedules(id, due_date, quantity, schedule_number, status)')
    .in('campaign_id', campIds);

  const { data: coverage, error } = await covQuery;
  if (error) throw error;

  let entries = (coverage || []).map((row) => {
    const sched = row.delivery_schedules;
    const scheduleQty = toNumber(row.schedule_qty);
    const coveredQty = toNumber(row.covered_qty);
    let state = 'at_risk';
    if (coveredQty >= scheduleQty) state = 'covered';
    else if (coveredQty > 0) state = 'partial';
    return {
      delivery_schedule_id: row.delivery_schedule_id,
      campaign_id: row.campaign_id,
      due_date: sched?.due_date,
      schedule_number: sched?.schedule_number,
      schedule_qty: scheduleQty,
      covered_qty: coveredQty,
      state,
    };
  });

  if (horizonStart) entries = entries.filter((e) => !e.due_date || e.due_date >= horizonStart);
  if (horizonEnd) entries = entries.filter((e) => !e.due_date || e.due_date <= horizonEnd);

  entries.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return { entries };
}

async function listWaves(workCenterId) {
  let query = supabase
    .from('production_horizon_waves')
    .select('*')
    .order('horizon_index', { ascending: true });
  if (workCenterId) query = query.eq('work_center_id', workCenterId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function listCommitmentTemplates(workCenterId) {
  let query = supabase.from('commitment_templates').select('*').eq('is_active', true);
  if (workCenterId) query = query.or(`work_center_id.eq.${workCenterId},work_center_id.is.null`);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return data || [];
}

async function saveCommitmentTemplate(payload) {
  const row = {
    work_center_id: payload.work_center_id || null,
    master_record_id: payload.master_record_id || null,
    activity_flow_node_id: payload.activity_flow_node_id || null,
    name: payload.name,
    pcs_per_day: toNumber(payload.pcs_per_day),
    shift_hours: payload.shift_hours != null ? toNumber(payload.shift_hours) : null,
    is_active: payload.is_active !== false,
  };
  if (!(row.pcs_per_day > 0)) throw httpError('pcs_per_day must be > 0');
  if (payload.id) {
    const { data, error } = await supabase
      .from('commitment_templates')
      .update(row)
      .eq('id', payload.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from('commitment_templates').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

async function updateCommitmentQty(commitmentId, committedQty, actorId, { isSupervisor = false } = {}) {
  const { data: commit, error } = await supabase
    .from('wc_daily_commitments')
    .select('*')
    .eq('id', commitmentId)
    .maybeSingle();
  if (error) throw error;
  if (!commit) throw httpError('Commitment not found', 404);
  if (commit.status === 'closed') throw httpError('Commitment is closed', 409);
  await assertWCManager(commit.work_center_id, actorId, { isSupervisor });

  const qty = toNumber(committedQty);
  if (!(qty > 0)) throw httpError('committed_qty must be > 0');

  const { data, error: uErr } = await supabase
    .from('wc_daily_commitments')
    .update({ committed_qty: qty, updated_at: new Date().toISOString() })
    .eq('id', commitmentId)
    .select('*')
    .single();
  if (uErr) throw uErr;
  return data;
}

async function listManagedWorkCenters(employeeId) {
  if (!isValidUUID(employeeId)) return [];
  const { data, error } = await supabase
    .from('work_centers')
    .select('id, name, code, manager_employee_id, hours_per_day, horizon_months_default')
    .eq('manager_employee_id', employeeId)
    .order('name');
  if (error) throw error;
  return data || [];
}

async function listCommitments({ from, to, work_center_id: workCenterId, status, search } = {}) {
  // Campaign daily cards are the floor work units (commitments table is frozen).
  let query = supabase
    .from('production_cards')
    .select(
      '*, production_campaigns(id, master_record_id, status, demand_rank, queue_sequence, target_quantity, good_quantity, activity_flow_node_id, activity_flow_version_id, run_out_days, priority_score), work_centers(id, name, code)'
    )
    .not('campaign_id', 'is', null)
    .order('work_date', { ascending: false });

  if (from) query = query.gte('work_date', from);
  if (to) query = query.lte('work_date', to);
  if (workCenterId && isValidUUID(workCenterId)) query = query.eq('work_center_id', workCenterId);

  if (status) {
    const statusMap = {
      open: ['READY', 'RUNNING', 'OVERDUE'],
      met: ['COMPLETED'],
      closed: ['COMPLETED'],
      READY: ['READY'],
      RUNNING: ['RUNNING'],
      COMPLETED: ['COMPLETED'],
      OVERDUE: ['OVERDUE'],
    };
    const mapped = statusMap[status] || [status];
    query = query.in('status', mapped);
  }

  const { data, error } = await query.limit(500);
  if (error) throw error;

  const rows = data || [];
  const recordIds = [
    ...new Set(
      rows
        .map((r) => r.master_record_id || r.production_campaigns?.master_record_id)
        .filter(Boolean)
    ),
  ];
  const { data: lookups } = recordIds.length
    ? await supabase.from('v_master_lookup').select('record_id, label').in('record_id', recordIds)
    : { data: [] };
  const labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));

  const mapBoardStatus = (cardStatus) => {
    if (cardStatus === 'COMPLETED') return 'closed';
    if (cardStatus === 'RUNNING' || cardStatus === 'READY' || cardStatus === 'OVERDUE') return 'open';
    return String(cardStatus || 'open').toLowerCase();
  };

  let enriched = rows.map((r) => {
    const camp = r.production_campaigns;
    const committed = toNumber(r.target_quantity);
    const good = toNumber(r.total_good_produced);
    return {
      ...r,
      committed_qty: committed,
      good_qty: good,
      scrap_qty: toNumber(r.total_scrap_produced),
      remaining: Math.max(0, committed - good),
      status: mapBoardStatus(r.status),
      card_status: r.status,
      component_label: labelById[r.master_record_id] || null,
      work_center_name: r.work_centers?.name || null,
      work_center_code: r.work_centers?.code || null,
      efficiency_unlocked: !!r.lot_minted_at,
      campaign: camp
        ? {
            ...camp,
            target_quantity: toNumber(camp.target_quantity),
            good_quantity: toNumber(camp.good_quantity),
            component_label: labelById[camp.master_record_id] || null,
          }
        : null,
      work_center: r.work_centers || null,
      production_campaigns: undefined,
      work_centers: undefined,
    };
  });

  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    enriched = enriched.filter((r) =>
      [
        r.component_label,
        r.card_number,
        r.work_center?.name,
        r.work_center?.code,
        r.status,
        r.campaign?.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }

  return enriched;
}

async function buildCampaignFlowTracking(camp, lots = [], commit = null) {
  const { getVersionById } = require('./activityFlowEngine');
  const { SCHEDULABLE_TYPES, OUTSOURCE_TYPES, TERMINAL_DISPATCH_TYPES } = require('../config/activityFlowTypes');
  const { walkPrimaryPath } = require('./activityFlowRoute');

  let flow = { nodes: [], edges: [] };
  if (camp?.activity_flow_version_id && camp?.master_record_id) {
    const version = await getVersionById(camp.activity_flow_version_id, camp.master_record_id);
    if (version) {
      flow = { nodes: version.nodes || [], edges: version.edges || [] };
    }
  }

  const rawFlowNodes = flow.nodes || [];
  const pathOrdered = walkPrimaryPath(rawFlowNodes, flow.edges || []);
  const onPathIds = new Set(pathOrdered.map((n) => n.id));
  const offPath = rawFlowNodes.filter((n) => !onPathIds.has(n.id));
  const flowNodes = pathOrdered.length ? [...pathOrdered, ...offPath] : rawFlowNodes;
  const pathIndexById = Object.fromEntries(flowNodes.map((n, i) => [n.id, i]));

  const wcIds = [...new Set(flowNodes.map((n) => n.work_center_id).filter(Boolean))];
  const { data: wcs } = wcIds.length
    ? await supabase.from('work_centers').select('id, code, name').in('id', wcIds)
    : { data: [] };
  const wcById = Object.fromEntries((wcs || []).map((w) => [w.id, w]));

  const enrichedFlowNodes = flowNodes.map((n) => {
    const wc = n.work_center_id ? wcById[n.work_center_id] : null;
    return {
      ...n,
      work_center_code: wc?.code || n.work_center_code || null,
      work_center_name: wc?.name || n.work_center_name || null,
    };
  });

  const lotIds = (lots || []).map((l) => l.id).filter(Boolean);
  let lotCompletions = [];
  if (lotIds.length) {
    const { data: locRows } = await supabase
      .from('production_lot_op_completions')
      .select('*')
      .in('production_lot_id', lotIds)
      .order('completed_at', { ascending: true });
    lotCompletions = locRows || [];
  }
  const completionByNode = {};
  for (const c of lotCompletions) {
    if (!c?.activity_flow_node_id) continue;
    const prev = completionByNode[c.activity_flow_node_id];
    if (!prev || String(c.completed_at) > String(prev.completed_at)) {
      completionByNode[c.activity_flow_node_id] = c;
    }
  }

  const activeLots = (lots || []).filter((l) =>
    ['in_process', 'received', 'staged', 'at_supplier', 'ready_for_dispatch', 'quarantine'].includes(
      String(l.status || '')
    )
  );

  let pointerId = null;
  let pointerSeq = null;
  for (const lot of activeLots) {
    const lid = lot.current_activity_flow_node_id || null;
    if (!lid) continue;
    const seq = pathIndexById[lid];
    if (seq == null) continue;
    if (pointerSeq == null || seq > pointerSeq) {
      pointerSeq = seq;
      pointerId = lid;
    }
  }

  const campaignNodeId = camp?.activity_flow_node_id || null;
  const commitClosed = commit && ['closed', 'met'].includes(commit.status);
  const commitGood = toNumber(commit?.good_qty);
  const dayGoal = toNumber(commit?.committed_qty);

  const tracking = enrichedFlowNodes.map((n) => {
    const schedulable = SCHEDULABLE_TYPES.has(n.activity_type);
    const isOutsource = OUTSOURCE_TYPES.has(n.activity_type);
    const pathOp = schedulable || isOutsource;
    const isDispatch = TERMINAL_DISPATCH_TYPES.has(n.activity_type);
    const completion = completionByNode[n.id] || null;
    const seq = pathIndexById[n.id] != null ? pathIndexById[n.id] : Number(n.sequence) || 0;

    let status = 'pending';
    let phase = null;

    if (!pathOp || isDispatch) {
      status = 'info';
      const pastByPointer = pointerSeq != null && seq < pointerSeq;
      if (completion || pastByPointer) phase = 'passed';
      else phase = 'ahead';
    } else if (completion) {
      status = 'done';
    } else if (n.id === campaignNodeId && commitClosed && commitGood > 0) {
      status = 'done';
    } else if (pointerSeq != null && seq < pointerSeq) {
      status = 'done';
    } else if (pointerId && n.id === pointerId) {
      status = 'running';
    } else if (
      n.id === campaignNodeId &&
      commit &&
      !commitClosed &&
      commit.status !== 'closed'
    ) {
      status = 'running';
    } else {
      status = 'pending';
    }

    const goodQty = completion
      ? toNumber(completion.good_qty)
      : n.id === campaignNodeId
        ? commitGood
        : 0;
    const scrapQty = completion
      ? toNumber(completion.scrap_qty)
      : n.id === campaignNodeId
        ? toNumber(commit?.scrap_qty)
        : 0;

    return {
      node_id: n.id,
      label: n.label,
      activity_type: n.activity_type,
      status,
      phase,
      good_qty: goodQty,
      scrap_qty: scrapQty,
      work_center_code: n.work_center_code,
      work_center_name: n.work_center_name,
      efficiency_pct:
        dayGoal > 0 && n.id === campaignNodeId && goodQty > 0
          ? Math.round((goodQty / dayGoal) * 100)
          : null,
      operator_name: completion?.operator_name || null,
      operator_code: completion?.operator_code || null,
    };
  });

  return {
    flow: { nodes: enrichedFlowNodes, edges: flow.edges || [] },
    tracking,
  };
}

async function getCommitmentDetail(commitmentId) {
  if (!isValidUUID(commitmentId)) throw httpError('Invalid id');

  // Campaign daily card tracking
  const { data: card, error: cardErr } = await supabase
    .from('production_cards')
    .select('*')
    .eq('id', commitmentId)
    .maybeSingle();
  if (cardErr) throw cardErr;

  if (card?.campaign_id) {
    const { data: camp } = await supabase
      .from('production_campaigns')
      .select('*')
      .eq('id', card.campaign_id)
      .maybeSingle();
    const enrichedCamp = camp ? (await enrichCampaigns([camp]))[0] : null;

    const { data: coverage } = await supabase
      .from('campaign_schedule_coverage')
      .select('*, delivery_schedules(id, schedule_number, due_date, quantity, status)')
      .eq('campaign_id', card.campaign_id);

    const { data: lots } = await supabase
      .from('production_lots')
      .select('*')
      .or(`campaign_id.eq.${card.campaign_id},production_card_id.eq.${card.id}`)
      .order('created_at', { ascending: false });

    const { data: wc } = await supabase
      .from('work_centers')
      .select('id, name, code, manager_employee_id')
      .eq('id', card.work_center_id)
      .maybeSingle();

    const target = toNumber(card.target_quantity);
    const good = toNumber(card.total_good_produced);
    const commitmentRow = {
      ...card,
      committed_qty: target,
      good_qty: good,
      scrap_qty: toNumber(card.total_scrap_produced),
      remaining: Math.max(0, target - good),
      efficiency_unlocked: !!card.lot_minted_at,
    };

    const { flow, tracking } = camp
      ? await buildCampaignFlowTracking(camp, lots || [], commitmentRow)
      : { flow: { nodes: [], edges: [] }, tracking: [] };

    return {
      commitment: commitmentRow,
      card: commitmentRow,
      campaign: enrichedCamp,
      work_center: wc,
      nodes: flow.nodes || [],
      flow,
      tracking,
      coverage: (coverage || []).map((c) => ({
        ...c,
        schedule_qty: toNumber(c.schedule_qty),
        covered_qty: toNumber(c.covered_qty),
        schedule: c.delivery_schedules || null,
        delivery_schedules: undefined,
      })),
      lots: lots || [],
      redirect_card_id: card.id,
    };
  }

  throw httpError('Production card not found (daily commitments retired)', 404);
}

async function mintLotFromCommitment(
  commitmentId,
  { quantity, scrap_qty: scrapQtySnake, scrapQty } = {},
  actorId,
  { isSupervisor = false } = {}
) {
  if (!isValidUUID(commitmentId)) throw httpError('Invalid id');

  const { data: card } = await supabase
    .from('production_cards')
    .select('*')
    .eq('id', commitmentId)
    .maybeSingle();

  if (card?.campaign_id) {
    await assertWCManager(card.work_center_id, actorId, { isSupervisor });
    const { mintLotFromScheduleCard } = require('./lotTravelerEngine');
    const qty =
      quantity != null
        ? toNumber(quantity)
        : Math.max(0, toNumber(card.total_good_produced));
    return mintLotFromScheduleCard(card, {
      quantity: qty,
      scrapQty: toNumber(scrapQtySnake != null ? scrapQtySnake : scrapQty),
      actorEmployeeId: actorId,
    });
  }

  throw httpError('Daily commitments retired — mint from production cards', 410);
}

/**
 * Campaign Review: current (or specified) horizon wave with ranked campaigns,
 * schedule coverage rollup, daily card rope, and wave KPIs.
 */
async function attachLiveStock(campaigns, wave) {
  if (!campaigns?.length || !wave) return campaigns || [];
  const workingDays = Math.max(1, listWorkingDays(wave.horizon_start, wave.horizon_end).length || 1);
  const out = [];
  for (const c of campaigns) {
    const remaining = Math.max(0, toNumber(c.target_quantity) - toNumber(c.good_quantity));
    const demandQty =
      remaining > 0 ? remaining : toNumber(c.horizon_demand_qty || c.target_quantity);
    const stock = c.master_record_id
      ? await computeRunOutDays({
          masterRecordId: c.master_record_id,
          demandQty,
          horizonWorkingDays: workingDays,
        })
      : { run_out_days: null, fg_stock: 0, wip_stock: 0, avg_daily_demand: 0 };
    const runOut = Number.isFinite(stock.run_out_days) ? stock.run_out_days : null;
    out.push({
      ...c,
      remaining_qty: remaining,
      run_out_days: runOut,
      fg_stock: toNumber(stock.fg_stock),
      wip_stock: toNumber(stock.wip_stock),
      avg_daily_demand: toNumber(stock.avg_daily_demand),
    });
  }
  return out;
}

async function persistCampaignRunOut(campaigns) {
  for (const c of campaigns || []) {
    if (!c?.id) continue;
    const { error } = await supabase
      .from('production_campaigns')
      .update({ run_out_days: c.run_out_days })
      .eq('id', c.id);
    if (error) throw error;
  }
}

async function getWaveReview(workCenterId, { waveId, includeLiveStock = true } = {}) {
  if (!isValidUUID(workCenterId)) throw httpError('Invalid work center id');

  const { data: wc, error: wcErr } = await supabase
    .from('work_centers')
    .select('id, name, code, hours_per_day, horizon_months_default')
    .eq('id', workCenterId)
    .maybeSingle();
  if (wcErr) throw wcErr;
  if (!wc) throw httpError('Work center not found', 404);

  let wave = null;
  if (waveId && isValidUUID(waveId)) {
    const { data, error } = await supabase
      .from('production_horizon_waves')
      .select('*')
      .eq('id', waveId)
      .eq('work_center_id', workCenterId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw httpError('Horizon wave not found', 404);
    wave = data;
  } else {
    const { data: waves, error } = await supabase
      .from('production_horizon_waves')
      .select('*')
      .eq('work_center_id', workCenterId)
      .order('horizon_index', { ascending: false });
    if (error) throw error;
    const list = waves || [];
    wave =
      list.find((w) => w.status === 'in_progress') ||
      list.find((w) => w.status === 'locked') ||
      list[0] ||
      null;
  }

  if (!wave) {
    return {
      work_center: wc,
      wave: null,
      campaigns: [],
      kpis: {
        days_remaining: null,
        demand_total: 0,
        good_total: 0,
        scrap_total: 0,
        pct_complete: 0,
        active_count: 0,
        queued_count: 0,
        completed_count: 0,
        campaign_count: 0,
      },
    };
  }

  const { data: campRows, error: campErr } = await supabase
    .from('production_campaigns')
    .select('*')
    .eq('horizon_wave_id', wave.id)
    .order('demand_rank', { ascending: true })
    .order('queue_sequence', { ascending: true });
  if (campErr) throw campErr;

  const enriched = await enrichCampaigns(campRows || []);
  const campaignIds = enriched.map((c) => c.id).filter(Boolean);

  const [{ data: coverageRows, error: covErr }, { data: cardRows, error: cardErr }] = await Promise.all([
    campaignIds.length
      ? supabase
          .from('campaign_schedule_coverage')
          .select(
            'id, campaign_id, delivery_schedule_id, schedule_qty, covered_qty, delivery_schedules(id, schedule_number, due_date, quantity, status)'
          )
          .in('campaign_id', campaignIds)
      : Promise.resolve({ data: [], error: null }),
    campaignIds.length
      ? supabase
          .from('production_cards')
          .select(
            'id, campaign_id, day_index, work_date, target_quantity, total_good_produced, total_scrap_produced, status, lot_minted_at, card_number'
          )
          .in('campaign_id', campaignIds)
          .order('day_index', { ascending: true })
          .order('work_date', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (covErr) throw covErr;
  if (cardErr) throw cardErr;

  const coverageByCamp = new Map();
  for (const row of coverageRows || []) {
    if (!coverageByCamp.has(row.campaign_id)) coverageByCamp.set(row.campaign_id, []);
    coverageByCamp.get(row.campaign_id).push(row);
  }
  const cardsByCamp = new Map();
  for (const row of cardRows || []) {
    if (!cardsByCamp.has(row.campaign_id)) cardsByCamp.set(row.campaign_id, []);
    cardsByCamp.get(row.campaign_id).push(row);
  }

  const today = todayDateString();
  const daysRemaining =
    wave.horizon_end && wave.horizon_end >= today
      ? listWorkingDays(today, wave.horizon_end).length
      : wave.horizon_end
        ? 0
        : null;

  let campaigns = enriched.map((c) => {
    const target = toNumber(c.target_quantity);
    const good = toNumber(c.good_quantity);
    const scrap = toNumber(c.scrap_quantity);
    const cov = coverageByCamp.get(c.id) || [];
    const scheduleQty = cov.reduce((s, r) => s + toNumber(r.schedule_qty), 0);
    const coveredQty = cov.reduce((s, r) => s + toNumber(r.covered_qty), 0);
    const schedules = cov
      .map((r) => {
        const sched = r.delivery_schedules || {};
        const sq = toNumber(r.schedule_qty);
        const cq = toNumber(r.covered_qty);
        return {
          id: r.id,
          delivery_schedule_id: r.delivery_schedule_id,
          schedule_number: sched.schedule_number || null,
          due_date: sched.due_date || null,
          schedule_qty: sq,
          covered_qty: cq,
          remaining_qty: Math.max(0, sq - cq),
          status: sched.status || null,
          at_risk: !!sched.due_date && sched.due_date <= today && cq < sq,
        };
      })
      .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));

    const cards = (cardsByCamp.get(c.id) || []).map((card) => ({
      id: card.id,
      card_number: card.card_number || null,
      day_index: card.day_index,
      work_date: card.work_date,
      target_quantity: toNumber(card.target_quantity),
      total_good_produced: toNumber(card.total_good_produced),
      total_scrap_produced: toNumber(card.total_scrap_produced),
      status: card.status,
      lot_minted_at: card.lot_minted_at || null,
    }));
    const openCards = cards.filter((card) => card.status !== 'COMPLETED');
    const lastCard = cards.length ? cards[cards.length - 1] : null;
    const nextOpen = openCards[0] || null;

    return {
      ...c,
      pct_complete: target > 0 ? Math.round((good / target) * 1000) / 10 : 0,
      coverage: {
        schedule_count: schedules.length,
        schedule_qty: scheduleQty,
        covered_qty: coveredQty,
        pct_covered: scheduleQty > 0 ? Math.round((coveredQty / scheduleQty) * 1000) / 10 : 0,
        schedules,
      },
      cards,
      rope_end_date: lastCard?.work_date || null,
      next_card_date: nextOpen?.work_date || null,
      open_card_count: openCards.length,
      card_count: cards.length,
      estimated_hours: c.estimated_hours != null ? toNumber(c.estimated_hours) : null,
      production_days: c.production_days != null ? toNumber(c.production_days) : null,
      run_time_per_unit_minutes:
        c.run_time_per_unit_minutes != null ? toNumber(c.run_time_per_unit_minutes) : null,
      setup_time_minutes: c.setup_time_minutes != null ? toNumber(c.setup_time_minutes) : null,
      started_at: c.started_at || null,
      completed_at: c.completed_at || null,
    };
  });

  if (includeLiveStock) {
    campaigns = await attachLiveStock(campaigns, wave);
  }

  const demandTotal = campaigns.reduce(
    (s, c) => s + toNumber(c.horizon_demand_qty || c.target_quantity),
    0
  );
  const goodTotal = campaigns.reduce((s, c) => s + toNumber(c.good_quantity), 0);
  const scrapTotal = campaigns.reduce((s, c) => s + toNumber(c.scrap_quantity), 0);
  const targetTotal = campaigns.reduce((s, c) => s + toNumber(c.target_quantity), 0);

  return {
    work_center: wc,
    wave: {
      ...wave,
      days_remaining: daysRemaining,
    },
    campaigns,
    kpis: {
      days_remaining: daysRemaining,
      demand_total: demandTotal,
      good_total: goodTotal,
      scrap_total: scrapTotal,
      target_total: targetTotal,
      pct_complete: targetTotal > 0 ? Math.round((goodTotal / targetTotal) * 1000) / 10 : 0,
      active_count: campaigns.filter((c) => c.status === 'active').length,
      queued_count: campaigns.filter((c) => c.status === 'queued').length,
      completed_count: campaigns.filter((c) => c.status === 'completed').length,
      campaign_count: campaigns.length,
    },
  };
}

/** Recompute FG/WIP + run-out for wave campaigns; persist run_out_days. Does not change ranks. */
async function refreshWaveStock(workCenterId, { waveId } = {}) {
  const review = await getWaveReview(workCenterId, { waveId, includeLiveStock: true });
  if (!review.wave) return review;
  await persistCampaignRunOut(review.campaigns);
  return review;
}

/**
 * Refresh stock then re-sequence queued campaigns only.
 * Active campaign stays active with its current demand_rank / queue_sequence.
 */
async function rerankWaveQueue(workCenterId, { waveId } = {}) {
  const review = await refreshWaveStock(workCenterId, { waveId });
  if (!review.wave) return review;

  const campaigns = review.campaigns || [];
  const active = campaigns.filter((c) => c.status === 'active');
  const queued = campaigns.filter((c) => c.status === 'queued');
  if (!queued.length) {
    return { ...review, reranked: false, message: 'No queued campaigns to re-rank' };
  }

  const scored = finalizeCampaignPriorityScores(
    queued.map((c) => ({
      ...c,
      demand_qty:
        toNumber(c.remaining_qty) > 0
          ? toNumber(c.remaining_qty)
          : toNumber(c.horizon_demand_qty || c.target_quantity),
      production_days: c.production_days,
      run_out_days: c.run_out_days,
    }))
  );

  let nextRank = active.reduce((m, a) => Math.max(m, Number(a.demand_rank) || 0), 0) + 1;
  if (!(nextRank >= 1)) nextRank = 1;
  let nextSeq = active.reduce((m, a) => Math.max(m, Number(a.queue_sequence) || 0), 0) + 1;
  if (!(nextSeq >= 1)) nextSeq = 1;

  for (const c of scored) {
    const { error } = await supabase
      .from('production_campaigns')
      .update({
        demand_rank: nextRank++,
        queue_sequence: nextSeq++,
        priority_score: c.priority_score,
        run_out_days: Number.isFinite(Number(c.run_out_days)) ? Number(c.run_out_days) : null,
      })
      .eq('id', c.id)
      .eq('status', 'queued');
    if (error) throw error;
  }

  const refreshed = await getWaveReview(workCenterId, { waveId, includeLiveStock: true });
  return { ...refreshed, reranked: true };
}

module.exports = {
  previewHorizonWave,
  lockHorizonWave,
  listWaves,
  getWCCommand,
  postCommitmentProgress,
  closeCommitment,
  upsertWorkerEfficiency,
  getCoverageCalendar,
  listCommitmentTemplates,
  saveCommitmentTemplate,
  updateCommitmentQty,
  aggregateHorizonDemand,
  enrichCampaigns,
  assertWCManager,
  completeCampaignIfDone,
  allocateCoverage,
  runMutualProtectionChecks,
  listCommitments,
  getCommitmentDetail,
  listManagedWorkCenters,
  mintLotFromCommitment,
  bulkReleaseSchedules,
  generateCampaignDailyCards,
  getWaveReview,
  refreshWaveStock,
  rerankWaveQueue,
};
