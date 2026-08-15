const express = require("express");
const multer = require("multer")
const jwt = require("jsonwebtoken");
const { getInvoice, startInvoiceOCR } = require('../services/invoiceOcrEngine');
const { recordVendorInvoicePayment } = require('../services/invoicePaymentEngine');
const {
  parseInvoiceDateRange,
  listInvoicesByDateRange,
  exportVendorInvoicesExcel,
} = require('../services/invoiceExportEngine');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

const upload = multer({ storage: multer.memoryStorage()});
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

function sendServiceError(res, err) {
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || 'Request failed' });
}

router.post("/upload", verifyEmployeeAuth, upload.single('invoice'), async (req,res)=>{
  try {
    const file = req.file
    if(!file){
      return res.status(400).json({
        error: "No file Uploaded"
      })
    }
    const { invoice, processing } = await startInvoiceOCR(file);
    res.json({status: "extracting", id: invoice.id})
    await processing;
  }
  catch(err){
      console.error("Invoice processing error ",err)
      res.status(500).json({error: err.message})
  }
})

router.get('/list', verifyEmployeeAuth, async (req,res)=>{
  try{
    const range = parseInvoiceDateRange(req.query.from, req.query.to);
    const invoices = await listInvoicesByDateRange(range);
    res.json(invoices);
  }
  catch(err){
    console.error('Invoice list error:', err);
    return sendServiceError(res, err);
  }
})

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

function actorId(req) {
  return req.user?.sub || req.user?.id || null;
}

router.post('/:id/payments', verifyEmployeeAuth, async (req, res) => {
  try {
    const invoice = await recordVendorInvoicePayment(
      req.params.id,
      actorId(req),
      req.body || {}
    );
    return res.json({ invoice });
  } catch (err) {
    console.error('Invoice payment error:', err);
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

    return res.json({ invoice });
  } catch (err) {
    console.error('Invoice detail error:', err);
    return res.status(500).json({ error: 'Unable to load invoice details' });
  }
});

module.exports = router
