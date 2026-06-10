export function getStandard(component) {
  const value = component?.standards ?? component?.standard ?? null;
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  if (value && typeof value === 'object') {
    return value;
  }
  return null;
}

export function toStandardForm(standard) {
  if (!standard) {
    return {
      minimum_quantity: '',
      maximum_quantity: '',
      location: '',
    };
  }

  return {
    minimum_quantity: standard.minimum_quantity ?? '',
    maximum_quantity: standard.maximum_quantity ?? '',
    location: standard.location || '',
  };
}
