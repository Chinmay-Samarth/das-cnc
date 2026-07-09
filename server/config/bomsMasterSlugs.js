const BOMS_MASTER_SLUGS = ['component'];

function isBomsMasterSlug(slug) {
  return BOMS_MASTER_SLUGS.includes(slug);
}

module.exports = {
  BOMS_MASTER_SLUGS,
  isBomsMasterSlug,
};
