const { createClient } = require('@supabase/supabase-js');
const {
  ACTIVITY_TYPES,
  SCHEDULABLE_TYPES,
  EDGE_KINDS,
  INSPECTION_KINDS,
  DEFAULT_LABELS,
} = require('../config/activityFlowTypes');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function loadNodes(versionId) {
  const { data, error } = await supabase
    .from('activity_flow_nodes')
    .select('*')
    .eq('flow_version_id', versionId)
    .order('sequence', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function loadEdges(versionId) {
  const { data, error } = await supabase
    .from('activity_flow_edges')
    .select('*')
    .eq('flow_version_id', versionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function enrichGraph(nodes, edges) {
  const wcIds = [...new Set(nodes.map((n) => n.work_center_id).filter(Boolean))];
  const planIds = [...new Set(nodes.map((n) => n.inspection_plan_id).filter(Boolean))];
  const supplierIds = [...new Set(nodes.map((n) => n.supplier_id).filter(Boolean))];

  const [wcRes, planRes, supplierRes] = await Promise.all([
    wcIds.length
      ? supabase.from('work_centers').select('id, code, name').in('id', wcIds)
      : Promise.resolve({ data: [] }),
    planIds.length
      ? supabase.from('inspection_plans').select('id, plan_code, revision, status').in('id', planIds)
      : Promise.resolve({ data: [] }),
    supplierIds.length
      ? supabase.from('suppliers').select('id, name').in('id', supplierIds)
      : Promise.resolve({ data: [] }),
  ]);

  if (wcRes.error) throw wcRes.error;
  if (planRes.error) throw planRes.error;
  if (supplierRes.error) throw supplierRes.error;

  const wcMap = new Map((wcRes.data || []).map((r) => [r.id, r]));
  const planMap = new Map((planRes.data || []).map((r) => [r.id, r]));
  const supplierMap = new Map((supplierRes.data || []).map((r) => [r.id, r]));

  const enrichedNodes = nodes.map((n) => {
    const wc = n.work_center_id ? wcMap.get(n.work_center_id) : null;
    const plan = n.inspection_plan_id ? planMap.get(n.inspection_plan_id) : null;
    const supplier = n.supplier_id ? supplierMap.get(n.supplier_id) : null;
    return {
      ...n,
      setup_time_minutes: n.setup_time_minutes != null ? Number(n.setup_time_minutes) : null,
      run_time_per_unit_minutes:
        n.run_time_per_unit_minutes != null ? Number(n.run_time_per_unit_minutes) : null,
      queue_time_minutes: n.queue_time_minutes != null ? Number(n.queue_time_minutes) : null,
      lead_time_days: n.lead_time_days != null ? Number(n.lead_time_days) : null,
      position_x: Number(n.position_x) || 0,
      position_y: Number(n.position_y) || 0,
      work_center_code: wc?.code || null,
      work_center_name: wc?.name || null,
      inspection_plan_code: plan?.plan_code || null,
      inspection_plan_revision: plan?.revision ?? null,
      supplier_name: supplier?.name || null,
    };
  });

  return { nodes: enrichedNodes, edges: edges || [] };
}

async function attachVersionPayload(version) {
  if (!version) return null;
  const [nodes, edges] = await Promise.all([
    loadNodes(version.id),
    loadEdges(version.id),
  ]);
  const graph = await enrichGraph(nodes, edges);
  return { ...version, ...graph };
}

async function getVersionRow(versionId) {
  const { data, error } = await supabase
    .from('activity_flow_versions')
    .select('*')
    .eq('id', versionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getDraftVersionRow(masterRecordId) {
  const { data, error } = await supabase
    .from('activity_flow_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'draft')
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getActiveVersionRow(masterRecordId) {
  const { data, error } = await supabase
    .from('activity_flow_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getDraftVersionForRecord(masterRecordId) {
  const row = await getDraftVersionRow(masterRecordId);
  return attachVersionPayload(row);
}

async function getActiveVersionForRecord(masterRecordId) {
  const row = await getActiveVersionRow(masterRecordId);
  return attachVersionPayload(row);
}

async function getLatestVersionForRecord(masterRecordId) {
  const { data, error } = await supabase
    .from('activity_flow_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return attachVersionPayload(data);
}

async function getVersionById(versionId, masterRecordId) {
  const { data, error } = await supabase
    .from('activity_flow_versions')
    .select('*')
    .eq('id', versionId)
    .eq('master_record_id', masterRecordId)
    .maybeSingle();

  if (error) throw error;
  return attachVersionPayload(data);
}

async function getVersionHistory(masterRecordId) {
  const { data, error } = await supabase
    .from('activity_flow_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .order('revision', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function createInitialDraft(masterRecordId, createdBy) {
  const { data, error } = await supabase
    .from('activity_flow_versions')
    .insert({
      master_record_id: masterRecordId,
      revision: 1,
      status: 'draft',
      created_by: createdBy || null,
    })
    .select()
    .single();

  if (error) throw error;
  return attachVersionPayload(data);
}

async function cloneVersionRevision(sourceVersion, createdBy) {
  const { data: newVersion, error: insertErr } = await supabase
    .from('activity_flow_versions')
    .insert({
      master_record_id: sourceVersion.master_record_id,
      revision: sourceVersion.revision + 1,
      status: 'draft',
      created_by: createdBy || sourceVersion.created_by || null,
    })
    .select()
    .single();

  if (insertErr) throw insertErr;

  const sourceNodes = sourceVersion.nodes || (await loadNodes(sourceVersion.id));
  const sourceEdges = sourceVersion.edges || (await loadEdges(sourceVersion.id));

  const idMap = new Map();

  if (sourceNodes.length) {
    for (const n of sourceNodes) {
      const { data: insertedNode, error: nodeErr } = await supabase
        .from('activity_flow_nodes')
        .insert({
          flow_version_id: newVersion.id,
          activity_type: n.activity_type,
          label: n.label,
          sequence: n.sequence,
          work_center_id: n.work_center_id,
          setup_time_minutes: n.setup_time_minutes,
          run_time_per_unit_minutes: n.run_time_per_unit_minutes,
          queue_time_minutes: n.queue_time_minutes,
          inspection_plan_id: n.inspection_plan_id,
          inspection_kind: n.inspection_kind,
          supplier_id: n.supplier_id,
          lead_time_days: n.lead_time_days,
          position_x: n.position_x,
          position_y: n.position_y,
          notes: n.notes,
          config: n.config || {},
        })
        .select('id')
        .single();

      if (nodeErr) throw nodeErr;
      idMap.set(n.id, insertedNode.id);
    }
  }

  if (sourceEdges.length) {
    const edgeRows = sourceEdges
      .map((e) => {
        const fromId = idMap.get(e.from_node_id);
        const toId = idMap.get(e.to_node_id);
        if (!fromId || !toId) return null;
        return {
          flow_version_id: newVersion.id,
          from_node_id: fromId,
          to_node_id: toId,
          label: e.label,
          edge_kind: e.edge_kind || 'default',
        };
      })
      .filter(Boolean);

    if (edgeRows.length) {
      const { error: edgeErr } = await supabase.from('activity_flow_edges').insert(edgeRows);
      if (edgeErr) throw edgeErr;
    }
  }

  return attachVersionPayload(newVersion);
}

async function ensureDraftVersion(masterRecordId, createdBy) {
  const existing = await getDraftVersionForRecord(masterRecordId);
  if (existing) return existing;

  const active = await getActiveVersionForRecord(masterRecordId);
  if (active) {
    return cloneVersionRevision(active, createdBy);
  }

  return createInitialDraft(masterRecordId, createdBy);
}

function assertDraftVersion(version) {
  if (!version) throw httpError('Activity flow version not found', 404);
  if (version.status !== 'draft') {
    throw httpError('Only draft activity flow versions can be edited', 400);
  }
}

function parseOptionalNumber(value, field, { min = 0, allowNull = true } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return allowNull ? null : undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) throw httpError(`${field} must be a number`);
  if (num < min) throw httpError(`${field} must be >= ${min}`);
  return num;
}

function validateNodeFields(payload, { partial = false, existing = null } = {}) {
  const type = payload.activity_type ?? existing?.activity_type;
  const fields = {};

  if (payload.activity_type !== undefined) {
    if (!ACTIVITY_TYPES.includes(payload.activity_type)) {
      throw httpError(`Invalid activity_type. Allowed: ${ACTIVITY_TYPES.join(', ')}`);
    }
    fields.activity_type = payload.activity_type;
  } else if (!partial) {
    throw httpError('activity_type is required');
  }

  if (payload.label !== undefined) {
    const label = String(payload.label || '').trim();
    if (!label) throw httpError('label is required');
    fields.label = label;
  } else if (!partial) {
    fields.label = DEFAULT_LABELS[type] || type;
  }

  if (payload.sequence !== undefined) {
    const seq = parseInt(payload.sequence, 10);
    if (!Number.isFinite(seq) || seq < 1) throw httpError('sequence must be >= 1');
    fields.sequence = seq;
  }

  if (payload.work_center_id !== undefined) {
    const id = payload.work_center_id;
    if (id && !isValidUUID(id)) throw httpError('Invalid work_center_id');
    fields.work_center_id = id || null;
  }

  if (payload.setup_time_minutes !== undefined) {
    fields.setup_time_minutes = parseOptionalNumber(payload.setup_time_minutes, 'setup_time_minutes');
  }
  if (payload.run_time_per_unit_minutes !== undefined) {
    fields.run_time_per_unit_minutes = parseOptionalNumber(
      payload.run_time_per_unit_minutes,
      'run_time_per_unit_minutes'
    );
  }
  if (payload.queue_time_minutes !== undefined) {
    fields.queue_time_minutes = parseOptionalNumber(payload.queue_time_minutes, 'queue_time_minutes');
  }

  if (payload.inspection_plan_id !== undefined) {
    const id = payload.inspection_plan_id;
    if (id && !isValidUUID(id)) throw httpError('Invalid inspection_plan_id');
    fields.inspection_plan_id = id || null;
  }

  if (payload.inspection_kind !== undefined) {
    const kind = payload.inspection_kind || null;
    if (kind && !INSPECTION_KINDS.includes(kind)) {
      throw httpError('inspection_kind must be in_process or final');
    }
    fields.inspection_kind = kind;
  }

  if (payload.supplier_id !== undefined) {
    const id = payload.supplier_id;
    if (id && !isValidUUID(id)) throw httpError('Invalid supplier_id');
    fields.supplier_id = id || null;
  }

  if (payload.lead_time_days !== undefined) {
    fields.lead_time_days = parseOptionalNumber(payload.lead_time_days, 'lead_time_days');
  }

  if (payload.position_x !== undefined) {
    fields.position_x = Number(payload.position_x) || 0;
  }
  if (payload.position_y !== undefined) {
    fields.position_y = Number(payload.position_y) || 0;
  }

  if (payload.notes !== undefined) {
    fields.notes = payload.notes == null || payload.notes === ''
      ? null
      : String(payload.notes).trim();
  }

  if (payload.config !== undefined) {
    fields.config = payload.config && typeof payload.config === 'object' ? payload.config : {};
  }

  const effectiveType = fields.activity_type || existing?.activity_type;
  const effectiveLead =
    fields.lead_time_days !== undefined ? fields.lead_time_days : existing?.lead_time_days;

  // Outsource requires lead_time on create; schedulable WC is enforced on activate
  if (effectiveType === 'outsource' && !partial) {
    if (effectiveLead == null) {
      throw httpError('outsource requires lead_time_days');
    }
  }

  if (partial && effectiveType === 'outsource') {
    if (fields.lead_time_days !== undefined && fields.lead_time_days == null) {
      throw httpError('outsource requires lead_time_days');
    }
    if (
      fields.activity_type === 'outsource' &&
      effectiveLead == null &&
      fields.lead_time_days === undefined
    ) {
      throw httpError('outsource requires lead_time_days');
    }
  }

  return fields;
}

function wouldCreateDefaultCycle(edges, fromId, toId) {
  // Adding from -> to: if to can reach from via default edges, cycle
  const children = new Map();
  for (const e of edges) {
    if ((e.edge_kind || 'default') !== 'default') continue;
    const list = children.get(e.from_node_id) || [];
    list.push(e.to_node_id);
    children.set(e.from_node_id, list);
  }

  const visited = new Set();
  const stack = [toId];
  while (stack.length) {
    const current = stack.pop();
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of children.get(current) || []) stack.push(next);
  }
  return false;
}

async function nextSequence(versionId) {
  const { data, error } = await supabase
    .from('activity_flow_nodes')
    .select('sequence')
    .eq('flow_version_id', versionId)
    .order('sequence', { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data?.[0]?.sequence || 0) + 1;
}

async function addNode(masterRecordId, payload, createdBy) {
  const version = await ensureDraftVersion(masterRecordId, createdBy);
  assertDraftVersion(version);

  const fields = validateNodeFields(payload, { partial: false });
  if (fields.sequence == null) {
    fields.sequence = await nextSequence(version.id);
  }
  if (fields.position_x == null) fields.position_x = 280;
  if (fields.position_y == null) fields.position_y = 40 + (fields.sequence - 1) * 140;

  const { data: node, error } = await supabase
    .from('activity_flow_nodes')
    .insert({
      flow_version_id: version.id,
      ...fields,
    })
    .select('*')
    .single();

  if (error) throw error;
  return getVersionById(version.id, masterRecordId);
}

async function updateNode(masterRecordId, nodeId, payload, createdBy) {
  const version = await ensureDraftVersion(masterRecordId, createdBy);
  assertDraftVersion(version);

  const existing = (version.nodes || []).find((n) => n.id === nodeId);
  if (!existing) throw httpError('Activity flow node not found', 404);

  const fields = validateNodeFields(payload, { partial: true, existing });
  if (!Object.keys(fields).length) throw httpError('No fields to update');

  // If switching to outsource without lead_time in payload, keep existing or fail
  const nextType = fields.activity_type || existing.activity_type;
  if (nextType === 'outsource') {
    const lead =
      fields.lead_time_days !== undefined ? fields.lead_time_days : existing.lead_time_days;
    if (lead == null) throw httpError('outsource requires lead_time_days');
  }

  const { error } = await supabase
    .from('activity_flow_nodes')
    .update(fields)
    .eq('id', nodeId)
    .eq('flow_version_id', version.id);

  if (error) throw error;
  return getVersionById(version.id, masterRecordId);
}

async function deleteNode(masterRecordId, nodeId, createdBy) {
  const version = await ensureDraftVersion(masterRecordId, createdBy);
  assertDraftVersion(version);

  const existing = (version.nodes || []).find((n) => n.id === nodeId);
  if (!existing) throw httpError('Activity flow node not found', 404);

  // Edges cascade via FK ON DELETE CASCADE
  const { error } = await supabase
    .from('activity_flow_nodes')
    .delete()
    .eq('id', nodeId)
    .eq('flow_version_id', version.id);

  if (error) throw error;
  return getVersionById(version.id, masterRecordId);
}

async function addEdge(masterRecordId, payload, createdBy) {
  const version = await ensureDraftVersion(masterRecordId, createdBy);
  assertDraftVersion(version);

  const fromId = payload.from_node_id;
  const toId = payload.to_node_id;
  if (!fromId || !toId) throw httpError('from_node_id and to_node_id are required');
  if (fromId === toId) throw httpError('Cannot connect a node to itself');

  const nodeIds = new Set((version.nodes || []).map((n) => n.id));
  if (!nodeIds.has(fromId) || !nodeIds.has(toId)) {
    throw httpError('Both nodes must belong to this activity flow');
  }

  const edgeKind = payload.edge_kind || 'default';
  if (!EDGE_KINDS.includes(edgeKind)) {
    throw httpError(`edge_kind must be one of: ${EDGE_KINDS.join(', ')}`);
  }

  const duplicate = (version.edges || []).some(
    (e) => e.from_node_id === fromId && e.to_node_id === toId
  );
  if (duplicate) throw httpError('This connection already exists');

  if (edgeKind === 'default' && wouldCreateDefaultCycle(version.edges || [], fromId, toId)) {
    throw httpError('This connection would create a cycle on default edges');
  }

  const { error } = await supabase.from('activity_flow_edges').insert({
    flow_version_id: version.id,
    from_node_id: fromId,
    to_node_id: toId,
    label: payload.label?.trim() || null,
    edge_kind: edgeKind,
  });

  if (error) {
    if (error.code === '23505') throw httpError('This connection already exists', 409);
    throw error;
  }

  return getVersionById(version.id, masterRecordId);
}

async function deleteEdge(masterRecordId, edgeId, createdBy) {
  const version = await ensureDraftVersion(masterRecordId, createdBy);
  assertDraftVersion(version);

  const existing = (version.edges || []).find((e) => e.id === edgeId);
  if (!existing) throw httpError('Activity flow edge not found', 404);

  const { error } = await supabase
    .from('activity_flow_edges')
    .delete()
    .eq('id', edgeId)
    .eq('flow_version_id', version.id);

  if (error) throw error;
  return getVersionById(version.id, masterRecordId);
}

async function updateLayout(masterRecordId, layoutNodes, createdBy) {
  const version = await ensureDraftVersion(masterRecordId, createdBy);
  assertDraftVersion(version);

  if (!Array.isArray(layoutNodes) || !layoutNodes.length) {
    throw httpError('nodes array is required');
  }

  const allowed = new Set((version.nodes || []).map((n) => n.id));

  for (const item of layoutNodes) {
    if (!item?.id || !allowed.has(item.id)) continue;
    const { error } = await supabase
      .from('activity_flow_nodes')
      .update({
        position_x: Number(item.x) || 0,
        position_y: Number(item.y) || 0,
      })
      .eq('id', item.id)
      .eq('flow_version_id', version.id);

    if (error) throw error;
  }

  return getVersionById(version.id, masterRecordId);
}

async function insertSkeleton(masterRecordId, createdBy) {
  const version = await ensureDraftVersion(masterRecordId, createdBy);
  assertDraftVersion(version);

  if ((version.nodes || []).length > 0) {
    throw httpError('Skeleton can only be inserted on an empty flow');
  }

  const skeleton = [
    { activity_type: 'machining', label: 'Machining', sequence: 1, x: 280, y: 0 },
    { activity_type: 'inspection', label: 'Inspection', sequence: 2, x: 280, y: 140, inspection_kind: 'in_process' },
    { activity_type: 'packing', label: 'Packing', sequence: 3, x: 280, y: 280 },
    { activity_type: 'dispatch', label: 'Dispatch', sequence: 4, x: 280, y: 420 },
  ];

  // Machining needs work_center — create without WC first as draft skeleton;
  // user must assign WC before activate. Soften validation for skeleton insert.
  const nodeRows = skeleton.map((s) => ({
    flow_version_id: version.id,
    activity_type: s.activity_type,
    label: s.label,
    sequence: s.sequence,
    position_x: s.x,
    position_y: s.y,
    inspection_kind: s.inspection_kind || null,
    work_center_id: null,
    lead_time_days: null,
  }));

  const { data: inserted, error } = await supabase
    .from('activity_flow_nodes')
    .insert(nodeRows)
    .select('id, sequence');

  if (error) throw error;

  const bySeq = new Map((inserted || []).map((n) => [n.sequence, n.id]));
  const edgeRows = [];
  for (let seq = 1; seq < skeleton.length; seq++) {
    const fromId = bySeq.get(seq);
    const toId = bySeq.get(seq + 1);
    if (!fromId || !toId) continue;
    edgeRows.push({
      flow_version_id: version.id,
      from_node_id: fromId,
      to_node_id: toId,
      edge_kind: 'default',
    });
  }

  const { error: edgeErr } = await supabase.from('activity_flow_edges').insert(edgeRows);
  if (edgeErr) throw edgeErr;

  return getVersionById(version.id, masterRecordId);
}

async function activateVersion(versionId, masterRecordId) {
  const version = await getVersionById(versionId, masterRecordId);
  if (!version) throw httpError('Activity flow version not found', 404);
  if (version.status !== 'draft') {
    throw httpError('Only draft versions can be activated', 400);
  }

  // Validate schedulable nodes have work centers; outsource has lead time
  for (const node of version.nodes || []) {
    if (SCHEDULABLE_TYPES.has(node.activity_type) && !node.work_center_id) {
      throw httpError(
        `Cannot activate: "${node.label}" (${node.activity_type}) requires a work center`
      );
    }
    if (node.activity_type === 'outsource' && node.lead_time_days == null) {
      throw httpError(
        `Cannot activate: "${node.label}" (outsource) requires lead_time_days`
      );
    }
  }

  const { computeActivateSequencePlan } = require('./activityFlowRoute');
  const plan = computeActivateSequencePlan(version.nodes || [], version.edges || []);

  if (plan.unreachableSchedulable.length) {
    const labels = plan.unreachableSchedulable.map((n) => n.label || n.activity_type).join(', ');
    throw httpError(
      `Cannot activate: schedulable node(s) not on primary path (default edges): ${labels}`
    );
  }
  if (!plan.dispatchOnPath.length) {
    throw httpError('Cannot activate: primary path must include a Dispatch node');
  }
  if (!plan.dispatchIsTerminal) {
    throw httpError(
      'Cannot activate: Dispatch must be the last traveler node on the primary path'
    );
  }

  // Sync sequence from primary-path order so display matches routing
  for (const upd of plan.sequenceUpdates) {
    const { error: seqErr } = await supabase
      .from('activity_flow_nodes')
      .update({ sequence: upd.sequence })
      .eq('id', upd.id)
      .eq('flow_version_id', versionId);
    if (seqErr) throw seqErr;
  }

  const today = todayDateString();
  const active = await getActiveVersionRow(masterRecordId);
  if (active) {
    const { error: retireErr } = await supabase
      .from('activity_flow_versions')
      .update({ status: 'retired', valid_to: today })
      .eq('id', active.id);

    if (retireErr) throw retireErr;
  }

  const { data: activated, error } = await supabase
    .from('activity_flow_versions')
    .update({ status: 'active', valid_from: today, valid_to: null })
    .eq('id', versionId)
    .select('*')
    .single();

  if (error) throw error;
  return attachVersionPayload(activated);
}

module.exports = {
  ACTIVITY_TYPES,
  DEFAULT_LABELS,
  getDraftVersionForRecord,
  getActiveVersionForRecord,
  getLatestVersionForRecord,
  getVersionById,
  getVersionHistory,
  ensureDraftVersion,
  addNode,
  updateNode,
  deleteNode,
  addEdge,
  deleteEdge,
  updateLayout,
  insertSkeleton,
  activateVersion,
};
