const { createClient } = require('@supabase/supabase-js');
const { loadToolLifeMeta } = require('./masterFieldEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

async function seedToolInstancesFromGirnItem(girnItem, purchaseOrderLineId = null) {
  if ((girnItem.item_category || '') !== 'tool') return [];
  const masterRecordId = girnItem.master_record_id;
  if (!masterRecordId || !girnItem.id) return [];

  const { data: existing } = await supabase
    .from('tool_instances')
    .select('id')
    .eq('girn_item_id', girnItem.id)
    .limit(1);
  if ((existing || []).length) return [];

  const qty = Math.max(1, Math.floor(toNumber(girnItem.quantity)));
  const { lifeTotal, lifeUnit } = await loadToolLifeMeta(masterRecordId);
  const baseSerial =
    girnItem.inventory_number ||
    girnItem.item_code ||
    girnItem.rm_id ||
    `TOOL-${String(masterRecordId).slice(0, 8)}`;

  const instances = [];
  for (let i = 0; i < qty; i += 1) {
    const serial =
      qty === 1 ? String(baseSerial) : `${baseSerial}-${i + 1}`;
    const { data, error } = await supabase
      .from('tool_instances')
      .insert({
        master_record_id: masterRecordId,
        girn_item_id: girnItem.id,
        purchase_order_line_id: purchaseOrderLineId || girnItem.purchase_order_line_id || null,
        serial_number: serial,
        life_total: lifeTotal,
        life_remaining: lifeTotal,
        life_unit: lifeUnit,
        status: 'active',
      })
      .select()
      .single();
    if (error) throw error;
    instances.push(data);
  }
  return instances;
}

async function seedToolInstancesFromGirn(girnId) {
  const { data: items, error } = await supabase
    .from('girn_items')
    .select('*')
    .eq('girn_id', girnId);
  if (error) throw error;

  const all = [];
  for (const item of items || []) {
    if (item.item_category !== 'tool') continue;
    const created = await seedToolInstancesFromGirnItem(item);
    all.push(...created);
  }
  return all;
}

async function listToolInstances({ masterRecordId, status } = {}) {
  let query = supabase
    .from('tool_instances')
    .select('*')
    .order('received_at', { ascending: false });
  if (masterRecordId) query = query.eq('master_record_id', masterRecordId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;

  const recordIds = [...new Set((data || []).map((r) => r.master_record_id))];
  let labelById = {};
  if (recordIds.length) {
    const { data: lookups } = await supabase
      .from('v_master_lookup')
      .select('record_id, label')
      .in('record_id', recordIds);
    labelById = Object.fromEntries((lookups || []).map((l) => [l.record_id, l.label]));
  }

  return (data || []).map((row) => ({
    ...row,
    tool_label: labelById[row.master_record_id] || row.master_record_id,
    life_pct:
      row.life_total > 0
        ? Math.round((toNumber(row.life_remaining) / toNumber(row.life_total)) * 100)
        : 0,
  }));
}

async function getActiveInstanceForTool(masterRecordId, workCenterId = null) {
  let query = supabase
    .from('tool_instances')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .in('status', ['active', 'low_life'])
    .order('received_at', { ascending: true })
    .limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function decrementToolLife({
  masterRecordId,
  consumeQty,
  sourceType,
  sourceId,
  note,
}) {
  const consume = toNumber(consumeQty);
  if (consume <= 0) return null;

  const instance = await getActiveInstanceForTool(masterRecordId);
  if (!instance) return null;

  const remaining = Math.max(0, toNumber(instance.life_remaining) - consume);
  const threshold = toNumber(instance.life_total) * 0.1;
  let status = 'active';
  if (remaining <= 0) status = 'retired';
  else if (remaining <= threshold) status = 'low_life';

  const { data: updated, error } = await supabase
    .from('tool_instances')
    .update({
      life_remaining: remaining,
      status,
      retired_at: status === 'retired' ? new Date().toISOString() : null,
    })
    .eq('id', instance.id)
    .select()
    .single();
  if (error) throw error;

  await supabase.from('tool_life_ledger').insert({
    tool_instance_id: instance.id,
    change_qty: -consume,
    life_remaining_after: remaining,
    source_type: sourceType || null,
    source_id: sourceId || null,
    note: note || null,
  });

  if (status === 'low_life') {
    const { ensureNotification } = require('./notificationStore');
    await ensureNotification({
      audience: 'admin',
      category: 'inventory',
      type: 'tool_life_low',
      severity: 'critical',
      priority: 1,
      title: 'Tool life low',
      body: `${instance.serial_number}: ${remaining} remaining of ${instance.life_total}.`,
      dedupe_key: `tool:life_low:${instance.id}`,
      payload: { tool_instance_id: instance.id, master_record_id: masterRecordId, life_remaining: remaining },
    });
  }

  return updated;
}

async function backflushToolLifeFromBom({
  bomVersionId,
  deltaGood,
  productionCardId,
  parentMasterRecordId,
  cardNumber = null,
}) {
  const { loadBomEdges, enrichEdges } = require('./bomEngine');
  const delta = toNumber(deltaGood);
  if (delta <= 0 || !bomVersionId) return { lines: [] };

  const rawEdges = await loadBomEdges(bomVersionId);
  const edges = await enrichEdges(rawEdges);
  const toolEdges = (edges || []).filter(
    (e) => e.child_slug === 'tool' && e.parent_element_id === parentMasterRecordId
  );

  const lines = [];
  for (const edge of toolEdges) {
    const need = toNumber(edge.quantity) * delta;
    if (need <= 0) continue;
    const updated = await decrementToolLife({
      masterRecordId: edge.child_element_id,
      consumeQty: need,
      sourceType: 'production_card',
      sourceId: productionCardId,
      note: cardNumber ? `Backflush ${cardNumber}` : `Production card ${productionCardId}`,
    });
    if (updated) {
      lines.push({
        master_record_id: edge.child_element_id,
        label: edge.child_label,
        qty: need,
        life_remaining: updated.life_remaining,
      });
    }
  }

  if (lines.length) {
    const { triggerPredictiveReorderEvaluation } = require('./predictiveReorderEngine');
    triggerPredictiveReorderEvaluation();
  }

  return { lines };
}

module.exports = {
  seedToolInstancesFromGirn,
  seedToolInstancesFromGirnItem,
  listToolInstances,
  decrementToolLife,
  backflushToolLifeFromBom,
  getActiveInstanceForTool,
};
