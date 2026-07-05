const { createClient } = require('@supabase/supabase-js');
const {
  GIRN_CATEGORIES,
  CLASSIFY_SLUGS,
  categoryFromMasterSlug,
  getCategoryConfig,
} = require('../config/girnCategoryConfig');

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

function scoreMatch(row, searchTerms) {
  const label = String(row.label || '').toLowerCase();
  let score = 0;

  for (const term of searchTerms) {
    const t = String(term || '').trim().toLowerCase();
    if (!t) continue;
    if (label === t) score += 100;
    else if (label.includes(t)) score += 50;
    else if (t.includes(label) && label.length > 2) score += 30;
  }

  const category = categoryFromMasterSlug(row.master_slug);
  if (category) {
    score += 10 - (getCategoryConfig(category).classifyPriority || 10);
  }

  return score;
}

async function searchMasterLookup(searchTerms) {
  const terms = searchTerms.filter((t) => String(t || '').trim());
  if (!terms.length) return [];

  const results = [];

  for (const slug of CLASSIFY_SLUGS) {
    for (const term of terms) {
      const pattern = `%${String(term).trim()}%`;
      const { data, error } = await supabase
        .from('v_master_lookup')
        .select('record_id, label, master_slug')
        .eq('master_slug', slug)
        .ilike('label', pattern)
        .limit(10);

      if (error) throw error;
      results.push(...(data || []));
    }
  }

  return results;
}

async function classifyLineItem(lineItem = {}) {
  const description = lineItem.description || lineItem.rm_code || lineItem.item_description || '';
  const itemCode = lineItem.item_code || inferItemCode(description);
  const searchTerms = [itemCode, description].filter(Boolean);

  const matches = await searchMasterLookup(searchTerms);

  let best = null;
  let bestScore = 0;

  for (const row of matches) {
    const score = scoreMatch(row, searchTerms);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  if (best) {
    const itemCategory = categoryFromMasterSlug(best.master_slug) || 'other';
    const cfg = getCategoryConfig(itemCategory);

    return {
      item_category: itemCategory,
      master_record_id: best.record_id,
      master_record_label: best.label,
      item_code: itemCode,
      item_description: description,
      quantity_type: cfg.quantityType,
      match_confidence: bestScore >= 100 ? 'high' : bestScore >= 50 ? 'medium' : 'low',
    };
  }

  return {
    item_category: 'other',
    master_record_id: null,
    master_record_label: '',
    item_code: itemCode,
    item_description: description,
    quantity_type: getCategoryConfig('other').quantityType,
    match_confidence: 'none',
  };
}

async function classifyLineItems(lineItems = []) {
  const classified = [];
  for (const item of lineItems) {
    classified.push(await classifyLineItem(item));
  }
  return classified;
}

module.exports = {
  inferItemCode,
  classifyLineItem,
  classifyLineItems,
};
