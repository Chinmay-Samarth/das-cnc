import { GIRN_CATEGORIES } from '../girn/girnCategoryConfig';

export const STOCKABLE_MASTER_SLUGS = Object.values(GIRN_CATEGORIES)
  .filter((cfg) => cfg.updatesStock && cfg.masterSlug)
  .map((cfg) => cfg.masterSlug);

export function isStockableMasterSlug(slug) {
  return STOCKABLE_MASTER_SLUGS.includes(slug);
}
