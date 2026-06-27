const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const RAW_MATERIAL_SLUG = 'raw-material';

function fieldMatches(field, matchers) {
  const slug = field.slug.toLowerCase();
  const label = field.label.toLowerCase();
  return matchers.some((m) => slug === m || slug.includes(m) || label.includes(m));
}

function findField(sections, matchers) {
  for (const section of sections) {
    for (const field of section.fields || []) {
      if (fieldMatches(field, matchers)) {
        return { section, field };
      }
    }
  }
  return null;
}

async function getMaster(slug) {
  const { data, error } = await supabase
    .from('masters')
    .select('id, slug')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    throw new Error(`Master '${slug}' not found`);
  }
  return data;
}

async function getMasterSchema(masterId) {
  const { data, error } = await supabase
    .from('v_master_schema')
    .select('*')
    .eq('master_id', masterId);

  if (error) throw error;

  const sectionsMap = {};
  for (const row of data || []) {
    if (!sectionsMap[row.section_id]) {
      sectionsMap[row.section_id] = {
        id: row.section_id,
        slug: row.section_slug,
        fields: [],
      };
    }
    sectionsMap[row.section_id].fields.push({
      id: row.field_id,
      label: row.field_label,
      slug: row.field_slug,
      field_type: row.field_type,
    });
  }

  return Object.values(sectionsMap);
}

async function findRecordIdByFieldValue(fieldId, value) {
  const { data, error } = await supabase
    .from('record_values')
    .select('record_id')
    .eq('field_id', fieldId)
    .eq('value', String(value).trim())
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.record_id ?? null;
}

async function createRawMaterialRecord(sections, rmId, rmCode) {
  const master = await getMaster(RAW_MATERIAL_SLUG);

  const rmIdField = findField(sections, ['rm-id', 'rm_id', 'rm id']);
  const rmCodeField = findField(sections, ['rm-code', 'rm_code', 'material-code', 'code']);

  if (!rmIdField || !rmCodeField) {
    throw new Error('Raw material master is missing RM ID or RM Code fields');
  }

  const { data: record, error: recErr } = await supabase
    .from('master_records')
    .insert({ master_id: master.id })
    .select('id')
    .single();

  if (recErr) throw recErr;

  const inserts = [
    {
      record_id: record.id,
      field_id: rmIdField.field.id,
      value: String(rmId).trim(),
    },
    {
      record_id: record.id,
      field_id: rmCodeField.field.id,
      value: String(rmCode).trim(),
    },
  ];

  const { error: valErr } = await supabase.from('record_values').insert(inserts);
  if (valErr) throw valErr;

  return record.id;
}

/**
 * Resolve raw_material_id for a GIRN line item.
 * Uses existing link, finds by RM ID, or creates a new master record.
 */
async function ensureRawMaterialId(item) {
  if (item.raw_material_id) {
    return item.raw_material_id;
  }

  const rmId = String(item.rm_id || '').trim();
  const rmCode = String(item.rm_code || '').trim();

  if (!rmId || !rmCode) {
    throw new Error('Each line item needs a raw material link or both RM ID and RM Code');
  }

  const master = await getMaster(RAW_MATERIAL_SLUG);
  const sections = await getMasterSchema(master.id);
  const rmIdField = findField(sections, ['rm-id', 'rm_id', 'rm id']);

  if (!rmIdField) {
    throw new Error('Raw material master is missing an RM ID field');
  }

  const existingId = await findRecordIdByFieldValue(rmIdField.field.id, rmId);
  if (existingId) return existingId;

  return createRawMaterialRecord(sections, rmId, rmCode);
}

async function resolveGirnItemMaterials(items) {
  const resolved = [];

  for (const item of items) {
    const raw_material_id = await ensureRawMaterialId(item);
    resolved.push({ ...item, raw_material_id });
  }

  return resolved;
}

module.exports = {
  ensureRawMaterialId,
  resolveGirnItemMaterials,
};
