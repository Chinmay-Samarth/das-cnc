const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ALLOWED_CHILD_SLUGS = ['component', 'raw-material'];

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function loadBomEdges(versionId) {
  const { data, error } = await supabase
    .from('bom_structure')
    .select('*')
    .eq('bom_version_id', versionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function enrichEdges(edges) {
  if (!edges.length) return edges;

  const recordIds = new Set();
  for (const edge of edges) {
    recordIds.add(edge.parent_element_id);
    recordIds.add(edge.child_element_id);
  }

  const { data: lookups, error } = await supabase
    .from('v_master_lookup')
    .select('record_id, label, master_slug')
    .in('record_id', [...recordIds]);

  if (error) throw error;

  const byId = new Map((lookups || []).map((row) => [row.record_id, row]));

  return edges.map((edge) => {
    const parent = byId.get(edge.parent_element_id) || {};
    const child = byId.get(edge.child_element_id) || {};
    return {
      ...edge,
      parent_label: parent.label || edge.parent_element_id,
      parent_slug: parent.master_slug || null,
      child_label: child.label || edge.child_element_id,
      child_slug: child.master_slug || null,
    };
  });
}

function getLocalChildEdges(parentId, parentEdges) {
  return parentEdges.filter((e) => e.parent_element_id === parentId);
}

function mergeChildEdges(localEdges, inheritedEdges, assemblyRecordId) {
  const localChildIds = new Set(localEdges.map((e) => e.child_element_id));
  const merged = [
    ...localEdges.map((e) => ({ ...e, source: 'local' })),
    ...inheritedEdges
      .filter(
        (e) =>
          e.parent_element_id === assemblyRecordId &&
          !localChildIds.has(e.child_element_id)
      )
      .map((e) => ({ ...e, source: 'inherited' })),
  ];
  return merged;
}

async function loadActiveBomEdgesForRecord(masterRecordId) {
  const batch = await loadActiveBomEdgesBatch([masterRecordId]);
  return batch.get(masterRecordId) || [];
}

async function loadActiveBomEdgesBatch(recordIds) {
  const unique = [...new Set((recordIds || []).filter(Boolean))];
  if (!unique.length) return new Map();

  const { data: versions, error: versionError } = await supabase
    .from('bom_versions')
    .select('id, master_record_id')
    .in('master_record_id', unique)
    .eq('status', 'active');

  if (versionError) throw versionError;

  const versionByRecord = new Map((versions || []).map((v) => [v.master_record_id, v.id]));
  const versionIds = [...versionByRecord.values()];

  if (!versionIds.length) {
    return new Map(unique.map((id) => [id, []]));
  }

  const { data: rawEdges, error: edgeError } = await supabase
    .from('bom_structure')
    .select('*')
    .in('bom_version_id', versionIds)
    .order('created_at', { ascending: true });

  if (edgeError) throw edgeError;

  const enrichedAll = await enrichEdges(rawEdges || []);
  const enrichedByVersion = new Map();
  for (const edge of enrichedAll) {
    const list = enrichedByVersion.get(edge.bom_version_id) || [];
    list.push(edge);
    enrichedByVersion.set(edge.bom_version_id, list);
  }

  const result = new Map();
  for (const recordId of unique) {
    const versionId = versionByRecord.get(recordId);
    result.set(recordId, versionId ? (enrichedByVersion.get(versionId) || []) : []);
  }
  return result;
}

async function buildActiveBomCache(seedComponentIds) {
  const cache = new Map();
  const seeds = seedComponentIds instanceof Set
    ? [...seedComponentIds]
    : (Array.isArray(seedComponentIds) ? seedComponentIds : []);
  let pending = new Set(seeds.filter(Boolean));

  while (pending.size) {
    const batchIds = [...pending].filter((id) => !cache.has(id));
    pending = new Set();
    if (!batchIds.length) break;

    const batch = await loadActiveBomEdgesBatch(batchIds);
    for (const [recordId, edges] of batch) {
      cache.set(recordId, edges);
      for (const edge of edges) {
        if (edge.child_slug === 'component' && !cache.has(edge.child_element_id)) {
          pending.add(edge.child_element_id);
        }
      }
    }
  }

  return cache;
}

function collectComponentIdsFromEdges(edges) {
  const ids = new Set();
  for (const edge of edges || []) {
    if (edge.child_slug === 'component') {
      ids.add(edge.child_element_id);
    }
  }
  return ids;
}

function buildChildrenForComponent(componentRecordId, parentEdges, visited, activeBomCache) {
  const local = getLocalChildEdges(componentRecordId, parentEdges);
  const inherited = activeBomCache.get(componentRecordId) || [];
  const childEdges = mergeChildEdges(local, inherited, componentRecordId);

  const nodes = [];
  for (const edge of childEdges) {
    const childRecordId = edge.child_element_id;

    if (edge.child_slug === 'component' && visited.has(childRecordId)) {
      nodes.push({
        edge,
        recordId: childRecordId,
        label: edge.child_label,
        slug: edge.child_slug,
        source: edge.source,
        inheritedFrom: edge.source === 'inherited' ? componentRecordId : null,
        cyclic: true,
        children: [],
      });
      continue;
    }

    const nextVisited =
      edge.child_slug === 'component'
        ? new Set(visited).add(childRecordId)
        : visited;

    let children = [];
    if (edge.child_slug === 'component') {
      children = buildChildrenForComponent(childRecordId, parentEdges, nextVisited, activeBomCache);
    }

    nodes.push({
      edge,
      recordId: childRecordId,
      label: edge.child_label,
      slug: edge.child_slug,
      source: edge.source,
      inheritedFrom: edge.source === 'inherited' ? componentRecordId : null,
      children,
    });
  }

  return nodes;
}

async function buildExplodedTree(rootId, parentEdges) {
  const activeBomCache = await buildActiveBomCache(collectComponentIdsFromEdges(parentEdges));
  const visited = new Set([rootId]);
  const rootEdges = getLocalChildEdges(rootId, parentEdges).map((e) => ({
    ...e,
    source: 'local',
  }));

  const nodes = [];
  for (const edge of rootEdges) {
    const childRecordId = edge.child_element_id;

    if (edge.child_slug === 'component' && visited.has(childRecordId)) {
      nodes.push({
        edge,
        recordId: childRecordId,
        label: edge.child_label,
        slug: edge.child_slug,
        source: 'local',
        inheritedFrom: null,
        cyclic: true,
        children: [],
      });
      continue;
    }

    const nextVisited =
      edge.child_slug === 'component'
        ? new Set(visited).add(childRecordId)
        : visited;

    let children = [];
    if (edge.child_slug === 'component') {
      children = buildChildrenForComponent(childRecordId, parentEdges, nextVisited, activeBomCache);
    }

    nodes.push({
      edge,
      recordId: childRecordId,
      label: edge.child_label,
      slug: edge.child_slug,
      source: 'local',
      inheritedFrom: null,
      children,
    });
  }

  return nodes;
}

/** @deprecated Use buildExplodedTree */
function buildTree(rootId, edges) {
  const childrenByParent = new Map();
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parent_element_id) || [];
    list.push(edge);
    childrenByParent.set(edge.parent_element_id, list);
  }
  function buildNode(parentId) {
    const childEdges = childrenByParent.get(parentId) || [];
    return childEdges.map((edge) => ({
      edge,
      recordId: edge.child_element_id,
      label: edge.child_label,
      slug: edge.child_slug,
      source: 'local',
      children: edge.child_slug === 'component' ? buildNode(edge.child_element_id) : [],
    }));
  }
  return buildNode(rootId);
}

