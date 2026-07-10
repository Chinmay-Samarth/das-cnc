const ACTIVITY_TYPES = [
  'material_issue',
  'storage',
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

const SCHEDULABLE_TYPES = new Set(['machining', 'assembly']);
const EDGE_KINDS = ['default', 'optional', 'rework'];
const INSPECTION_KINDS = ['in_process', 'final'];

const DEFAULT_LABELS = {
  material_issue: 'Material Issue',
  storage: 'Storage',
  machining: 'Machining',
  inspection: 'Inspection',
  outsource: 'Outsource',
  outsource_inward: 'Outsource Inward',
  assembly: 'Assembly',
  firewall: 'Fire Wall',
  packing: 'Packing',
  dispatch: 'Dispatch',
  note: 'Note',
};

module.exports = {
  ACTIVITY_TYPES,
  SCHEDULABLE_TYPES,
  EDGE_KINDS,
  INSPECTION_KINDS,
  DEFAULT_LABELS,
};
