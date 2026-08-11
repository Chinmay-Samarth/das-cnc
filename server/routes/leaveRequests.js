/**
 * Leave requests API — apply (ops/mgr) + review (admin/supervisor)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const {
  createLeaveRequest,
  listMyLeaveRequests,
  listLeaveRequests,
  approveLeaveRequest,
  denyLeaveRequest,
  canApplyLeave,
  canReviewLeave,
} = require('../services/leaveRequestEngine');

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
      console.error('Leave requests route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

router.use(verifyEmployeeAuth);

router.post(
  '/',
  wrap(async (req, res) => {
    if (!canApplyLeave(req.user)) {
      return res.status(403).json({ error: 'Only operators and managers can request leave' });
    }
    const employeeId = req.user?.sub;
    const request = await createLeaveRequest({
      employeeId,
      startDate: req.body?.start_date,
      days: req.body?.days,
      reason: req.body?.reason,
    });
    res.status(201).json({ request });
  })
);

router.get(
  '/mine',
  wrap(async (req, res) => {
    if (!canApplyLeave(req.user) && !canReviewLeave(req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const requests = await listMyLeaveRequests(req.user?.sub);
    res.json({ requests });
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    if (!canReviewLeave(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const status = req.query.status || 'pending';
    const requests = await listLeaveRequests({ status });
    res.json({ requests });
  })
);

router.post(
  '/:id/approve',
  wrap(async (req, res) => {
    if (!canReviewLeave(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const result = await approveLeaveRequest(req.params.id, req.user?.sub, {
      reviewNote: req.body?.review_note,
    });
    res.json(result);
  })
);

router.post(
  '/:id/deny',
  wrap(async (req, res) => {
    if (!canReviewLeave(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const result = await denyLeaveRequest(req.params.id, req.user?.sub, {
      reviewNote: req.body?.review_note,
    });
    res.json(result);
  })
);

module.exports = router;
