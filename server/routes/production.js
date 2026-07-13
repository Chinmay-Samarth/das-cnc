const express = require('express');
const jwt = require('jsonwebtoken');
const {
  previewDailySplit,
  releaseToProduction,
  listCards,
  listMyToday,
  getCardById,
  getCardTrackingDetail,
  rolloverOverdue,
  startCard,
  reportProgress,
  completeMachiningOp,
  sendOutsource,
  receiveOutsource,
} = require('../services/productionCardEngine');
const {
  assignUnassignedForDate,
  reassignCard,
  getWorkCenterBoard,
  previewAssigneeForSchedule,
} = require('../services/productionAssignEngine');
const { emitProductionUpdated } = require('../socket/emitter');
const { broadcastProductionRealtime } = require('../socket/productionRealtime');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

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

function notifyProduction(action, cardOrMeta = {}, extras = {}) {
  const card = cardOrMeta.card || cardOrMeta;
  const advance = cardOrMeta.advance || extras.advance || card.advance || null;
  broadcastProductionRealtime({
    action,
    card,
    operatorId: extras.operatorId || null,
    quantityGood: extras.quantityGood ?? null,
    quantityScrap: extras.quantityScrap ?? null,
    previousEmployeeId:
      extras.previousEmployeeId ||
      advance?.from_employee_id ||
      null,
    previousWorkCenterId:
      extras.previousWorkCenterId ||
      advance?.from_work_center_id ||
      null,
    advance,
    cardIds: extras.cardIds || null,
  });
}

router.use(verifyEmployeeAuth);

