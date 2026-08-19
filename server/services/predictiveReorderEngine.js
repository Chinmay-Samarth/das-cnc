const { createClient } = require('@supabase/supabase-js');
const { ensureNotification } = require('./notificationStore');
const {
  loadProcurementMetaForMaster,
  loadSupplierIdForMasterRecord,
  computeOrderQtyWithMoq,
} = require('./masterFieldEngine');
const {
  getActiveCampaignRmRequirements,
  loadOnHandByMasterRecordId,
} = require('./materialRequirementsEngine');
const { listToolInstances } = require('./toolLifeEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DEFAULTS = {
  rmSafetyBuffer: 2,
  toolLifeThresholdPct: 20,
  toolSafetyBuffer: 2,
  lookbackDays: 7,
};

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 10000) / 10000;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + toNumber(days));
  return d.toISOString().slice(0, 10);
}

async function loadSettings() {
  const { data } = await supabase.from('notification_settings').select('*').limit(1).maybeSingle();
  return {
    rmSafetyBuffer: data?.predictive_rm_safety_buffer_days ?? DEFAULTS.rmSafetyBuffer,
    toolLifeThresholdPct: data?.predictive_tool_life_threshold_pct ?? DEFAULTS.toolLifeThresholdPct,
    toolSafetyBuffer: data?.predictive_tool_safety_buffer_days ?? DEFAULTS.toolSafetyBuffer,
    lookbackDays: data?.predictive_consumption_lookback_days ?? DEFAULTS.lookbackDays,
  };
}

async function hasOpenPoForItem(masterRecordId) {
  const { data: lines, error } = await supabase
    .from('purchase_order_lines')
    .select('purchase_order_id, quantity, received_qty')
    .eq('master_record_id', masterRecordId);
  if (error || !lines?.length) return false;

  const poIds = [...new Set(lines.map((l) => l.purchase_order_id))];
  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('id, status')
    .in('id', poIds)
    .in('status', ['draft', 'due']);
  const openPoIds = new Set((pos || []).map((p) => p.id));

  return lines.some(
    (l) =>
      openPoIds.has(l.purchase_order_id) &&
      toNumber(l.quantity) - toNumber(l.received_qty) > 0
  );
}

async function dismissPredictiveNotification(itemCategory, masterRecordId) {
  const dedupeKey = `inv:predictive:${itemCategory}:${masterRecordId}`;
  await supabase
    .from('notifications')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('dedupe_key', dedupeKey)
    .in('status', ['unread', 'read']);
}

