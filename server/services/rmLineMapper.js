/**
 * Regex-based mapping of purchase invoice line descriptions → raw-material records.
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MASTER_SLUG = 'raw-material';
const FIELD_SLUGS = [
  'raw_material_id',
  'raw_material_size',
  'raw_material_grade',
  'characteristics',
];

let cache = { loadedAt: 0, items: [] };
const CACHE_TTL_MS = 60_000;

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[Øø⌀]/g, 'dia ')
    .replace(/\bdia\.?\b/g, 'dia ')
    .replace(/[×x]/gi, ' x ')
    .replace(/[^a-z0-9.\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sizeTokenVariants(size) {
  const raw = String(size || '').trim();
  if (!raw) return [];
  const norm = normalizeText(raw);
  const variants = new Set([norm]);

  // "8" and "8.0" / "Ø 8" style
  const num = norm.replace(/^dia\s+/, '').trim();
  if (num) {
    variants.add(num);
    variants.add(`dia ${num}`);
    const asFloat = Number(num);
    if (Number.isFinite(asFloat)) {
      variants.add(String(asFloat));
      variants.add(`dia ${asFloat}`);
    }
  }

  // rectangular "22.5 x 16.5"
  if (/\sx\s/.test(norm)) {
    variants.add(norm.replace(/\s+/g, ' '));
  }

  return [...variants].filter(Boolean);
}

function buildTokenRegex(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  // Word-ish boundaries so "8" does not match "18" / "80"
  const escaped = escapeRegex(t).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![a-z0-9.])${escaped}(?![a-z0-9.])`, 'i');
}

function labelFor(item) {
  const parts = [item.rmId, item.size, item.grade].filter(Boolean);
  return parts.join(' · ') || item.rmId || item.recordId;
}

async function loadRmCatalog(force = false) {
  const now = Date.now();
  if (!force && cache.items.length && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.items;
  }

  const { data: master, error: mErr } = await supabase
    .from('masters')
    .select('id')
    .eq('slug', MASTER_SLUG)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!master?.id) {
    cache = { loadedAt: now, items: [] };
    return [];
  }

  const { data: sections, error: sErr } = await supabase
    .from('master_sections')
    .select('id, slug')
    .eq('master_id', master.id);
  if (sErr) throw sErr;
  const general = (sections || []).find((s) => s.slug === 'general');
  if (!general) {
    cache = { loadedAt: now, items: [] };
    return [];
  }

  const { data: fields, error: fErr } = await supabase
    .from('section_fields')
    .select('id, slug')
    .eq('section_id', general.id)
    .in('slug', FIELD_SLUGS);
  if (fErr) throw fErr;

  const fieldBySlug = Object.fromEntries((fields || []).map((f) => [f.slug, f.id]));
  const fieldIds = Object.values(fieldBySlug);
  if (!fieldIds.length) {
    cache = { loadedAt: now, items: [] };
    return [];
  }

  const { data: records, error: rErr } = await supabase
    .from('master_records')
    .select('id')
    .eq('master_id', master.id);
  if (rErr) throw rErr;
  const recordIds = (records || []).map((r) => r.id);
  if (!recordIds.length) {
    cache = { loadedAt: now, items: [] };
    return [];
  }

  const { data: values, error: vErr } = await supabase
    .from('record_values')
    .select('record_id, field_id, value')
    .in('record_id', recordIds)
    .in('field_id', fieldIds);
  if (vErr) throw vErr;

  const byRecord = {};
  for (const row of values || []) {
    if (!byRecord[row.record_id]) byRecord[row.record_id] = {};
    const slug = Object.keys(fieldBySlug).find((s) => fieldBySlug[s] === row.field_id);
    if (slug) byRecord[row.record_id][slug] = row.value || '';
  }

  const items = recordIds.map((id) => {
    const vals = byRecord[id] || {};
    const size = String(vals.raw_material_size || '').trim();
    const grade = String(vals.raw_material_grade || '').trim();
    const rmId = String(vals.raw_material_id || '').trim();
    const characteristics = String(vals.characteristics || '').trim();
    return {
      recordId: id,
      rmId,
      size,
      grade,
      characteristics,
      sizeTokens: sizeTokenVariants(size),
      gradeNorm: normalizeText(grade),
      rmIdNorm: normalizeText(rmId),
      charNorm: normalizeText(characteristics),
      label: labelFor({
        recordId: id,
        rmId,
        size,
        grade,
      }),
    };
  });

  cache = { loadedAt: now, items };
  return items;
}

function scoreItemAgainstDescription(item, descriptionNorm) {
  if (!descriptionNorm) return { score: 0, sizeHit: false, gradeHit: false, idHit: false };

  let score = 0;
  let sizeHit = false;
  let gradeHit = false;
  let idHit = false;

  if (item.rmIdNorm) {
    const re = buildTokenRegex(item.rmIdNorm);
    if (re && re.test(descriptionNorm)) {
      idHit = true;
      score += 120;
    }
  }

  for (const token of item.sizeTokens) {
    const re = buildTokenRegex(token);
    if (re && re.test(descriptionNorm)) {
      sizeHit = true;
      score += 80;
      break;
    }
  }

  if (item.gradeNorm) {
    const re = buildTokenRegex(item.gradeNorm);
    if (re && re.test(descriptionNorm)) {
      gradeHit = true;
      score += 60;
    }
  }

  if (item.charNorm) {
    const re = buildTokenRegex(item.charNorm);
    if (re && re.test(descriptionNorm)) {
      score += 25;
    }
  }

  return { score, sizeHit, gradeHit, idHit };
}

/**
 * Map a single line description to an RM record when confidence is clear.
 */
function matchDescriptionToRm(description, catalog) {
  const descriptionNorm = normalizeText(description);
  if (!descriptionNorm || !catalog?.length) return null;

  const scored = catalog
    .map((item) => ({ item, ...scoreItemAgainstDescription(item, descriptionNorm) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;

  const top = scored[0];
  const tied = scored.filter((r) => r.score === top.score);
  if (tied.length > 1) return null;

  // Require size hit, unless RM ID matched exactly
  if (!top.idHit && !top.sizeHit) return null;

  // If size matched multiple distinct RMs, require grade (or id) to disambiguate
  if (top.sizeHit && !top.idHit) {
    const sameSize = scored.filter((r) => r.sizeHit && r.score >= 80);
    if (sameSize.length > 1 && !top.gradeHit) return null;
  }

  const confidence = top.idHit || (top.sizeHit && top.gradeHit) ? 'high' : 'medium';

  return {
    master_record_id: top.item.recordId,
    master_record_label: top.item.label,
    master_slug: MASTER_SLUG,
    item_category: 'raw_material',
    match_confidence: confidence,
    match_source: 'rm_regex',
  };
}

async function mapInvoiceLinesToRawMaterials(lines = []) {
  const catalog = await loadRmCatalog();
  return (lines || []).map((line) => {
    const description = line.scanned_description || line.description || '';
    const hit = matchDescriptionToRm(description, catalog);
    if (!hit) return { ...line };
    return {
      ...line,
      item_category: hit.item_category,
      master_record_id: hit.master_record_id,
      master_record_label: hit.master_record_label,
      master_slug: hit.master_slug,
      match_confidence: hit.match_confidence,
      match_source: hit.match_source,
    };
  });
}

function invalidateRmCatalogCache() {
  cache = { loadedAt: 0, items: [] };
}

module.exports = {
  normalizeText,
  matchDescriptionToRm,
  mapInvoiceLinesToRawMaterials,
  loadRmCatalog,
  invalidateRmCatalogCache,
};
