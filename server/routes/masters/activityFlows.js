const express = require('express');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { isRoutableMasterSlug } = require('../../config/routableMasterSlugs');
const { ACTIVITY_TYPES, DEFAULT_LABELS } = require('../../config/activityFlowTypes');
const {
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
} = require('../../services/activityFlowEngine');

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
      console.error('Activity flow route error:', err);
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

function assertRoutable(slug) {
  if (!isRoutableMasterSlug(slug)) {
    const e = new Error('Activity flow is not available for this master type');
    e.status = 404;
    throw e;
  }
}

function flowResponse(version, isActive) {
  if (!version) {
    return { version: null, nodes: [], edges: [], is_active: false };
  }
  const { nodes, edges, ...meta } = version;
  return {
    version: meta,
    nodes: nodes || [],
    edges: edges || [],
    is_active: isActive,
  };
}

router.use(verifyEmployeeAuth);

router.get(
  '/:slug/records/:recordId/activity-flow/types',
  wrap(async (req, res) => {
    assertRoutable(req.params.slug);
    return res.json({
      types: ACTIVITY_TYPES.map((t) => ({
        value: t,
        label: DEFAULT_LABELS[t] || t,
      })),
    });
  })
);

router.get(
  '/:slug/records/:recordId/activity-flow',
  wrap(async (req, res) => {
    const { slug, recordId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const draft = await getDraftVersionForRecord(recordId);
    if (draft) {
      const active = await getActiveVersionForRecord(recordId);
      return res.json({
        ...flowResponse(draft, false),
        has_active_version: !!active,
        read_only: false,
      });
    }

    const active = await getActiveVersionForRecord(recordId);
    if (active) {
      return res.json({ ...flowResponse(active, true), read_only: true });
    }

    const latest = await getLatestVersionForRecord(recordId);
    return res.json({
      ...flowResponse(latest, false),
      read_only: latest ? latest.status !== 'draft' : false,
    });
  })
);

router.get(
  '/:slug/records/:recordId/activity-flow/history',
  wrap(async (req, res) => {
    const { slug, recordId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);
    const history = await getVersionHistory(recordId);
    return res.json({ history });
  })
);

router.get(
  '/:slug/records/:recordId/activity-flow/versions/:versionId',
  wrap(async (req, res) => {
    const { slug, recordId, versionId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await getVersionById(versionId, recordId);
    if (!version) {
      return res.status(404).json({ error: 'Activity flow version not found' });
    }

    return res.json({
      ...flowResponse(version, version.status === 'active'),
      read_only: version.status !== 'draft',
    });
  })
);

router.post(
  '/:slug/records/:recordId/activity-flow/ensure-draft',
  wrap(async (req, res) => {
    const { slug, recordId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await ensureDraftVersion(recordId, req.user?.sub);
    return res.json({ ...flowResponse(version, false), read_only: false });
  })
);

router.post(
  '/:slug/records/:recordId/activity-flow/activate',
  wrap(async (req, res) => {
    const { slug, recordId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const targetId = req.body?.version_id || (await getDraftVersionForRecord(recordId))?.id;
    if (!targetId) {
      return res.status(404).json({ error: 'No draft activity flow found to activate' });
    }

    const activated = await activateVersion(targetId, recordId);
    return res.json({
      ...flowResponse(activated, true),
      read_only: true,
      message: 'Activity flow activated',
    });
  })
);

router.post(
  '/:slug/records/:recordId/activity-flow/skeleton',
  wrap(async (req, res) => {
    const { slug, recordId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await insertSkeleton(recordId, req.user?.sub);
    return res.status(201).json({ ...flowResponse(version, false), read_only: false });
  })
);

router.post(
  '/:slug/records/:recordId/activity-flow/nodes',
  wrap(async (req, res) => {
    const { slug, recordId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await addNode(recordId, req.body || {}, req.user?.sub);
    return res.status(201).json({ ...flowResponse(version, false), read_only: false });
  })
);

router.patch(
  '/:slug/records/:recordId/activity-flow/nodes/:nodeId',
  wrap(async (req, res) => {
    const { slug, recordId, nodeId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await updateNode(recordId, nodeId, req.body || {}, req.user?.sub);
    return res.json({ ...flowResponse(version, false), read_only: false });
  })
);

router.delete(
  '/:slug/records/:recordId/activity-flow/nodes/:nodeId',
  wrap(async (req, res) => {
    const { slug, recordId, nodeId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await deleteNode(recordId, nodeId, req.user?.sub);
    return res.json({ ...flowResponse(version, false), read_only: false });
  })
);

router.post(
  '/:slug/records/:recordId/activity-flow/edges',
  wrap(async (req, res) => {
    const { slug, recordId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await addEdge(recordId, req.body || {}, req.user?.sub);
    return res.status(201).json({ ...flowResponse(version, false), read_only: false });
  })
);

router.delete(
  '/:slug/records/:recordId/activity-flow/edges/:edgeId',
  wrap(async (req, res) => {
    const { slug, recordId, edgeId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await deleteEdge(recordId, edgeId, req.user?.sub);
    return res.json({ ...flowResponse(version, false), read_only: false });
  })
);

router.patch(
  '/:slug/records/:recordId/activity-flow/layout',
  wrap(async (req, res) => {
    const { slug, recordId } = req.params;
    assertRoutable(slug);
    const master = await getMaster(slug);
    await verifyRecordBelongsToMaster(recordId, master.id);

    const version = await updateLayout(recordId, req.body?.nodes || [], req.user?.sub);
    return res.json({ ...flowResponse(version, false), read_only: false });
  })
);

module.exports = router;
