const ACTIVITY_TYPES = [
  'machining',
  'inspection',
  'outsource',
  'outsource_inward',
  'assembly',
  'firewall',
  'packing',
  'dispatch',
  'note',
];

const SCHEDULABLE_TYPES = new Set([
  'machining',
  'assembly',
  'inspection',
  'packing',
  'outsource',
]);

/** Terminal gate — Ready for Dispatch queue (not shop-floor EQL assign unless node has WC) */
const TERMINAL_DISPATCH_TYPES = new Set(['dispatch']);
const EDGE_KINDS = ['default', 'optional', 'rework'];
const INSPECTION_KINDS = ['in_process', 'final'];

const DEFAULT_LABELS = {
  machining: 'Machining',
  inspection: 'Inspection',
  outsource: 'Outsource',
  outsource_inward: 'Outsource Inward',
  assembly: 'Assembly',
  firewall: 'Fire Wall',
  packing: 'Packing',
  dispatch: 'Dispatch',
  note: 'Note',
  // legacy (display only; no longer creatable)
  material_issue: 'Material Issue',
  storage: 'Storage',
};

module.exports = {
  ACTIVITY_TYPES,
  SCHEDULABLE_TYPES,
  TERMINAL_DISPATCH_TYPES,
  EDGE_KINDS,
  INSPECTION_KINDS,
  DEFAULT_LABELS,
};
