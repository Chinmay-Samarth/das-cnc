const { getCategoryConfig, requiresInspection } = require('../config/girnCategoryConfig');

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function itemInspectionComplete(item, inspection) {
  const category = item.item_category || 'raw_material';

  if (!requiresInspection(category)) {
    return true;
  }

  if (category === 'gauge') {
    const ok = toNumber(item.quantity_ok);
    const ng = toNumber(item.quantity_not_ok);
    const total = toNumber(item.quantity);
    if (ok + ng !== total) return false;
    if (ok <= 0 && ng > 0) return false;
  }

  if (!inspection) return false;
  return inspection.overall_result === 'pass';
}

async function validateGirnInspection(items = []) {
  const incomplete = [];

  for (const item of items) {
    if (!requiresInspection(item.item_category || 'raw_material')) {
      continue;
    }

    const complete = itemInspectionComplete(item, item.inspection);
    if (!complete) {
      incomplete.push(item.id);
    }
  }

  if (incomplete.length) {
    return `Inspection incomplete for ${incomplete.length} item(s)`;
  }

  return null;
}

module.exports = {
  itemInspectionComplete,
  validateGirnInspection,
};
