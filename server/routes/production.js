const express = require('express');
const jwt = require('jsonwebtoken');
const {
  previewDailySplit,
  releaseToProduction,
  listCards,
  listMyToday,
  getCardById,
  rolloverOverdue,
  startCard,
  reportProgress,
  completeMachiningOp,
  listCardLots,
  listCardFlowNodes,
  sendOutsource,
  receiveOutsource,
  listCardShipments,
} = require('../services/productionCardEngine');
const { emitProductionUpdated } = require('../socket/emitter');

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

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('Production route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

function isManager(user) {
  const level = String(user?.access_level || user?.accessLevel || '').toUpperCase();
  return ['SUPERVISOR', 'MANAGER', 'ADMIN'].includes(level);
}

function notifyProduction(action, cardOrMeta = {}) {
  const card = cardOrMeta.card || cardOrMeta;
  emitProductionUpdated({
    action,
    cardId: card.id || cardOrMeta.cardId || null,
    employeeId: card.assigned_employee_id || cardOrMeta.employeeId || null,
    deliveryScheduleId: card.delivery_schedule_id || cardOrMeta.deliveryScheduleId || null,
    blanketPoId: card.blanket_po_id || cardOrMeta.blanketPoId || null,
    status: card.status || null,
  });
}

router.use(verifyEmployeeAuth);

router.post(
  '/release',
  wrap(async (req, res) => {
    const result = await releaseToProduction(req.body || {}, req.user?.sub);
    const first = result.cards?.[0];
    emitProductionUpdated({
      action: 'released',
      employeeId: first?.assigned_employee_id || req.body?.assigned_employee_id || null,
      deliveryScheduleId: result.schedule?.id || req.body?.delivery_schedule_id || null,
      blanketPoId: first?.blanket_po_id || null,
      cardIds: (result.cards || []).map((c) => c.id),
    });
    return res.status(201).json(result);
  })
);

router.post(
  '/preview-split',
  wrap(async (req, res) => {
    const { quantity, due_date, from_date } = req.body || {};
    const split = previewDailySplit(quantity, due_date, from_date);
    return res.json({ split });
  })
);

router.post(
  '/rollover',
  wrap(async (req, res) => {
    const result = await rolloverOverdue();
    if (result.rolled > 0) {
      emitProductionUpdated({
        action: 'rollover',
        cardIds: (result.cards || []).map((c) => c.id),
      });
    }
    return res.json(result);
  })
);

router.get(
  '/cards/my-today',
  wrap(async (req, res) => {
    const rolled = await rolloverOverdue();
    if (rolled.rolled > 0) {
      emitProductionUpdated({
        action: 'rollover',
        cardIds: (rolled.cards || []).map((c) => c.id),
      });
    }
    const cards = await listMyToday(req.user?.sub);
    return res.json({ cards });
  })
);

router.get(
  '/cards',
  wrap(async (req, res) => {
    const cards = await listCards({
      employee_id: req.query.employee_id,
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
      delivery_schedule_id: req.query.delivery_schedule_id,
    });
    return res.json({ cards });
  })
);

router.get(
  '/cards/:id',
  wrap(async (req, res) => {
    const card = await getCardById(req.params.id);
    const [lots, nodes, shipments] = await Promise.all([
      listCardLots(req.params.id),
      listCardFlowNodes(req.params.id),
      listCardShipments(req.params.id),
    ]);
    return res.json({ card, lots, nodes, shipments });
  })
);

router.post(
  '/cards/:id/start',
  wrap(async (req, res) => {
    const card = await startCard(req.params.id, req.user?.sub, {
      isManager: isManager(req.user),
    });
    notifyProduction('started', card);
    return res.json({ card });
  })
);

router.post(
  '/cards/:id/progress',
  wrap(async (req, res) => {
    const card = await reportProgress(req.params.id, req.body || {}, req.user?.sub, {
      isManager: isManager(req.user),
    });
    notifyProduction('progress', card);
    return res.json({ card });
  })
);

router.post(
  '/cards/:id/complete',
  wrap(async (req, res) => {
    const card = await reportProgress(
      req.params.id,
      { ...(req.body || {}), done_for_day: true },
      req.user?.sub,
      { isManager: isManager(req.user) }
    );
    notifyProduction('completed', card);
    return res.json({ card });
  })
);

router.post(
  '/cards/:id/operations/:nodeId/complete',
  wrap(async (req, res) => {
    const result = await completeMachiningOp(
      req.params.id,
      req.params.nodeId,
      req.body || {},
      req.user?.sub,
      { isManager: isManager(req.user) }
    );
    const card = await getCardById(req.params.id);
    notifyProduction('lot_created', card);
    return res.status(201).json(result);
  })
);

router.post(
  '/outsource/send',
  wrap(async (req, res) => {
    const result = await sendOutsource(req.body || {}, req.user?.sub, {
      isManager: isManager(req.user),
    });
    const card = await getCardById(req.body?.production_card_id);
    notifyProduction('outsource_sent', card);
    return res.status(201).json(result);
  })
);

router.post(
  '/outsource/:shipmentId/receive',
  wrap(async (req, res) => {
    const result = await receiveOutsource(req.params.shipmentId, req.user?.sub, {
      isManager: isManager(req.user),
    });
    const card = await getCardById(result.shipment?.production_card_id);
    notifyProduction('outsource_received', card);
    return res.json(result);
  })
);

module.exports = router;
