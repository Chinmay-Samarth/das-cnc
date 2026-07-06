function computeSampleSize(lotQty, ruleType, ruleValue) {
  const lot = Math.max(0, Number(lotQty) || 0);
  if (lot === 0) return 0;

  const value = Number(ruleValue) || 0;
  if (ruleType === 'fixed_count') {
    return Math.min(Math.ceil(value), lot);
  }

  return Math.max(1, Math.ceil((lot * value) / 100));
}

module.exports = {
  computeSampleSize,
};
