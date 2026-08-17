/**
 * Admin factory dashboard API
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const { getFactoryDashboard } = require('../services/factoryDashboardEngine');

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

function isAdmin(user) {
  const level = String(
    user?.access_level || user?.accessLevel || user?.job_description || ''
  ).toUpperCase();
  return (
    level === 'ADMIN' ||
    level.includes('ADMIN') ||
    level.includes('MANAGING DIRECTOR') ||
    level === 'MD'
  );
}

router.use(verifyEmployeeAuth);

router.get('/factory-dashboard', async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const date = req.query.date || undefined;
    const dashboard = await getFactoryDashboard({ date });
    res.json(dashboard);
  } catch (err) {
    console.error('Factory dashboard error:', err);
    res.status(500).json({ error: err.message || 'Unable to load factory dashboard' });
  }
});

module.exports = router;
