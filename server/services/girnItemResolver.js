const { createClient } = require('@supabase/supabase-js');
const { getCategoryConfig } = require('../config/girnCategoryConfig');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
        name: row.section_name,
        slug: row.section_slug,
        is_repeatable: row.is_repeatable,
        fields: [],
      };
    }
    sectionsMap[row.section_id].fields.push({
      id: row.field_id,
      label: row.field_label,
      slug: row.field_slug,
      field_type: row.field_type,
      order: row.field_order,
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

async function ensureMasterRecordId(item) {
  const category = item.item_category || 'raw_material';
  const cfg = getCategoryConfig(category);

  if (!cfg.masterSlug) {
    return null;
  }

  if (item.master_record_id) {
    return item.master_record_id;
  }

  const legacyId = item.raw_material_id;
  if (legacyId && category === 'raw_material') {
    return legacyId;
  }

  const keyValue = String(item.rm_id || item.item_code || '').trim();
  const codeValue = String(item.rm_code || item.item_code || item.item_description || '').trim();

  if (!keyValue && !codeValue) {
    throw new Error(`Each ${cfg.label} line item needs a master link or item code`);
  }

  const master = await getMaster(cfg.masterSlug);
  const sections = await getMasterSchema(master.id);
  const keyField = findField(sections, cfg.keyFieldMatchers);

  if (keyField && keyValue) {
    const existingId = await findRecordIdByFieldValue(keyField.field.id, keyValue);
    if (existingId) return existingId;
  }

  const codeField = findField(sections, cfg.codeFieldMatchers);
  if (codeField && codeValue) {
    const existingId = await findRecordIdByFieldValue(codeField.field.id, codeValue);
    if (existingId) return existingId;
  }

  throw new Error(
    `No existing ${cfg.label} record found. Link an item that already exists in the ${cfg.masterSlug} master.`
  );
}

async function resolveGirnItem(item) {
  const category = item.item_category || 'raw_material';
  const cfg = getCategoryConfig(category);

  if (category === 'other') {
    return {
      ...item,
      item_category: 'other',
      quantity_type: item.quantity_type || cfg.quantityType,
      master_record_id: null,
      raw_material_id: null,
    };
  }

  const master_record_id = await ensureMasterRecordId({ ...item, item_category: category });

  return {
    ...item,
    item_category: category,
    quantity_type: item.quantity_type || cfg.quantityType,
    master_record_id,
    raw_material_id: category === 'raw_material' ? master_record_id : item.raw_material_id || null,
  };
}

async function resolveGirnItems(items = []) {
  const resolved = [];
  for (const item of items) {
    resolved.push(await resolveGirnItem(item));
  }
  return resolved;
}

function validateGirnItem(item) {
  const category = item.item_category || 'raw_material';
  const cfg = getCategoryConfig(category);

  if (category === 'other') {
    if (!String(item.item_description || '').trim()) {
      return 'Other items require a description';
    }
    return null;
  }

  const masterId = item.master_record_id || item.raw_material_id;
  if (!masterId) {
    return `Each ${cfg.label} line item must be linked to an existing master record`;
  }

  return null;
}

module.exports = {
  resolveGirnItem,
  resolveGirnItems,
  validateGirnItem,
  getMasterSchema,
  findField,
};
