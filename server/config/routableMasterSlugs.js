const ROUTABLE_MASTER_SLUGS = ['component'];

function isRoutableMasterSlug(slug) {
  return ROUTABLE_MASTER_SLUGS.includes(slug);
}

module.exports = {
  ROUTABLE_MASTER_SLUGS,
  isRoutableMasterSlug,
};
