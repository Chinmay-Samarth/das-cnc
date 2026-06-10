export const CATEGORY_TYPE_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'image', label: 'Image' },
];

export function categoryTypeLabel(type) {
  return CATEGORY_TYPE_OPTIONS.find((option) => option.value === type)?.label || type;
}

export function createEmptyCategory(newKey, valueType = 'text') {
  return {
    _key: newKey(),
    key: '',
    value_type: valueType,
    value: '',
    image_url: '',
  };
}
