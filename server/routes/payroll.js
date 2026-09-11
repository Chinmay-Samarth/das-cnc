/**
 * Monthly payroll API — generate, edit inputs, lock, export, formula versions
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const {
  getPayroll,
  generatePayroll,
  updatePayrollLine,
  lockPayroll,
  getEmployeePayroll,
  exportPayrollWorkbook,
  listFormulaVersions,
  createFormulaVersion,
  getLatestFormulaVersion,
  DEFAULT_FORMULAS,
} = require('../services/payrollEngine');

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

function accessLevel(user) {
  return String(user?.access_level || user?.accessLevel || user?.job_description || '').toUpperCase();
}

function requireAdmin(req, res, next) {
  const level = accessLevel(req.user);
  if (level !== 'ADMIN' && level !== 'SUPERVISOR') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error('Payroll route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

function parseYm(req) {
  const year = Number(req.params.year ?? req.query.year);
  const month = Number(req.params.month ?? req.query.month);
  return { year, month };
}

router.use(verifyEmployeeAuth);

router.get(
  '/formulas',
  requireAdmin,
  wrap(async (_req, res) => {
    const versions = await listFormulaVersions();
    const current = await getLatestFormulaVersion();
    const mergedCurrent = current
      ? {
          ...current,
          formulas: { ...DEFAULT_FORMULAS, ...(current.formulas || {}) },
        }
      : null;
    res.json({ versions, current: mergedCurrent, defaults: DEFAULT_FORMULAS });
  })
);

router.post(
  '/formulas',
  requireAdmin,
  wrap(async (req, res) => {
    const version = await createFormulaVersion({
      formulas: req.body?.formulas,
      label: req.body?.label,
      createdBy: req.user?.sub,
    });
    res.status(201).json({ version });
  })
);

router.get(
  '/employees/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const result = await getEmployeePayroll(req.params.id, year, month);
    res.json(result);
  })
);

router.get(
  '/',
  requireAdmin,
  wrap(async (req, res) => {
    const { year, month } = parseYm(req);
    const result = await getPayroll(year, month);
    res.json(result);
  })
);

router.post(
  '/:year/:month/generate',
  requireAdmin,
  wrap(async (req, res) => {
    const { year, month } = parseYm(req);
    const result = await generatePayroll(year, month, {
      preserveOverrides: req.body?.preserve_overrides !== false,
    });
    res.json(result);
  })
);

router.post(
  '/:year/:month/lock',
  requireAdmin,
  wrap(async (req, res) => {
    const { year, month } = parseYm(req);
    const result = await lockPayroll(year, month, req.user?.sub);
    res.json(result);
  })
);

router.get(
  '/:year/:month/export',
  requireAdmin,
  wrap(async (req, res) => {
    const { year, month } = parseYm(req);
    const { buffer, filename } = await exportPayrollWorkbook(year, month);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  })
);

router.patch(
  '/lines/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const line = await updatePayrollLine(req.params.id, req.body || {}, req.user?.sub);
    res.json({ line });
  })
);

module.exports = router;
