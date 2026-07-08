const { GIRN_CATEGORIES } = require('./girnCategoryConfig');

const STOCKABLE_MASTER_SLUGS = Object.values(GIRN_CATEGORIES)
  .filter((cfg) => cfg.updatesStock && cfg.masterSlug)
  .map((cfg) => cfg.masterSlug);

function isStockableMasterSlug(slug) {
  return STOCKABLE_MASTER_SLUGS.includes(slug);
}

module.exports = {
  STOCKABLE_MASTER_SLUGS,
  isStockableMasterSlug,
};
