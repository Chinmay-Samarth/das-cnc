const { createClient } = require('@supabase/supabase-js');
const { nextDocumentNumber } = require('./blanketPosEngine');
const { generateComponentLotNumber } = require('./componentLotEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function getCardById(cardId) {
  return require('./productionCardEngine').getCardById(cardId);
}

async function loadOutsourceNode(nodeId) {
  if (!isValidUUID(nodeId)) throw httpError('activity_flow_node_id is required');
  const { data: node, error } = await supabase
    .from('activity_flow_nodes')
    .select('*')
    .eq('id', nodeId)
    .maybeSingle();
  if (error) throw error;
  if (!node) throw httpError('Outsource node not found', 404);
  if (node.activity_type !== 'outsource') throw httpError('Node must be an outsource activity');
  if (node.min_ship_qty == null || !(toNumber(node.min_ship_qty) > 0)) {
    throw httpError('Outsource node requires min_ship_qty on the activity flow');
  }
  return node;
}

async function sumBatchStagedQty(batchId) {
  const { data: links, error } = await supabase
    .from('outsource_batch_lots')
    .select('lot_id')
    .eq('batch_id', batchId);
  if (error) throw error;
  if (!links?.length) return { qty: 0, lotIds: [], lots: [] };

  const lotIds = links.map((l) => l.lot_id);
  const { data: lots, error: lErr } = await supabase
    .from('production_lots')
    .select('*')
    .in('id', lotIds);
  if (lErr) throw lErr;
  const qty = (lots || []).reduce((s, l) => s + toNumber(l.quantity), 0);
  return { qty, lotIds, lots: lots || [] };
}

async function refreshBatchStatus(batchId, minShipQty) {
  const { qty } = await sumBatchStagedQty(batchId);
  const ready = qty >= toNumber(minShipQty);
  const nextStatus = ready ? 'ready' : 'open';
  const { data: batch, error } = await supabase
    .from('outsource_batches')
    .update({ status: nextStatus })
    .eq('id', batchId)
    .in('status', ['open', 'ready'])
    .select('*')
    .single();
  if (error) throw error;
  return { batch, staged_qty: qty, min_ship_qty: toNumber(minShipQty), ready };
}