router.post(
  '/release',
  wrap(async (req, res) => {
    const result = await releaseToProduction(req.body || {}, req.user?.sub);
    emitProductionUpdated({
      action: 'released',
      employeeId: null,
      deliveryScheduleId: result.schedule?.id || req.body?.delivery_schedule_id || null,
      blanketPoId: result.cards?.[0]?.blanket_po_id || null,
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
  '/preview-assign',
  wrap(async (req, res) => {
    const scheduleId = req.body?.delivery_schedule_id;
    const workDate = req.body?.work_date || todayDateString();
    if (!scheduleId) return res.status(400).json({ error: 'delivery_schedule_id is required' });

    const { getActiveActivityFlowVersionId, getLineWithBlanket } = require('../services/blanketPosEngine');

    const { data: schedule, error } = await supabase
      .from('delivery_schedules')
      .select('id, activity_flow_version_id, due_date, status, blanket_po_line_id')
      .eq('id', scheduleId)
      .maybeSingle();
    if (error) throw error;
    if (!schedule) return res.status(404).json({ error: 'Delivery schedule not found' });

    let afVersionId = schedule.activity_flow_version_id;
    if (!afVersionId && schedule.blanket_po_line_id) {
      const { line } = await getLineWithBlanket(schedule.blanket_po_line_id);
      afVersionId = await getActiveActivityFlowVersionId(line.master_record_id);
    }

    const preview = await previewAssigneeForSchedule(afVersionId, workDate);
    let workCenter = null;
    if (preview.work_center_id) {
      const { data: wc } = await supabase
        .from('work_centers')
        .select('id, name, code')
        .eq('id', preview.work_center_id)
        .maybeSingle();
      workCenter = wc;
    }

    return res.json({
      ...preview,
      work_center: workCenter,
      activity_flow_version_id: afVersionId,
    });
  })
);

router.post(
  '/assign-unassigned',
  wrap(async (req, res) => {
    if (!isManager(req.user)) {
      return res.status(403).json({ error: 'Manager access required' });
    }
    const date = req.query.date || req.body?.date || todayDateString();
    const results = await assignUnassignedForDate(date);
    broadcastProductionRealtime({
      action: 'assign_unassigned',
      cardIds: results.map((r) => r.card?.id).filter(Boolean),
      card: {},
    });
    for (const r of results) {
      if (r.card?.assigned_employee_id) {
        broadcastProductionRealtime({
          action: 'assign_unassigned',
          card: r.card,
          advance: { advanced: true },
        });
      }
    }
    return res.json({
      assigned: results.filter((r) => r.card?.assignment_status === 'assigned').length,
      results,
    });
  })
);

router.get(
  '/work-centers/:id/board',
  wrap(async (req, res) => {
    const date = req.query.date || todayDateString();
    const board = await getWorkCenterBoard(req.params.id, date);
    return res.json(board);
  })
);

router.post(
  '/cards/:id/reassign',
  wrap(async (req, res) => {
    if (!isManager(req.user)) {
      return res.status(403).json({ error: 'Manager access required' });
    }
    const result = await reassignCard(req.params.id, req.body?.employee_id);
    const card = await getCardById(req.params.id);
    notifyProduction('reassigned', card, {
      previousEmployeeId: result.previous_employee_id || null,
      previousWorkCenterId: card.work_center_id,
    });
    return res.json({ card, assignee: result.assignee });
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
    const result = await listMyToday(req.user?.sub);
    return res.json({
      cards: result.cards || [],
      ops_completed_today: result.ops_completed_today || 0,
      cards_completed_today: result.cards_completed_today || 0,
      completed_credit: result.completed_credit || 0,
      good_today: result.good_today || 0,
      goal_today: result.goal_today || 0,
      efficiency_pct: result.efficiency_pct || 0,
    });
  })
);

router.get(
  '/cards',
  wrap(async (req, res) => {
    const cards = await listCards({
      employee_id: req.query.employee_id,
      work_center_id: req.query.work_center_id,
      assignment_status: req.query.assignment_status,
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
    const detail = await getCardTrackingDetail(req.params.id);
    return res.json(detail);
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
    const body = req.body || {};
    const card = await reportProgress(req.params.id, body, req.user?.sub, {
      isManager: isManager(req.user),
    });
    notifyProduction('progress', card, {
      operatorId: req.user?.sub,
      quantityGood: body.good_qty != null ? Number(body.good_qty) : null,
      quantityScrap: body.scrap_qty != null ? Number(body.scrap_qty) : null,
      previousEmployeeId: card.advance?.from_employee_id || req.user?.sub,
      previousWorkCenterId: card.advance?.from_work_center_id || card.work_center_id,
      advance: card.advance,
    });
    return res.json({ card });
  })
);

/** Alias for MES terminals that post a single log-output payload */
router.post(
  '/log-output',
  wrap(async (req, res) => {
    const body = req.body || {};
    const cardId = body.production_card_id || body.card_id || req.params?.id;
    if (!cardId) return res.status(400).json({ error: 'production_card_id is required' });
    const card = await reportProgress(
      cardId,
      {
        good_qty: body.quantity_good ?? body.good_qty,
        scrap_qty: body.quantity_scrap ?? body.scrap_qty,
        done_for_day: !!body.done_for_day,
      },
      body.operator_id || req.user?.sub,
      { isManager: isManager(req.user) }
    );
    const action = card.advance?.advanced
      ? 'advanced'
      : body.done_for_day
        ? 'completed'
        : 'progress';
    notifyProduction(action, card, {
      operatorId: body.operator_id || req.user?.sub,
      quantityGood: Number(body.quantity_good ?? body.good_qty ?? 0),
      quantityScrap: Number(body.quantity_scrap ?? body.scrap_qty ?? 0),
      previousEmployeeId: card.advance?.from_employee_id || body.operator_id || req.user?.sub,
      previousWorkCenterId: card.advance?.from_work_center_id || card.work_center_id,
      advance: card.advance,
    });
    return res.json({ card });
  })
);

router.post(
  '/cards/:id/complete',
  wrap(async (req, res) => {
    const body = req.body || {};
    const card = await reportProgress(
      req.params.id,
      { ...body, done_for_day: true },
      req.user?.sub,
      { isManager: isManager(req.user) }
    );
    notifyProduction(card.advance?.advanced ? 'advanced' : 'completed', card, {
      operatorId: req.user?.sub,
      quantityGood: body.good_qty != null ? Number(body.good_qty) : null,
      quantityScrap: body.scrap_qty != null ? Number(body.scrap_qty) : null,
      previousEmployeeId: card.advance?.from_employee_id || req.user?.sub,
      previousWorkCenterId: card.advance?.from_work_center_id || card.work_center_id,
      advance: card.advance,
    });
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
    notifyProduction(result.advance?.advanced ? 'advanced' : 'lot_created', card, {
      operatorId: req.user?.sub,
      quantityGood: req.body?.quantity != null ? Number(req.body.quantity) : null,
      previousEmployeeId: result.advance?.from_employee_id || req.user?.sub,
      previousWorkCenterId: result.advance?.from_work_center_id || card.work_center_id,
      advance: result.advance,
    });
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
