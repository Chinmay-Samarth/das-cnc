const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listRules,
  createRule,
  updateRule,
  activateRule,
  deactivateRule,
  listRuleDates,
  setRuleDates,
  listSchedules,
  createOneOffSchedule,
  generateFromRule,
  previewMatchingDates,
  updateSchedule,
  releaseSchedule,
  cancelSchedule,
  getLineWithBlanket,
} = require('../services/blanketPosEngine');
const { emitDeliveryScheduleUpdated } = require('../socket/emitter');

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
      console.error('Delivery schedule route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

async function blanketPoIdFromLine(lineId) {
  if (!lineId) return null;
  try {
    const { blanket } = await getLineWithBlanket(lineId);
    return blanket?.id || null;
  } catch {
    return null;
  }
}

router.use(verifyEmployeeAuth);

// ─── Rules ───────────────────────────────────────────────────────────────────

router.get(
  '/rules',
  wrap(async (req, res) => {
    const rules = await listRules(req.query.blanket_po_line_id || null);
    return res.json({ rules });
  })
);

router.post(
  '/rules',
  wrap(async (req, res) => {
    const rule = await createRule(req.body || {});
    const blanketPoId = await blanketPoIdFromLine(rule.blanket_po_line_id);
    emitDeliveryScheduleUpdated({
      action: 'rule_created',
      ruleId: rule.id,
      lineId: rule.blanket_po_line_id,
      blanketPoId,
    });
    return res.status(201).json({ rule });
  })
);

router.patch(
  '/rules/:id',
  wrap(async (req, res) => {
    const rule = await updateRule(req.params.id, req.body || {});
    const blanketPoId = await blanketPoIdFromLine(rule.blanket_po_line_id);
    emitDeliveryScheduleUpdated({
      action: 'rule_updated',
      ruleId: rule.id,
      lineId: rule.blanket_po_line_id,
      blanketPoId,
    });
    return res.json({ rule });
  })
);

router.post(
  '/rules/:id/activate',
  wrap(async (req, res) => {
    const rule = await activateRule(req.params.id);
    const blanketPoId = await blanketPoIdFromLine(rule.blanket_po_line_id);
    emitDeliveryScheduleUpdated({
      action: 'rule_activated',
      ruleId: rule.id,
      lineId: rule.blanket_po_line_id,
      blanketPoId,
    });
    return res.json({ rule });
  })
);

router.post(
  '/rules/:id/deactivate',
  wrap(async (req, res) => {
    const rule = await deactivateRule(req.params.id);
    const blanketPoId = await blanketPoIdFromLine(rule.blanket_po_line_id);
    emitDeliveryScheduleUpdated({
      action: 'rule_deactivated',
      ruleId: rule.id,
      lineId: rule.blanket_po_line_id,
      blanketPoId,
    });
    return res.json({ rule });
  })
);

router.get(
  '/rules/:id/dates',
  wrap(async (req, res) => {
    const dates = await listRuleDates(req.params.id);
    return res.json({ dates });
  })
);

router.put(
  '/rules/:id/dates',
  wrap(async (req, res) => {
    const dates = await setRuleDates(req.params.id, req.body?.dates ?? req.body ?? []);
    emitDeliveryScheduleUpdated({
      action: 'rule_dates_updated',
      ruleId: req.params.id,
    });
    return res.json({ dates });
  })
);

router.post(
  '/rules/:id/preview',
  wrap(async (req, res) => {
    const result = await previewMatchingDates({
      rule_id: req.params.id,
      horizon_start: req.body?.horizon_start,
      horizon_end: req.body?.horizon_end,
    });
    return res.json(result);
  })
);

// ─── Occurrences ─────────────────────────────────────────────────────────────

router.get(
  '/',
  wrap(async (req, res) => {
    const schedules = await listSchedules({
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      customer_id: req.query.customer_id,
      blanket_po_id: req.query.blanket_po_id,
      blanket_po_line_id: req.query.blanket_po_line_id,
    });
    return res.json({ schedules });
  })
);

router.post(
  '/generate',
  wrap(async (req, res) => {
    const result = await generateFromRule(req.body || {}, req.user?.sub);
    const first = result.schedules?.[0];
    emitDeliveryScheduleUpdated({
      action: 'generated',
      blanketPoId: first?.blanket_po_id || null,
      scheduleIds: (result.schedules || []).map((s) => s.id),
    });
    return res.status(201).json(result);
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const schedule = await createOneOffSchedule(req.body || {}, req.user?.sub);
    emitDeliveryScheduleUpdated({
      action: 'created',
      scheduleId: schedule.id,
      blanketPoId: schedule.blanket_po_id || null,
      lineId: schedule.blanket_po_line_id || null,
    });
    return res.status(201).json({ schedule });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const schedule = await updateSchedule(req.params.id, req.body || {});
    emitDeliveryScheduleUpdated({
      action: 'updated',
      scheduleId: schedule.id,
      blanketPoId: schedule.blanket_po_id || null,
      status: schedule.status,
    });
    return res.json({ schedule });
  })
);

router.post(
  '/:id/release',
  wrap(async (req, res) => {
    const schedule = await releaseSchedule(req.params.id);
    emitDeliveryScheduleUpdated({
      action: 'released',
      scheduleId: schedule.id,
      blanketPoId: schedule.blanket_po_id || null,
      status: schedule.status,
    });
    return res.json({ schedule });
  })
);

router.post(
  '/:id/cancel',
  wrap(async (req, res) => {
    const schedule = await cancelSchedule(req.params.id);
    emitDeliveryScheduleUpdated({
      action: 'cancelled',
      scheduleId: schedule.id,
      blanketPoId: schedule.blanket_po_id || null,
      status: schedule.status,
    });
    return res.json({ schedule });
  })
);

module.exports = router;
