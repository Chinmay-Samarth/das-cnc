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
  stageOutsourceLots,
  splitRemainingToNewCard,
} = require('../services/productionCardEngine');
const {
  unstageOutsourceLots,
  listOutsourceBatches,
  listOutsourceShipments,
  listStageCandidates,
  getOutsourceShipmentById,
} = require('../services/outsourceEngine');
const {
  assignUnassignedForDate,
  reassignCard,
  getWorkCenterBoard,
  previewAssigneeForSchedule,
} = require('../services/productionAssignEngine');
const {
  getLotById,
  completeLotOp,
  dispatchLot,
  reassignLot,
  listReadyForDispatch,
  listLotOpCompletions,
  mergeLotsForDispatch,
} = require('../services/lotTravelerEngine');
const {
  getOpCardById,
  listMyTodayOpCards,
  startOpCard,
  reportOpCardProgress,
  completeOpCard,
  reassignOpCard,
  healAndSpawnMissingOpCards,
} = require('../services/productionOpCardEngine');
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

function isAdminOrSupervisor(user) {
  const level = String(user?.access_level || user?.accessLevel || '').toUpperCase();
  return level === 'ADMIN' || level === 'SUPERVISOR';
}

async function assertBoardJobReassign(req, workCenterId, workDate) {
  const { assertJobReassignAllowed } = require('../services/wcContingencyEngine');
  return assertJobReassignAllowed(
    workCenterId,
    workDate || todayDateString(),
    req.user?.sub,
    req.user
  );
}

function notifyProduction(action, cardOrMeta = {}, extras = {}) {
  const card = cardOrMeta.card || cardOrMeta;
  const advance = cardOrMeta.advance || extras.advance || card.advance || null;
  const lot = extras.lot || cardOrMeta.lot || advance?.lot || null;
  const opCard = extras.opCard || cardOrMeta.op_card || null;
  broadcastProductionRealtime({
    action,
    card,
    lot,
    opCard,
    assignee: extras.assignee || null,
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
  '/work-centers/:id/acting-manager',
  wrap(async (req, res) => {
    if (!isAdminOrSupervisor(req.user)) {
      return res.status(403).json({ error: 'Admin or supervisor access required' });
    }
    const { pinActingManager } = require('../services/wcContingencyEngine');
    const date = req.body?.work_date || todayDateString();
    const contingency = await pinActingManager(
      req.params.id,
      date,
      req.body?.employee_id,
      req.user?.sub
    );
    emitProductionUpdated({
      action: 'acting_manager_pinned',
      workCenterId: req.params.id,
      employeeId: contingency.acting_employee_id,
    });
    return res.json({ contingency });
  })
);

router.post(
  '/cards/:id/reassign',
  wrap(async (req, res) => {
    if (!isManager(req.user)) {
      return res.status(403).json({ error: 'Manager access required' });
    }
    const card = await getCardById(req.params.id);
    await assertBoardJobReassign(
      req,
      card.work_center_id,
      req.body?.work_date || card.work_date || todayDateString()
    );
    const result = await reassignCard(req.params.id, req.body?.employee_id);
    const updated = await getCardById(req.params.id);
    notifyProduction('reassigned', updated, {
      previousEmployeeId: result.previous_employee_id || null,
      previousWorkCenterId: updated.work_center_id,
      assignee: result.assignee,
    });
    return res.json({ card: updated, assignee: result.assignee });
  })
);

router.post(
  '/cards/:id/split-remaining',
  wrap(async (req, res) => {
    if (!isManager(req.user)) {
      return res.status(403).json({ error: 'Manager access required' });
    }
    const result = await splitRemainingToNewCard(req.params.id, {
      quantity: req.body?.quantity,
      employee_id: req.body?.employee_id,
      work_date: req.body?.work_date,
    });
    notifyProduction('split_remaining', result.source, {
      assignee: result.assignee,
      cardIds: [result.source?.id, result.card?.id].filter(Boolean),
    });
    if (result.card?.id) {
      notifyProduction('released', result.card, {
        assignee: result.assignee,
        cardIds: [result.source?.id, result.card?.id].filter(Boolean),
      });
    }
    return res.json(result);
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
      lots: result.lots || [],
      op_cards: result.op_cards || [],
      completed_ops_today: result.completed_ops_today || [],
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
      lean: true,
    });
    res.json({ card });
    setImmediate(() => {
      try {
        notifyProduction('started', card);
      } catch (e) {
        console.error('started notify:', e.message);
      }
    });
  })
);

