const express = require('express');
const jwt = require('jsonwebtoken');
const { listToolInstances } = require('../services/toolLifeEngine');

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

router.get('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const instances = await listToolInstances({
      masterRecordId: req.query.master_record_id,
      status: req.query.status,
    });
    return res.json({ tool_instances: instances });
  } catch (err) {
    console.error('Tool instances list error:', err);
    return res.status(500).json({ error: err.message || 'Unable to load tool instances' });
  }
});

module.exports = router;
