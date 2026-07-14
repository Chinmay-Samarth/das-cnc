/**
 * Primary-path AF routing: walk default edges (not sequence index).
 * Sequence remains a denormalized display/order field synced on activate.
 */
const {
  SCHEDULABLE_TYPES,
  TERMINAL_DISPATCH_TYPES,
} = require('../config/activityFlowTypes');

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  const { createClient } = require('@supabase/supabase-js');
  _supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  return _supabase;
}

const SKIP_TYPES = new Set([
  'firewall',
  'note',
  'outsource_inward',
  'material_issue',
  'storage',
]);

function isTravelerNode(node) {
  if (!node) return false;
  if (TERMINAL_DISPATCH_TYPES.has(node.activity_type)) return true;
  return SCHEDULABLE_TYPES.has(node.activity_type);
}

function isSkipOnPath(node) {
  if (!node) return true;
  return SKIP_TYPES.has(node.activity_type);
}

function buildDefaultAdjacency(edges) {
  const children = new Map();
  for (const e of edges || []) {
    if ((e.edge_kind || 'default') !== 'default') continue;
    if (!children.has(e.from_node_id)) children.set(e.from_node_id, []);
    children.get(e.from_node_id).push(e.to_node_id);
  }
  return children;
}

function buildIncomingCount(nodes, edges) {
  const ids = new Set((nodes || []).map((n) => n.id));
  const incoming = new Map([...ids].map((id) => [id, 0]));
  for (const e of edges || []) {
    if ((e.edge_kind || 'default') !== 'default') continue;
    if (!ids.has(e.from_node_id) || !ids.has(e.to_node_id)) continue;
    incoming.set(e.to_node_id, (incoming.get(e.to_node_id) || 0) + 1);
  }
  return incoming;
}

/**
 * Ordered primary path: BFS from entry nodes (no default incoming),
 * following default edges. Visits each node once.
 */
function walkPrimaryPath(nodes, edges) {
  const nodeById = new Map((nodes || []).map((n) => [n.id, n]));
  const children = buildDefaultAdjacency(edges);
  const incoming = buildIncomingCount(nodes, edges);

  const entries = (nodes || [])
    .filter((n) => (incoming.get(n.id) || 0) === 0)
    .sort((a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0));

  const ordered = [];
  const visited = new Set();
  const queue = entries.map((n) => n.id);

  // Fallback: if graph has a cycle covering all nodes, start from lowest sequence
  if (!queue.length && nodes?.length) {
    const sorted = [...nodes].sort(
      (a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0)
    );
    queue.push(sorted[0].id);
  }

  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodeById.get(id);
    if (node) ordered.push(node);
    for (const nextId of children.get(id) || []) {
      if (!visited.has(nextId)) queue.push(nextId);
    }
  }

  return ordered;
}

/**
 * From afterNodeId, walk default edges until the next traveler node
 * (schedulable or dispatch). Skips firewall/note/etc.
 */
function resolveNextTravelerOnPath(nodes, edges, afterNodeId) {
  const nodeById = new Map((nodes || []).map((n) => [n.id, n]));
  const children = buildDefaultAdjacency(edges);

  if (!afterNodeId) {
    const path = walkPrimaryPath(nodes, edges);
    return path.find((n) => isTravelerNode(n)) || null;
  }

  if (!nodeById.has(afterNodeId)) {
    const path = walkPrimaryPath(nodes, edges);
    return path.find((n) => isTravelerNode(n)) || null;
  }

  const visited = new Set();
  const queue = [...(children.get(afterNodeId) || [])];

  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodeById.get(id);
    if (!node) continue;
    if (isTravelerNode(node)) return node;
    if (isSkipOnPath(node)) {
      for (const nextId of children.get(id) || []) queue.push(nextId);
    }
  }
  return null;
}

/** First schedulable node on primary path that has a work center. */
function resolveFirstSchedulableOnPath(nodes, edges) {
  const path = walkPrimaryPath(nodes, edges);
  return (
    path.find((n) => SCHEDULABLE_TYPES.has(n.activity_type) && n.work_center_id) ||
    path.find((n) => SCHEDULABLE_TYPES.has(n.activity_type)) ||
    null
  );
}

