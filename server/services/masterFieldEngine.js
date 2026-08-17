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

module.exports = {
  PROCUREMENT_FIELDS,
  parseNumericField,
  getProcurementFieldIds,
  loadNumericFieldValues,
  loadProcurementMetaForMaster,
};