async function findOrCreateStagingBatch(masterRecordId, node) {
  const { data: openBatch, error } = await supabase
    .from('outsource_batches')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('activity_flow_node_id', node.id)
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw error;
  if (openBatch) return openBatch;

  const { data: readyBatch, error: rErr } = await supabase
    .from('outsource_batches')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('activity_flow_node_id', node.id)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rErr) throw rErr;
  if (readyBatch) return readyBatch;

  const { data: created, error: cErr } = await supabase
    .from('outsource_batches')
    .insert({
      master_record_id: masterRecordId,
      activity_flow_node_id: node.id,
      supplier_id: node.supplier_id || null,
      status: 'open',
    })
    .select('*')
    .single();
  if (cErr) {
    const { data: raced } = await supabase
      .from('outsource_batches')
      .select('*')
      .eq('master_record_id', masterRecordId)
      .eq('activity_flow_node_id', node.id)
      .in('status', ['open', 'ready'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (raced) return raced;
    throw cErr;
  }
  return created;
}

async function stageOutsourceLots(payload, actorEmployeeId, opts = {}) {
  const nodeId = payload.activity_flow_node_id;
  const lotIds = Array.isArray(payload.lot_ids) ? [...new Set(payload.lot_ids)] : [];
  if (!lotIds.length) throw httpError('lot_ids are required');

  const node = await loadOutsourceNode(nodeId);

  const { data: lots, error: lErr } = await supabase
    .from('production_lots')
    .select('*')
    .in('id', lotIds);
  if (lErr) throw lErr;
  if (!lots?.length || lots.length !== lotIds.length) {
    throw httpError('One or more lots not found');
  }

  for (const lot of lots) {
    if (!['in_process', 'received'].includes(lot.status)) {
      throw httpError(`Lot ${lot.lot_number} must be in_process or received to stage`);
    }
    if (lot.current_activity_flow_node_id !== nodeId) {
      throw httpError(`Lot ${lot.lot_number} is not at the outsource node`);
    }
  }

  const masterIds = [...new Set(lots.map((l) => l.master_record_id))];
  if (masterIds.length !== 1) {
    throw httpError('All lots in a batch must be the same component');
  }
  const masterRecordId = masterIds[0];

  if (!opts.isManager) {
    const canAct = lots.some((l) => l.assigned_employee_id === actorEmployeeId);
    if (!canAct) {
      const cardIds = [...new Set(lots.map((l) => l.production_card_id))];
      const { data: cards } = await supabase
        .from('production_cards')
        .select('id, assigned_employee_id')
        .in('id', cardIds);
      const ok = (cards || []).some((c) => c.assigned_employee_id === actorEmployeeId);
      if (!ok) throw httpError('Only the assigned employee can stage outsource lots', 403);
    }
  }

  let batch = await findOrCreateStagingBatch(masterRecordId, node);

  for (const lot of lots) {
    const { error: linkErr } = await supabase.from('outsource_batch_lots').insert({
      batch_id: batch.id,
      lot_id: lot.id,
    });
    if (linkErr) {
      if (String(linkErr.message || '').includes('duplicate') || linkErr.code === '23505') {
        throw httpError(`Lot ${lot.lot_number} is already staged`);
      }
      throw linkErr;
    }
    const { error: upErr } = await supabase
      .from('production_lots')
      .update({
        status: 'staged',
        current_activity_flow_node_id: nodeId,
        assigned_employee_id: null,
        assignment_status: 'unassigned',
        work_center_id: null,
      })
      .eq('id', lot.id);
    if (upErr) throw upErr;
  }

  const refreshed = await refreshBatchStatus(batch.id, node.min_ship_qty);
  return {
    batch: refreshed.batch,
    staged_qty: refreshed.staged_qty,
    min_ship_qty: refreshed.min_ship_qty,
    ready: refreshed.ready,
    lot_ids: lotIds,
  };
}

async function unstageOutsourceLots(payload, _actorEmployeeId, opts = {}) {
  const lotIds = Array.isArray(payload.lot_ids) ? [...new Set(payload.lot_ids)] : [];
  if (!lotIds.length) throw httpError('lot_ids are required');
  if (!opts.isManager) {
    throw httpError('Only a manager can unstage lots', 403);
  }

  const { data: links, error } = await supabase
    .from('outsource_batch_lots')
    .select('id, batch_id, lot_id')
    .in('lot_id', lotIds);
  if (error) throw error;
  if (!links?.length) throw httpError('No staged lots found');

  const batchIds = [...new Set(links.map((l) => l.batch_id))];
  for (const link of links) {
    const { error: dErr } = await supabase
      .from('outsource_batch_lots')
      .delete()
      .eq('id', link.id);
    if (dErr) throw dErr;
    const { error: upErr } = await supabase
      .from('production_lots')
      .update({
        status: 'in_process',
        assignment_status: 'unassigned',
      })
      .eq('id', link.lot_id)
      .eq('status', 'staged');
    if (upErr) throw upErr;
  }

  const results = [];
  for (const batchId of batchIds) {
    const { data: batch } = await supabase
      .from('outsource_batches')
      .select('*')
      .eq('id', batchId)
      .maybeSingle();
    if (!batch || !['open', 'ready'].includes(batch.status)) continue;
    const { data: node } = await supabase
      .from('activity_flow_nodes')
      .select('min_ship_qty')
      .eq('id', batch.activity_flow_node_id)
      .maybeSingle();
    results.push(await refreshBatchStatus(batchId, node?.min_ship_qty || 0));
  }
  return { unstaged: lotIds, batches: results };
}

async function sendOutsource(payload, actorEmployeeId, opts = {}) {
  const merge = !!payload.merge;
  let batch = null;
  let lots = [];
  let node = null;
  let shipLotIds = [];

  if (payload.batch_id) {
    if (!isValidUUID(payload.batch_id)) throw httpError('Invalid batch_id');
    const { data: b, error } = await supabase
      .from('outsource_batches')
      .select('*')
      .eq('id', payload.batch_id)
      .maybeSingle();
    if (error) throw error;
    if (!b) throw httpError('Batch not found', 404);
    if (b.status !== 'ready') {
      throw httpError('Batch must reach minimum ship qty before send (status ready)');
    }
    batch = b;
    node = await loadOutsourceNode(b.activity_flow_node_id);
    const summed = await sumBatchStagedQty(b.id);
    if (summed.qty < toNumber(node.min_ship_qty)) {
      throw httpError(
        `Staged qty ${summed.qty} is below min_ship_qty ${node.min_ship_qty}`
      );
    }
    lots = summed.lots;
    if (!lots.length) throw httpError('Batch has no staged lots');
    if (lots.some((l) => l.status !== 'staged')) {
      throw httpError('All batch lots must be staged');
    }
    shipLotIds = lots.map((l) => l.id);
  } else {
    const cardId = payload.production_card_id;
    const nodeId = payload.activity_flow_node_id;
    const lotIds = Array.isArray(payload.lot_ids) ? payload.lot_ids : [];
    if (!lotIds.length) throw httpError('lot_ids or batch_id are required');

    node = await loadOutsourceNode(nodeId);
    const card = await getCardById(cardId);
    const { data: onRoute } = await supabase
      .from('activity_flow_nodes')
      .select('id')
      .eq('id', nodeId)
      .eq('flow_version_id', card.activity_flow_version_id)
      .maybeSingle();
    if (!onRoute) throw httpError('Outsource node not found on this routing', 404);

    const { data: loaded, error: lErr } = await supabase
      .from('production_lots')
      .select('*')
      .in('id', lotIds);
    if (lErr) throw lErr;
    if (!loaded?.length || loaded.length !== lotIds.length) {
      throw httpError('One or more lots not found');
    }
    lots = loaded;

    if (lots.some((l) => l.status !== 'staged')) {
      throw httpError('Lots must be staged before send. Stage them to inventory first.');
    }
    if (lots.some((l) => l.current_activity_flow_node_id !== nodeId)) {
      throw httpError('Lots must be at the outsource node');
    }

    const { data: links } = await supabase
      .from('outsource_batch_lots')
      .select('batch_id, lot_id')
      .in('lot_id', lotIds);
    const batchIds = [...new Set((links || []).map((l) => l.batch_id))];
    if (batchIds.length !== 1) {
      throw httpError('Selected lots must belong to a single staging batch');
    }
    const { data: b } = await supabase
      .from('outsource_batches')
      .select('*')
      .eq('id', batchIds[0])
      .maybeSingle();
    if (!b || b.status !== 'ready') {
      throw httpError('Staging batch has not reached minimum components to send');
    }
    batch = b;
    const summed = await sumBatchStagedQty(b.id);
    lots = summed.lots;
    shipLotIds = lots.map((l) => l.id);
    if (summed.qty < toNumber(node.min_ship_qty)) {
      throw httpError(
        `Staged qty ${summed.qty} is below min_ship_qty ${node.min_ship_qty}`
      );
    }
  }

  if (!opts.isManager) {
    const cardIds = [...new Set(lots.map((l) => l.production_card_id))];
    const { data: cards } = await supabase
      .from('production_cards')
      .select('id, assigned_employee_id')
      .in('id', cardIds);
    const ok =
      lots.some((l) => l.assigned_employee_id === actorEmployeeId) ||
      (cards || []).some((c) => c.assigned_employee_id === actorEmployeeId);
    if (!ok) throw httpError('Only the assigned employee can send outsource', 403);
  }

  const primaryCardId = lots[0].production_card_id;

  if (merge) {
    if (lots.length < 2) throw httpError('Merge requires at least two lots');
    const sumQty = lots.reduce((s, l) => s + toNumber(l.quantity), 0);
    const lotNumber = await generateComponentLotNumber(lots[0].master_record_id);
    const { data: mergedLot, error: mErr } = await supabase
      .from('production_lots')
      .insert({
        lot_number: lotNumber,
        master_record_id: lots[0].master_record_id,
        production_card_id: primaryCardId,
        activity_flow_node_id: node.id,
        current_activity_flow_node_id: node.id,
        work_center_id: null,
        quantity: sumQty,
        status: 'staged',
        assignment_status: 'unassigned',
      })
      .select('*')
      .single();
    if (mErr) throw mErr;

    for (const src of lots) {
      const { error: uErr } = await supabase
        .from('production_lots')
        .update({ status: 'merged', merged_into_lot_id: mergedLot.id })
        .eq('id', src.id);
      if (uErr) throw uErr;
      const { error: jErr } = await supabase.from('production_lot_merges').insert({
        result_lot_id: mergedLot.id,
        source_lot_id: src.id,
      });
      if (jErr) throw jErr;
      await supabase.from('outsource_batch_lots').delete().eq('lot_id', src.id);
    }
    const { error: blErr } = await supabase.from('outsource_batch_lots').insert({
      batch_id: batch.id,
      lot_id: mergedLot.id,
    });
    if (blErr) throw blErr;
    shipLotIds = [mergedLot.id];
    lots = [mergedLot];
  }

  const shipmentNumber = await nextDocumentNumber('outsource_shipment', 'OS');
  const { data: shipment, error: sErr } = await supabase
    .from('outsource_shipments')
    .insert({
      shipment_number: shipmentNumber,
      production_card_id: primaryCardId,
      activity_flow_node_id: node.id,
      supplier_id: node.supplier_id || batch.supplier_id || null,
      status: 'sent',
      sent_at: new Date().toISOString(),
      notes: payload.notes || null,
      outsource_batch_id: batch.id,
    })
    .select('*')
    .single();
  if (sErr) throw sErr;

  for (const lot of lots.filter((l) => shipLotIds.includes(l.id))) {
    const sentQty = toNumber(lot.quantity);
    const { error: linkErr } = await supabase.from('outsource_shipment_lots').insert({
      shipment_id: shipment.id,
      lot_id: lot.id,
      sent_qty: sentQty,
      scrap_qty: 0,
    });
    if (linkErr) throw linkErr;
    const { error: lotUp } = await supabase
      .from('production_lots')
      .update({
        status: 'at_supplier',
        current_activity_flow_node_id: node.id,
        assigned_employee_id: null,
        assignment_status: 'unassigned',
      })
      .eq('id', lot.id);
    if (lotUp) throw lotUp;
  }

  const { error: bUp } = await supabase
    .from('outsource_batches')
    .update({ status: 'sent' })
    .eq('id', batch.id);
  if (bUp) throw bUp;

  return {
    shipment,
    lot_ids: shipLotIds,
    batch_id: batch.id,
    card_ids: [...new Set(lots.map((l) => l.production_card_id))],
  };
}

async function receiveOutsource(shipmentId, actorEmployeeId, opts = {}) {
  if (!isValidUUID(shipmentId)) throw httpError('Invalid shipment id');

  const payloadLines = Array.isArray(opts.lines) ? opts.lines : null;

  const { data: shipment, error } = await supabase
    .from('outsource_shipments')
    .select('*')
    .eq('id', shipmentId)
    .maybeSingle();
  if (error) throw error;
  if (!shipment) throw httpError('Shipment not found', 404);
  if (shipment.status !== 'sent') throw httpError('Only sent shipments can be received');

  const girnId = opts.girnId || shipment.girn_id || null;
  if (!girnId || !isValidUUID(girnId)) {
    throw httpError('File a GIRN for this shipment before receive', 409);
  }

  const card = await getCardById(shipment.production_card_id);
  if (!opts.isManager && card.assigned_employee_id !== actorEmployeeId) {
    throw httpError('Only the assigned employee or a manager can receive this shipment', 403);
  }

  const { data: links, error: lErr } = await supabase
    .from('outsource_shipment_lots')
    .select('*')
    .eq('shipment_id', shipmentId);
  if (lErr) throw lErr;
  if (!links?.length) throw httpError('Shipment has no lots');

  const lineMap = new Map();
  if (payloadLines?.length) {
    for (const line of payloadLines) {
      if (!isValidUUID(line.lot_id)) throw httpError('Invalid lot_id in receive lines');
      const rq = toNumber(line.received_qty);
      if (!(rq >= 0)) throw httpError('received_qty must be >= 0');
      lineMap.set(line.lot_id, rq);
    }
    for (const link of links) {
      if (!lineMap.has(link.lot_id)) {
        throw httpError('Receive lines must include every shipment lot');
      }
    }
  } else {
    for (const link of links) {
      lineMap.set(link.lot_id, toNumber(link.sent_qty));
    }
  }

  const { advanceLotAfterOp } = require('./lotTravelerEngine');
  const advancedLots = [];

  for (const link of links) {
    const sentQty = toNumber(link.sent_qty);
    const receivedQty = lineMap.get(link.lot_id);
    if (receivedQty > sentQty) {
      throw httpError(
        `Over-receive not allowed: lot received ${receivedQty} > sent ${sentQty}`
      );
    }
    const scrapQty = Math.round((sentQty - receivedQty) * 10000) / 10000;

    const { error: linkUp } = await supabase
      .from('outsource_shipment_lots')
      .update({
        received_qty: receivedQty,
        scrap_qty: scrapQty,
      })
      .eq('id', link.id);
    if (linkUp) throw linkUp;

    const { data: lot, error: lotErr } = await supabase
      .from('production_lots')
      .select('*')
      .eq('id', link.lot_id)
      .maybeSingle();
    if (lotErr) throw lotErr;
    if (!lot) throw httpError('Lot not found on shipment', 404);

    if (!(receivedQty > 0)) {
      const { data: emptied, error: eErr } = await supabase
        .from('production_lots')
        .update({
          status: 'consumed',
          scrap_qty: toNumber(lot.scrap_qty) + scrapQty,
          assigned_employee_id: null,
          assignment_status: 'unassigned',
        })
        .eq('id', lot.id)
        .select('*')
        .single();
      if (eErr) throw eErr;
      advancedLots.push({
        lot: emptied,
        advanced: false,
        ready_for_dispatch: false,
        from_employee_id: lot.assigned_employee_id,
        from_work_center_id: lot.work_center_id,
      });
      continue;
    }

    const { error: qtyUp } = await supabase
      .from('production_lots')
      .update({
        quantity: receivedQty,
        scrap_qty: toNumber(lot.scrap_qty) + scrapQty,
        status: 'received',
      })
      .eq('id', lot.id);
    if (qtyUp) throw qtyUp;

    const result = await advanceLotAfterOp(lot.id, shipment.activity_flow_node_id, {
      employee_id: actorEmployeeId,
      work_center_id: null,
      good_qty: receivedQty,
      scrap_qty: scrapQty,
    });
    advancedLots.push(result);
  }

  const { data: updated, error: upErr } = await supabase
    .from('outsource_shipments')
    .update({
      status: 'received',
      received_at: new Date().toISOString(),
      received_by: actorEmployeeId || null,
      girn_id: girnId,
    })
    .eq('id', shipmentId)
    .select('*')
    .single();
  if (upErr) throw upErr;

  return { shipment: updated, lots: advancedLots };
}

/**
 * Called after an outsource-return GIRN is registered.
 * Links girn → shipment and completes receive with full sent qty (v1).
 */
async function receiveOutsourceAfterGirn(shipmentId, girnId, actorEmployeeId, opts = {}) {
  if (!isValidUUID(shipmentId)) throw httpError('Invalid shipment id');
  if (!isValidUUID(girnId)) throw httpError('Invalid girn id');

  const { data: shipment, error } = await supabase
    .from('outsource_shipments')
    .select('id, status')
    .eq('id', shipmentId)
    .maybeSingle();
  if (error) throw error;
  if (!shipment) throw httpError('Shipment not found', 404);
  if (shipment.status !== 'sent') {
    throw httpError('Only sent shipments can be received via GIRN', 409);
  }

  const { error: linkErr } = await supabase
    .from('outsource_shipments')
    .update({ girn_id: girnId })
    .eq('id', shipmentId);
  if (linkErr) throw linkErr;

  return receiveOutsource(shipmentId, actorEmployeeId, {
    ...opts,
    girnId,
    isManager: true,
    lines: opts.lines,
  });
}

async function getOutsourceShipmentById(shipmentId) {
  if (!isValidUUID(shipmentId)) throw httpError('Invalid shipment id');
  const rows = await listOutsourceShipments({});
  const found = rows.find((s) => s.id === shipmentId);
  if (!found) {
    // list filters — fetch single even if received
    const { data: shipment, error } = await supabase
      .from('outsource_shipments')
      .select('*')
      .eq('id', shipmentId)
      .maybeSingle();
    if (error) throw error;
    if (!shipment) throw httpError('Shipment not found', 404);
    const enriched = await enrichShipments([shipment]);
    return enriched[0];
  }
  return found;
}

async function enrichBatches(batches) {
  if (!batches?.length) return [];
  const nodeIds = [...new Set(batches.map((b) => b.activity_flow_node_id))];
  const masterIds = [...new Set(batches.map((b) => b.master_record_id))];
  const supplierIds = [...new Set(batches.map((b) => b.supplier_id).filter(Boolean))];
  const batchIds = batches.map((b) => b.id);

  const [nodesRes, mastersRes, suppliersRes, linksRes] = await Promise.all([
    supabase
      .from('activity_flow_nodes')
      .select('id, label, activity_type, min_ship_qty, lead_time_days, supplier_id')
      .in('id', nodeIds),
    supabase.from('v_master_lookup').select('record_id, label').in('record_id', masterIds),
    supplierIds.length
      ? supabase.from('suppliers').select('id, name').in('id', supplierIds)
      : Promise.resolve({ data: [] }),
    supabase.from('outsource_batch_lots').select('batch_id, lot_id, staged_at').in('batch_id', batchIds),
  ]);
  if (nodesRes.error) throw nodesRes.error;
  if (mastersRes.error) throw mastersRes.error;
  if (suppliersRes.error) throw suppliersRes.error;
  if (linksRes.error) throw linksRes.error;

  const lotIds = [...new Set((linksRes.data || []).map((l) => l.lot_id))];
  const { data: lots, error: lotsErr } = lotIds.length
    ? await supabase
        .from('production_lots')
        .select(
          'id, lot_number, quantity, status, production_card_id, master_record_id, current_activity_flow_node_id'
        )
        .in('id', lotIds)
    : { data: [], error: null };
  if (lotsErr) throw lotsErr;

  const cardIds = [...new Set((lots || []).map((l) => l.production_card_id).filter(Boolean))];
  const { data: cards } = cardIds.length
    ? await supabase.from('production_cards').select('id, card_number, work_date').in('id', cardIds)
    : { data: [] };

  const nodeMap = new Map((nodesRes.data || []).map((n) => [n.id, n]));
  const masterMap = new Map((mastersRes.data || []).map((m) => [m.record_id, m]));
  const supplierMap = new Map((suppliersRes.data || []).map((s) => [s.id, s]));
  const lotMap = new Map((lots || []).map((l) => [l.id, l]));
  const cardMap = new Map((cards || []).map((c) => [c.id, c]));
  const linksByBatch = new Map();
  for (const link of linksRes.data || []) {
    const list = linksByBatch.get(link.batch_id) || [];
    list.push(link);
    linksByBatch.set(link.batch_id, list);
  }

  return batches.map((b) => {
    const node = nodeMap.get(b.activity_flow_node_id);
    const master = masterMap.get(b.master_record_id);
    const supplier = b.supplier_id ? supplierMap.get(b.supplier_id) : null;
    const minShip = toNumber(node?.min_ship_qty);
    const batchLots = (linksByBatch.get(b.id) || [])
      .map((link) => {
        const lot = lotMap.get(link.lot_id);
        if (!lot) return null;
        const card = cardMap.get(lot.production_card_id);
        return {
          ...lot,
          quantity: toNumber(lot.quantity),
          staged_at: link.staged_at,
          card_number: card?.card_number || null,
          work_date: card?.work_date || null,
        };
      })
      .filter(Boolean);
    const stagedQty = batchLots.reduce((s, l) => s + toNumber(l.quantity), 0);
    return {
      ...b,
      min_ship_qty: minShip,
      staged_qty: stagedQty,
      progress_label: `${stagedQty} / ${minShip}`,
      ready: stagedQty >= minShip && minShip > 0,
      node_label: node?.label || null,
      component_label: master?.label || null,
      supplier_name: supplier?.name || null,
      lots: batchLots,
    };
  });
}

async function listOutsourceBatches({ status } = {}) {
  let q = supabase
    .from('outsource_batches')
    .select('*')
    .order('updated_at', { ascending: false });
  if (status) {
    const statuses = String(status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length === 1) q = q.eq('status', statuses[0]);
    else if (statuses.length > 1) q = q.in('status', statuses);
  } else {
    q = q.in('status', ['open', 'ready']);
  }
  const { data, error } = await q;
  if (error) throw error;
  return enrichBatches(data || []);
}

async function listStageCandidates() {
  const { data: lots, error } = await supabase
    .from('production_lots')
    .select(
      'id, lot_number, quantity, status, production_card_id, master_record_id, current_activity_flow_node_id, assigned_employee_id'
    )
    .in('status', ['in_process', 'received'])
    .not('current_activity_flow_node_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  if (!lots?.length) return [];

  const nodeIds = [...new Set(lots.map((l) => l.current_activity_flow_node_id))];
  const { data: nodes, error: nErr } = await supabase
    .from('activity_flow_nodes')
    .select('id, label, activity_type, min_ship_qty, supplier_id')
    .in('id', nodeIds)
    .eq('activity_type', 'outsource');
  if (nErr) throw nErr;
  const outNodeMap = new Map((nodes || []).map((n) => [n.id, n]));

  const candidates = lots.filter((l) => outNodeMap.has(l.current_activity_flow_node_id));
  if (!candidates.length) return [];

  const masterIds = [...new Set(candidates.map((l) => l.master_record_id))];
  const cardIds = [...new Set(candidates.map((l) => l.production_card_id))];
  const [mastersRes, cardsRes] = await Promise.all([
    supabase.from('v_master_lookup').select('record_id, label').in('record_id', masterIds),
    supabase.from('production_cards').select('id, card_number, work_date').in('id', cardIds),
  ]);
  const masterMap = new Map((mastersRes.data || []).map((m) => [m.record_id, m]));
  const cardMap = new Map((cardsRes.data || []).map((c) => [c.id, c]));

  return candidates.map((l) => {
    const node = outNodeMap.get(l.current_activity_flow_node_id);
    const master = masterMap.get(l.master_record_id);
    const card = cardMap.get(l.production_card_id);
    return {
      ...l,
      quantity: toNumber(l.quantity),
      node_label: node?.label || null,
      min_ship_qty: node?.min_ship_qty != null ? toNumber(node.min_ship_qty) : null,
      component_label: master?.label || null,
      card_number: card?.card_number || null,
      work_date: card?.work_date || null,
    };
  });
}

async function getOutsourceShipmentById(shipmentId) {
  if (!isValidUUID(shipmentId)) throw httpError('Invalid shipment id');
  const { data: shipment, error } = await supabase
    .from('outsource_shipments')
    .select('*')
    .eq('id', shipmentId)
    .maybeSingle();
  if (error) throw error;
  if (!shipment) throw httpError('Shipment not found', 404);
  const enriched = await enrichShipments([shipment]);
  return enriched[0];
}

async function enrichShipments(shipments) {
  if (!shipments?.length) return [];

  const shipmentIds = shipments.map((s) => s.id);
  const nodeIds = [...new Set(shipments.map((s) => s.activity_flow_node_id))];
  const cardIds = [...new Set(shipments.map((s) => s.production_card_id).filter(Boolean))];
  const supplierIds = [...new Set(shipments.map((s) => s.supplier_id).filter(Boolean))];
  const girnIds = [...new Set(shipments.map((s) => s.girn_id).filter(Boolean))];

  const [linksRes, nodesRes, cardsRes, suppliersRes, girnsRes] = await Promise.all([
    supabase.from('outsource_shipment_lots').select('*').in('shipment_id', shipmentIds),
    supabase
      .from('activity_flow_nodes')
      .select('id, label, min_ship_qty, lead_time_days')
      .in('id', nodeIds),
    cardIds.length
      ? supabase
          .from('production_cards')
          .select('id, card_number, master_record_id, work_date')
          .in('id', cardIds)
      : Promise.resolve({ data: [] }),
    supplierIds.length
      ? supabase.from('suppliers').select('id, name').in('id', supplierIds)
      : Promise.resolve({ data: [] }),
    girnIds.length
      ? supabase.from('girns').select('id, girn_number, status').in('id', girnIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (linksRes.error) throw linksRes.error;
  if (nodesRes.error) throw nodesRes.error;
  if (cardsRes.error) throw cardsRes.error;
  if (suppliersRes.error) throw suppliersRes.error;
  if (girnsRes.error) throw girnsRes.error;

  const lotIds = [...new Set((linksRes.data || []).map((l) => l.lot_id))];
  const { data: lots } = lotIds.length
    ? await supabase
        .from('production_lots')
        .select('id, lot_number, quantity, status, master_record_id, production_card_id')
        .in('id', lotIds)
    : { data: [] };

  const masterIds = [
    ...new Set(
      [
        ...(lots || []).map((l) => l.master_record_id),
        ...(cardsRes.data || []).map((c) => c.master_record_id),
      ].filter(Boolean)
    ),
  ];
  const { data: masters } = masterIds.length
    ? await supabase.from('v_master_lookup').select('record_id, label').in('record_id', masterIds)
    : { data: [] };

  const lotMap = new Map((lots || []).map((l) => [l.id, l]));
  const nodeMap = new Map((nodesRes.data || []).map((n) => [n.id, n]));
  const cardMap = new Map((cardsRes.data || []).map((c) => [c.id, c]));
  const supplierMap = new Map((suppliersRes.data || []).map((s) => [s.id, s]));
  const masterMap = new Map((masters || []).map((m) => [m.record_id, m]));
  const girnMap = new Map((girnsRes.data || []).map((g) => [g.id, g]));
  const linksByShip = new Map();
  for (const link of linksRes.data || []) {
    const list = linksByShip.get(link.shipment_id) || [];
    list.push(link);
    linksByShip.set(link.shipment_id, list);
  }

  return shipments.map((s) => {
    const card = cardMap.get(s.production_card_id);
    const node = nodeMap.get(s.activity_flow_node_id);
    const supplier = s.supplier_id ? supplierMap.get(s.supplier_id) : null;
    const masterRecordId =
      card?.master_record_id ||
      (linksByShip.get(s.id) || [])
        .map((link) => lotMap.get(link.lot_id)?.master_record_id)
        .find(Boolean) ||
      null;
    const master = masterRecordId ? masterMap.get(masterRecordId) : null;
    const girn = s.girn_id ? girnMap.get(s.girn_id) : null;
    const shipLots = (linksByShip.get(s.id) || []).map((link) => {
      const lot = lotMap.get(link.lot_id);
      return {
        ...link,
        sent_qty: toNumber(link.sent_qty),
        received_qty: link.received_qty != null ? toNumber(link.received_qty) : null,
        scrap_qty: toNumber(link.scrap_qty),
        lot_number: lot?.lot_number || null,
        lot_status: lot?.status || null,
        lot_quantity: lot != null ? toNumber(lot.quantity) : null,
        master_record_id: lot?.master_record_id || null,
      };
    });
    return {
      ...s,
      master_record_id: masterRecordId,
      node_label: node?.label || null,
      card_number: card?.card_number || null,
      work_date: card?.work_date || null,
      supplier_name: supplier?.name || null,
      component_label: master?.label || null,
      girn_number: girn?.girn_number || null,
      girn_status: girn?.status || null,
      lots: shipLots,
      sent_qty_total: shipLots.reduce((a, l) => a + toNumber(l.sent_qty), 0),
    };
  });
}

async function listOutsourceShipments({ status } = {}) {
  let q = supabase
    .from('outsource_shipments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) {
    const statuses = String(status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length === 1) q = q.eq('status', statuses[0]);
    else if (statuses.length > 1) q = q.in('status', statuses);
  }
  const { data: shipments, error } = await q;
  if (error) throw error;
  return enrichShipments(shipments || []);
}

module.exports = {
  stageOutsourceLots,
  unstageOutsourceLots,
  sendOutsource,
  receiveOutsource,
  receiveOutsourceAfterGirn,
  getOutsourceShipmentById,
  listOutsourceBatches,
  listOutsourceShipments,
  listStageCandidates,
};
