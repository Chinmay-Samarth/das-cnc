const { createClient } = require('@supabase/supabase-js');
const { updatesStock } = require('../config/girnCategoryConfig');
const { emitInventoryUpdated } = require('../socket/emitter');

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

async function findStockRow(itemCategory, masterRecordId, lotNumber) {
  let query = supabase
    .from('inventory_stock')
    .select('id, current_stock, unit')
    .eq('item_category', itemCategory)
    .eq('master_record_id', masterRecordId);

  if (lotNumber) query = query.eq('lot_number', lotNumber);
  else query = query.is('lot_number', null);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function recordLotInventoryEvent(lotId, eventType, nodeId, ledgerId) {
  const { error } = await supabase.from('lot_inventory_events').insert({
    production_lot_id: lotId,
    event_type: eventType,
    activity_flow_node_id: nodeId || null,
    inventory_ledger_id: ledgerId || null,
  });
  if (error && error.code !== '23505') throw error;
}

async function hasLotInventoryEvent(lotId, eventType, nodeId = null) {
  let query = supabase
    .from('lot_inventory_events')
    .select('id')
    .eq('production_lot_id', lotId)
    .eq('event_type', eventType);
  if (nodeId) query = query.eq('activity_flow_node_id', nodeId);
  else query = query.is('activity_flow_node_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * Apply signed qty change to inventory_stock + ledger.
 * @param {number} delta - positive = receive, negative = issue
 */
async function applyInventoryMove({
  itemCategory,
  masterRecordId,
  lotNumber,
  delta,
  reason,
  referenceId,
  note,
  unit = 'nos',
}) {
  if (!updatesStock(itemCategory)) return null;
  const qty = toNumber(delta);
  if (!(qty !== 0)) return null;

  const existing = await findStockRow(itemCategory, masterRecordId, lotNumber);
  if (qty < 0) {
    const onHand = toNumber(existing?.current_stock);
    if (onHand + qty < -0.0001) {
      throw httpError(
        `Insufficient ${itemCategory} stock for lot ${lotNumber || '—'} (have ${onHand}, need ${Math.abs(qty)})`,
        409
      );
    }
  }

  if (existing) {
    const newStock = Math.round((toNumber(existing.current_stock) + qty) * 10000) / 10000;
    const { error } = await supabase
      .from('inventory_stock')
      .update({ current_stock: newStock })
      .eq('id', existing.id);
    if (error) throw error;
  } else if (qty > 0) {
    const { error } = await supabase.from('inventory_stock').insert({
      item_category: itemCategory,
      master_record_id: masterRecordId,
      lot_number: lotNumber,
      current_stock: qty,
      unit,
    });
    if (error) throw error;
  } else {
    throw httpError('Cannot issue stock that does not exist', 409);
  }

  const { data: ledgerRow, error: ledgerError } = await supabase
    .from('inventory_ledger')
    .insert({
      item_category: itemCategory,
      master_record_id: masterRecordId,
      lot_number: lotNumber,
      change_qty: qty,
      reason,
      reference_id: referenceId,
      note,
    })
    .select('id')
    .single();
  if (ledgerError) throw ledgerError;
  try {
    emitInventoryUpdated({ item_category: itemCategory, master_record_id: masterRecordId, lot_number: lotNumber });
  } catch (_) {
    /* socket optional */
  }
  return ledgerRow.id;
}

async function receiveUnfinishedLot(lot, completedNodeId, note = '') {
  if (!lot?.id || !lot.master_record_id) return null;
  const eventType = 'receive_unfinished';
  if (await hasLotInventoryEvent(lot.id, eventType, completedNodeId)) return null;

  const qty = toNumber(lot.quantity);
  if (!(qty > 0)) return null;

  const ledgerId = await applyInventoryMove({
    itemCategory: 'unfinished_lot',
    masterRecordId: lot.master_record_id,
    lotNumber: lot.lot_number,
    delta: qty,
    reason: 'production_wip_receive',
    referenceId: lot.id,
    note: note || `Unfinished lot parked after op (${lot.lot_number})`,
  });
  await recordLotInventoryEvent(lot.id, eventType, completedNodeId, ledgerId);
  return ledgerId;
}

async function issueUnfinishedLot(lot, nextNodeId, note = '') {
  if (!lot?.id || !lot.master_record_id) return null;
  const eventType = 'issue_unfinished';
  if (await hasLotInventoryEvent(lot.id, eventType, nextNodeId)) return null;

  const qty = toNumber(lot.quantity);
  if (!(qty > 0)) return null;

  const ledgerId = await applyInventoryMove({
    itemCategory: 'unfinished_lot',
    masterRecordId: lot.master_record_id,
    lotNumber: lot.lot_number,
    delta: -qty,
    reason: 'production_wip_issue',
    referenceId: lot.id,
    note: note || `Unfinished lot issued to next op (${lot.lot_number})`,
  });
  await recordLotInventoryEvent(lot.id, eventType, nextNodeId, ledgerId);
  return ledgerId;
}

async function receiveFinishedComponent(lot, note = '') {
  if (!lot?.id || !lot.master_record_id) return null;
  const eventType = 'receive_finished';
  if (await hasLotInventoryEvent(lot.id, eventType, null)) return null;

  const unfinishedExists = await findStockRow('unfinished_lot', lot.master_record_id, lot.lot_number);
  if (unfinishedExists && toNumber(unfinishedExists.current_stock) > 0) {
    await applyInventoryMove({
      itemCategory: 'unfinished_lot',
      masterRecordId: lot.master_record_id,
      lotNumber: lot.lot_number,
      delta: -toNumber(unfinishedExists.current_stock),
      reason: 'production_wip_clear',
      referenceId: lot.id,
      note: `Clear unfinished before FG receive (${lot.lot_number})`,
    });
  }

  const qty = toNumber(lot.quantity);
  if (!(qty > 0)) return null;

  const ledgerId = await applyInventoryMove({
    itemCategory: 'component',
    masterRecordId: lot.master_record_id,
    lotNumber: lot.lot_number,
    delta: qty,
    reason: 'production_fg_receive',
    referenceId: lot.id,
    note: note || `Ready for dispatch (${lot.lot_number})`,
  });
  await recordLotInventoryEvent(lot.id, eventType, null, ledgerId);
  return ledgerId;
}

async function issueFinishedComponent(lot, note = '') {
  if (!lot?.id || !lot.master_record_id) return null;
  const eventType = 'issue_dispatch';
  if (await hasLotInventoryEvent(lot.id, eventType, null)) return null;

  const qty = toNumber(lot.quantity);
  if (!(qty > 0)) return null;

  const ledgerId = await applyInventoryMove({
    itemCategory: 'component',
    masterRecordId: lot.master_record_id,
    lotNumber: lot.lot_number,
    delta: -qty,
    reason: 'production_dispatch',
    referenceId: lot.id,
    note: note || `Dispatched (${lot.lot_number})`,
  });
  await recordLotInventoryEvent(lot.id, eventType, null, ledgerId);
  return ledgerId;
}

module.exports = {
  applyInventoryMove,
  receiveUnfinishedLot,
  issueUnfinishedLot,
  receiveFinishedComponent,
  issueFinishedComponent,
  hasLotInventoryEvent,
};
