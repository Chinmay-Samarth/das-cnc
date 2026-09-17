/**
 * Shared GIRN approval (manual review + auto after inspection pass).
 */

const { createClient } = require('@supabase/supabase-js');
const { applyStockForGirn, rollbackStock } = require('./girnStockEngine');
const { validateGirnInspection } = require('./girnInspectionEngine');
const { assignLotToGirnItem } = require('./componentLotEngine');
const {
  dismissGirnReadyNotification,
  notifyGirnApproved,
  loadInspectionsForItems,
} = require('./girnApprovalEngine');
const { emitGirnUpdated, emitInventoryUpdated } = require('../socket/emitter');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function postGirnApprovedHooks(girnId) {
  const { rollupReceivedQtyFromGirn } = require('./purchaseOrderEngine');
  const { seedToolInstancesFromGirn } = require('./toolLifeEngine');
  const { triggerPredictiveReorderEvaluation } = require('./predictiveReorderEngine');

  await rollupReceivedQtyFromGirn(girnId);
  await seedToolInstancesFromGirn(girnId).catch((e) =>
    console.error('Tool instance seed failed:', e.message)
  );
  triggerPredictiveReorderEvaluation();
}

/**
 * Approve a pending_inspection GIRN after inspections are complete.
 * @param {{ girnId: string, approvedBy?: string|null, auto?: boolean }} opts
 */
async function approvePendingGirn({ girnId, approvedBy = null, auto = false } = {}) {
  let stockUpdates = [];
  let ledgerIds = [];

  try {
    const { data: girn, error: girnError } = await supabase
      .from('girns')
      .select('id, status, source, girn_number')
      .eq('id', girnId)
      .maybeSingle();

    if (girnError) throw girnError;
    if (!girn) {
      const err = new Error('GIRN not found');
      err.status = 404;
      throw err;
    }
    if (girn.status !== 'pending_inspection') {
      const err = new Error('Only GIRNs pending inspection can be approved');
      err.status = 409;
      throw err;
    }

    const { data: items, error: itemsError } = await supabase
      .from('girn_items')
      .select('*')
      .eq('girn_id', girnId);

    if (itemsError) throw itemsError;

    const itemIds = (items || []).map((i) => i.id);
    const inspectionsByItem = await loadInspectionsForItems(itemIds);

    const itemsWithInspections = (items || []).map((item) => ({
      ...item,
      inspection: inspectionsByItem[item.id] || null,
    }));

    const inspectionError = await validateGirnInspection(itemsWithInspections);
    if (inspectionError) {
      const err = new Error(inspectionError);
      err.status = 400;
      throw err;
    }

    for (const item of itemsWithInspections) {
      if (
        item.item_category === 'component' &&
        !item.lot_number &&
        item.master_record_id &&
        item.inspection?.overall_result === 'pass'
      ) {
        await assignLotToGirnItem(item.id, item.master_record_id);
        const { data: refreshed } = await supabase
          .from('girn_items')
          .select('lot_number')
          .eq('id', item.id)
          .single();
        item.lot_number = refreshed?.lot_number || item.lot_number;
      }
    }

    const skipStock = girn.source === 'outsource_return';
    if (!skipStock) {
      const stockResult = await applyStockForGirn(girnId, itemsWithInspections);
      stockUpdates = stockResult.stockUpdates;
      ledgerIds = stockResult.ledgerIds;
    }

    const now = new Date().toISOString();
    const { data: approved, error: approveError } = await supabase
      .from('girns')
      .update({
        status: 'approved',
        approved_by: approvedBy || null,
        approved_at: now,
        rejected_by: null,
        rejected_at: null,
      })
      .eq('id', girnId)
      .select()
      .single();

    if (approveError) throw approveError;

    await dismissGirnReadyNotification(girnId).catch((e) =>
      console.error('Dismiss GIRN ready notification failed:', e.message)
    );

    emitGirnUpdated({
      girnId,
      action: auto ? 'auto_approved' : 'approved',
      status: 'approved',
    });
    if (!skipStock) {
      emitInventoryUpdated({ action: 'girn_approved', girnId });
    }

    await postGirnApprovedHooks(girnId);

    await notifyGirnApproved(girnId, { auto }).catch((e) =>
      console.error('GIRN approved notification failed:', e.message)
    );

    return {
      girn: approved,
      message: auto
        ? 'GIRN auto-approved after inspection pass'
        : skipStock
          ? 'GIRN approved (outsource return — no stock posting)'
          : 'GIRN approved and stock updated',
    };
  } catch (err) {
    await rollbackStock(stockUpdates, ledgerIds).catch((e) =>
      console.error('Rollback failed:', e)
    );
    throw err;
  }
}

module.exports = {
  approvePendingGirn,
  postGirnApprovedHooks,
};