router.post(
  '/cards/:id/progress',
  wrap(async (req, res) => {
    const body = req.body || {};
    const card = await reportProgress(req.params.id, body, req.user?.sub, {
      isManager: isManager(req.user),
    });
    const action = card.lot || card.advance?.lot_minted ? 'lot_created' : 'progress';
    notifyProduction(action, card, {
      operatorId: req.user?.sub,
      quantityGood: body.good_qty != null ? Number(body.good_qty) : null,
      quantityScrap: body.scrap_qty != null ? Number(body.scrap_qty) : null,
      previousEmployeeId: card.advance?.from_employee_id || req.user?.sub,
      previousWorkCenterId: card.advance?.from_work_center_id || card.work_center_id,
      advance: card.advance,
      lot: card.lot || card.advance?.lot || null,
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
    const action =
      card.lot || card.advance?.lot_minted
        ? 'lot_created'
        : card.advance?.advanced
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
      lot: card.lot || card.advance?.lot || null,
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
    notifyProduction(
      card.lot || card.advance?.lot_minted
        ? 'lot_created'
        : card.advance?.advanced
          ? 'advanced'
          : 'completed',
      card,
      {
      operatorId: req.user?.sub,
      quantityGood: body.good_qty != null ? Number(body.good_qty) : null,
      quantityScrap: body.scrap_qty != null ? Number(body.scrap_qty) : null,
      previousEmployeeId: card.advance?.from_employee_id || req.user?.sub,
      previousWorkCenterId: card.advance?.from_work_center_id || card.work_center_id,
      advance: card.advance,
      lot: card.lot || card.advance?.lot || null,
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
      lot: result.lot,
    });
    return res.status(201).json(result);
  })
);

router.get(
  '/ready-for-dispatch',
  wrap(async (req, res) => {
    const lots = await listReadyForDispatch();
    return res.json({ lots });
  })
);

router.post(
  '/lots/merge-and-dispatch',
  wrap(async (req, res) => {
    const lotIds = Array.isArray(req.body?.lot_ids) ? req.body.lot_ids : [];
    const result = await mergeLotsForDispatch(lotIds, req.user?.sub);
    const lot = result.lot;
    let card = {};
    if (lot.production_card_id) {
      try {
        card = await getCardById(lot.production_card_id);
      } catch {
        card = { id: lot.production_card_id };
      }
    }
    notifyProduction('lot_dispatched', card, {
      operatorId: req.user?.sub,
      quantityGood: Number(lot.quantity || 0),
      lot,
    });
    return res.json(result);
  })
);

router.get(
  '/lots/:id',
  wrap(async (req, res) => {
    const lot = await getLotById(req.params.id);
    const completions = await listLotOpCompletions(req.params.id);
    return res.json({ lot, completions });
  })
);

router.post(
  '/lots/:id/complete',
  wrap(async (req, res) => {
    const body = req.body || {};
    const result = await completeLotOp(req.params.id, body, req.user?.sub, {
      isManager: isManager(req.user),
    });
    const lot = result.lot || (await getLotById(req.params.id));
    let card = {};
    if (lot.production_card_id) {
      try {
        card = await getCardById(lot.production_card_id);
      } catch {
        card = { id: lot.production_card_id };
      }
    }
    notifyProduction(
      result.ready_for_dispatch ? 'lot_ready_for_dispatch' : 'lot_advanced',
      card,
      {
        operatorId: req.user?.sub,
        quantityGood: body.good_qty != null ? Number(body.good_qty) : Number(lot.quantity || 0),
        quantityScrap: body.scrap_qty != null ? Number(body.scrap_qty) : null,
        previousEmployeeId: result.from_employee_id || req.user?.sub,
        previousWorkCenterId: result.from_work_center_id || null,
        advance: {
          advanced: !!result.advanced,
          from_employee_id: result.from_employee_id,
          from_work_center_id: result.from_work_center_id,
        },
        lot,
      }
    );
    return res.json(result);
  })
);

router.post(
  '/lots/:id/dispatch',
  wrap(async (req, res) => {
    const lot = await dispatchLot(req.params.id, req.user?.sub);
    let card = {};
    if (lot.production_card_id) {
      try {
        card = await getCardById(lot.production_card_id);
      } catch {
        card = { id: lot.production_card_id };
      }
    }
    notifyProduction('lot_dispatched', card, {
      operatorId: req.user?.sub,
      quantityGood: Number(lot.quantity || 0),
      lot,
    });
    return res.json({ lot });
  })
);

router.post(
  '/lots/:id/reassign',
  wrap(async (req, res) => {
    if (!isManager(req.user)) {
      return res.status(403).json({ error: 'Manager access required' });
    }
    const existing = await getLotById(req.params.id);
    await assertBoardJobReassign(
      req,
      existing.work_center_id,
      req.body?.work_date || todayDateString()
    );
    const result = await reassignLot(req.params.id, req.body?.employee_id);
    const [lot] = result.lot
      ? [await getLotById(result.lot.id)]
      : [null];
    let card = {};
    if (lot?.production_card_id) {
      try {
        card = await getCardById(lot.production_card_id);
      } catch {
        card = { id: lot.production_card_id };
      }
    }
    notifyProduction('lot_reassigned', card, {
      previousEmployeeId: result.previous_employee_id || null,
      previousWorkCenterId: lot?.work_center_id || null,
      lot,
      assignee: result.assignee,
    });
    return res.json({ lot, assignee: result.assignee });
  })
);

router.get(
  '/outsource/batches',
  wrap(async (req, res) => {
    const batches = await listOutsourceBatches({ status: req.query.status });
    return res.json({ batches });
  })
);

router.get(
  '/outsource/shipments/:shipmentId',
  wrap(async (req, res) => {
    const shipment = await getOutsourceShipmentById(req.params.shipmentId);
    return res.json({ shipment });
  })
);

router.get(
  '/outsource/shipments',
  wrap(async (req, res) => {
    const shipments = await listOutsourceShipments({ status: req.query.status || 'sent' });
    return res.json({ shipments });
  })
);

router.get(
  '/outsource/stage-candidates',
  wrap(async (req, res) => {
    const lots = await listStageCandidates();
    return res.json({ lots });
  })
);

router.post(
  '/outsource/stage',
  wrap(async (req, res) => {
    const result = await stageOutsourceLots(req.body || {}, req.user?.sub, {
      isManager: isManager(req.user),
    });
    const lotIds = result.lot_ids || [];
    if (lotIds.length) {
      const { data: lots } = await supabase
        .from('production_lots')
        .select('production_card_id')
        .in('id', lotIds);
      const cardIds = [...new Set((lots || []).map((l) => l.production_card_id).filter(Boolean))];
      for (const cardId of cardIds) {
        try {
          const card = await getCardById(cardId);
          notifyProduction('outsource_staged', card, { operatorId: req.user?.sub });
        } catch {
          /* ignore */
        }
      }
    } else {
      notifyProduction('outsource_staged', { id: null }, { operatorId: req.user?.sub });
    }
    return res.status(201).json(result);
  })
);

router.post(
  '/outsource/unstage',
  wrap(async (req, res) => {
    const result = await unstageOutsourceLots(req.body || {}, req.user?.sub, {
      isManager: isManager(req.user),
    });
    notifyProduction('outsource_unstaged', { id: null }, { operatorId: req.user?.sub });
    return res.json(result);
  })
);

router.post(
  '/outsource/send',
  wrap(async (req, res) => {
    const result = await sendOutsource(req.body || {}, req.user?.sub, {
      isManager: isManager(req.user),
    });
    const cardId =
      result.shipment?.production_card_id || req.body?.production_card_id || result.card_ids?.[0];
    const card = cardId ? await getCardById(cardId) : { id: null };
    notifyProduction('outsource_sent', card, { cardIds: result.card_ids || null });
    return res.status(201).json(result);
  })
);

router.post(
  '/outsource/:shipmentId/receive',
  wrap(async (req, res) => {
    const result = await receiveOutsource(req.params.shipmentId, req.user?.sub, {
      isManager: isManager(req.user),
      lines: req.body?.lines,
      girnId: req.body?.girn_id || null,
    });
    const card = await getCardById(result.shipment?.production_card_id);
    notifyProduction('outsource_received', card);
    for (const adv of result.lots || []) {
      if (adv?.lot) {
        notifyProduction(
          adv.ready_for_dispatch ? 'lot_ready_for_dispatch' : 'lot_advanced',
          card,
          {
            operatorId: req.user?.sub,
            previousEmployeeId: adv.from_employee_id || null,
            previousWorkCenterId: adv.from_work_center_id || null,
            advance: {
              advanced: !!adv.advanced,
              from_employee_id: adv.from_employee_id,
              from_work_center_id: adv.from_work_center_id,
            },
            lot: adv.lot,
          }
        );
      }
    }
    return res.json(result);
  })
);

// ─── Operation Cards ──────────────────────────────────────────────────────────

router.get(
  '/op-cards/my-today',
  wrap(async (req, res) => {
    const op_cards = await listMyTodayOpCards(req.user?.sub);
    return res.json({ op_cards });
  })
);

router.get(
  '/op-cards/:id',
  wrap(async (req, res) => {
    const op_card = await getOpCardById(req.params.id);
    return res.json({ op_card });
  })
);

router.post(
  '/op-cards/:id/start',
  wrap(async (req, res) => {
    const op_card = await startOpCard(req.params.id, req.user?.sub, {
      isManager: isManager(req.user),
    });
    // Respond immediately — broadcast after so Start isn't blocked on socket fan-out
    res.json({ op_card });
    setImmediate(() => {
      try {
        notifyProduction(
          'op_started',
          {
            id: op_card.parent_production_card_id || op_card.production_card_id,
            work_center_id: op_card.work_center_id,
            assigned_employee_id: op_card.assigned_employee_id,
            status: 'RUNNING',
          },
          {
            operatorId: req.user?.sub,
            opCard: op_card,
            lot: op_card.production_lot_id ? { id: op_card.production_lot_id } : null,
          }
        );
      } catch (e) {
        console.error('op_started notify:', e.message);
      }
    });
  })
);

router.post(
  '/op-cards/:id/progress',
  wrap(async (req, res) => {
    const body = req.body || {};
    const result = await reportOpCardProgress(req.params.id, body, req.user?.sub, {
      isManager: isManager(req.user),
    });
    const parentId =
      result.op_card?.production_card_id ||
      result.parent?.id ||
      result.op_card?.parent_production_card_id;
    let card = result.parent || {};
    if (parentId && !card.id) {
      try {
        card = await getCardById(parentId);
      } catch {
        card = { id: parentId };
      }
    }
    const advance = result.advance || result.parent?.advance || null;
    notifyProduction(
      advance?.ready_for_dispatch
        ? 'lot_ready_for_dispatch'
        : advance?.advanced
          ? 'lot_advanced'
          : body.done_for_day
            ? 'completed'
            : 'progress',
      card,
      {
        operatorId: req.user?.sub,
        quantityGood: body.good_qty != null ? Number(body.good_qty) : null,
        quantityScrap: body.scrap_qty != null ? Number(body.scrap_qty) : null,
        previousEmployeeId: advance?.from_employee_id || req.user?.sub,
        previousWorkCenterId: advance?.from_work_center_id || null,
        advance,
        lot: result.lot || advance?.lot || null,
        opCard: result.op_card || null,
      }
    );
    return res.json(result);
  })
);

router.post(
  '/op-cards/:id/complete',
  wrap(async (req, res) => {
    const body = req.body || {};
    const result = await completeOpCard(req.params.id, body, req.user?.sub, {
      isManager: isManager(req.user),
    });
    const parentId =
      result.op_card?.production_card_id || result.op_card?.parent_production_card_id;
    let card = result.parent || {};
    if (parentId && !card.id) {
      try {
        card = await getCardById(parentId);
      } catch {
        card = { id: parentId };
      }
    }
    const advance = result.advance || null;
    notifyProduction(
      advance?.ready_for_dispatch
        ? 'lot_ready_for_dispatch'
        : advance?.advanced
          ? 'lot_advanced'
          : 'completed',
      card,
      {
        operatorId: req.user?.sub,
        quantityGood: body.good_qty != null ? Number(body.good_qty) : null,
        quantityScrap: body.scrap_qty != null ? Number(body.scrap_qty) : null,
        previousEmployeeId: advance?.from_employee_id || req.user?.sub,
        previousWorkCenterId: advance?.from_work_center_id || null,
        advance,
        lot: result.lot || null,
        opCard: result.op_card || null,
      }
    );
    return res.json(result);
  })
);

router.post(
  '/op-cards/:id/reassign',
  wrap(async (req, res) => {
    if (!isManager(req.user)) {
      return res.status(403).json({ error: 'Manager access required' });
    }
    const existingOp = await getOpCardById(req.params.id);
    await assertBoardJobReassign(
      req,
      existingOp.work_center_id,
      req.body?.work_date || todayDateString()
    );
    const result = await reassignOpCard(req.params.id, req.body?.employee_id);
    const op = result.op_card;
    let card = {};
    if (op?.parent_production_card_id) {
      try {
        card = await getCardById(op.parent_production_card_id);
      } catch {
        card = { id: op.parent_production_card_id };
      }
    }
    let lot = null;
    if (op?.production_lot_id) {
      try {
        lot = await getLotById(op.production_lot_id);
      } catch {
        lot = { id: op.production_lot_id };
      }
    }
    notifyProduction('op_reassigned', card, {
      previousEmployeeId: result.previous_employee_id || null,
      previousWorkCenterId: op?.work_center_id || null,
      opCard: op,
      assignee: result.assignee,
      lot,
    });
    return res.json(result);
  })
);

router.post(
  '/heal-op-cards',
  wrap(async (req, res) => {
    if (!isManager(req.user)) {
      return res.status(403).json({ error: 'Manager access required' });
    }
    const result = await healAndSpawnMissingOpCards(
      req.body?.limit != null ? Number(req.body.limit) : 200
    );
    broadcastProductionRealtime({ action: 'heal_op_cards', card: {} });
    return res.json(result);
  })
);

module.exports = router;
