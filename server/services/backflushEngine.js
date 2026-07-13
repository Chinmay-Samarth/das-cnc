const { createClient } = require('@supabase/supabase-js');
const { loadBomEdges, enrichEdges } = require('./bomEngine');
const { emitInventoryBackflushed } = require('../socket/emitter');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 10000) / 10000;
}

async function findStockRow(itemCategory, masterRecordId, lotNumber = null) {
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

/** Recompute inventory_stock.current_stock from ledger for one stock key. */
async function syncStockFromLedger(itemCategory, masterRecordId, lotNumber = null) {
  let ledgerQuery = supabase
    .from('inventory_ledger')
    .select('change_qty')
    .eq('item_category', itemCategory)
    .eq('master_record_id', masterRecordId);

  if (lotNumber) ledgerQuery = ledgerQuery.eq('lot_number', lotNumber);
  else ledgerQuery = ledgerQuery.is('lot_number', null);

  const { data: entries, error: ledErr } = await ledgerQuery;
  if (ledErr) throw ledErr;

  const sum = roundQty((entries || []).reduce((s, e) => s + toNumber(e.change_qty), 0));
  const stock = await findStockRow(itemCategory, masterRecordId, lotNumber);

  if (stock) {
    const { error } = await supabase
      .from('inventory_stock')
      .update({ current_stock: sum })
      .eq('id', stock.id);
    if (error) throw error;
    return { id: stock.id, current_stock: sum };
  }

  if (sum === 0) return null;

  const { data: inserted, error: insErr } = await supabase
    .from('inventory_stock')
    .insert({
      item_category: itemCategory,
      master_record_id: masterRecordId,
      lot_number: lotNumber,
      current_stock: sum,
      unit: null,
    })
    .select('id, current_stock')
    .single();
  if (insErr) throw insErr;
  return inserted;
}

/**
 * Debit unlotted RM stock for delta good qty using direct BOM RM edges.
 * Ledger is written first; stock is then synced from ledger so balances stay consistent.
 * Rejects if available stock (ledger sum) would go negative.
 */
async function backflushRawMaterials({
  bomVersionId,
  deltaGood,
  productionCardId,
  parentMasterRecordId,
  cardNumber = null,
}) {
  const delta = toNumber(deltaGood);
  if (delta <= 0) return { lines: [] };
  if (!bomVersionId) throw httpError('No BOM version to backflush against');

  const rawEdges = await loadBomEdges(bomVersionId);
  const edges = await enrichEdges(rawEdges);
  const rmEdges = (edges || []).filter(
    (e) =>
      e.child_slug === 'raw-material' &&
      e.parent_element_id === parentMasterRecordId
  );

  if (!rmEdges.length) return { lines: [] };

  const lines = [];
  const postedLedgerIds = [];

  try {
    for (const edge of rmEdges) {
      const need = roundQty(toNumber(edge.quantity) * delta);
      if (need <= 0) continue;

      // Available qty = ledger sum (source of truth), not a possibly drifted stock row
      let ledgerQuery = supabase
        .from('inventory_ledger')
        .select('change_qty')
        .eq('item_category', 'raw_material')
        .eq('master_record_id', edge.child_element_id)
        .is('lot_number', null);
      const { data: entries, error: sumErr } = await ledgerQuery;
      if (sumErr) throw sumErr;
      const available = roundQty((entries || []).reduce((s, e) => s + toNumber(e.change_qty), 0));

      if (available < need) {
        throw httpError(
          `Insufficient RM stock for backflush (${edge.child_label || edge.child_element_id}): need ${need}, have ${available}`
        );
      }

      const { data: ledgerRow, error: ledErr } = await supabase
        .from('inventory_ledger')
        .insert({
          item_category: 'raw_material',
          master_record_id: edge.child_element_id,
          lot_number: null,
          change_qty: -need,
          reason: 'backflush',
          reference_id: productionCardId,
          note: cardNumber
            ? `Backflush ${cardNumber}`
            : `Backflush for production card ${productionCardId}`,
        })
        .select('id')
        .single();
      if (ledErr) throw ledErr;
      postedLedgerIds.push(ledgerRow.id);

      const synced = await syncStockFromLedger('raw_material', edge.child_element_id, null);

      emitInventoryBackflushed({
        raw_material_lot_id: synced?.id || null,
        master_record_id: edge.child_element_id,
        remaining_stock: synced?.current_stock != null ? Number(synced.current_stock) : null,
        deducted_qty: need,
        production_card_id: productionCardId,
        stockId: synced?.id || null,
        itemCategory: 'raw_material',
        masterRecordId: edge.child_element_id,
        referenceId: productionCardId,
      });

      lines.push({
        master_record_id: edge.child_element_id,
        label: edge.child_label,
        qty: need,
        current_stock: synced?.current_stock,
      });
    }
  } catch (err) {
    if (postedLedgerIds.length) {
      await supabase.from('inventory_ledger').delete().in('id', postedLedgerIds);
      for (const edge of rmEdges) {
        try {
          await syncStockFromLedger('raw_material', edge.child_element_id, null);
        } catch {
          /* best-effort restore */
        }
      }
    }
    throw err;
  }

  return { lines };
}

/** One-shot repair: align all inventory_stock rows to their ledger sums. */
async function reconcileAllStockFromLedger() {
  const { data: stocks, error } = await supabase
    .from('inventory_stock')
    .select('item_category, master_record_id, lot_number');
  if (error) throw error;

  const fixed = [];
  for (const row of stocks || []) {
    const synced = await syncStockFromLedger(
      row.item_category,
      row.master_record_id,
      row.lot_number ?? null
    );
    if (synced) fixed.push(synced);
  }
  return { fixed: fixed.length };
}

module.exports = {
  backflushRawMaterials,
  syncStockFromLedger,
  reconcileAllStockFromLedger,
};
