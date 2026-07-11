const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listBlankets,
  getBlanketById,
  createBlanket,
  updateBlanket,
  setBlanketStatus,
  addLine,
  updateLine,
  deleteLine,
} = require('../services/blanketPosEngine');

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
      console.error('Blanket PO route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

router.use(verifyEmployeeAuth);

router.get(
  '/',
  wrap(async (req, res) => {
    const blankets = await listBlankets();
    return res.json({ blanket_pos: blankets });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const blanket = await createBlanket(req.body || {}, req.user?.sub);
    return res.status(201).json({ blanket_po: blanket });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const blanket = await getBlanketById(req.params.id);
    return res.json({ blanket_po: blanket });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const blanket = await updateBlanket(req.params.id, req.body || {});
    return res.json({ blanket_po: blanket });
  })
);

router.post(
  '/:id/activate',
  wrap(async (req, res) => {
    const blanket = await setBlanketStatus(req.params.id, 'active');
    return res.json({ blanket_po: blanket });
  })
);

router.post(
  '/:id/hold',
  wrap(async (req, res) => {
    const blanket = await setBlanketStatus(req.params.id, 'on_hold');
    return res.json({ blanket_po: blanket });
  })
);

router.post(
  '/:id/close',
  wrap(async (req, res) => {
    const blanket = await setBlanketStatus(req.params.id, 'closed');
    return res.json({ blanket_po: blanket });
  })
);

router.post(
  '/:id/cancel',
  wrap(async (req, res) => {
    const blanket = await setBlanketStatus(req.params.id, 'cancelled');
    return res.json({ blanket_po: blanket });
  })
);

router.get(
  '/:id/lines',
  wrap(async (req, res) => {
    const blanket = await getBlanketById(req.params.id);
    return res.json({ lines: blanket.lines || [] });
  })
);

router.post(
  '/:id/lines',
  wrap(async (req, res) => {
    const { line } = await addLine(req.params.id, req.body || {});
    const blanket = await getBlanketById(req.params.id);
    return res.status(201).json({ line, blanket_po: blanket });
  })
);

router.patch(
  '/:id/lines/:lineId',
  wrap(async (req, res) => {
    const line = await updateLine(req.params.id, req.params.lineId, req.body || {});
    return res.json({ line });
  })
);

router.delete(
  '/:id/lines/:lineId',
  wrap(async (req, res) => {
    const result = await deleteLine(req.params.id, req.params.lineId);
    return res.json(result);
  })
);

module.exports = router;
