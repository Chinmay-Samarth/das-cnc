/**
 * One-off: import RAW MATERIAL INSPECTION PLAN.xlsx into raw-material master
 * records + active dimensional inspection plans.
 *
 * Usage (from server/):
 *   node scripts/importRawMaterialInspectionPlan.js [path-to-xlsx]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const XLSX = require('xlsx');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MASTER_SLUG = 'raw-material';
const DEFAULT_XLSX = 'E:\\das-cnc-files\\RAW MATERIAL INSPECTION PLAN.xlsx';

const FIELD_SLUGS = [
  'raw_material_id',
  'raw_material_size',
  'raw_material_grade',
  'color_code',
  'specification',
  'specified_value',
  'minimum_value',
  'maximum_value',
  'measuring_method',
  'characteristics',
];

function clean(value) {
  if (value == null) return '';
  return String(value).replace(/\r\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function toNum(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function padRmId(sl) {
  return `RM-${String(sl).padStart(3, '0')}`;
}

function parseRows(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const out = [];

  for (const row of rows.slice(3)) {
    const sl = row[0];
    if (typeof sl !== 'number' || !Number.isFinite(sl)) continue;

    const size = clean(row[1]);
    const spec = clean(row[3]);
    const grade = clean(row[5]);
    const min = toNum(row[7]);
    const max = toNum(row[9]);
    const method = clean(row[11]) || 'MICROMETER';
    const characteristics = clean(row[12]);
    const color = clean(row[14]);

    if (!size && !grade && !spec) continue;

    out.push({
      sl,
      rmId: padRmId(sl),
      size,
      spec: spec === '.' ? '' : spec,
      grade,
      min,
      max,
      method,
      characteristics,
      color,
    });
  }

  return out;
}

async function loadFieldMap(masterId) {
  const { data: sections, error: sErr } = await supabase
    .from('master_sections')
    .select('id, slug')
    .eq('master_id', masterId);
  if (sErr) throw sErr;

  const general = (sections || []).find((s) => s.slug === 'general');
  if (!general) throw new Error('raw-material general section not found');

  const { data: fields, error: fErr } = await supabase
    .from('section_fields')
    .select('id, slug')
    .eq('section_id', general.id);
  if (fErr) throw fErr;

  const map = {};
  for (const f of fields || []) map[f.slug] = f.id;
  for (const slug of FIELD_SLUGS) {
    if (!map[slug]) throw new Error(`Missing field slug: ${slug}`);
  }
  return map;
}

async function existingRmIds(fieldId) {
  const { data, error } = await supabase
    .from('record_values')
    .select('value, record_id')
    .eq('field_id', fieldId);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    if (row.value) map.set(String(row.value).trim().toUpperCase(), row.record_id);
  }
  return map;
}

function dimensionalPayload(item) {
  const max = item.max;
  const min = item.min;
  let nominal = null;
  let tolPlus = null;
  let tolMinus = null;

  if (max != null && min != null) {
    nominal = max;
    tolPlus = 0;
    tolMinus = Number((max - min).toFixed(4));
  } else if (max != null) {
    nominal = max;
  } else if (min != null) {
    nominal = min;
  }

  return {
    sequence: 1,
    parameter_name: item.characteristics || item.size || 'Size',
    check_type: 'dimensional',
    nominal_value: nominal,
    tol_plus: tolPlus,
    tol_minus: tolMinus,
    unit: 'mm',
    instrument_required: item.method || 'MICROMETER',
    is_mandatory: true,
  };
}

async function createRecord(masterId, fieldMap, item) {
  const { data: record, error: recErr } = await supabase
    .from('master_records')
    .insert({ master_id: masterId })
    .select('id')
    .single();
  if (recErr) throw recErr;

  const values = [
    { field_id: fieldMap.raw_material_id, value: item.rmId },
    { field_id: fieldMap.raw_material_size, value: item.size || null },
    { field_id: fieldMap.raw_material_grade, value: item.grade || null },
    { field_id: fieldMap.color_code, value: item.color || null },
    { field_id: fieldMap.specification, value: item.spec || null },
    { field_id: fieldMap.specified_value, value: item.spec || null },
    {
      field_id: fieldMap.minimum_value,
      value: item.min != null ? String(item.min) : null,
    },
    {
      field_id: fieldMap.maximum_value,
      value: item.max != null ? String(item.max) : null,
    },
    { field_id: fieldMap.measuring_method, value: item.method || null },
    { field_id: fieldMap.characteristics, value: item.characteristics || null },
  ].map((row) => ({
    record_id: record.id,
    field_id: row.field_id,
    value: row.value,
  }));

  const { error: valErr } = await supabase.from('record_values').insert(values);
  if (valErr) {
    await supabase.from('master_records').delete().eq('id', record.id);
    throw valErr;
  }

  const { data: plan, error: planErr } = await supabase
    .from('inspection_plans')
    .insert({
      master_record_id: record.id,
      plan_code: `${item.rmId}-IP`,
      revision: 1,
      status: 'active',
      effective_from: new Date().toISOString().slice(0, 10),
      sampling_rule_type: 'percentage',
      sampling_rule_value: 100,
    })
    .select('id')
    .single();
  if (planErr) throw planErr;

  const param = dimensionalPayload(item);
  const { error: pErr } = await supabase.from('inspection_plan_parameters').insert({
    plan_id: plan.id,
    ...param,
  });
  if (pErr) throw pErr;

  return record.id;
}

async function main() {
  const filePath = process.argv[2] || DEFAULT_XLSX;
  console.log('Reading', filePath);

  const items = parseRows(filePath);
  console.log(`Parsed ${items.length} raw material rows`);

  const { data: master, error: mErr } = await supabase
    .from('masters')
    .select('id, slug, name')
    .eq('slug', MASTER_SLUG)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!master) throw new Error('Master raw-material not found');

  const fieldMap = await loadFieldMap(master.id);
  const existing = await existingRmIds(fieldMap.raw_material_id);

  let created = 0;
  let skipped = 0;

  for (const item of items) {
    const key = item.rmId.toUpperCase();
    if (existing.has(key)) {
      console.log(`skip ${item.rmId} (exists)`);
      skipped += 1;
      continue;
    }
    const id = await createRecord(master.id, fieldMap, item);
    existing.set(key, id);
    created += 1;
    console.log(`created ${item.rmId} · ${item.size || '—'} · ${item.grade || '—'} → ${id}`);
  }

  console.log(`Done. created=${created} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