async function attachVersionPayload(version, masterRecordId) {
  const edges = await loadBomEdges(version.id);
  const enriched = await enrichEdges(edges);
  const tree = await buildExplodedTree(masterRecordId, enriched);
  return { ...version, edges: enriched, tree };
}

async function attachVersionEdgesOnly(version, masterRecordId) {
  const edges = await loadBomEdges(version.id);
  const enriched = await enrichEdges(edges);
  return { ...version, edges: enriched };
}

async function getVersionRow(versionId) {
  const { data: version, error } = await supabase
    .from('bom_versions')
    .select('*')
    .eq('id', versionId)
    .maybeSingle();

  if (error) throw error;
  return version;
}

async function getDraftVersionRow(masterRecordId) {
  const { data: version, error } = await supabase
    .from('bom_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'draft')
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return version;
}

async function getActiveVersionRow(masterRecordId) {
  const { data: version, error } = await supabase
    .from('bom_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return version;
}

async function getActiveVersionForRecord(masterRecordId) {
  const { data: version, error } = await supabase
    .from('bom_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  if (!version) return null;
  return attachVersionPayload(version, masterRecordId);
}

async function getLatestVersionForRecord(masterRecordId) {
  const { data: version, error } = await supabase
    .from('bom_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!version) return null;
  return attachVersionPayload(version, masterRecordId);
}

async function getDraftVersionForRecord(masterRecordId) {
  const { data: version, error } = await supabase
    .from('bom_versions')
    .select('*')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'draft')
    .order('revision', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!version) return null;
  return attachVersionPayload(version, masterRecordId);
}

async function getVersionById(versionId, masterRecordId) {
  const { data: version, error } = await supabase
    .from('bom_versions')
    .select('*')
    .eq('id', versionId)
    .maybeSingle();

  if (error) throw error;
  if (!version) return null;
  if (masterRecordId && version.master_record_id !== masterRecordId) return null;
  return attachVersionPayload(version, version.master_record_id);
}

async function getVersionHistory(masterRecordId) {
  const { data, error } = await supabase
    .from('bom_versions')
    .select('id, revision, status, valid_from, valid_to, created_at, updated_at')
    .eq('master_record_id', masterRecordId)
    .order('revision', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function createInitialDraft(masterRecordId, createdBy) {
  const { data: version, error } = await supabase
    .from('bom_versions')
    .insert({
      master_record_id: masterRecordId,
      revision: 1,
      status: 'draft',
      created_by: createdBy || null,
    })
    .select()
    .single();

  if (error) throw error;
  return attachVersionPayload(version, masterRecordId);
}

async function cloneVersionRevision(sourceVersion, createdBy) {
  const { data: newVersion, error: insertErr } = await supabase
    .from('bom_versions')
    .insert({
      master_record_id: sourceVersion.master_record_id,
      revision: sourceVersion.revision + 1,
      status: 'draft',
      created_by: createdBy || sourceVersion.created_by || null,
    })
    .select()
    .single();

  if (insertErr) throw insertErr;

  const edges = await loadBomEdges(sourceVersion.id);
  if (edges.length) {
    const rows = edges.map((e) => ({
      bom_version_id: newVersion.id,
      parent_element_id: e.parent_element_id,
      child_element_id: e.child_element_id,
      quantity: e.quantity,
      uom: e.uom,
      notes: e.notes,
    }));

    const { error: edgeErr } = await supabase.from('bom_structure').insert(rows);
    if (edgeErr) throw edgeErr;
  }

  return attachVersionEdgesOnly(newVersion, sourceVersion.master_record_id);
}

async function ensureDraftVersionLite(masterRecordId, createdBy) {
  const existing = await getDraftVersionRow(masterRecordId);
  if (existing) {
    return attachVersionEdgesOnly(existing, masterRecordId);
  }

  const activeRow = await getActiveVersionRow(masterRecordId);
  if (activeRow) {
    const active = await attachVersionEdgesOnly(activeRow, masterRecordId);
    return cloneVersionRevision(active, createdBy);
  }

  const { data: version, error } = await supabase
    .from('bom_versions')
    .insert({
      master_record_id: masterRecordId,
      revision: 1,
      status: 'draft',
      created_by: createdBy || null,
    })
    .select()
    .single();

  if (error) throw error;
  return attachVersionEdgesOnly(version, masterRecordId);
}

async function ensureDraftVersion(masterRecordId, createdBy) {
  const existingDraft = await getDraftVersionForRecord(masterRecordId);
  if (existingDraft) return existingDraft;

  const active = await getActiveVersionForRecord(masterRecordId);
  if (active) {
    const cloned = await cloneVersionRevision(active, createdBy);
    return attachVersionPayload(await getVersionRow(cloned.id), masterRecordId);
  }

  return createInitialDraft(masterRecordId, createdBy);
}

function assertDraftVersion(version) {
  if (!version) {
    const e = new Error('BOM version not found');
    e.status = 404;
    throw e;
  }
  if (version.status !== 'draft') {
    const e = new Error('Only draft BOM versions can be edited');
    e.status = 400;
    throw e;
  }
}

async function getRecordSlug(recordId) {
  const { data, error } = await supabase
    .from('v_master_lookup')
    .select('master_slug')
    .eq('record_id', recordId)
    .maybeSingle();

  if (error) throw error;
  return data?.master_slug || null;
}

function wouldCreateCycle(edges, parentId, childId, rootId) {
  if (parentId === childId) return true;
  if (childId === rootId) return true;

  const childrenByParent = new Map();
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parent_element_id) || [];
    list.push(edge.child_element_id);
    childrenByParent.set(edge.parent_element_id, list);
  }

  // Adding edge parentId -> childId: childId must not be an ancestor of parentId
  const visited = new Set();
  const stack = [parentId];
  while (stack.length) {
    const current = stack.pop();
    if (current === childId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const kids = childrenByParent.get(current) || [];
    for (const kid of kids) stack.push(kid);
  }

  return false;
}

async function validateNewEdge({
  version,
  masterRecordId,
  parentId,
  childId,
  edges,
}) {
  if (parentId === childId) {
    const e = new Error('Parent and child cannot be the same record');
    e.status = 400;
    throw e;
  }

  const validParents = new Set([masterRecordId]);
  for (const edge of edges) {
    if (edge.child_slug === 'component') {
      validParents.add(edge.child_element_id);
    }
  }

  if (!validParents.has(parentId)) {
    const e = new Error('Invalid parent — must be the assembly root or a component in this BOM');
    e.status = 400;
    throw e;
  }

  const childSlug = await getRecordSlug(childId);
  if (!ALLOWED_CHILD_SLUGS.includes(childSlug)) {
    const e = new Error('Child must be a component or raw-material master record');
    e.status = 400;
    throw e;
  }

  const duplicate = edges.some(
    (edge) => edge.parent_element_id === parentId && edge.child_element_id === childId
  );
  if (duplicate) {
    const e = new Error('This child is already linked under the selected parent');
    e.status = 400;
    throw e;
  }

  if (wouldCreateCycle(edges, parentId, childId, masterRecordId)) {
    const e = new Error('This link would create a cycle in the BOM');
    e.status = 400;
    throw e;
  }
}

async function addEdge(versionId, masterRecordId, payload, createdBy) {
  let version = await getVersionById(versionId, masterRecordId);
  assertDraftVersion(version);

  const parentId = payload.parent_element_id;
  const childId = payload.child_element_id;
  const quantity = parseFloat(payload.quantity);
  const uom = String(payload.uom || '').trim();

  if (!parentId || !childId) {
    const e = new Error('parent_element_id and child_element_id are required');
    e.status = 400;
    throw e;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    const e = new Error('quantity must be greater than 0');
    e.status = 400;
    throw e;
  }
  if (!uom) {
    const e = new Error('uom is required');
    e.status = 400;
    throw e;
  }

  await validateNewEdge({
    version,
    masterRecordId,
    parentId,
    childId,
    edges: version.edges,
  });

  const { data: edge, error } = await supabase
    .from('bom_structure')
    .insert({
      bom_version_id: version.id,
      parent_element_id: parentId,
      child_element_id: childId,
      quantity,
      uom,
      notes: payload.notes?.trim() || null,
    })
    .select()
    .single();

  if (error) throw error;
  return getVersionById(version.id, masterRecordId);
}

async function updateEdge(versionId, masterRecordId, edgeId, payload) {
  const version = await getVersionById(versionId, masterRecordId);
  assertDraftVersion(version);

  const edge = version.edges.find((e) => e.id === edgeId);
  if (!edge) {
    const e = new Error('BOM edge not found');
    e.status = 404;
    throw e;
  }

  const updates = {};
  if (payload.quantity !== undefined) {
    const quantity = parseFloat(payload.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const e = new Error('quantity must be greater than 0');
      e.status = 400;
      throw e;
    }
    updates.quantity = quantity;
  }
  if (payload.uom !== undefined) {
    const uom = String(payload.uom || '').trim();
    if (!uom) {
      const e = new Error('uom is required');
      e.status = 400;
      throw e;
    }
    updates.uom = uom;
  }
  if (payload.notes !== undefined) {
    updates.notes = payload.notes?.trim() || null;
  }

  const { error } = await supabase
    .from('bom_structure')
    .update(updates)
    .eq('id', edgeId)
    .eq('bom_version_id', version.id);

  if (error) throw error;
  return getVersionById(version.id, masterRecordId);
}

function collectDescendantChildIds(edges, parentChildId) {
  const childrenByParent = new Map();
  for (const edge of edges) {
    const list = childrenByParent.get(edge.parent_element_id) || [];
    list.push(edge);
    childrenByParent.set(edge.parent_element_id, list);
  }

  const toDelete = new Set();
  const stack = [parentChildId];
  while (stack.length) {
    const current = stack.pop();
    const childEdges = childrenByParent.get(current) || [];
    for (const edge of childEdges) {
      toDelete.add(edge.id);
      if (edge.child_slug === 'component') {
        stack.push(edge.child_element_id);
      }
    }
  }
  return toDelete;
}

async function deleteEdgeCascade(versionId, masterRecordId, edgeId) {
  const versionRow = await getVersionRow(versionId);
  if (!versionRow || versionRow.master_record_id !== masterRecordId) {
    const e = new Error('BOM version not found');
    e.status = 404;
    throw e;
  }
  if (versionRow.status !== 'draft') {
    const e = new Error('Only draft BOM versions can be edited');
    e.status = 400;
    throw e;
  }

  const edges = await loadBomEdges(versionRow.id);
  const enriched = await enrichEdges(edges);

  const edge = enriched.find((e) => e.id === edgeId);
  if (!edge) {
    const e = new Error('BOM edge not found');
    e.status = 404;
    throw e;
  }

  const idsToDelete = collectDescendantChildIds(enriched, edge.child_element_id);
  idsToDelete.add(edgeId);

  const { error } = await supabase
    .from('bom_structure')
    .delete()
    .in('id', [...idsToDelete])
    .eq('bom_version_id', versionRow.id);

  if (error) throw error;
  return attachVersionPayload(versionRow, masterRecordId);
}

async function activateVersion(versionId, masterRecordId) {
  const version = await getVersionById(versionId, masterRecordId);
  if (!version) {
    const e = new Error('BOM version not found');
    e.status = 404;
    throw e;
  }
  if (version.status !== 'draft') {
    const e = new Error('Only draft BOM versions can be activated');
    e.status = 400;
    throw e;
  }
  if (!version.edges.length) {
    const e = new Error('BOM must have at least one line before activation');
    e.status = 400;
    throw e;
  }

  const today = todayDateString();

  const { data: currentActive } = await supabase
    .from('bom_versions')
    .select('id')
    .eq('master_record_id', masterRecordId)
    .eq('status', 'active')
    .maybeSingle();

  if (currentActive) {
    const { error: retireErr } = await supabase
      .from('bom_versions')
      .update({ status: 'retired', valid_to: today })
      .eq('id', currentActive.id);

    if (retireErr) throw retireErr;
  }

  const { error: activateErr } = await supabase
    .from('bom_versions')
    .update({
      status: 'active',
      valid_from: version.valid_from || today,
      valid_to: null,
    })
    .eq('id', versionId)
    .eq('master_record_id', masterRecordId);

  if (activateErr) throw activateErr;
  return getVersionById(versionId, masterRecordId);
}

module.exports = {
  ALLOWED_CHILD_SLUGS,
  loadBomEdges,
  enrichEdges,
  buildTree,
  buildExplodedTree,
  loadActiveBomEdgesForRecord,
  loadActiveBomEdgesBatch,
  attachVersionEdgesOnly,
  getActiveVersionForRecord,
  getLatestVersionForRecord,
  getDraftVersionForRecord,
  getVersionById,
  getVersionHistory,
  createInitialDraft,
  cloneVersionRevision,
  ensureDraftVersion,
  ensureDraftVersionLite,
  getDraftVersionRow,
  getActiveVersionRow,
  addEdge,
  updateEdge,
  deleteEdgeCascade,
  activateVersion,
};
