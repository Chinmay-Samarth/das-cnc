const { createClient } = require('@supabase/supabase-js');
const { getCategoryConfig } = require('../config/girnCategoryConfig');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function defaultUnit(category, storedUnit) {
  if (storedUnit) return storedUnit;
  const cfg = getCategoryConfig(category);
  return cfg.quantityType === 'kg' ? 'kg' : 'nos';
}

async function fetchLabelMap(recordIds = []) {
  if (!recordIds.length) return {};

  const { data, error } = await supabase
    .from('v_master_lookup')
    .select('record_id, label, master_slug')
    .in('record_id', recordIds);

  if (error) throw error;

  return Object.fromEntries(
    (data || []).map((row) => [row.record_id, { label: row.label, master_slug: row.master_slug }])
  );
}

async function fetchLastMovementMap(rows = []) {
  if (!rows.length) return {};

  const recordIds = [...new Set(rows.map((r) => r.master_record_id))];
  const { data, error } = await supabase
    .from('inventory_ledger')
    .select('item_category, master_record_id, lot_number, created_at')
    .in('master_record_id', recordIds)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const map = {};
  for (const entry of data || []) {
    const key = `${entry.item_category}|${entry.master_record_id}|${entry.lot_number ?? ''}`;
    if (!map[key]) map[key] = entry.created_at;
  }
  return map;
}

function movementKey(row) {
  return `${row.item_category}|${row.master_record_id}|${row.lot_number ?? ''}`;
}

function enrichStockRow(row, labelMap, movementMap) {
  const lookup = labelMap[row.master_record_id] || {};
  const cfg = getCategoryConfig(row.item_category);
  return {
    id: row.id,
    item_category: row.item_category,
    category_label: cfg.label,
    master_record_id: row.master_record_id,
    master_slug: lookup.master_slug || null,
    item_label: lookup.label || row.master_record_id,
    lot_number: row.lot_number,
    current_stock: toNumber(row.current_stock),
    unit: defaultUnit(row.item_category, row.unit),
    last_movement_at: movementMap[movementKey(row)] || null,
  };
}

async function searchRecordIds(search) {
  const term = String(search || '').trim();
  if (!term) return null;

  const { data, error } = await supabase
    .from('v_master_lookup')
    .select('record_id')
    .ilike('label', `%${term}%`)
    .limit(500);

  if (error) throw error;
  return (data || []).map((r) => r.record_id);
}

async function listStock({
  category,
  search,
  masterRecordId,
  page = 1,
  limit = 50,
  sort = 'current_stock',
  order = 'desc',
}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const ascending = order === 'asc';

  let query = supabase.from('inventory_stock').select('*', { count: 'exact' });

  if (category) query = query.eq('item_category', category);
  if (masterRecordId) query = query.eq('master_record_id', masterRecordId);

  const searchIds = await searchRecordIds(search);
  if (searchIds !== null) {
    if (!searchIds.length) {
      return { rows: [], total: 0, page: safePage, limit: safeLimit };
    }
    query = query.in('master_record_id', searchIds);
  }

  if (sort === 'current_stock') {
    query = query.order('current_stock', { ascending });
  } else if (sort === 'category') {
    query = query.order('item_category', { ascending });
  } else {
    query = query.order('id', { ascending });
  }

  const needsLabelSort = sort === 'label';
  if (needsLabelSort) {
    const { data: allRows, error } = await query;
    if (error) throw error;

    const labelMap = await fetchLabelMap((allRows || []).map((r) => r.master_record_id));
    const movementMap = await fetchLastMovementMap(allRows || []);

    const enriched = (allRows || [])
      .map((row) => enrichStockRow(row, labelMap, movementMap))
      .sort((a, b) => {
        const l = String(a.item_label).toLowerCase();
        const r = String(b.item_label).toLowerCase();
        if (l === r) return 0;
        return ascending ? (l < r ? -1 : 1) : (l > r ? -1 : 1);
      });

    const total = enriched.length;
    const offset = (safePage - 1) * safeLimit;
    return {
      rows: enriched.slice(offset, offset + safeLimit),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  const offset = (safePage - 1) * safeLimit;
  const { data, error, count } = await query.range(offset, offset + safeLimit - 1);
  if (error) throw error;

  const labelMap = await fetchLabelMap((data || []).map((r) => r.master_record_id));
  const movementMap = await fetchLastMovementMap(data || []);

  return {
    rows: (data || []).map((row) => enrichStockRow(row, labelMap, movementMap)),
    total: count || 0,
    page: safePage,
    limit: safeLimit,
  };
}

async function getStockSummary() {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('item_category, current_stock');

  if (error) throw error;

  const byCategory = {};
  for (const row of data || []) {
    const cat = row.item_category || 'unknown';
    if (!byCategory[cat]) {
      byCategory[cat] = { category: cat, total_rows: 0, total_qty: 0 };
    }
    byCategory[cat].total_rows += 1;
    byCategory[cat].total_qty += toNumber(row.current_stock);
  }

  return Object.values(byCategory).map((entry) => ({
    ...entry,
    category_label: getCategoryConfig(entry.category).label,
  }));
}

async function getStockById(stockId) {
  const { data: row, error } = await supabase
    .from('inventory_stock')
    .select('*')
    .eq('id', stockId)
    .maybeSingle();

  if (error) throw error;
  if (!row) return null;

  const labelMap = await fetchLabelMap([row.master_record_id]);
  const movementMap = await fetchLastMovementMap([row]);
  const stock = enrichStockRow(row, labelMap, movementMap);
  const ledger = await getLedger({
    itemCategory: row.item_category,
    masterRecordId: row.master_record_id,
    lotNumber: row.lot_number,
  });

  return { stock, ledger };
}

async function getLedger({ itemCategory, masterRecordId, lotNumber }) {
  let query = supabase
    .from('inventory_ledger')
    .select('*')
    .eq('item_category', itemCategory)
    .eq('master_record_id', masterRecordId)
    .order('created_at', { ascending: false });

  if (lotNumber) {
    query = query.eq('lot_number', lotNumber);
  } else {
    query = query.is('lot_number', null);
  }

  const { data: entries, error } = await query;
  if (error) throw error;

  const girnIds = [...new Set(
    (entries || [])
      .filter((e) => e.reason === 'girn' && e.reference_id)
      .map((e) => e.reference_id)
  )];

  let girnMap = {};
  if (girnIds.length) {
    const { data: girns, error: girnError } = await supabase
      .from('girns')
      .select('id, girn_number')
      .in('id', girnIds);

    if (girnError) throw girnError;
    girnMap = Object.fromEntries((girns || []).map((g) => [g.id, g.girn_number]));
  }

  const chronological = [...(entries || [])].reverse();
  let running = 0;
  const withBalance = chronological.map((entry) => {
    running += toNumber(entry.change_qty);
    return {
      ...entry,
      balance_after: running,
      girn_number: entry.reference_id ? girnMap[entry.reference_id] || null : null,
    };
  });

  return withBalance.reverse();
}

module.exports = {
  listStock,
  getStockSummary,
  getStockById,
  getLedger,
};
