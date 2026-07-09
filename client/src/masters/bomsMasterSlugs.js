export const BOMS_MASTER_SLUGS = ['component'];

export function isBomsMasterSlug(slug) {
  return BOMS_MASTER_SLUGS.includes(slug);
}
