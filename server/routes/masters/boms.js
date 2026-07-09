const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { isBomsMasterSlug } = require('../../config/bomsMasterSlugs');
const {
  getActiveVersionForRecord,
  getLatestVersionForRecord,
  getDraftVersionForRecord,
  getDraftVersionRow,
  getActiveVersionRow,
  ensureDraftVersionLite,
  getVersionById,
  getVersionHistory,
  ensureDraftVersion,
  addEdge,
  updateEdge,
  deleteEdgeCascade,
  activateVersion,
  attachVersionEdgesOnly,
} = require('../../services/bomEngine');
const { emitBomUpdated } = require('../../socket/emitter');

const router = express.Router();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    const token = authHeader.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('BOM route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

async function getMaster(slug) {
  const { data, error } = await supabase
    .from('masters')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    const e = new Error(`Master '${slug}' not found`);
    e.status = 404;
    throw e;
  }
  return data;
}

async function verifyRecordBelongsToMaster(recordId, masterId) {
  const { data, error } = await supabase
    .from('master_records')
    .select('id, master_id')
    .eq('id', recordId)
    .eq('master_id', masterId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const e = new Error('Master record not found');
    e.status = 404;
    throw e;
  }
  return data;
}

function versionResponse(version, isActive) {
  if (!version) {
    return { version: null, tree: [], edges: [], is_active: false };
  }
  const { tree, edges, ...meta } = version;
  return {
    version: meta,
    tree: tree || [],
    edges: edges || [],
    is_active: isActive,
  };
}

router.use(verifyEmployeeAuth);

