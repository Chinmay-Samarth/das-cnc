const { createClient } = require('@supabase/supabase-js');
const { getCategoryConfig } = require('../config/girnCategoryConfig');
const { getMasterSchema } = require('./girnItemResolver');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

function findInspectionSection(sections = []) {
  return sections.find((section) => {
    const slug = String(section.slug || '').toLowerCase();
    const name = String(section.name || '').toLowerCase();
    return slug.includes('inspection') || name.includes('inspection');
  });
}

function cellDisplayValue(cell) {
  if (!cell) return '';
  if (cell.value != null && String(cell.value).trim() !== '') return String(cell.value).trim();
  if (cell.file_url) return cell.file_url;
  if (Array.isArray(cell.file_urls) && cell.file_urls.length) return cell.file_urls.join(', ');
  return '';
}

function checkpointsFromFlatSection(section, flatSection = {}) {
  return (section.fields || [])
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((field) => {
      const cell = flatSection[field.slug];
      return {
        field_slug: field.slug,
        checkpoint: field.label || field.slug,
        standard: cellDisplayValue(cell),
        passed: false,
        inspector_note: '',
      };
    });
}

function checkpointsFromRepeatableSection(section, repeatableRows = []) {
  const checkpoints = [];

  repeatableRows.forEach((row, rowIndex) => {
    for (const field of section.fields || []) {
      const cell = row[field.slug];
      checkpoints.push({
        field_slug: field.slug,
        row_index: rowIndex,
        checkpoint: `${field.label || field.slug}${repeatableRows.length > 1 ? ` (Row ${rowIndex + 1})` : ''}`,
        standard: cellDisplayValue(cell),
        passed: false,
        inspector_note: '',
      });
    }
  });

  return checkpoints;
}

async function fetchMasterRecordValues(masterSlug, recordId) {
  const master = await getMaster(masterSlug);

  const { data: flatValues } = await supabase
    .from('record_values')
    .select(`
      value,
      file_url,
      file_urls,
      section_fields (
        slug,
        master_sections ( slug, is_repeatable )
      )
    `)
    .eq('record_id', recordId);

  const { data: sectionRows } = await supabase
    .from('record_section_rows')
    .select(`
      row_order,
      record_section_values (
        value,
        file_url,
        file_urls,
        section_fields ( slug )
      ),
      master_sections ( slug )
    `)
    .eq('record_id', recordId)
    .order('row_order');

  const flat = {};
  for (const rv of flatValues || []) {
    const sectionSlug = rv.section_fields?.master_sections?.slug;
    const fieldSlug = rv.section_fields?.slug;
    if (!sectionSlug || !fieldSlug) continue;
    if (!flat[sectionSlug]) flat[sectionSlug] = {};
    flat[sectionSlug][fieldSlug] = {
      value: rv.value,
      file_url: rv.file_url,
      file_urls: rv.file_urls,
    };
  }

  const repeatable = {};
  for (const row of sectionRows || []) {
    const slug = row.master_sections?.slug;
    if (!slug) continue;
    if (!repeatable[slug]) repeatable[slug] = [];
    const cells = {};
    for (const cell of row.record_section_values || []) {
      cells[cell.section_fields.slug] = {
        value: cell.value,
        file_url: cell.file_url,
        file_urls: cell.file_urls,
      };
    }
    repeatable[slug].push(cells);
  }

  return { flat, repeatable };
}

function mergeCheckpointsWithLogs(checkpoints, logs = []) {
  return checkpoints.map((cp) => {
    const saved = logs.find(
      (log) =>
        log.checkpoint === cp.checkpoint ||
        (cp.field_slug && log.checkpoint?.includes(cp.field_slug))
    );

    if (!saved) return cp;

    return {
      ...cp,
      standard: saved.standard || cp.standard,
      passed: saved.passed === true || saved.passed === 'true',
      inspector_note: saved.inspector_note || '',
    };
  });
}

async function getInspectionCheckpointsForItem(item, existingLogs = []) {
  const category = item.item_category || 'raw_material';
  const cfg = getCategoryConfig(category);
  const masterRecordId = item.master_record_id || item.raw_material_id;

  if (!cfg.requiresInspection || !cfg.masterSlug || !masterRecordId) {
    return [];
  }

  const master = await getMaster(cfg.masterSlug);
  const sections = await getMasterSchema(master.id);
  const inspectionSection = findInspectionSection(sections);

  if (!inspectionSection) {
    return [];
  }

  const { flat, repeatable } = await fetchMasterRecordValues(cfg.masterSlug, masterRecordId);

  let checkpoints = [];
  if (inspectionSection.is_repeatable) {
    checkpoints = checkpointsFromRepeatableSection(
      inspectionSection,
      repeatable[inspectionSection.slug] || []
    );
  } else {
    checkpoints = checkpointsFromFlatSection(
      inspectionSection,
      flat[inspectionSection.slug] || {}
    );
  }

  return mergeCheckpointsWithLogs(checkpoints, existingLogs);
}

module.exports = {
  findInspectionSection,
  getInspectionCheckpointsForItem,
  mergeCheckpointsWithLogs,
};
