/**
 * Dispatch shortfall approvals — request (supervisor/manager/admin) + review (admin/supervisor)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const {
  createShortfallRequest,
  listShortfallRequests,
  approveShortfallRequest,
  denyShortfallRequest,
  canRequestShortfall,
  canReviewShortfall,
} = require('../services/dispatchShortfallEngine');
const { getLotById, getDispatchQtyGate } = require('../services/lotTravelerEngine');

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
      console.error('Dispatch shortfall route error:', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
        code: err.code || undefined,
      });
    }
  };
}

router.use(verifyEmployeeAuth);

router.post(
  '/',
  wrap(async (req, res) => {
    if (!canRequestShortfall(req.user)) {
      return res
        .status(403)
        .json({ error: 'Only supervisors, managers, or admins can request shortfall approval' });
    }
    const lotId = req.body?.lot_id;
    const lot = await getLotById(lotId);
    const gate = await getDispatchQtyGate(lot);
    if (gate.mode !== 'shortfall') {
      return res.status(409).json({
        error:
          gate.mode === 'no_schedule'
            ? 'Lot has no delivery schedule — shortfall approval does not apply'
            : `Lot is not a shortfall (mode: ${gate.mode})`,
      });
    }
    const request = await createShortfallRequest({
      lotId,
      requestedBy: req.user?.sub,
      reason: req.body?.reason,
      lotQty: gate.lot_qty,
      scheduleId: gate.schedule_id,
      scheduleQty: gate.schedule_qty,
    });
    res.status(201).json({ request });
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    if (!canReviewShortfall(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const status = req.query.status || 'pending';
    const requests = await listShortfallRequests({ status });
    res.json({ requests });
  })
);

router.post(
  '/:id/approve',
  wrap(async (req, res) => {
    if (!canReviewShortfall(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const result = await approveShortfallRequest(req.params.id, req.user?.sub, {
      reviewNote: req.body?.review_note,
    });
    res.json(result);
  })
);

router.post(
  '/:id/deny',
  wrap(async (req, res) => {
    if (!canReviewShortfall(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const result = await denyShortfallRequest(req.params.id, req.user?.sub, {
      reviewNote: req.body?.review_note,
    });
    res.json(result);
  })
);

module.exports = router;
