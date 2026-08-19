/**
 * Bulk read numeric master record fields (ROL, MOQ) from dynamic master EAV.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PROCUREMENT_FIELDS = {
  'raw-material': {
    reorderLevel: ['reorder_level'],
    moq: ['minimum_order_quantity_moq'],
  },
  tool: {
    reorderLevel: ['reorder_level'],
    moq: ['minimum_order_quantity'],
  },
};

function parseNumericField(value) {
  if (value == null || value === '') return null;
  const n = parseFloat(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

async function getMasterBySlug(slug) {
  const { data, error } = await supabase
    .from('masters')
    .select('id, slug')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Master '${slug}' not found`);
  return data;
}

async function getProcurementFieldIds(masterSlug) {
  const config = PROCUREMENT_FIELDS[masterSlug];
  if (!config) return { reorderLevelFieldId: null, moqFieldId: null };

  const master = await getMasterBySlug(masterSlug);
  const { data: schema, error } = await supabase
    .from('v_master_schema')
    .select('field_id, field_slug')
    .eq('master_id', master.id);
  if (error) throw error;

  const bySlug = Object.fromEntries((schema || []).map((row) => [row.field_slug, row.field_id]));

  const pickFieldId = (slugs) => {
    for (const slug of slugs) {
      if (bySlug[slug]) return bySlug[slug];
    }
    return null;
  };

  return {
    masterId: master.id,
    reorderLevelFieldId: pickFieldId(config.reorderLevel),
    moqFieldId: pickFieldId(config.moq),
  };
}

async function loadNumericFieldValues(recordIds, fieldId) {
  const map = {};
  if (!fieldId || !recordIds.length) return map;

  const chunkSize = 200;
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('record_values')
      .select('record_id, value')
      .eq('field_id', fieldId)
      .in('record_id', chunk);
    if (error) throw error;
    for (const row of data || []) {
      map[row.record_id] = parseNumericField(row.value);
    }
  }
  return map;
}

/**
 * Load ROL + MOQ for all records of a master slug.
 * @returns {Promise<Array<{ recordId, label, reorderLevel, moq }>>}
 */
async function loadProcurementMetaForMaster(masterSlug) {
  const { masterId, reorderLevelFieldId, moqFieldId } = await getProcurementFieldIds(masterSlug);

  const { data: records, error: recErr } = await supabase
    .from('master_records')
    .select('id')
    .eq('master_id', masterId);
  if (recErr) throw recErr;

  const recordIds = (records || []).map((r) => r.id);
  if (!recordIds.length) return [];

  const [rolByRecord, moqByRecord, lookupRes] = await Promise.all([
    loadNumericFieldValues(recordIds, reorderLevelFieldId),
    loadNumericFieldValues(recordIds, moqFieldId),
    supabase.from('v_master_lookup').select('record_id, label').in('record_id', recordIds),
  ]);
  if (lookupRes.error) throw lookupRes.error;

  const labelById = Object.fromEntries((lookupRes.data || []).map((l) => [l.record_id, l.label]));

  return recordIds.map((recordId) => ({
    recordId,
    label: labelById[recordId] || '(unnamed)',
    reorderLevel: rolByRecord[recordId] ?? null,
    moq: moqByRecord[recordId] ?? null,
  }));
}

async function getRelationFieldId(masterSlug, fieldSlugs) {
  const master = await getMasterBySlug(masterSlug);
  const { data: schema, error } = await supabase
    .from('v_master_schema')
    .select('field_id, field_slug')
    .eq('master_id', master.id);
  if (error) throw error;
  const bySlug = Object.fromEntries((schema || []).map((row) => [row.field_slug, row.field_id]));
  for (const slug of fieldSlugs) {
    if (bySlug[slug]) return bySlug[slug];
  }
  return null;
}

async function loadLinkedRecordIds(recordIds, fieldId) {
  const map = {};
  if (!fieldId || !recordIds.length) return map;
  const chunkSize = 200;
  for (let i = 0; i < recordIds.length; i += chunkSize) {
    const chunk = recordIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('record_values')
      .select('record_id, linked_record_id, value')
      .eq('field_id', fieldId)
      .in('record_id', chunk);
    if (error) throw error;
    for (const row of data || []) {
      map[row.record_id] = row.linked_record_id || row.value || null;
    }
  }
  return map;
}

function commercialSectionSlug(masterSlug) {
  return masterSlug === 'tool' ? 'sources' : 'commercials';
}

