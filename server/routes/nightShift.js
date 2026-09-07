/**
 * Night shift weekly roster API
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { isAdminUser } = require('../utils/accessLevel');
const {
  getRosterOverview,
  setWeekRoster,
  setUpcomingRoster,
  applyCurrentWeek,
} = require('../services/nightShiftRosterEngine');

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

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('Night shift route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function isValidYmd(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str);
}

router.use(verifyEmployeeAuth);

router.get(
  '/',
  wrap(async (req, res) => {
    const overview = await getRosterOverview();
    res.json(overview);
  })
);

router.put(
  '/weeks/:weekStart',
  requireAdmin,
  wrap(async (req, res) => {
    const weekStart = String(req.params.weekStart || '');
    if (!isValidYmd(weekStart)) {
      return res.status(400).json({ error: 'weekStart must be YYYY-MM-DD' });
    }
    const raw = req.body?.employee_ids;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: 'employee_ids must be an array' });
    }
    const employeeIds = raw.map(String);
    if (employeeIds.some((id) => !isValidUUID(id))) {
      return res.status(400).json({ error: 'All employee_ids must be valid UUIDs' });
    }
    const createdBy = req.user?.sub || req.user?.id || null;
    const result = await setWeekRoster(weekStart, employeeIds, { createdBy });
    res.json(result);
  })
);

router.put(
  '/upcoming',
  requireAdmin,
  wrap(async (req, res) => {
    const raw = req.body?.employee_ids;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: 'employee_ids must be an array' });
    }
    const employeeIds = raw.map(String);
    if (employeeIds.some((id) => !isValidUUID(id))) {
      return res.status(400).json({ error: 'All employee_ids must be valid UUIDs' });
    }
    const createdBy = req.user?.sub || req.user?.id || null;
    const upcoming = await setUpcomingRoster(employeeIds, { createdBy });
    res.json({ upcoming });
  })
);

router.post(
  '/apply',
  requireAdmin,
  wrap(async (req, res) => {
    const result = await applyCurrentWeek();
    res.json(result);
  })
);

module.exports = router;
