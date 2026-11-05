const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { getInvoice, startInvoiceOCR } = require('../services/invoiceOcrEngine');
const {
  recordVendorInvoicePayment,
  recordBulkVendorPayments,
  listPayableInvoices,
  updateInvoiceTallyFields,
  retryVendorInvoicePurchaseSync,
  retryVendorInvoicePaymentSync,
  syncAllUnsyncedPurchaseVouchers,
  resolvePoAdvanceForInvoice,
} = require('../services/invoicePaymentEngine');
const { isTallyEnabled, tallyCompany, tallyUrl } = require('../services/tallyClient');
const { fetchBankLedgersFromTally } = require('../services/tallyBankLedgers');
const {
  fetchSupplierOutstandingFromTally,
} = require('../services/tallyCustomerOutstanding');
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const {
  syncPurchaseVoucherOnGirnRegister,
} = require('../services/girnTallyPurchaseSync');
const {
  parseInvoiceDateRange,
  listInvoicesByDateRange,
  exportVendorInvoicesExcel,
  loadGirnByInvoiceIds,
} = require('../services/invoiceExportEngine');
const {
  buildReviewPayload,
  confirmReview,
  abandonReviewDraft,
  assertUniqueSupplierInvoiceNumber,
} = require('../services/invoiceReviewEngine');
const { buildDraftGirnFromInvoice } = require('../services/girnDraftEngine');
const { isAdminUser } = require('../utils/accessLevel');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Only admins can edit or delete saved invoices' });
  }
  return next();
}

function isUnconfirmedInvoiceDraft(invoice) {
  if (!invoice) return false;
  const status = String(invoice.status || '');
  const reviewStatus = String(invoice.review_status || '');
  if (reviewStatus === 'confirmed' || reviewStatus === 'auto_accepted') return false;
  if (['paid', 'overdue', 'partial', 'cancelled'].includes(status)) return false;
  return (
    reviewStatus === 'needs_review' ||
    ['needs_review', 'extracting', 'saving', 'error', 'queued', 'uploading'].includes(status)
  );
}

function sendServiceError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || 'Request failed' });
}

function actorId(req) {
  return req.user?.sub || req.user?.id || null;
}

router.post('/upload', verifyEmployeeAuth, upload.single('invoice'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file Uploaded' });
    }
    const { invoice, processing } = await startInvoiceOCR(file);
    res.json({ status: 'extracting', id: invoice.id });
    await processing;
  } catch (err) {
    console.error('Invoice processing error ', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/list', verifyEmployeeAuth, async (req, res) => {
  try {
    const range = parseInvoiceDateRange(req.query.from, req.query.to);
    const invoices = await listInvoicesByDateRange(range);
    res.json(invoices);
  } catch (err) {
    console.error('Invoice list error:', err);
    return sendServiceError(res, err);
  }
});

/** Pre-save check: same invoice number for the same supplier (active rows). */
router.get('/check-duplicate', verifyEmployeeAuth, async (req, res) => {
  try {
    await assertUniqueSupplierInvoiceNumber({
      supplierId: req.query.supplier_id,
      invoiceNumber: req.query.invoice_number,
      excludeInvoiceId: req.query.exclude_id,
    });
    return res.json({ duplicate: false });
  } catch (err) {
    if (err.status === 409) {
      return res.json({
        duplicate: true,
        error:
          err.message ||
          'Invoice number already exists for this supplier. Duplicate invoices are not allowed.',
      });
    }
    console.error('Invoice duplicate check error:', err);
    return sendServiceError(res, err);
  }
});

