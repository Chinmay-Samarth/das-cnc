/**
 * GIRN approval queue — list for admin/supervisor reviewers.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { canReviewGirn, listGirnsForApproval } = require('../services/girnApprovalEngine');

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
      console.error('GIRN approvals route error:', err);
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
      });
    }
  };
}

router.use(verifyEmployeeAuth);

router.get(
  '/',
  wrap(async (req, res) => {
    if (!canReviewGirn(req.user)) {
      return res.status(403).json({ error: 'Admin or supervisor access required' });
    }
    const status = req.query.status || 'ready';
    const girns = await listGirnsForApproval({ status });
    res.json({ girns });
  })
);

module.exports = router;
