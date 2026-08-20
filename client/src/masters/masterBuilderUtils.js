export const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'number', label: 'Number' },
  { value: 'float', label: 'Float' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'file', label: 'File' },
  { value: 'multi_file', label: 'Multi-file' },
  { value: 'relation', label: 'Relation' },
];

export function toSlug(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');
}

export function uid() {
  return `tmp_${Math.random().toString(36).slice(2, 9)}`;
}

export function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function emptyMaster() {
  return { id: null, name: '', slug: '', description: '' };
}

export function emptySection(order = 0) {
  return {
    _uid: uid(),
    id: null,
    name: '',
    slug: '',
    is_repeatable: false,
    order,
    fields: [],
    _slugManual: false,
  };
}

export function emptyField(order = 0) {
  return {
    _uid: uid(),
    id: null,
    label: '',
    slug: '',
    field_type: 'text',
    options: [],
    related_master_id: null,
    is_required: false,
    order,
    _slugManual: false,
  };
}

export function fieldTypeLabel(type) {
  return FIELD_TYPES.find((f) => f.value === type)?.label ?? type;
}
