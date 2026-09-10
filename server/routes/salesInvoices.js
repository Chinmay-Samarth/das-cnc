const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { computeAccessLevel } = require('../utils/accessLevel');
const {
  getCompanySettings,
  updateCompanySettings,
  listInvoices,
  getInvoiceById,
  createDraftFromLot,
  updateDraft,
  issueInvoice,
  confirmPrinted,
  confirmPackingSlipPrinted,
  cancelInvoice,
  recordPayment,
  recordBulkPayments,
  retrySalesInvoiceTallySync,
  retrySalesInvoiceReceiptTallySync,
  findActiveInvoiceForLot,
  resolveLotBillingContext,
  storeSalesInvoicePdf,
} = require('../services/salesInvoiceEngine');
const { isTallyEnabled, tallyCompany, tallyUrl } = require('../services/tallyClient');
const { fetchBankLedgersFromTally } = require('../services/tallyBankLedgers');
const { fetchCustomerOutstandingFromTally } = require('../services/tallyCustomerOutstanding');
const { createClient } = require('@supabase/supabase-js');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
      console.error('Sales invoice route error:', err);
      res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
    }
  };
}

function actorId(req) {
  return req.user?.sub || req.user?.id || null;
}

function requireAdminOrSupervisor(req, res, next) {
  const level = computeAccessLevel(
    req.user?.access_level || req.user?.job_description || req.user?.accessLevel
  );
  if (level !== 'ADMIN' && level !== 'SUPERVISOR') {
    return res.status(403).json({ error: 'Admin or Supervisor access required' });
  }
  next();
}

router.use(verifyEmployeeAuth);

router.get(
  '/company-settings',
  wrap(async (req, res) => {
    const settings = await getCompanySettings();
    return res.json({ company_settings: settings });
  })
);

router.patch(
  '/company-settings',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const settings = await updateCompanySettings(req.body || {});
    return res.json({ company_settings: settings });
  })
);

router.get(
  '/by-lot/:lotId',
  wrap(async (req, res) => {
    const inv = await findActiveInvoiceForLot(req.params.lotId);
    if (!inv) return res.json({ sales_invoice: null });
    const full = await getInvoiceById(inv.id);
    return res.json({ sales_invoice: full });
  })
);

router.get(
  '/preview-lot/:lotId',
  wrap(async (req, res) => {
    const ctx = await resolveLotBillingContext(req.params.lotId);
    const company = await getCompanySettings();
    return res.json({
      lot: {
        id: ctx.lot.id,
        lot_number: ctx.lot.lot_number,
        quantity: ctx.lot.quantity,
        status: ctx.lot.status,
      },
      schedule: {
        ...ctx.schedule,
        remaining_qty: ctx.remaining_qty,
      },
      remaining_qty: ctx.remaining_qty,
      line: ctx.line,
      blanket: ctx.blanket,
      customer: ctx.customer,
      component_label: ctx.componentLabel,
      company_settings: company,
    });
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    const invoices = await listInvoices({
      status: req.query.status,
      customerId: req.query.customer_id,
    });
    return res.json({ sales_invoices: invoices });
  })
);

router.get(
  '/tally/status',
  wrap(async (req, res) => {
    return res.json({
      tally_enabled: isTallyEnabled(),
      company: tallyCompany() || null,
      url: tallyUrl(),
    });
  })
);

router.get(
  '/tally/bank-ledgers',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    if (!isTallyEnabled()) {
      return res.status(422).json({ error: 'Tally is not enabled', bank_ledgers: [] });
    }
    try {
      const bank_ledgers = await fetchBankLedgersFromTally({
        force: String(req.query.force || '') === '1',
      });
      return res.json({ bank_ledgers });
    } catch (err) {
      return res.status(502).json({
        error: err.message || 'Unable to load bank ledgers from Tally',
        bank_ledgers: [],
      });
    }
  })
);

router.get(
  '/tally/customer-outstanding/:customerId',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('id, name, ledger_name')
      .eq('id', req.params.customerId)
      .maybeSingle();
    if (error) throw error;
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const ledgerName = String(customer.ledger_name || customer.name || '').trim();
    const result = await fetchCustomerOutstandingFromTally(ledgerName);
    return res.json({
      customer_id: customer.id,
      customer_name: customer.name,
      ...result,
      tally_enabled: isTallyEnabled(),
    });
  })
);

router.post(
  '/bulk-payments',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const result = await recordBulkPayments(actorId(req), req.body || {});
    return res.json({
      ...result,
      tally_enabled: isTallyEnabled(),
    });
  })
);

router.post(
  '/',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const lotId = req.body?.lot_id;
    const invoice = await createDraftFromLot(lotId, actorId(req), req.body || {});
    return res.status(201).json({ sales_invoice: invoice });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const invoice = await getInvoiceById(req.params.id);
    return res.json({
      sales_invoice: invoice,
      tally_enabled: isTallyEnabled(),
    });
  })
);

router.patch(
  '/:id',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const invoice = await updateDraft(req.params.id, req.body || {});
    return res.json({ sales_invoice: invoice });
  })
);

router.post(
  '/:id/issue',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const invoice = await issueInvoice(req.params.id, actorId(req));
    return res.json({ sales_invoice: invoice });
  })
);

router.post(
  '/:id/confirm-printed',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const invoice = await confirmPrinted(req.params.id, actorId(req));
    return res.json({ sales_invoice: invoice });
  })
);

router.post(
  '/:id/confirm-packing-slip-printed',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const invoice = await confirmPackingSlipPrinted(req.params.id, actorId(req));
    return res.json({ sales_invoice: invoice });
  })
);

router.post(
  '/:id/pdf',
  upload.single('pdf'),
  wrap(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'PDF file is required' });
    }
    const invoice = await storeSalesInvoicePdf(req.params.id, req.file);
    return res.json({ sales_invoice: invoice });
  })
);

router.post(
  '/:id/cancel',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const invoice = await cancelInvoice(
      req.params.id,
      actorId(req),
      req.body?.reason
    );
    return res.json({ sales_invoice: invoice });
  })
);

router.post(
  '/:id/payments',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const invoice = await recordPayment(req.params.id, actorId(req), req.body || {});
    return res.json({
      sales_invoice: invoice,
      tally_enabled: isTallyEnabled(),
    });
  })
);

router.post(
  '/:id/tally/sync',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const invoice = await retrySalesInvoiceTallySync(req.params.id);
    return res.json({
      sales_invoice: invoice,
      tally_enabled: isTallyEnabled(),
    });
  })
);

router.post(
  '/:id/tally/receipt-sync',
  requireAdminOrSupervisor,
  wrap(async (req, res) => {
    const invoice = await retrySalesInvoiceReceiptTallySync(req.params.id);
    return res.json({
      sales_invoice: invoice,
      tally_enabled: isTallyEnabled(),
    });
  })
);

module.exports = router;
