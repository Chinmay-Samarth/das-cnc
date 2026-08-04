/**
 * TOC / DBR Heuristic Horizon Prioritization
 * Run-Out Time (days) = (FG + WIP) / Avg daily customer demand
 * Priority Score = w1*(1/RunOut) + w2*(campaign duration days) + w3*(demand volume)
 */

const { createClient } = require('@supabase/supabase-js');
const { listWorkingDays, toNumber } = require('./productionCapacityEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WEIGHTS = {
  runOut: 0.5,
  campaignDays: 0.2,
  demandVolume: 0.3,
};

/** Safety buffer (working days) before a starved component's due date. */
const SAFETY_BUFFER_DAYS = 5;

async function sumFgStock(masterRecordId) {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('current_stock')
    .eq('item_category', 'component')
    .eq('master_record_id', masterRecordId);
  if (error) throw error;
  return (data || []).reduce((s, r) => s + toNumber(r.current_stock), 0);
}

async function sumWipStock(masterRecordId) {
  const { data: lots, error } = await supabase
    .from('production_lots')
    .select('quantity, status')
    .eq('master_record_id', masterRecordId)
    .in('status', ['in_process', 'staged', 'at_supplier', 'received']);
  if (error) throw error;
  const lotQty = (lots || []).reduce((s, l) => s + toNumber(l.quantity), 0);

  const { data: unfinished, error: uErr } = await supabase
    .from('inventory_stock')
    .select('current_stock')
    .eq('item_category', 'unfinished_lot')
    .eq('master_record_id', masterRecordId);
  if (uErr) throw uErr;
  // Prefer unfinished inventory if present; otherwise lot qty is WIP
  const unfinishedQty = (unfinished || []).reduce((s, r) => s + toNumber(r.current_stock), 0);
  return unfinishedQty > 0 ? unfinishedQty : lotQty;
}

/**
 * Run-out days for a component given horizon demand.
 */
async function computeRunOutDays({ masterRecordId, demandQty, horizonWorkingDays }) {
  const fg = await sumFgStock(masterRecordId);
  const wip = await sumWipStock(masterRecordId);
  const days = Math.max(1, toNumber(horizonWorkingDays) || 1);
  const avgDailyDemand = toNumber(demandQty) / days;
  if (!(avgDailyDemand > 0)) {
    return {
      run_out_days: Number.POSITIVE_INFINITY,
      fg_stock: fg,
      wip_stock: wip,
      avg_daily_demand: 0,
    };
  }
  const runOut = (fg + wip) / avgDailyDemand;
  return {
    run_out_days: Math.round(runOut * 10000) / 10000,
    fg_stock: fg,
    wip_stock: wip,
    avg_daily_demand: Math.round(avgDailyDemand * 10000) / 10000,
  };
}

function computePriorityScore({ runOutDays, productionDays, demandQty, maxDemand }) {
  const runOut = Number.isFinite(runOutDays) && runOutDays > 0 ? runOutDays : 9999;
  const invRunOut = 1 / runOut;
  const durationNorm = Math.max(0, toNumber(productionDays));
  const demandNorm = maxDemand > 0 ? toNumber(demandQty) / maxDemand : 0;
  const score =
    WEIGHTS.runOut * invRunOut +
    WEIGHTS.campaignDays * (durationNorm / 100) +
    WEIGHTS.demandVolume * demandNorm;
  return Math.round(score * 1e6) / 1e6;
}

/**
 * Enrich demand rows with run-out + priority and sort (highest priority first).
 */
async function rankHorizonDemand(demandRows, { horizonStart, horizonEnd } = {}) {
  const workingDays = listWorkingDays(horizonStart, horizonEnd).length || 1;
  const maxDemand = Math.max(1, ...demandRows.map((r) => toNumber(r.demand_qty)));

  const enriched = [];
  for (const row of demandRows) {
    const runOut = await computeRunOutDays({
      masterRecordId: row.master_record_id,
      demandQty: row.demand_qty,
      horizonWorkingDays: workingDays,
    });
    enriched.push({
      ...row,
      ...runOut,
      priority_score: null, // filled after capacity days known, or provisional
      provisional_priority: computePriorityScore({
        runOutDays: runOut.run_out_days,
        productionDays: 0,
        demandQty: row.demand_qty,
        maxDemand,
      }),
    });
  }

  enriched.sort((a, b) => {
    if (b.provisional_priority !== a.provisional_priority) {
      return b.provisional_priority - a.provisional_priority;
    }
    if (a.run_out_days !== b.run_out_days) return a.run_out_days - b.run_out_days;
    if (b.demand_qty !== a.demand_qty) return b.demand_qty - a.demand_qty;
    return String(a.earliest_due || '').localeCompare(String(b.earliest_due || ''));
  });

  return enriched.map((r, i) => ({
    ...r,
    demand_rank: i + 1,
  }));
}

/**
 * Finalize priority scores once capacity.productionDays is known; re-sequence.
 */
function finalizeCampaignPriorityScores(campaigns) {
  const maxDemand = Math.max(1, ...campaigns.map((c) => toNumber(c.demand_qty || c.target_quantity)));
  const scored = campaigns.map((c) => {
    const days = c.capacity?.productionDays || c.production_days || 0;
    const score = computePriorityScore({
      runOutDays: c.run_out_days,
      productionDays: days,
      demandQty: c.demand_qty || c.target_quantity,
      maxDemand,
    });
    return { ...c, priority_score: score, production_days: days };
  });

  scored.sort((a, b) => {
    if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;
    if (a.run_out_days !== b.run_out_days) return a.run_out_days - b.run_out_days;
    return (a.demand_rank || 0) - (b.demand_rank || 0);
  });

  return scored.map((c, i) => ({
    ...c,
    demand_rank: i + 1,
  }));
}

module.exports = {
  WEIGHTS,
  SAFETY_BUFFER_DAYS,
  computeRunOutDays,
  computePriorityScore,
  rankHorizonDemand,
  finalizeCampaignPriorityScores,
  sumFgStock,
  sumWipStock,
};
