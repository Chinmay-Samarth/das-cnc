const INSPECTABLE_MASTER_SLUGS = [
  'raw-material',
  'component',
  'tool',
  'gauge-instruments',
];

function isInspectableMasterSlug(slug) {
  return INSPECTABLE_MASTER_SLUGS.includes(slug);
}

module.exports = {
  INSPECTABLE_MASTER_SLUGS,
  isInspectableMasterSlug,
};