/** Next schedulable (with WC preferred) after afterNodeId along default edges. */
function resolveNextSchedulableOnPath(nodes, edges, afterNodeId) {
  const nextTraveler = resolveNextTravelerOnPath(nodes, edges, afterNodeId);
  if (!nextTraveler) return null;
  if (SCHEDULABLE_TYPES.has(nextTraveler.activity_type) && nextTraveler.work_center_id) {
    return nextTraveler;
  }
  if (SCHEDULABLE_TYPES.has(nextTraveler.activity_type)) {
    return nextTraveler;
  }
  // dispatch or other — no further schedulable
  if (TERMINAL_DISPATCH_TYPES.has(nextTraveler.activity_type)) return null;

  // Keep walking if we landed on something unexpected
  return resolveNextSchedulableOnPath(nodes, edges, nextTraveler.id);
}

/**
 * Schedulable traveler nodes on primary path before (not including) untilNodeId.
 * If untilNodeId is null, all schedulable on path.
 */
function priorSchedulableOnPath(nodes, edges, untilNodeId) {
  const path = walkPrimaryPath(nodes, edges);
  const result = [];
  for (const n of path) {
    if (untilNodeId && n.id === untilNodeId) break;
    if (SCHEDULABLE_TYPES.has(n.activity_type)) result.push(n);
  }
  return result;
}

/**
 * Validate graph for activate: all schedulables reachable; dispatch on path.
 * Returns { path, sequenceUpdates } or throws via caller httpError.
 */
function computeActivateSequencePlan(nodes, edges) {
  const path = walkPrimaryPath(nodes, edges);
  const onPath = new Set(path.map((n) => n.id));

  const unreachableSchedulable = (nodes || []).filter(
    (n) => SCHEDULABLE_TYPES.has(n.activity_type) && !onPath.has(n.id)
  );

  const dispatchOnPath = path.filter((n) => TERMINAL_DISPATCH_TYPES.has(n.activity_type));
  const travelerPath = path.filter(isTravelerNode);
  const lastTraveler = travelerPath[travelerPath.length - 1] || null;
  const dispatchIsTerminal =
    lastTraveler && TERMINAL_DISPATCH_TYPES.has(lastTraveler.activity_type);

  const sequenceUpdates = path.map((n, i) => ({
    id: n.id,
    sequence: i + 1,
  }));

  // Nodes not on path keep sequences after path
  let seq = path.length + 1;
  for (const n of nodes || []) {
    if (onPath.has(n.id)) continue;
    sequenceUpdates.push({ id: n.id, sequence: seq++ });
  }

  return {
    path,
    sequenceUpdates,
    unreachableSchedulable,
    dispatchOnPath,
    dispatchIsTerminal,
  };
}

async function loadFlowGraph(activityFlowVersionId) {
  if (!activityFlowVersionId) return { nodes: [], edges: [] };
  const supabase = getSupabase();
  const [{ data: nodes, error: nErr }, { data: edges, error: eErr }] = await Promise.all([
    supabase
      .from('activity_flow_nodes')
      .select('id, label, activity_type, sequence, work_center_id, flow_version_id')
      .eq('flow_version_id', activityFlowVersionId)
      .order('sequence', { ascending: true }),
    supabase
      .from('activity_flow_edges')
      .select('id, from_node_id, to_node_id, edge_kind')
      .eq('flow_version_id', activityFlowVersionId),
  ]);
  if (nErr) throw nErr;
  if (eErr) throw eErr;
  return { nodes: nodes || [], edges: edges || [] };
}

async function resolveNextTravelerNode(activityFlowVersionId, afterNodeId) {
  const { nodes, edges } = await loadFlowGraph(activityFlowVersionId);
  return resolveNextTravelerOnPath(nodes, edges, afterNodeId);
}

async function resolveFirstSchedulableNode(activityFlowVersionId) {
  const { nodes, edges } = await loadFlowGraph(activityFlowVersionId);
  return resolveFirstSchedulableOnPath(nodes, edges);
}

async function resolveNextSchedulableNode(activityFlowVersionId, afterNodeId) {
  const { nodes, edges } = await loadFlowGraph(activityFlowVersionId);
  if (!afterNodeId) return resolveFirstSchedulableOnPath(nodes, edges);
  return resolveNextSchedulableOnPath(nodes, edges, afterNodeId);
}

module.exports = {
  SKIP_TYPES,
  isTravelerNode,
  isSkipOnPath,
  walkPrimaryPath,
  resolveNextTravelerOnPath,
  resolveFirstSchedulableOnPath,
  resolveNextSchedulableOnPath,
  priorSchedulableOnPath,
  computeActivateSequencePlan,
  loadFlowGraph,
  resolveNextTravelerNode,
  resolveFirstSchedulableNode,
  resolveNextSchedulableNode,
  buildDefaultAdjacency,
};