async function loadCommercialSourcesForRecords(recordIds, masterSlug = 'raw-material') {
  const ids = [...new Set((recordIds || []).filter(Boolean))];
  const empty = {};
  if (!ids.length) return empty;

  const master = await getMasterBySlug(masterSlug);
  const { data: section, error: secErr } = await supabase
    .from('master_sections')
    .select('id')
    .eq('master_id', master.id)
    .eq('slug', commercialSectionSlug(masterSlug))
    .maybeSingle();
  if (secErr) throw secErr;
  if (!section?.id) return empty;

  const { data: rows, error } = await supabase
    .from('record_section_rows')
    .select(
      `
      id, record_id, row_order,
      record_section_values (
        value, linked_record_id,
        section_fields ( slug )
      )
    `
    )
    .eq('section_id', section.id)
    .in('record_id', ids)
    .order('row_order');
  if (error) throw error;

  const byRecord = {};
  for (const row of rows || []) {
    const cells = {};
    for (const cell of row.record_section_values || []) {
      const slug = cell.section_fields?.slug;
      if (!slug) continue;
      cells[slug] = cell.linked_record_id || cell.value || null;
    }
    const supplierId = String(cells.source || cells.supplier || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(supplierId)) continue;
    if (!byRecord[row.record_id]) byRecord[row.record_id] = [];
    byRecord[row.record_id].push({
      supplier_id: supplierId,
      rate: parseNumericField(cells.rate),
      tax_gst: parseNumericField(cells.tax_gst),
      lead_time_days: parseNumericField(cells.lead_time_days),
    });
  }
  return byRecord;
}

function pickCommercialSource(sources, supplierId) {
  const list = Array.isArray(sources) ? sources : [];
  if (supplierId) {
    const match = list.find((s) => s.supplier_id === supplierId);
    if (match) return match;
  }
  return list[0] || null;
}

async function loadSupplierIdForMasterRecord(masterRecordId, masterSlug) {
  const commercials = await loadCommercialSourcesForRecords([masterRecordId], masterSlug);
  const fromCommercial = pickCommercialSource(commercials[masterRecordId]);
  if (fromCommercial?.supplier_id) return fromCommercial.supplier_id;

  const fieldId = await getRelationFieldId(masterSlug, ['supplier', 'source']);
  if (!fieldId) return null;
  const links = await loadLinkedRecordIds([masterRecordId], fieldId);
  const raw = links[masterRecordId];
  if (!raw) return null;
  const id = String(raw).trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabase.from('suppliers').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function loadToolRecordIdsForComponent(componentRecordId) {
  const fieldId = await getRelationFieldId('tool', ['components']);
  if (!fieldId) return [];
  const { data, error } = await supabase
    .from('record_values')
    .select('record_id')
    .eq('field_id', fieldId)
    .eq('linked_record_id', componentRecordId);
  if (error) throw error;
  return (data || []).map((r) => r.record_id);
}

async function loadNumericMasterField(recordId, fieldSlugs, masterSlug) {
  const fieldId = await getRelationFieldId(masterSlug, fieldSlugs);
  if (!fieldId) return null;
  const vals = await loadNumericFieldValues([recordId], fieldId);
  return vals[recordId] ?? null;
}

async function loadToolLifeMeta(toolRecordId) {
  const life =
    (await loadNumericMasterField(toolRecordId, ['tool_life'], 'tool')) ??
    (await loadNumericMasterField(toolRecordId, ['max_quantity'], 'tool'));
  return {
    lifeTotal: life != null && life > 0 ? life : 10000,
    lifeUnit: 'pcs',
  };
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 10000) / 10000;
}

function computeOrderQtyWithMoq({ netNeed, moq, reorderLevel, onHand, isRawMaterial = true }) {
  const need = Math.max(0, toNumber(netNeed));
  const minimumOrder = Math.max(0, toNumber(moq));
  const replenish = Math.max(0, toNumber(reorderLevel) - toNumber(onHand));

  if (need > 0) {
    return roundQty(Math.max(need, minimumOrder));
  }
  if (onHand <= toNumber(reorderLevel) && reorderLevel > 0) {
    return roundQty(Math.max(minimumOrder, replenish));
  }
  if (!isRawMaterial && minimumOrder > 0) {
    return roundQty(minimumOrder);
  }
  return 0;
}

module.exports = {
  PROCUREMENT_FIELDS,
  parseNumericField,
  getProcurementFieldIds,
  loadNumericFieldValues,
  loadProcurementMetaForMaster,
  loadCommercialSourcesForRecords,
  pickCommercialSource,
  loadSupplierIdForMasterRecord,
  loadToolRecordIdsForComponent,
  loadToolLifeMeta,
  computeOrderQtyWithMoq,
};
