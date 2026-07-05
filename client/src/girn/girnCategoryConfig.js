export const GIRN_CATEGORIES = {
  raw_material: {
    label: 'Raw Material',
    masterSlug: 'raw-material',
    quantityType: 'kg',
    requiresInspection: true,
    updatesStock: true,
    inspectionCheckpoints: [
      { checkpoint: 'Dimensional Check', standard: '', passed: false, inspector_note: '' },
      { checkpoint: 'Visual Inspection', standard: '', passed: false, inspector_note: '' },
      { checkpoint: 'Material Grade Verification', standard: '', passed: false, inspector_note: '' },
    ],
    keyFieldMatchers: ['rm-id', 'rm_id', 'rm id'],
    codeFieldMatchers: ['rm-code', 'rm_code', 'material-code', 'code'],
  },
  component: {
    label: 'Component',
    masterSlug: 'component',
    quantityType: 'number',
    requiresInspection: true,
    updatesStock: true,
    assignsLot: true,
    inspectionCheckpoints: [
      { checkpoint: '100% Thread gauge / Tap gauge', standard: '', passed: false, inspector_note: '' },
      { checkpoint: '100% Air gauge', standard: '', passed: false, inspector_note: '' },
      { checkpoint: '100% Total length / Polishing / Vibrodeburring', standard: '', passed: false, inspector_note: '' },
      { checkpoint: 'Visual', standard: '', passed: false, inspector_note: '' },
      { checkpoint: 'Packing', standard: '', passed: false, inspector_note: '' },
    ],
    keyFieldMatchers: ['component-id', 'component-code', 'code', 'part-no'],
    codeFieldMatchers: ['component-code', 'code', 'part-no'],
  },
  tool: {
    label: 'Tool',
    masterSlug: 'tool',
    quantityType: 'number',
    requiresInspection: true,
    updatesStock: true,
    inspectionCheckpoints: [
      { checkpoint: 'Dimensional Check', standard: '', passed: false, inspector_note: '' },
      { checkpoint: 'Visual Inspection', standard: '', passed: false, inspector_note: '' },
      { checkpoint: 'Material Grade Verification', standard: '', passed: false, inspector_note: '' },
    ],
    keyFieldMatchers: ['tool-id', 'tool-code', 'code'],
    codeFieldMatchers: ['tool-code', 'code'],
  },
  oil: {
    label: 'Oil',
    masterSlug: 'oil',
    quantityType: 'kg',
    requiresInspection: false,
    updatesStock: true,
    inspectionCheckpoints: [],
    keyFieldMatchers: ['oil-id', 'oil-code', 'code'],
    codeFieldMatchers: ['oil-code', 'code'],
  },
  gauge: {
    label: 'Gauge',
    masterSlug: 'gauge',
    quantityType: 'number',
    requiresInspection: true,
    updatesStock: true,
    bifurcateOkNg: true,
    inspectionCheckpoints: [
      { checkpoint: 'Dimensional Check', standard: '', passed: false, inspector_note: '' },
      { checkpoint: 'Visual Inspection', standard: '', passed: false, inspector_note: '' },
    ],
    keyFieldMatchers: ['gauge-id', 'gauge-code', 'code'],
    codeFieldMatchers: ['gauge-code', 'code'],
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
  },
};

export const CATEGORY_OPTIONS = Object.entries(GIRN_CATEGORIES).map(([value, cfg]) => ({
  value,
  label: cfg.label,
}));

export function getCategoryConfig(category) {
  return GIRN_CATEGORIES[category] || GIRN_CATEGORIES.other;
}

export function requiresInspection(category) {
  return Boolean(getCategoryConfig(category).requiresInspection);
}

export function hasMasterLink(category) {
  return Boolean(getCategoryConfig(category).masterSlug);
}
