/**
 * Material requirements from active campaigns and on-hand stock lookups.
 */

const { createClient } = require('@supabase/supabase-js');
const { getActiveBomVersionId } = require('./blanketPosEngine');
const { loadBomEdges, enrichEdges } = require('./bomEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 10000) / 10000;
}

/**
 * Sum unlotted on-hand stock for one master record.
 */
async function sumOnHandStock(itemCategory, masterRecordId) {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('current_stock')
    .eq('item_category', itemCategory)
    .eq('master_record_id', masterRecordId)
    .is('lot_number', null);
  if (error) throw error;
  return roundQty((data || []).reduce((sum, row) => sum + toNumber(row.current_stock), 0));
}

/**
 * Bulk on-hand for all unlotted rows in a category.
 * @returns {Map<string, { onHand: number, unit: string|null }>}
 */
async function loadOnHandByMasterRecordId(itemCategory) {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('master_record_id, current_stock, unit')
    .eq('item_category', itemCategory)
    .is('lot_number', null);
  if (error) throw error;

  const map = new Map();
  for (const row of data || []) {
    const id = row.master_record_id;
    if (!id) continue;
    const prev = map.get(id) || { onHand: 0, unit: row.unit || null };
    prev.onHand = roundQty(prev.onHand + toNumber(row.current_stock));
    if (!prev.unit && row.unit) prev.unit = row.unit;
    map.set(id, prev);
  }
  return map;
}

/**
 * Direct BOM RM requirements for all active campaigns (matches backflush scope).
 * @returns {Promise<Map<string, number>>} rmMasterRecordId -> required qty
 */
async function getActiveCampaignRmRequirements() {
  const { data: campaigns, error } = await supabase
    .from('production_campaigns')
    .select('id, master_record_id, target_quantity, good_quantity')
    .eq('status', 'active');
  if (error) throw error;

  const required = new Map();
  const bomCache = {};

  for (const camp of campaigns || []) {
    const componentId = camp.master_record_id;
    if (!componentId) continue;

    const remaining = Math.max(0, toNumber(camp.target_quantity) - toNumber(camp.good_quantity));
    if (remaining <= 0) continue;

    if (!(componentId in bomCache)) {
      bomCache[componentId] = await getActiveBomVersionId(componentId);
    }
    const bomVersionId = bomCache[componentId];
    if (!bomVersionId) continue;

    const rawEdges = await loadBomEdges(bomVersionId);
    const edges = await enrichEdges(rawEdges);
    const rmEdges = (edges || []).filter(
      (e) => e.child_slug === 'raw-material' && e.parent_element_id === componentId
    );

    for (const edge of rmEdges) {
      const need = roundQty(toNumber(edge.quantity) * remaining);
      if (need <= 0) continue;
      required.set(edge.child_element_id, roundQty((required.get(edge.child_element_id) || 0) + need));
    }
  }

  return required;
}

/** Placeholder until tool BOM consumption is implemented. */
async function getActiveCampaignToolRequirements() {
  return new Map();
}

module.exports = {
  sumOnHandStock,
  loadOnHandByMasterRecordId,
  getActiveCampaignRmRequirements,
  getActiveCampaignToolRequirements,
};
