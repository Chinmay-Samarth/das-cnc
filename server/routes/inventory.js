const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listStock,
  getStockSummary,
  getStockById,
  getLedger,
} = require('../services/inventoryQueryEngine');
const { reconcileAllStockFromLedger } = require('../services/backflushEngine');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    const token = authHeader.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

router.use(verifyEmployeeAuth);

router.get('/stock/summary', async (req, res) => {
  try {
    const summary = await getStockSummary();
    return res.json({ summary });
  } catch (err) {
    console.error('Inventory summary error:', err);
    return res.status(500).json({ error: 'Unable to load stock summary' });
  }
});

router.get('/stock', async (req, res) => {
  try {
    const result = await listStock({
      category: req.query.category || null,
      search: req.query.search || '',
      masterRecordId: req.query.master_record_id || null,
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort || 'current_stock',
      order: req.query.order || 'desc',
    });
    return res.json(result);
  } catch (err) {
    console.error('Inventory stock list error:', err);
    return res.status(500).json({ error: 'Unable to load stock' });
  }
});

router.get('/stock/:stockId', async (req, res) => {
  try {
    const result = await getStockById(req.params.stockId);
    if (!result) return res.status(404).json({ error: 'Stock row not found' });
    return res.json(result);
  } catch (err) {
    console.error('Inventory stock detail error:', err);
    return res.status(500).json({ error: 'Unable to load stock detail' });
  }
});

router.get('/ledger', async (req, res) => {
  try {
    const { item_category: itemCategory, master_record_id: masterRecordId, lot_number: lotNumber } = req.query;
    if (!itemCategory || !masterRecordId) {
      return res.status(400).json({ error: 'item_category and master_record_id are required' });
    }

    const ledger = await getLedger({
      itemCategory,
      masterRecordId,
      lotNumber: lotNumber || null,
    });

    return res.json({ ledger });
  } catch (err) {
    console.error('Inventory ledger error:', err);
    return res.status(500).json({ error: 'Unable to load ledger' });
  }
});

router.post('/reconcile', async (req, res) => {
  try {
    const result = await reconcileAllStockFromLedger();
    return res.json(result);
  } catch (err) {
    console.error('Inventory reconcile error:', err);
    return res.status(500).json({ error: err.message || 'Unable to reconcile stock' });
  }
});

module.exports = router;
