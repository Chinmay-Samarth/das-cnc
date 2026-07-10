export const ACTIVITY_TYPES = [
  { value: 'material_issue', label: 'Material Issue', color: '#64748b' },
  { value: 'storage', label: 'Storage', color: '#78716c' },
  { value: 'machining', label: 'Machining', color: '#2563eb' },
  { value: 'inspection', label: 'Inspection', color: '#7c3aed' },
  { value: 'outsource', label: 'Outsource', color: '#ea580c' },
  { value: 'outsource_inward', label: 'Outsource Inward', color: '#c2410c' },
  { value: 'assembly', label: 'Assembly', color: '#0891b2' },
  { value: 'firewall', label: 'Fire Wall', color: '#dc2626' },
  { value: 'packing', label: 'Packing', color: '#059669' },
  { value: 'dispatch', label: 'Dispatch', color: '#0f766e' },
  { value: 'note', label: 'Note', color: '#6b7280' },
];

export function getActivityTypeMeta(type) {
  return ACTIVITY_TYPES.find((t) => t.value === type) || {
    value: type,
    label: type,
    color: '#6b7280',
  };
}

export const SCHEDULABLE_TYPES = new Set(['machining', 'assembly']);
