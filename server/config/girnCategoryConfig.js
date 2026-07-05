const RAW_MATERIAL_CHECKPOINTS = [
  { checkpoint: 'Dimensional Check', standard: '', passed: false, inspector_note: '' },
  { checkpoint: 'Visual Inspection', standard: '', passed: false, inspector_note: '' },
  { checkpoint: 'Material Grade Verification', standard: '', passed: false, inspector_note: '' },
];

const COMPONENT_CHECKPOINTS = [
  { checkpoint: '100% Thread gauge / Tap gauge', standard: '', passed: false, inspector_note: '' },
  { checkpoint: '100% Air gauge', standard: '', passed: false, inspector_note: '' },
  { checkpoint: '100% Total length / Polishing / Vibrodeburring', standard: '', passed: false, inspector_note: '' },
  { checkpoint: 'Visual', standard: '', passed: false, inspector_note: '' },
  { checkpoint: 'Packing', standard: '', passed: false, inspector_note: '' },
];

const GAUGE_CHECKPOINTS = [
  { checkpoint: 'Dimensional Check', standard: '', passed: false, inspector_note: '' },
  { checkpoint: 'Visual Inspection', standard: '', passed: false, inspector_note: '' },
];

const GIRN_CATEGORIES = {
  raw_material: {
    label: 'Raw Material',
    masterSlug: 'raw-material',
    quantityType: 'kg',
    requiresInspection: true,
    updatesStock: true,
    inspectionCheckpoints: RAW_MATERIAL_CHECKPOINTS,
    keyFieldMatchers: ['rm-id', 'rm_id', 'rm id', 'raw-material-id'],
    codeFieldMatchers: ['rm-code', 'rm_code', 'material-code', 'code'],
    classifyPriority: 2,
  },
  component: {
    label: 'Component',
    masterSlug: 'component',
    quantityType: 'number',
    requiresInspection: true,
    updatesStock: true,
    assignsLot: true,
    inspectionCheckpoints: COMPONENT_CHECKPOINTS,
    keyFieldMatchers: ['component-id', 'component_id', 'component-code', 'code', 'part-no', 'part_no'],
    codeFieldMatchers: ['component-code', 'code', 'part-no', 'part_no'],
    classifyPriority: 1,
  },
  tool: {
    label: 'Tool',
    masterSlug: 'tool',
    quantityType: 'number',
    requiresInspection: true,
    updatesStock: true,
    inspectionCheckpoints: RAW_MATERIAL_CHECKPOINTS,
    keyFieldMatchers: ['tool-id', 'tool_id', 'tool-code', 'code'],
    codeFieldMatchers: ['tool-code', 'code', 'name'],
    classifyPriority: 3,
  },
  oil: {
    label: 'Oil',
    masterSlug: 'oil',
    quantityType: 'kg',
    requiresInspection: false,
    updatesStock: true,
    inspectionCheckpoints: [],
    keyFieldMatchers: ['oil-id', 'oil_id', 'oil-code', 'code'],
    codeFieldMatchers: ['oil-code', 'code', 'name'],
    classifyPriority: 5,
  },
  gauge: {
    label: 'Gauge',
    masterSlug: 'gauge-instruments',
    quantityType: 'number',
    requiresInspection: true,
    updatesStock: true,
    bifurcateOkNg: true,
    inspectionCheckpoints: GAUGE_CHECKPOINTS,
    keyFieldMatchers: ['gauge-id', 'gauge_id', 'gauge-code', 'code'],
    codeFieldMatchers: ['gauge-code', 'code', 'name'],
    classifyPriority: 4,
  },
  other: {
    label: 'Others',
    masterSlug: null,
    quantityType: 'number',
    requiresInspection: false,
    updatesStock: false,
    inspectionCheckpoints: [],
    keyFieldMatchers: [],
    codeFieldMatchers: [],
    classifyPriority: 99,
  },
};

const SLUG_TO_CATEGORY = Object.fromEntries(
  Object.entries(GIRN_CATEGORIES)
    .filter(([, cfg]) => cfg.masterSlug)
    .map(([category, cfg]) => [cfg.masterSlug, category])
);

const CLASSIFY_SLUGS = Object.values(GIRN_CATEGORIES)
  .map((cfg) => cfg.masterSlug)
  .filter(Boolean);

function getCategoryConfig(category) {
  return GIRN_CATEGORIES[category] || GIRN_CATEGORIES.other;
}

function categoryFromMasterSlug(slug) {
  return SLUG_TO_CATEGORY[slug] || null;
}

function requiresInspection(category) {
  return Boolean(getCategoryConfig(category).requiresInspection);
}

function updatesStock(category) {
  return Boolean(getCategoryConfig(category).updatesStock);
}

function girnNeedsInspection(items = []) {
  return items.some((item) => requiresInspection(item.item_category || 'raw_material'));
}

function girnCanAutoApprove(items = []) {
  if (!items.length) return false;
  return items.every((item) => {
    const cat = item.item_category || 'raw_material';
    return cat === 'oil' || cat === 'other';
  });
}

module.exports = {
  GIRN_CATEGORIES,
  SLUG_TO_CATEGORY,
  CLASSIFY_SLUGS,
  getCategoryConfig,
  categoryFromMasterSlug,
  requiresInspection,
  updatesStock,
  girnNeedsInspection,
  girnCanAutoApprove,
};
