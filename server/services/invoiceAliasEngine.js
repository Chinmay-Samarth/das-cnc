const { createClient } = require('@supabase/supabase-js');
const { getCategoryConfig, categoryFromMasterSlug } = require('../config/girnCategoryConfig');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function inferItemCode(description = '') {
  const trimmed = String(description || '').trim();
  const codeMatch = trimmed.match(/\b[A-Z]{0,3}[-_]?\d{2,}[A-Z0-9-]*\b/i);
  if (codeMatch) return codeMatch[0];
  const numMatch = trimmed.match(/\b\d{3,}\b/);
  return numMatch ? numMatch[0] : trimmed.slice(0, 40);
}

function normalizeDescription(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function lookupSupplierItemAlias(supplierId, description) {
  if (!supplierId) return null;
  const normalized = normalizeDescription(description);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('supplier_invoice_item_aliases')
    .select('*')
    .eq('supplier_id', supplierId)
    .eq('scanned_description_normalized', normalized)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01') return null;
    throw error;
  }
  if (!data) return null;

  const { data: lookup } = await supabase
    .from('v_master_lookup')
    .select('record_id, label, master_slug')
    .eq('record_id', data.master_record_id)
    .maybeSingle();

  supabase
    .from('supplier_invoice_item_aliases')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {})
    .catch(() => {});

  const itemCategory = data.item_category || categoryFromMasterSlug(lookup?.master_slug) || 'other';
  const cfg = getCategoryConfig(itemCategory);

  return {
    item_category: itemCategory,
    master_record_id: data.master_record_id,
    master_record_label: lookup?.label || '',
    master_slug: data.master_slug || lookup?.master_slug || cfg.masterSlug,
    item_code: inferItemCode(description),
    item_description: description,
    quantity_type: cfg.quantityType,
    match_confidence: 'high',
    match_source: 'alias',
  };
}

async function upsertSupplierItemAliases(supplierId, lines, actorId) {
  if (!supplierId) return;

  for (const line of lines || []) {
    const raw = line.scanned_description || line.description;
    const masterId = line.master_record_id;
    if (!raw || !masterId) continue;

    const normalized = normalizeDescription(raw);
    const cfg = getCategoryConfig(line.item_category || 'other');

    const row = {
      supplier_id: supplierId,
      scanned_description_raw: String(raw).trim(),
      scanned_description_normalized: normalized,
      master_record_id: masterId,
      master_slug: line.master_slug || cfg.masterSlug,
      item_category: line.item_category || 'other',
      created_by: actorId || null,
      last_used_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('supplier_invoice_item_aliases')
      .upsert(row, { onConflict: 'supplier_id,scanned_description_normalized' });

    if (error && error.code !== '42P01') {
      console.error('Alias upsert error:', error.message);
    }
  }
}

module.exports = {
  normalizeDescription,
  lookupSupplierItemAlias,
  upsertSupplierItemAliases,
};
