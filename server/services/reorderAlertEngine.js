/**
 * Reorder level (ROL) purchase alerts — P1 admin notifications for RM and tools.
 */

const { createClient } = require('@supabase/supabase-js');
const { ensureNotification } = require('./notificationStore');
const { loadProcurementMetaForMaster } = require('./masterFieldEngine');
const {
  loadOnHandByMasterRecordId,
  getActiveCampaignRmRequirements,
  getActiveCampaignToolRequirements,
} = require('./materialRequirementsEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MASTER_CONFIG = [
  { masterSlug: 'raw-material', itemCategory: 'raw_material', isRawMaterial: true },
  { masterSlug: 'tool', itemCategory: 'tool', isRawMaterial: false },
];

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 10000) / 10000;
}

function computeSuggestedOrderQty({ isRawMaterial, campaignReq, moq, reorderLevel, onHand }) {
  const campaign = Math.max(0, toNumber(campaignReq));
  const minimumOrder = Math.max(0, toNumber(moq));
  const replenish = Math.max(0, toNumber(reorderLevel) - toNumber(onHand));

  if (isRawMaterial) {
    const primary = Math.max(campaign, minimumOrder);
    if (primary > 0) return roundQty(primary);
    return roundQty(Math.max(minimumOrder, replenish));
  }

  return roundQty(Math.max(minimumOrder, replenish));
}

async function dismissReorderNotification(itemCategory, masterRecordId) {
  const dedupeKey = `inv:reorder:${itemCategory}:${masterRecordId}`;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('notifications')
    .update({ status: 'dismissed', dismissed_at: now })
    .eq('dedupe_key', dedupeKey)
    .in('status', ['unread', 'read']);
  if (error) throw error;
}

async function evaluateReorderAlertsForMaster({
  masterSlug,
  itemCategory,
  isRawMaterial,
  campaignMap,
}) {
  const metaRows = await loadProcurementMetaForMaster(masterSlug);
  const onHandMap = await loadOnHandByMasterRecordId(itemCategory);

  let created = 0;
  let dismissed = 0;
  let checked = 0;

  for (const row of metaRows) {
    const rol = toNumber(row.reorderLevel);
    if (rol <= 0) continue;

    checked += 1;
    const stock = onHandMap.get(row.recordId) || { onHand: 0, unit: null };
    const onHand = stock.onHand;
    const unit = stock.unit || (isRawMaterial ? 'kg' : 'ea');

    if (onHand > rol) {
      await dismissReorderNotification(itemCategory, row.recordId);
      dismissed += 1;
      continue;
    }

    const campaignReq = campaignMap.get(row.recordId) || 0;
    const moq = toNumber(row.moq);
    const suggestedQty = computeSuggestedOrderQty({
      isRawMaterial,
      campaignReq,
      moq,
      reorderLevel: rol,
      onHand,
    });

    const itemLabel = isRawMaterial ? 'raw material' : 'tool';
    const moqNote = moq > 0 ? ` (MOQ ${moq})` : '';
    const campaignNote =
      campaignReq > 0 ? ` Campaign need ${campaignReq}.` : '';

    const result = await ensureNotification({
      audience: 'admin',
      category: 'inventory',
      type: 'reorder_purchase_required',
      severity: 'critical',
      priority: 1,
      title: `Purchase ${itemLabel} required`,
      body: `${row.label}: on hand ${onHand} ${unit}, ROL ${rol}.${campaignNote} Suggest order ${suggestedQty}${moqNote}.`,
      dedupe_key: `inv:reorder:${itemCategory}:${row.recordId}`,
      payload: {
        master_record_id: row.recordId,
        item_category: itemCategory,
        master_slug: masterSlug,
        label: row.label,
        on_hand_qty: onHand,
        reorder_level: rol,
        campaign_requirement: campaignReq,
        moq,
        suggested_order_qty: suggestedQty,
        unit,
      },
    });
    if (result.created) created += 1;
  }

  return { created, dismissed, checked };
}

async function evaluateReorderAlerts() {
  const [campaignRmMap, campaignToolMap] = await Promise.all([
    getActiveCampaignRmRequirements(),
    getActiveCampaignToolRequirements(),
  ]);

  let totalCreated = 0;
  let totalDismissed = 0;
  let totalChecked = 0;
  const byMaster = {};

  for (const cfg of MASTER_CONFIG) {
    const campaignMap = cfg.isRawMaterial ? campaignRmMap : campaignToolMap;
    const result = await evaluateReorderAlertsForMaster({
      masterSlug: cfg.masterSlug,
      itemCategory: cfg.itemCategory,
      isRawMaterial: cfg.isRawMaterial,
      campaignMap,
    });
    byMaster[cfg.masterSlug] = result;
    totalCreated += result.created;
    totalDismissed += result.dismissed;
    totalChecked += result.checked;
  }

  return {
    ok: true,
    created: {
      reorder_purchase_required: totalCreated,
      total: totalCreated,
    },
    dismissed: totalDismissed,
    checked: totalChecked,
    by_master: byMaster,
    evaluated_at: new Date().toISOString(),
  };
}

function triggerReorderAlertEvaluation() {
  evaluateReorderAlerts().catch((err) => {
    console.error('Reorder alert evaluation failed:', err.message || err);
  });
}

module.exports = {
  evaluateReorderAlerts,
  dismissReorderNotification,
  computeSuggestedOrderQty,
  triggerReorderAlertEvaluation,
};