router.get('/:slug/records/:recordId/bom', wrap(async (req, res) => {
  const { slug, recordId } = req.params;

  if (!isBomsMasterSlug(slug)) {
    return res.status(404).json({ error: 'BOMs are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  const draft = await getDraftVersionForRecord(recordId);
  if (draft) {
    const active = await getActiveVersionForRecord(recordId);
    return res.json({
      ...versionResponse(draft, false),
      has_active_version: !!active,
    });
  }

  const active = await getActiveVersionForRecord(recordId);
  if (active) {
    return res.json(versionResponse(active, true));
  }

  const latest = await getLatestVersionForRecord(recordId);
  return res.json(versionResponse(latest, false));
}));

router.get('/:slug/records/:recordId/bom/history', wrap(async (req, res) => {
  const { slug, recordId } = req.params;

  if (!isBomsMasterSlug(slug)) {
    return res.status(404).json({ error: 'BOMs are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  const history = await getVersionHistory(recordId);
  return res.json({ history });
}));

router.get('/:slug/records/:recordId/bom/versions/:versionId', wrap(async (req, res) => {
  const { slug, recordId, versionId } = req.params;

  if (!isBomsMasterSlug(slug)) {
    return res.status(404).json({ error: 'BOMs are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  const version = await getVersionById(versionId, recordId);
  if (!version) {
    return res.status(404).json({ error: 'BOM version not found' });
  }

  return res.json({
    ...versionResponse(version, version.status === 'active'),
    read_only: version.status !== 'draft',
  });
}));

router.post('/:slug/records/:recordId/bom/activate', wrap(async (req, res) => {
  const { slug, recordId } = req.params;
  const { version_id: versionId } = req.body;

  if (!isBomsMasterSlug(slug)) {
    return res.status(404).json({ error: 'BOMs are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  const targetId = versionId || (await getDraftVersionForRecord(recordId))?.id;
  if (!targetId) {
    return res.status(404).json({ error: 'No draft BOM found to activate' });
  }

  const activated = await activateVersion(targetId, recordId);
  emitBomUpdated({ recordId, versionId: activated.id, action: 'activated' });
  return res.json({
    ...versionResponse(activated, true),
    message: 'BOM activated',
  });
}));

router.post('/:slug/records/:recordId/bom/edges', wrap(async (req, res) => {
  const { slug, recordId } = req.params;

  if (!isBomsMasterSlug(slug)) {
    return res.status(404).json({ error: 'BOMs are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  const hadActive = await getActiveVersionForRecord(recordId);
  const draft = await ensureDraftVersion(recordId, req.user?.sub);
  const updated = await addEdge(draft.id, recordId, req.body, req.user?.sub);

  emitBomUpdated({ recordId, versionId: updated.id, action: 'edge_added' });

  return res.json({
    ...versionResponse(updated, false),
    message: hadActive ? 'New draft revision created' : 'BOM line added',
  });
}));

router.patch('/:slug/records/:recordId/bom/edges/:edgeId', wrap(async (req, res) => {
  const { slug, recordId, edgeId } = req.params;

  if (!isBomsMasterSlug(slug)) {
    return res.status(404).json({ error: 'BOMs are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  let version = await getDraftVersionForRecord(recordId);
  if (!version) {
    const active = await getActiveVersionForRecord(recordId);
    if (!active) {
      return res.status(404).json({ error: 'No BOM version found' });
    }
    version = await ensureDraftVersion(recordId, req.user?.sub);
  }

  const edgeOnDraft = version.edges.find((e) => e.id === edgeId);
  if (!edgeOnDraft && version.status === 'draft') {
    const active = await getActiveVersionForRecord(recordId);
    const onActive = active?.edges?.find((e) => e.id === edgeId);
    if (onActive) {
      version = await ensureDraftVersion(recordId, req.user?.sub);
      const match = version.edges.find(
        (e) =>
          e.parent_element_id === onActive.parent_element_id &&
          e.child_element_id === onActive.child_element_id
      );
      if (match) {
        const updated = await updateEdge(version.id, recordId, match.id, req.body);
        emitBomUpdated({ recordId, versionId: updated.id, action: 'edge_updated' });
        return res.json({ ...versionResponse(updated, false), message: 'BOM line updated' });
      }
    }
  }

  const updated = await updateEdge(version.id, recordId, edgeId, req.body);
  emitBomUpdated({ recordId, versionId: updated.id, action: 'edge_updated' });
  return res.json({ ...versionResponse(updated, false), message: 'BOM line updated' });
}));

router.delete('/:slug/records/:recordId/bom/edges/:edgeId', wrap(async (req, res) => {
  const { slug, recordId, edgeId } = req.params;

  if (!isBomsMasterSlug(slug)) {
    return res.status(404).json({ error: 'BOMs are not available for this master type' });
  }

  const master = await getMaster(slug);
  await verifyRecordBelongsToMaster(recordId, master.id);

  let version = await getDraftVersionRow(recordId);
  if (version) {
    version = await attachVersionEdgesOnly(version, recordId);
  } else {
    const activeRow = await getActiveVersionRow(recordId);
    if (!activeRow) {
      return res.status(404).json({ error: 'No BOM version found' });
    }
    version = await ensureDraftVersionLite(recordId, req.user?.sub);
  }

  let targetEdgeId = edgeId;
  const edgeOnDraft = version.edges.find((e) => e.id === edgeId);
  if (!edgeOnDraft) {
    const activeRow = await getActiveVersionRow(recordId);
    if (activeRow) {
      const active = await attachVersionEdgesOnly(activeRow, recordId);
      const onActive = active.edges.find((e) => e.id === edgeId);
      if (onActive) {
        const match = version.edges.find(
          (e) =>
            e.parent_element_id === onActive.parent_element_id &&
            e.child_element_id === onActive.child_element_id
        );
        if (!match) {
          return res.status(404).json({ error: 'BOM edge not found on current draft' });
        }
        targetEdgeId = match.id;
      }
    }
  }

  const updated = await deleteEdgeCascade(version.id, recordId, targetEdgeId);
  emitBomUpdated({ recordId, versionId: updated.id, action: 'edge_deleted' });
  return res.json({ ...versionResponse(updated, false), message: 'BOM line removed' });
}));

module.exports = router;
