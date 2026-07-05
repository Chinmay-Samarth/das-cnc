const { getCategoryConfig, requiresInspection } = require('../config/girnCategoryConfig');
const { getInspectionCheckpointsForItem } = require('./girnInspectionTemplateEngine');

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function allCheckpointsPassed(checkpoints = []) {
  if (!checkpoints.length) return false;
  return checkpoints.every((cp) => cp.passed === true || cp.passed === 'true');
}

async function itemInspectionComplete(item, logs = []) {
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

  const template = await getInspectionCheckpointsForItem(item, logs);
  if (!template.length) {
    return false;
  }

  const merged = template.map((cp) => {
    const saved = logs.find((log) => log.checkpoint === cp.checkpoint);
    return saved ? { ...cp, passed: saved.passed } : cp;
  });

  return allCheckpointsPassed(merged);
}

async function validateGirnInspection(items = []) {
  const incomplete = [];

  for (const item of items) {
    if (!requiresInspection(item.item_category || 'raw_material')) {
      continue;
    }

    const complete = await itemInspectionComplete(item, item.inspection_logs || []);
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
  allCheckpointsPassed,
  itemInspectionComplete,
  validateGirnInspection,
};
