const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { accessLevelFromUser, isAdminUser } = require('../utils/accessLevel');
const {
  listPurchaseOrders,
  getPurchaseOrderById,
  generateFromCampaigns,
  createFromAlert,
  createPurchaseOrder,
  updatePurchaseOrder,
  sendPurchaseOrder,
  markPurchaseOrderPaid,
  markPurchaseOrderDelivered,
  storePurchaseOrderPdf,
  buildDemandSummary,
  cancelPurchaseOrder,
  splitPurchaseOrder,
  linkInvoiceToPo,
  buildGirnDraftFromPo,
} = require('../services/purchaseOrderEngine');
const { loadCommercialSourcesForRecords } = require('../services/masterFieldEngine');
const {
  runThreeWayMatch,
  resolveMatchException,
  hasUnresolvedMatchExceptions,
} = require('../services/purchaseOrderMatchEngine');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireAdminOrSupervisor(req, res, next) {
  const level = accessLevelFromUser(req.user);
  if (level !== 'ADMIN' && level !== 'SUPERVISOR') {
    return res.status(403).json({ error: 'Admin or supervisor access required' });
  }
  next();
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('Purchase order route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

router.use(verifyEmployeeAuth);

router.get(
  '/demand-summary',
  requireAdmin,
  wrap(async (req, res) => {
    const summary = await buildDemandSummary();
    return res.json(summary);
  })
);

router.get(
  '/item-sources',
  requireAdmin,
  wrap(async (req, res) => {
    const ids = String(req.query.master_record_ids || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const masterSlug = req.query.master_slug === 'tool' ? 'tool' : 'raw-material';
    const sources = await loadCommercialSourcesForRecords(ids, masterSlug);
    return res.json({ sources });
  })
);

router.get(
  '/:id/girn-draft',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const draft = await buildGirnDraftFromPo(req.params.id);
    return res.json({ draft });
  })
);

router.use(requireAdmin);

router.get(
  '/',
  wrap(async (req, res) => {
    const purchase_orders = await listPurchaseOrders();
    return res.json({ purchase_orders });
  })
);

router.post(
  '/generate-from-campaigns',
  wrap(async (req, res) => {
    const result = await generateFromCampaigns(req.user?.sub);
    return res.status(201).json(result);
  })
);

router.post(
  '/from-alert',
  wrap(async (req, res) => {
    const purchase_order = await createFromAlert(req.body || {}, req.user?.sub);
    return res.status(201).json({ purchase_order });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const purchase_order = await createPurchaseOrder(req.body || {}, req.user?.sub);
    return res.status(201).json({ purchase_order });
  })
);

router.post(
  '/:id/pdf',
  upload.single('pdf'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'PDF file is required' });
    const purchase_order = await storePurchaseOrderPdf(req.params.id, req.file);
    return res.json({ purchase_order });
  })
);

router.post(
  '/:id/delivered',
  wrap(async (req, res) => {
    const purchase_order = await markPurchaseOrderDelivered(req.params.id);
    return res.json({ purchase_order });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const purchase_order = await getPurchaseOrderById(req.params.id);
    return res.json({ purchase_order });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const purchase_order = await updatePurchaseOrder(req.params.id, req.body || {}, req.user?.sub);
    return res.json({ purchase_order });
  })
);

router.post(
  '/:id/send',
  wrap(async (req, res) => {
    const purchase_order = await sendPurchaseOrder(req.params.id, req.user?.sub);
    return res.json({ purchase_order });
  })
);

router.post(
  '/:id/mark-paid',
  wrap(async (req, res) => {
    const hasOpen = await hasUnresolvedMatchExceptions(req.params.id);
    if (hasOpen && !req.body?.override) {
      return res.status(409).json({
        error: 'Unresolved match exceptions exist. Confirm override to mark paid.',
        requires_override: true,
      });
    }
    const purchase_order = await markPurchaseOrderPaid(req.params.id, req.user?.sub);
    return res.json({ purchase_order });
  })
);

router.post(
  '/:id/cancel',
  wrap(async (req, res) => {
    const purchase_order = await cancelPurchaseOrder(req.params.id);
    return res.json({ purchase_order });
  })
);

router.post(
  '/:id/split',
  wrap(async (req, res) => {
    const result = await splitPurchaseOrder(req.params.id, req.user?.sub);
    return res.json(result);
  })
);

router.post(
  '/:id/link-invoice',
  wrap(async (req, res) => {
    const { invoice_id } = req.body || {};
    if (!invoice_id) return res.status(400).json({ error: 'invoice_id is required' });
    const purchase_order = await linkInvoiceToPo(req.params.id, invoice_id);
    return res.json({ purchase_order });
  })
);

router.get(
  '/:id/match',
  wrap(async (req, res) => {
    const result = await runThreeWayMatch(req.params.id);
    return res.json(result);
  })
);

router.post(
  '/:id/match/:exceptionId/resolve',
  wrap(async (req, res) => {
    const result = await resolveMatchException(req.params.id, req.params.exceptionId);
    return res.json(result);
  })
);

module.exports = router;
