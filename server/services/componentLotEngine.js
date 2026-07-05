const { createClient } = require('@supabase/supabase-js');
const { getMasterSchema, findField } = require('./girnItemResolver');
const { getCategoryConfig } = require('../config/girnCategoryConfig');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function getMasterId(slug) {
  const { data, error } = await supabase
    .from('masters')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (error) throw error;
  return data.id;
}

async function getRecordCode(masterRecordId) {
  const { data: lookup } = await supabase
    .from('v_master_lookup')
    .select('label, master_slug')
    .eq('record_id', masterRecordId)
    .maybeSingle();

  if (!lookup) return 'COMP';

  const cfg = getCategoryConfig(
    Object.entries(require('../config/girnCategoryConfig').GIRN_CATEGORIES)
      .find(([, c]) => c.masterSlug === lookup.master_slug)?.[0] || 'component'
  );

  const masterId = await getMasterId(cfg.masterSlug || 'component');
  const sections = await getMasterSchema(masterId);
  const codeField = findField(sections, cfg.codeFieldMatchers);

  if (!codeField) {
    return String(lookup.label || 'COMP').replace(/\s+/g, '-').slice(0, 20);
  }

  const { data: valueRow } = await supabase
    .from('record_values')
    .select('value')
    .eq('record_id', masterRecordId)
    .eq('field_id', codeField.field.id)
    .maybeSingle();

  return valueRow?.value || lookup.label || 'COMP';
}

async function nextLotSequence(masterRecordId, lotDate) {
  const { data: existing } = await supabase
    .from('component_lot_sequences')
    .select('last_seq')
    .eq('master_record_id', masterRecordId)
    .eq('lot_date', lotDate)
    .maybeSingle();

  const nextSeq = (existing?.last_seq || 0) + 1;

  const { error } = await supabase.from('component_lot_sequences').upsert(
    {
      master_record_id: masterRecordId,
      lot_date: lotDate,
      last_seq: nextSeq,
    },
    { onConflict: 'master_record_id,lot_date' }
  );

  if (error) throw error;
  return nextSeq;
}

async function generateComponentLotNumber(masterRecordId, date = new Date()) {
  const code = await getRecordCode(masterRecordId);
  const lotDate = date.toISOString().slice(0, 10);
  const yyyymmdd = lotDate.replace(/-/g, '');
  const seq = await nextLotSequence(masterRecordId, lotDate);
  const safeCode = String(code).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 30);
  return `LOT-${safeCode}-${yyyymmdd}-${String(seq).padStart(4, '0')}`;
}

async function assignLotToGirnItem(itemId, masterRecordId) {
  const lotNumber = await generateComponentLotNumber(masterRecordId);

  const { data, error } = await supabase
    .from('girn_items')
    .update({ lot_number: lotNumber })
    .eq('id', itemId)
    .select('lot_number')
    .single();

  if (error) throw error;
  return data.lot_number;
}

module.exports = {
  generateComponentLotNumber,
  assignLotToGirnItem,
};
