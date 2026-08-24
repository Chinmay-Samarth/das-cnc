const axios = require('axios');
const FormData = require('form-data');
const { createClient } = require('@supabase/supabase-js');
const { ensureSupplier, supplierPayloadFromOcrDoc } = require('./girnSupplierEngine');
const { finalizeOcrReview } = require('./invoiceReviewEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const INVOICE_OCR_URL =
  process.env.INVOICE_OCR_URL || 'http://127.0.0.1:8000/parse';
const INVOICE_OCR_HEALTH_URL =
  process.env.INVOICE_OCR_HEALTH_URL ||
  INVOICE_OCR_URL.replace(/\/parse\/?$/, '/health');
const INVOICE_OCR_TIMEOUT_MS = Number(process.env.INVOICE_OCR_TIMEOUT_MS) || 300000;

const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function emptyToNull(value) {
  if (value == null) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  return value;
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalize OCR date strings (DD-MM-YYYY, DD.MM.YYYY, DD-Mon-YY, ISO) to YYYY-MM-DD. */
function toIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  let match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    return `${match[3]}-${month}-${day}`;
  }

  match = raw.match(/^(\d{1,2})[./\s-]+([A-Za-z]{3,})[./\s-]+(\d{2,4})$/);
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function ymdPartsIst(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return ymdPartsIst(new Date());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function isoDateUtc(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysBetweenYmd(from, to) {
  const fromStr = String(from || '').slice(0, 10);
  const toStr = String(to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromStr) || !/^\d{4}-\d{2}-\d{2}$/.test(toStr)) return null;
  const start = Date.UTC(
    Number(fromStr.slice(0, 4)),
    Number(fromStr.slice(5, 7)) - 1,
    Number(fromStr.slice(8, 10))
  );
  const end = Date.UTC(
    Number(toStr.slice(0, 4)),
    Number(toStr.slice(5, 7)) - 1,
    Number(toStr.slice(8, 10))
  );
  return Math.round((end - start) / 86400000);
}

async function nextRegisterSerial(createdAt) {
  const { year, month } = ymdPartsIst(createdAt);
  const start = new Date(`${isoDateUtc(year, month, 1)}T00:00:00+05:30`).toISOString();
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = new Date(`${isoDateUtc(nextYear, nextMonth, 1)}T00:00:00+05:30`).toISOString();

  const { count, error } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', start)
    .lt('created_at', end)
    .not('register_serial', 'is', null);

  if (error) throw error;
  const n = (count || 0) + 1;
  return `A${String(n).padStart(2, '0')}`;
}

function normalizeLineItems(ocrResult) {
  const lines = Array.isArray(ocrResult?.line_items) ? ocrResult.line_items : [];
  return lines.map((item) => {
    const description = String(item?.description || '').trim();
    return {
      description,
      scanned_description: description,
      quantity: toNumberOrNull(item?.quantity),
      unit: '',
      unit_price: toNumberOrNull(item?.unit_price),
      total: toNumberOrNull(item?.total),
    };
  });
}

function normalizeTaxItems(ocrResult) {
  const lines = Array.isArray(ocrResult?.tax_lines) ? ocrResult.tax_lines : [];
  const mapped = lines
    .map((item) => ({
      kind: String(item?.kind || '').toUpperCase() || null,
      rate: toNumberOrNull(item?.rate),
      base: toNumberOrNull(item?.base),
      amount: toNumberOrNull(item?.amount),
    }))
    .filter((item) => item.amount || item.rate);

  if (mapped.length) return mapped;

  const taxAmount = toNumberOrNull(ocrResult?.totals?.tax_amount);
  const baseAmount = toNumberOrNull(ocrResult?.totals?.base_amount);
  if (!taxAmount) return [];

  const gstin = String(ocrResult?.supplier?.gstin || '');
  const stateCode = gstin.slice(0, 2);
  const isIntraState = stateCode === '29' || !stateCode;

  if (isIntraState) {
    const half = Math.round((taxAmount / 2) * 100) / 100;
    return [
      { kind: 'CGST', rate: 9, base: baseAmount, amount: half },
      { kind: 'SGST', rate: 9, base: baseAmount, amount: Math.round((taxAmount - half) * 100) / 100 },
    ];
  }

  return [{ kind: 'IGST', rate: 18, base: baseAmount, amount: taxAmount }];
}

async function updateInvoiceStatus(invoiceId, status) {
  const { error } = await supabase
    .from('invoices')
    .update({ status })
    .eq('id', invoiceId);

  if (error) throw error;
}

async function getInvoice(invoiceId) {
  const { data, error } = await supabase
    .from('invoices')
    .select(`*,
      suppliers(
        id,
        name,
        billing_address,
        account_number,
        ifsc,
        GSTIN,
        state
      )`)
    .eq('id', invoiceId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function resolveSupplier(ocrResult) {
  const payload = supplierPayloadFromOcrDoc(ocrResult);
  const name = String(payload.name || '').trim();
  const gstin = String(payload.GSTIN || '').trim();

  if (!name && !gstin) {
    return null;
  }

  try {
    return await ensureSupplier(payload);
  } catch (err) {
    console.error('Supplier resolve error:', err);
    return null;
  }
}

/** Soft warm-up so Render cold starts happen before the multipart upload. */
async function warmInvoiceOcr() {
  try {
    await axios.get(INVOICE_OCR_HEALTH_URL, { timeout: 60000 });
  } catch (err) {
    console.warn('Invoice OCR health warm-up failed (continuing):', err.message);
  }
}

function buildOcrForm(file) {
  const form = new FormData();
  const filename = file.originalname || 'invoice.pdf';
  const mime = file.mimetype || 'application/pdf';
  form.append('document', file.buffer, {
    filename,
    contentType: mime,
  });
  return form;
}

function wrapOcrError(err) {
  const status = err.response?.status;
  let detail =
    err.response?.data?.detail ||
    err.response?.data?.error ||
    err.message ||
    'Invoice OCR request failed';

  if (!err.response && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
    detail =
      `Cannot reach Invoice OCR at ${INVOICE_OCR_URL}. ` +
      'Start it with: uvicorn app.main:app --host 0.0.0.0 --port 8000';
  } else if (!err.response && err.code === 'ECONNABORTED') {
    detail = `OCR request timed out after ${INVOICE_OCR_TIMEOUT_MS}ms`;
  }

  const wrapped = new Error(
    typeof detail === 'string' ? detail : JSON.stringify(detail)
  );
  wrapped.status = status || 502;
  return wrapped;
}

async function parseInvoiceWithCustomOcr(file) {
  if (!file?.buffer?.length) {
    throw new Error('Empty invoice file');
  }

  await warmInvoiceOcr();

  try {
    const form = buildOcrForm(file);
    const { data } = await axios.post(INVOICE_OCR_URL, form, {
      timeout: INVOICE_OCR_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      headers: {
        ...form.getHeaders(),
        Accept: 'application/json',
      },
    });
    return data;
  } catch (err) {
    throw wrapOcrError(err);
  }
}

async function uploadInvoiceFile(file) {
  const fileName = `invoices/${Date.now()}_${file.originalname || 'invoice.pdf'}`;

  const { error: storageError } = await supabase.storage
    .from('invoices')
    .upload(fileName, file.buffer, { contentType: file.mimetype });

  if (storageError) throw storageError;

  const { data: publicUrlData } = supabase.storage
    .from('invoices')
    .getPublicUrl(fileName);

  const publicUrl = publicUrlData?.publicUrl || null;

  const { data: invoice, error: dbError } = await supabase
    .from('invoices')
    .insert({ status: 'extracting', file_url: publicUrl })
    .select()
    .single();

  if (dbError) throw dbError;

  return { invoice, file, publicUrl };
}

async function processInvoiceOCR(invoiceId, file, publicUrl) {
  const ocrResult = await parseInvoiceWithCustomOcr(file);

  await updateInvoiceStatus(invoiceId, 'saving');

  const supplierId = await resolveSupplier(ocrResult);
  const lineItems = normalizeLineItems(ocrResult);
  const taxItems = normalizeTaxItems(ocrResult);
  const invoiceDate = toIsoDate(ocrResult?.invoice?.date);
  const dueDate = toIsoDate(ocrResult?.invoice?.due_date);
  const existing = await getInvoice(invoiceId);
  const registerSerial =
    existing?.register_serial || (await nextRegisterSerial(existing?.created_at || new Date()));

  const invoiceDraft = {
    file_url: publicUrl,
    invoice_number: emptyToNull(ocrResult?.invoice?.number),
    invoice_date: invoiceDate,
    due_date: dueDate,
    credit_period_days: daysBetweenYmd(invoiceDate, dueDate),
    register_serial: registerSerial,
    base_amount: toNumberOrNull(ocrResult?.totals?.base_amount),
    total_amount: toNumberOrNull(ocrResult?.totals?.total_amount),
    tax_amount: toNumberOrNull(ocrResult?.totals?.tax_amount),
    line_items: lineItems,
    tax_items: taxItems,
    raw_ocr_response: ocrResult,
    customer_GSTIN: null,
    IRN: emptyToNull(ocrResult?.invoice?.irn),
    supplier_id: supplierId,
  };

  const reviewResult = await finalizeOcrReview(invoiceId, ocrResult, invoiceDraft);

  return {
    invoice: reviewResult.invoice,
    fields: ocrResult,
    lineItems: reviewResult.invoice?.line_items || lineItems,
    taxItems,
    needs_review: reviewResult.needs_review,
    ocr_confidence_level: reviewResult.ocr_confidence_level,
    warning_count: reviewResult.warning_count,
    ocr_warnings: reviewResult.ocr_warnings,
  };
}

async function startInvoiceOCR(file) {
  const uploaded = await uploadInvoiceFile(file);
  const processing = processInvoiceOCR(
    uploaded.invoice.id,
    uploaded.file,
    uploaded.publicUrl
  ).catch(async (err) => {
    console.error('Invoice processing error', err);
    try {
      await updateInvoiceStatus(uploaded.invoice.id, 'error');
    } catch (statusErr) {
      console.error('Unable to mark invoice processing as failed', statusErr);
    }
  });

  return {
    invoice: uploaded.invoice,
    processing,
  };
}

async function extractInvoiceNow(file) {
  const uploaded = await uploadInvoiceFile(file);
  return processInvoiceOCR(uploaded.invoice.id, uploaded.file, uploaded.publicUrl);
}

module.exports = {
  extractInvoiceNow,
  getInvoice,
  processInvoiceOCR,
  startInvoiceOCR,
  updateInvoiceStatus,
  toIsoDate,
  parseInvoiceWithCustomOcr,
};
