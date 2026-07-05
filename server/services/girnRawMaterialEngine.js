const { resolveGirnItems, resolveGirnItem } = require('./girnItemResolver');

async function ensureRawMaterialId(item) {
  const resolved = await resolveGirnItem({ ...item, item_category: 'raw_material' });
  return resolved.master_record_id || resolved.raw_material_id;
}

async function resolveGirnItemMaterials(items) {
  const resolved = await resolveGirnItems(
    items.map((item) => ({ ...item, item_category: item.item_category || 'raw_material' }))
  );
  return resolved.map((item) => ({
    ...item,
    raw_material_id: item.master_record_id || item.raw_material_id,
  }));
}

module.exports = {
  ensureRawMaterialId,
  resolveGirnItemMaterials,
};