router.get('/export', verifyEmployeeAuth, async (req, res) => {
  try {
    const { buffer, filename } = await exportVendorInvoicesExcel({
      from: req.query.from,
      to: req.query.to,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  } catch (err) {
    console.error('Invoice export error:', err);
    return sendServiceError(res, err);
  }
});

router.get('/tally/status', verifyEmployeeAuth, async (req, res) => {
  return res.json({
    tally_enabled: isTallyEnabled(),
    tally_company_configured: Boolean(tallyCompany()),
    tally_company: tallyCompany() || null,
    tally_url: tallyUrl(),
  });
});

router.get('/tally/bank-ledgers', verifyEmployeeAuth, async (req, res) => {
  try {
    if (!isTallyEnabled()) {
      return res.json({ bank_ledgers: [], tally_enabled: false });
    }
    const bank_ledgers = await fetchBankLedgersFromTally({
      force: req.query.refresh === '1',
    });
    return res.json({ bank_ledgers, tally_enabled: true });
  } catch (err) {
    console.error('Bank ledgers fetch error:', err);
    return res.status(err.code === 'TALLY_UNREACHABLE' ? 503 : 502).json({
      error: err.message || 'Unable to load bank ledgers from Tally',
      bank_ledgers: [],
      tally_enabled: true,
    });
  }
});

router.get(
  '/tally/supplier-outstanding/:supplierId',
  verifyEmployeeAuth,
  async (req, res) => {
    try {
      const supplierId = req.params.supplierId;
      const { data: supplier, error } = await supabaseAdmin
        .from('suppliers')
        .select('id, name, ledger_name')
        .eq('id', supplierId)
        .maybeSingle();
      if (error) throw error;
      if (!supplier) {
        return res.status(404).json({ error: 'Supplier not found' });
      }

      const ledger =
        String(supplier.ledger_name || '').trim() ||
        String(supplier.name || '').trim();
      const result = await fetchSupplierOutstandingFromTally(ledger);
      return res.json({
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        tally_enabled: isTallyEnabled(),
        ...result,
      });
    } catch (err) {
      console.error('Supplier outstanding error:', err);
      return sendServiceError(res, err);
    }
  }
);

router.get('/payable', verifyEmployeeAuth, async (req, res) => {
  try {
    const invoices = await listPayableInvoices({
      supplierId: req.query.supplier_id || null,
    });
    return res.json({ invoices, tally_enabled: isTallyEnabled() });
  } catch (err) {
    console.error('Payable invoices list error:', err);
    return sendServiceError(res, err);
  }
});

router.post('/bulk-payments', verifyEmployeeAuth, async (req, res) => {
  try {
    const result = await recordBulkVendorPayments(actorId(req), req.body || {});
    return res.json({ ...result, tally_enabled: isTallyEnabled() });
  } catch (err) {
    console.error('Bulk invoice payment error:', err);
    return sendServiceError(res, err);
  }
});

router.post('/:id/payments', verifyEmployeeAuth, async (req, res) => {
  try {
    const invoice = await recordVendorInvoicePayment(
      req.params.id,
      actorId(req),
      req.body || {}
    );
    return res.json({ invoice, tally_enabled: isTallyEnabled() });
  } catch (err) {
    console.error('Invoice payment error:', err);
    return sendServiceError(res, err);
  }
});

router.patch('/:id/tally', verifyEmployeeAuth, async (req, res) => {
  try {
    const invoice = await updateInvoiceTallyFields(req.params.id, req.body || {});
    return res.json({ invoice, tally_enabled: isTallyEnabled() });
  } catch (err) {
    console.error('Invoice tally update error:', err);
    return sendServiceError(res, err);
  }
});

router.post('/tally/sync-all', verifyEmployeeAuth, async (req, res) => {
  try {
    if (!isTallyEnabled()) {
      return res.status(400).json({
        error: 'Tally sync is disabled. Set TALLY_ENABLED=true and restart the API.',
        tally_enabled: false,
      });
    }
    const summary = await syncAllUnsyncedPurchaseVouchers();
    return res.json({
      ...summary,
      tally_enabled: true,
      tally_company_configured: Boolean(tallyCompany()),
      tally_url: tallyUrl(),
    });
  } catch (err) {
    console.error('Invoice tally sync-all error:', err);
    return sendServiceError(res, err);
  }
});

router.post('/:id/tally/sync', verifyEmployeeAuth, async (req, res) => {
  try {
    const kind = String(req.body?.kind || req.query.kind || 'payment').toLowerCase();
    const invoice =
      kind === 'purchase'
        ? await retryVendorInvoicePurchaseSync(req.params.id)
        : await retryVendorInvoicePaymentSync(req.params.id);
    return res.json({
      invoice,
      tally_enabled: isTallyEnabled(),
      tally_company_configured: Boolean(tallyCompany()),
      tally_url: tallyUrl(),
      sync_kind: kind === 'purchase' ? 'purchase' : 'payment',
    });
  } catch (err) {
    console.error('Invoice tally sync retry error:', err);
    return sendServiceError(res, err);
  }
});

router.post('/:id/tally/purchase-sync', verifyEmployeeAuth, async (req, res) => {
  try {
    const result = await syncPurchaseVoucherOnGirnRegister(req.params.id);
    const invoice = result.invoice || (await getInvoice(req.params.id));
    return res.json({
      invoice,
      tally_enabled: isTallyEnabled(),
      result,
    });
  } catch (err) {
    console.error('Invoice purchase sync error:', err);
    return sendServiceError(res, err);
  }
});

router.get('/:id/review', verifyEmployeeAuth, async (req, res) => {
  try {
    const payload = await buildReviewPayload(req.params.id);
    const invoice = payload?.invoice;
    // Draft OCR review is open to anyone; reopening a saved invoice is admin-only.
    if (invoice && !isUnconfirmedInvoiceDraft(invoice) && !isAdminUser(req.user)) {
      return res.status(403).json({ error: 'Only admins can edit saved invoices' });
    }
    return res.json(payload);
  } catch (err) {
    console.error('Invoice review load error:', err);
    return sendServiceError(res, err);
  }
});

router.post('/:id/confirm-review', verifyEmployeeAuth, async (req, res) => {
  try {
    const existing = await getInvoice(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (!isUnconfirmedInvoiceDraft(existing) && !isAdminUser(req.user)) {
      return res.status(403).json({ error: 'Only admins can edit saved invoices' });
    }

    const invoice = await confirmReview(req.params.id, req.body || {}, actorId(req));
    // Always build a GIRN draft — confirmed purchase invoices are due for
    // Register & review next (Tally purchase sync runs on GIRN register).
    const draft_girn = await buildDraftGirnFromInvoice(invoice, actorId(req));
    return res.json({ invoice, draft_girn });
  } catch (err) {
    console.error('Invoice review confirm error:', err);
    return sendServiceError(res, err);
  }
});

router.post('/:id/abandon-review', verifyEmployeeAuth, async (req, res) => {
  try {
    const result = await abandonReviewDraft(req.params.id);
    return res.json({ message: 'OCR draft discarded', ...result });
  } catch (err) {
    console.error('Invoice review abandon error:', err);
    return sendServiceError(res, err);
  }
});

/** Admin-only hard delete for saved (confirmed) purchase invoices. */
router.delete('/:id', verifyEmployeeAuth, requireAdmin, async (req, res) => {
  try {
    const invoice = await getInvoice(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (isUnconfirmedInvoiceDraft(invoice)) {
      return res.status(409).json({
        error: 'Use discard draft for unscanned / needs-review invoices',
      });
    }

    const { data: girns, error: girnErr } = await supabaseAdmin
      .from('girns')
      .select('id, girn_number')
      .eq('invoice_id', req.params.id)
      .limit(1);
    if (girnErr) throw girnErr;
    if (girns?.length) {
      return res.status(409).json({
        error: `Cannot delete invoice linked to GIRN ${girns[0].girn_number || girns[0].id}`,
      });
    }

    const { error } = await supabaseAdmin.from('invoices').delete().eq('id', req.params.id);
    if (error) throw error;
    return res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    console.error('Invoice delete error:', err);
    return sendServiceError(res, err);
  }
});

router.get('/:id', verifyEmployeeAuth, async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const invoice = await getInvoice(invoiceId);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const needs_review =
      invoice.review_status === 'needs_review' || invoice.status === 'needs_review';

    let poAdvance = Number(invoice.po_advance_amount) || 0;
    try {
      const resolved = await resolvePoAdvanceForInvoice(invoiceId);
      if (resolved.advance_amount > 0) poAdvance = resolved.advance_amount;
    } catch (_) {
      /* ignore */
    }
    const total = Number(invoice.total_amount) || 0;
    const amount_due_after_advance = Math.max(
      Math.round((total - poAdvance) * 100) / 100,
      0
    );

    const girnMap = await loadGirnByInvoiceIds([invoiceId]);
    const girns = girnMap.get(invoiceId) || [];
    const primaryGirn = girns[0] || null;

    return res.json({
      invoice: {
        ...invoice,
        po_advance_amount: poAdvance || invoice.po_advance_amount || 0,
        amount_due_after_advance,
        has_girn: girns.length > 0,
        girn_id: primaryGirn?.id || null,
        girn_number: primaryGirn?.girn_number || null,
      },
      needs_review,
      ocr_confidence_level: invoice.ocr_confidence_level,
      warning_count: Array.isArray(invoice.ocr_warnings) ? invoice.ocr_warnings.length : 0,
      tally_enabled: isTallyEnabled(),
    });
  } catch (err) {
    console.error('Invoice detail error:', err);
    return res.status(500).json({ error: 'Unable to load invoice details' });
  }
});

module.exports = router;
