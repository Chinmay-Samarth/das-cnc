export const INSPECTABLE_MASTER_SLUGS = [
  'raw-material',
  'component',
  'tool',
  'gauge-instruments',
];

export function isInspectableMasterSlug(slug) {
  return INSPECTABLE_MASTER_SLUGS.includes(slug);
}
