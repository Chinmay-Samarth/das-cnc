export const ROUTABLE_MASTER_SLUGS = ['component'];

export function isRoutableMasterSlug(slug) {
  return ROUTABLE_MASTER_SLUGS.includes(slug);
}
