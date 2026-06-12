export function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function labelToFieldKey(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'image', label: 'Image' },
  { value: 'select', label: 'List of options' },
  { value: 'relation', label: 'Relation' },
];

export function fieldTypeLabel(type) {
  return FIELD_TYPE_OPTIONS.find((option) => option.value === type)?.label || type;
}

export function emptyField(sortOrder = 0, type = 'text') {
  return {
    _key: newKey(),
    _keyManual: false,
    id: null,
    label: '',
    field_key: '',
    type,
    required: false,
    options: [],
    related_master_id: null,
    sort_order: sortOrder,
  };
}

export function emptyRule() {
  return {
    _key: newKey(),
    id: null,
    name: '',
    condition_field_id: '',
    operator: '<',
    compareMode: 'fixed',
    threshold_field_id: null,
    threshold_value: '',
    action_type: 'alert',
    action_message: '',
  };
}

export function fieldRef(field) {
  return field.id || field._key;
}

export const RULE_OPERATORS = [
  { value: '<', label: 'Less than' },
  { value: '>', label: 'Greater than' },
  { value: '=', label: 'Equal to' },
  { value: '<=', label: 'Less than or equal to' },
  { value: '>=', label: 'Greater than or equal to' },
  { value: '!=', label: 'Not equal to' },
];

export function operatorLabel(operator) {
  return RULE_OPERATORS.find((item) => item.value === operator)?.label || operator;
}

export function resolveFieldRef(ref, fields, previousFields = []) {
  if (!ref) return null;

  const byId = fields.find((field) => field.id === ref);
  if (byId) return byId.id;

  const byClientKey = fields.find((field) => field._key === ref);
  if (byClientKey) return byClientKey.id;

  const byFieldKey = fields.find((field) => field.field_key && field.field_key === ref);
  if (byFieldKey) return byFieldKey.id;

  const previousField = previousFields.find(
    (field) => field.id === ref || field._key === ref || field.field_key === ref
  );
  if (previousField?.field_key) {
    const remapped = fields.find((field) => field.field_key === previousField.field_key);
    if (remapped) return remapped.id;
  }

  return null;
}

export function mapFieldFromServer(field) {
  return {
    _key: field.id || newKey(),
    _keyManual: true,
    id: field.id,
    label: field.label || '',
    field_key: field.field_key || '',
    type: field.type || 'text',
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? field.options : [],
    related_master_id: field.related_master_id || null,
    sort_order: field.sort_order ?? 0,
  };
}

export function mapRuleFromServer(rule) {
  return {
    _key: rule.id || newKey(),
    id: rule.id,
    name: rule.name || '',
    condition_field_id: rule.condition_field_id || '',
    operator: rule.operator || '<',
    compareMode: rule.threshold_field_id ? 'field' : 'fixed',
    threshold_field_id: rule.threshold_field_id || null,
    threshold_value: rule.threshold_value ?? '',
    action_type: rule.action_type || 'alert',
    action_message: rule.action_message || '',
  };
}

export function fieldsToPayload(fields) {
  return fields.map((field, index) => ({
    id: field.id || null,
    label: field.label || null,
    field_key: field.field_key || null,
    type: field.type || 'text',
    required: Boolean(field.required),
    options: field.type === 'select' ? field.options : null,
    related_master_id: field.type === 'relation' ? field.related_master_id || null : null,
    sort_order: field.sort_order ?? index,
  }));
}

export function rulesToPayload(rules, fields, previousFields = []) {
  return rules.map((rule) => ({
    id: rule.id || null,
    name: rule.name || null,
    condition_field_id: resolveFieldRef(rule.condition_field_id, fields, previousFields),
    operator: rule.operator || null,
    threshold_field_id:
      rule.compareMode === 'field'
        ? resolveFieldRef(rule.threshold_field_id, fields, previousFields)
        : null,
    threshold_value:
      rule.compareMode === 'fixed' && rule.threshold_value !== ''
        ? rule.threshold_value
        : null,
    action_type: rule.action_type || null,
    action_message: rule.action_message || null,
  }));
}

export function compareFields(fields) {
  return fields.filter((field) => field.type === 'number' || field.type === 'date');
}

export function emptySection(sortOrder = 0) {
  return {
    _key: newKey(),
    id: null,
    name: '',
    description: '',
    sort_order: sortOrder,
    fields: [],
  };
}

export function mapSectionFieldFromServer(field) {
  return {
    _key: field.id || newKey(),
    _keyManual: true,
    id: field.id,
    label: field.label || '',
    field_key: field.field_key || '',
    type: field.type || 'text',
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? field.options : [],
    related_master_id: field.related_master_id || null,
    sort_order: field.sort_order ?? 0,
  };
}

export function mapSectionFromServer(section) {
  return {
    _key: section.id || newKey(),
    id: section.id,
    name: section.name || '',
    description: section.description || '',
    sort_order: section.sort_order ?? 0,
    fields: (section.master_section_fields || [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(mapSectionFieldFromServer),
  };
}

export function sectionsToPayload(sections) {
  return sections.map((section, sectionIndex) => ({
    name: section.name || null,
    description: section.description || null,
    sort_order: section.sort_order ?? sectionIndex,
    fields: (section.fields || []).map((field, fieldIndex) => ({
      label: field.label || null,
      field_key: field.field_key || null,
      type: field.type || 'text',
      required: Boolean(field.required),
      options: field.type === 'select' ? field.options : null,
      related_master_id: field.type === 'relation' ? field.related_master_id || null : null,
      sort_order: field.sort_order ?? fieldIndex,
    })),
  }));
}

function evaluateOperator(lhs, operator, rhs) {
  switch (operator) {
    case '<':
      return lhs < rhs;
    case '>':
      return lhs > rhs;
    case '=':
      return lhs === rhs;
    case '<=':
      return lhs <= rhs;
    case '>=':
      return lhs >= rhs;
    case '!=':
      return lhs !== rhs;
    default:
      return false;
  }
}

export function getNumericFieldValue(field, rawValue) {
  if (rawValue === '' || rawValue == null) return null;
  if (field?.type === 'date') {
    const timestamp = Date.parse(rawValue);
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  const num = parseFloat(rawValue);
  return Number.isNaN(num) ? null : num;
}

export function evaluateRules(fields, values, rules, overrides) {
  return rules
    .map((rule) => {
      const lhsField = fields.find((field) => field.id === rule.condition_field_id);
      const lhs = getNumericFieldValue(lhsField, values[rule.condition_field_id]);
      const rhs = rule.threshold_field_id
        ? getNumericFieldValue(
            fields.find((field) => field.id === rule.threshold_field_id),
            values[rule.threshold_field_id]
          )
        : parseFloat(overrides[rule.id] ?? rule.threshold_value);

      if (lhs === null || rhs === null || Number.isNaN(rhs)) return null;

      const triggered = evaluateOperator(lhs, rule.operator, rhs);
      return triggered ? rule : null;
    })
    .filter(Boolean);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}
