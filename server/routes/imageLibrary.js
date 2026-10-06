const express = require('express');
const jwt = require('jsonwebtoken');
const { searchImageLibrary } = require('../services/imageLibraryEngine');

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
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.get('/', verifyEmployeeAuth, async (req, res) => {
  try {
    const results = await searchImageLibrary(req.query.q, req.query.kind);
    return res.json({ results });
  } catch (err) {
    console.error('Image library search error:', err);
    return res.status(500).json({ error: 'Unable to search images' });
  }
});

module.exports = router;
