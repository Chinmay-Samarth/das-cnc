const { createClient } = require('@supabase/supabase-js');
const { getCategoryConfig, updatesStock } = require('../config/girnCategoryConfig');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

async function findStockRow(itemCategory, masterRecordId, lotNumber = null) {
  let query = supabase
    .from('inventory_stock')
    .select('id, current_stock')
    .eq('item_category', itemCategory)
    .eq('master_record_id', masterRecordId);

  if (lotNumber) {
    query = query.eq('lot_number', lotNumber);
  } else {
    query = query.is('lot_number', null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function applyStockForItem(item, girnId) {
  const category = item.item_category || 'raw_material';

  if (!updatesStock(category)) {
    return { stockUpdates: [], ledgerIds: [] };
  }

  const masterRecordId = item.master_record_id || item.raw_material_id;
  if (!masterRecordId) {
    return { stockUpdates: [], ledgerIds: [] };
  }

  let stockQty = toNumber(item.quantity);
  const lotNumber = item.lot_number || null;

  if (category === 'gauge') {
    stockQty = toNumber(item.quantity_ok);
    if (stockQty <= 0) {
      return { stockUpdates: [], ledgerIds: [] };
    }
  }

  const stockUpdates = [];
  const ledgerIds = [];

  try {
    const existingStock = await findStockRow(category, masterRecordId, lotNumber);

    if (existingStock) {
      const previous = existingStock.current_stock;
      const newStock = toNumber(previous) + stockQty;
      const { error } = await supabase
        .from('inventory_stock')
        .update({ current_stock: newStock })
        .eq('id', existingStock.id);

      if (error) throw error;
      stockUpdates.push({ id: existingStock.id, previous, delta: stockQty, table: 'inventory_stock' });
    } else {
      const { error } = await supabase.from('inventory_stock').insert({
        item_category: category,
        master_record_id: masterRecordId,
        lot_number: lotNumber,
        current_stock: stockQty,
        unit: item.unit || null,
      });

      if (error) throw error;
    }

    const { data: ledgerRow, error: ledgerError } = await supabase
      .from('inventory_ledger')
      .insert({
        item_category: category,
        master_record_id: masterRecordId,
        lot_number: lotNumber,
        change_qty: stockQty,
        reason: 'girn',
        reference_id: girnId,
        note: `Received via GIRN ${girnId}`,
      })
      .select('id')
      .single();

    if (ledgerError) throw ledgerError;
    ledgerIds.push({ id: ledgerRow.id, table: 'inventory_ledger' });
  } catch (inventoryErr) {
    if (category !== 'raw_material') {
      throw inventoryErr;
    }

    const { data: existingStock } = await supabase
      .from('raw_material_stock')
      .select('id, current_stock')
      .eq('raw_material_id', masterRecordId)
      .maybeSingle();

    if (existingStock) {
      const previous = existingStock.current_stock;
      const newStock = toNumber(previous) + stockQty;
      const { error } = await supabase
        .from('raw_material_stock')
        .update({ current_stock: newStock })
        .eq('id', existingStock.id);
      if (error) throw error;
      stockUpdates.push({ id: existingStock.id, previous, delta: stockQty, table: 'raw_material_stock' });
    } else {
      const { error } = await supabase.from('raw_material_stock').insert({
        raw_material_id: masterRecordId,
        current_stock: stockQty,
        unit: item.unit || null,
      });
      if (error) throw error;
    }

    const { data: ledgerRow, error: ledgerError } = await supabase
      .from('stock_ledger')
      .insert({
        raw_material_id: masterRecordId,
        change_qty: stockQty,
        reason: 'girn',
        reference_id: girnId,
        note: `Received via GIRN ${girnId}`,
      })
      .select('id')
      .single();

    if (ledgerError) throw ledgerError;
    ledgerIds.push({ id: ledgerRow.id, table: 'stock_ledger' });
  }

  return { stockUpdates, ledgerIds };
}

async function applyStockForGirn(girnId, items = []) {
  const allStockUpdates = [];
  const allLedgerIds = [];

  for (const item of items) {
    const { stockUpdates, ledgerIds } = await applyStockForItem(item, girnId);
    allStockUpdates.push(...stockUpdates);
    allLedgerIds.push(...ledgerIds);
  }

  return { stockUpdates: allStockUpdates, ledgerIds: allLedgerIds };
}

async function rollbackStock(stockUpdates, ledgerIds) {
  const inventoryLedgerIds = ledgerIds.filter((e) => e.table === 'inventory_ledger').map((e) => e.id);
  const legacyLedgerIds = ledgerIds.filter((e) => e.table === 'stock_ledger').map((e) => e.id);

  if (inventoryLedgerIds.length > 0) {
    await supabase.from('inventory_ledger').delete().in('id', inventoryLedgerIds);
  }
  if (legacyLedgerIds.length > 0) {
    await supabase.from('stock_ledger').delete().in('id', legacyLedgerIds);
  }

  for (const s of stockUpdates) {
    const table = s.table === 'raw_material_stock' ? 'raw_material_stock' : 'inventory_stock';
    await supabase.from(table).update({ current_stock: s.previous }).eq('id', s.id);
  }
}

module.exports = {
  applyStockForGirn,
  applyStockForItem,
  rollbackStock,
};