async function estimateRemainingCampaignDays() {
  const { data: campaigns } = await supabase
    .from('production_campaigns')
    .select('id, target_quantity, good_quantity')
    .eq('status', 'active');
  if (!(campaigns || []).length) return 14;

  let maxRemaining = 0;
  for (const c of campaigns) {
    const remaining = Math.max(0, toNumber(c.target_quantity) - toNumber(c.good_quantity));
    const { data: cards } = await supabase
      .from('production_cards')
      .select('target_quantity, good_quantity')
      .eq('production_campaign_id', c.id)
      .in('status', ['planned', 'in_progress', 'running']);
    const cardRemaining = (cards || []).reduce(
      (s, card) => s + Math.max(0, toNumber(card.target_quantity) - toNumber(card.good_quantity)),
      0
    );
    const useRemaining = cardRemaining > 0 ? cardRemaining : remaining;
    const { data: rateCards } = await supabase
      .from('production_cards')
      .select('target_quantity')
      .eq('production_campaign_id', c.id)
      .gte('scheduled_date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
    const weeklyQty = (rateCards || []).reduce((s, card) => s + toNumber(card.target_quantity), 0);
    const dailyRate = weeklyQty > 0 ? weeklyQty / 7 : useRemaining / 14;
    if (dailyRate > 0) {
      maxRemaining = Math.max(maxRemaining, useRemaining / dailyRate);
    }
  }
  return Math.max(1, Math.ceil(maxRemaining || 14));
}

async function evaluateRmPredictive(settings) {
  const [campaignMap, onHandMap, metaRows, remainingDays] = await Promise.all([
    getActiveCampaignRmRequirements(),
    loadOnHandByMasterRecordId('raw_material'),
    loadProcurementMetaForMaster('raw-material'),
    estimateRemainingCampaignDays(),
  ]);

  const metaById = Object.fromEntries(metaRows.map((m) => [m.recordId, m]));
  let created = 0;

  for (const [recordId, campaignReq] of campaignMap.entries()) {
    const meta = metaById[recordId] || {};
    const stock = onHandMap.get(recordId) || { onHand: 0, unit: 'kg' };
    const onHand = stock.onHand;
    const dailyConsumption = toNumber(campaignReq) / remainingDays;
    if (dailyConsumption <= 0) {
      await dismissPredictiveNotification('raw_material', recordId);
      continue;
    }

    const daysUntilStockout = onHand / dailyConsumption;
    const supplierId = await loadSupplierIdForMasterRecord(recordId, 'raw-material');
    let leadTime = 7;
    if (supplierId) {
      const { data: sup } = await supabase
        .from('suppliers')
        .select('lead_time_days')
        .eq('id', supplierId)
        .maybeSingle();
      leadTime = sup?.lead_time_days ?? 7;
    }

    const buffer = settings.rmSafetyBuffer;
    if (daysUntilStockout > leadTime + buffer) {
      await dismissPredictiveNotification('raw_material', recordId);
      continue;
    }

    if (await hasOpenPoForItem(recordId)) {
      await dismissPredictiveNotification('raw_material', recordId);
      continue;
    }

    const netNeed = Math.max(0, toNumber(campaignReq) - onHand);
    const moq = toNumber(meta.moq);
    const suggestedQty = computeOrderQtyWithMoq({
      netNeed,
      moq,
      reorderLevel: meta.reorderLevel,
      onHand,
      isRawMaterial: true,
    });

    const stockoutDate = addDays(new Date().toISOString().slice(0, 10), Math.floor(daysUntilStockout));
    const result = await ensureNotification({
      audience: 'admin',
      category: 'inventory',
      type: 'predictive_reorder',
      severity: 'critical',
      priority: 1,
      title: 'Predictive RM reorder',
      body: `${meta.label || recordId}: stockout in ~${Math.floor(daysUntilStockout)} days. Lead time ${leadTime}d. Order ${suggestedQty} ${stock.unit || 'kg'}.`,
      dedupe_key: `inv:predictive:raw_material:${recordId}`,
      payload: {
        master_record_id: recordId,
        item_category: 'raw_material',
        master_slug: 'raw-material',
        label: meta.label,
        on_hand_qty: onHand,
        days_until_stockout: roundQty(daysUntilStockout),
        lead_time_days: leadTime,
        suggested_order_qty: suggestedQty,
        moq,
        campaign_requirement: netNeed,
        unit: stock.unit || 'kg',
        predicted_stockout_date: stockoutDate,
        trigger_reason: daysUntilStockout <= leadTime ? 'lead_time_buffer' : 'run_out',
      },
    });
    if (result.created) created += 1;
  }

  return created;
}

async function evaluateToolPredictive(settings) {
  const instances = await listToolInstances({ status: 'active' });
  const lowLife = await listToolInstances({ status: 'low_life' });
  const all = [...instances, ...lowLife];
  let created = 0;

  for (const inst of all) {
    const pct =
      inst.life_total > 0
        ? (toNumber(inst.life_remaining) / toNumber(inst.life_total)) * 100
        : 100;
    const threshold = settings.toolLifeThresholdPct;

    const supplierId = await loadSupplierIdForMasterRecord(inst.master_record_id, 'tool');
    let leadTime = 7;
    if (supplierId) {
      const { data: sup } = await supabase
        .from('suppliers')
        .select('lead_time_days')
        .eq('id', supplierId)
        .maybeSingle();
      leadTime = sup?.lead_time_days ?? 7;
    }

    const { data: ledger } = await supabase
      .from('tool_life_ledger')
      .select('change_qty, created_at')
      .eq('tool_instance_id', inst.id)
      .gte('created_at', new Date(Date.now() - settings.lookbackDays * 86400000).toISOString())
      .order('created_at');

    const consumed = (ledger || []).reduce((s, e) => s + Math.abs(Math.min(0, toNumber(e.change_qty))), 0);
    const dailyConsumption = consumed / Math.max(1, settings.lookbackDays);
    const daysUntilLifeOut =
      dailyConsumption > 0 ? toNumber(inst.life_remaining) / dailyConsumption : Infinity;

    const lifeThresholdHit = pct <= threshold;
    const leadTimeHit = daysUntilLifeOut <= leadTime + settings.toolSafetyBuffer;

    if (!lifeThresholdHit && !leadTimeHit) {
      await dismissPredictiveNotification('tool', inst.master_record_id);
      continue;
    }

    if (await hasOpenPoForItem(inst.master_record_id)) {
      await dismissPredictiveNotification('tool', inst.master_record_id);
      continue;
    }

    const { data: meta } = await supabase
      .from('v_master_lookup')
      .select('label')
      .eq('record_id', inst.master_record_id)
      .maybeSingle();

    const metaRows = await loadProcurementMetaForMaster('tool');
    const toolMeta = metaRows.find((m) => m.recordId === inst.master_record_id) || {};

    const result = await ensureNotification({
      audience: 'admin',
      category: 'inventory',
      type: 'predictive_reorder',
      severity: 'critical',
      priority: 1,
      title: 'Predictive tool reorder',
      body: `${meta?.label || inst.serial_number}: ${Math.round(pct)}% life left${Number.isFinite(daysUntilLifeOut) ? `, ~${Math.floor(daysUntilLifeOut)} days remaining` : ''}. Lead time ${leadTime}d.`,
      dedupe_key: `inv:predictive:tool:${inst.master_record_id}`,
      payload: {
        master_record_id: inst.master_record_id,
        item_category: 'tool',
        master_slug: 'tool',
        label: meta?.label,
        tool_instance_id: inst.id,
        life_remaining: inst.life_remaining,
        life_total: inst.life_total,
        days_until_life_out: Number.isFinite(daysUntilLifeOut) ? roundQty(daysUntilLifeOut) : null,
        lead_time_days: leadTime,
        suggested_order_qty: Math.max(1, toNumber(toolMeta.moq) || 1),
        moq: toNumber(toolMeta.moq),
        unit: 'ea',
        trigger_reason: lifeThresholdHit ? 'life_threshold' : 'lead_time_buffer',
      },
    });
    if (result.created) created += 1;
  }

  return created;
}

async function evaluatePredictiveReorder() {
  const settings = await loadSettings();
  const [rmCreated, toolCreated] = await Promise.all([
    evaluateRmPredictive(settings),
    evaluateToolPredictive(settings),
  ]);
  return {
    ok: true,
    created: { predictive_reorder: rmCreated + toolCreated, rm: rmCreated, tool: toolCreated },
    evaluated_at: new Date().toISOString(),
  };
}

function triggerPredictiveReorderEvaluation() {
  evaluatePredictiveReorder().catch((err) => {
    console.error('Predictive reorder evaluation failed:', err.message || err);
  });
}

module.exports = {
  evaluatePredictiveReorder,
  triggerPredictiveReorderEvaluation,
};
