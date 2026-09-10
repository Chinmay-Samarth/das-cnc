const { createClient } = require('@supabase/supabase-js');
const { getCategoryConfig, categoryFromMasterSlug } = require('../config/girnCategoryConfig');
const { classifyLineItems, inferItemCode } = require('./girnItemClassifier');
const { lookupSupplierItemAlias, upsertSupplierItemAliases } = require('./invoiceAliasEngine');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/** Lazy require avoids circular dependency with invoiceOcrEngine. */
function getInvoice(invoiceId) {
  return require('./invoiceOcrEngine').getInvoice(invoiceId);
}

const AUTO_ACCEPT_THRESHOLD = 0.95;

function normalizeDescription(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function fieldConfidence(field) {
  if (field == null) return null;
  if (typeof field.confidence === 'number') return field.confidence;
  if (typeof field === 'object' && field.fields) {
    const scores = Object.values(field.fields)
      .map((f) => (typeof f?.confidence === 'number' ? f.confidence : null))
      .filter((n) => n != null);
    if (scores.length) return scores.reduce((a, b) => a + b, 0) / scores.length;
  }
  return null;
}

function computeOcrConfidence(doc) {
  if (!doc || typeof doc !== 'object') return 0.5;

  // Custom Invoice OCR returns an aggregate score
  if (typeof doc.ocr_confidence === 'number' && Number.isFinite(doc.ocr_confidence)) {
    return Math.round(Math.min(1, Math.max(0, doc.ocr_confidence)) * 1000) / 1000;
  }

  const scores = [];
  const push = (field) => {
    const c = fieldConfidence(field);
    if (c != null && Number.isFinite(c)) scores.push(c);
  };

  push(doc.invoice_number);
  push(doc.date);
  push(doc.due_date);
  push(doc.total_amount);
  push(doc.total_net);
  push(doc.total_tax);

  const lineItems = Array.isArray(doc.line_items?.items) ? doc.line_items.items : [];
  for (const item of lineItems.slice(0, 20)) {
    push(item.fields?.description);
    push(item.fields?.quantity);
    push(item.fields?.unit_price);
    push(item.fields?.total_price);
  }

  if (!scores.length) return 0.75;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(Math.min(1, Math.max(0, avg)) * 1000) / 1000;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Keep base + tax + round_off = total so OCR misreads / tax recalcs
 * cannot leave a ₹1 gap on the purchase invoice.
 * Grand total always follows the parts; set round_off explicitly for ±₹1 bills.
 */
function reconcileInvoiceTotals({ baseAmount, taxAmount, roundOff, totalAmount }) {
  const base = toNumberOrNull(baseAmount);
  const tax = toNumberOrNull(taxAmount);
  let round = toNumberOrNull(roundOff);

  if (base == null || tax == null) {
    return {
      base_amount: baseAmount,
      tax_amount: taxAmount,
      round_off: round ?? 0,
      total_amount: totalAmount,
    };
  }

  if (round == null) round = 0;

  return {
    base_amount: round2(base),
    tax_amount: round2(tax),
    round_off: round2(round),
    total_amount: round2(base + tax + round),
  };
}

function enrichLineForReview(lineItem, classification = {}) {
  const scanned = lineItem.scanned_description || lineItem.description || '';
  const category = classification.item_category || lineItem.item_category || 'other';
  const cfg = getCategoryConfig(category);

  return {
    scanned_description: scanned,
    description: scanned,
    item_category: category,
    master_record_id: classification.master_record_id || lineItem.master_record_id || null,
    master_record_label: classification.master_record_label || lineItem.master_record_label || '',
    master_slug: classification.master_slug || cfg.masterSlug || lineItem.master_slug || null,
    item_code: classification.item_code || lineItem.item_code || inferItemCode(scanned),
    quantity: lineItem.quantity ?? null,
    unit: lineItem.unit || '',
    unit_price: lineItem.unit_price ?? null,
    total: lineItem.total ?? null,
    match_confidence: classification.match_confidence || lineItem.match_confidence || 'none',
    match_source: classification.match_source || lineItem.match_source || null,
  };
}

async function lookupAlias(supplierId, description) {
  return lookupSupplierItemAlias(supplierId, description);
}

async function classifyLinesForReview(supplierId, lineItems = []) {
  const baseItems = (lineItems || []).map((item) => ({
    ...item,
    description: item.scanned_description || item.description || '',
  }));
  return classifyLineItems(baseItems, { supplierId });
}

function buildOcrWarnings(invoice, classifiedLines, doc, ocrConfidenceLevel) {
  const warnings = [];

  // Warnings emitted by the custom OCR service (totals reconciliation, etc.)
  if (Array.isArray(doc?.warnings)) {
    for (const message of doc.warnings) {
      const text = String(message || '').trim();
      if (!text) continue;
      warnings.push({
        code: 'ocr_service_warning',
        message: text,
      });
    }
  }

  const invoiceNumber =
    invoice?.invoice_number ||
    emptyString(doc?.invoice?.number) ||
    doc?.invoice_number?.value;
  const invoiceDate =
    invoice?.invoice_date ||
    emptyString(doc?.invoice?.date) ||
    doc?.date?.value;

  if (!invoiceNumber) {
    warnings.push({ code: 'missing_invoice_number', message: 'Invoice number was not detected' });
  }
  if (!invoiceDate) {
    warnings.push({ code: 'missing_invoice_date', message: 'Invoice date was not detected' });
  }
  if (!invoice?.supplier_id) {
    warnings.push({ code: 'supplier_unmatched', message: 'Supplier could not be matched automatically' });
  }

  if (ocrConfidenceLevel != null && ocrConfidenceLevel <= AUTO_ACCEPT_THRESHOLD) {
    warnings.push({
      code: 'low_ocr_confidence',
      message: `OCR confidence ${Math.round(ocrConfidenceLevel * 100)}% is below the auto-accept threshold`,
      field: 'document',
    });
  }

  classifiedLines.forEach((line, idx) => {
    if (line.item_category !== 'other' && !line.master_record_id) {
      warnings.push({
        code: 'line_unmatched',
        message: `Line ${idx + 1} could not be linked to a master record`,
        field: `line_${idx + 1}`,
      });
    } else if (line.match_confidence && line.match_confidence !== 'high') {
      warnings.push({
        code: 'line_low_match',
        message: `Line ${idx + 1} has uncertain master match (${line.match_confidence})`,
        field: `line_${idx + 1}`,
      });
    }
  });

  const lineSum = classifiedLines.reduce((s, l) => s + toNumber(l.total), 0);
  const invoiceTotal = toNumber(invoice?.total_amount);
  if (invoiceTotal > 0 && lineSum > 0 && Math.abs(lineSum - invoiceTotal) / invoiceTotal > 0.05) {
    warnings.push({
      code: 'total_mismatch',
      message: 'Sum of line totals differs from invoice total by more than 5%',
    });
  }

  // Legacy Mindee per-field confidence checks
  if (doc && typeof doc === 'object' && !doc.supplier) {
    for (const key of ['invoice_number', 'date', 'total_amount']) {
      const field = doc[key];
      const c = fieldConfidence(field);
      if (c != null && c < 0.7) {
        warnings.push({
          code: 'low_field_confidence',
          message: `Low OCR confidence on ${key.replace(/_/g, ' ')}`,
          field: key,
        });
      }
    }
  }

  return warnings;
}

function emptyString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function shouldAutoAccept({ ocr_confidence_level, ocr_warnings }) {
  const warnings = Array.isArray(ocr_warnings) ? ocr_warnings : [];
  return (
    Number(ocr_confidence_level) > AUTO_ACCEPT_THRESHOLD &&
    warnings.length === 0
  );
}

async function buildReviewLines(invoice) {
  const rawLines = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  const classified = await classifyLinesForReview(invoice.supplier_id, rawLines);
  return rawLines.map((line, idx) =>
    enrichLineForReview(
      { ...line, scanned_description: line.scanned_description || line.description || '' },
      classified[idx] || {}
    )
  );
}

async function buildReviewPayload(invoiceId) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    const err = new Error('Invoice not found');
    err.status = 404;
    throw err;
  }

  const lines = await buildReviewLines(invoice);
  const warnings = Array.isArray(invoice.ocr_warnings) ? invoice.ocr_warnings : [];

  return {
    invoice: {
      ...invoice,
      line_items: lines,
    },
    review: {
      ocr_confidence_level: invoice.ocr_confidence_level,
      ocr_warnings: warnings,
      review_status: invoice.review_status,
      needs_review:
        invoice.review_status === 'needs_review' ||
        invoice.status === 'needs_review',
    },
    lines,
  };
}

async function upsertAliases(supplierId, lines, actorId) {
  return upsertSupplierItemAliases(supplierId, lines, actorId);
}

async function confirmReview(invoiceId, body, actorId) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) {
    const err = new Error('Invoice not found');
    err.status = 404;
    throw err;
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  const supplierId = body.supplier_id || invoice.supplier_id;

  if (!supplierId) {
    const err = new Error('Supplier is required before confirming review');
    err.status = 400;
    throw err;
  }

  for (const line of lines) {
    const cat = line.item_category || 'other';
    if (cat !== 'other' && !line.master_record_id) {
      const err = new Error('Each stocked line must be linked to a master record');
      err.status = 400;
      throw err;
    }
  }

  const normalizedLines = lines.map((line) => {
    const scanned = line.scanned_description || line.description || '';
    const category = line.item_category || 'other';
    const cfg = getCategoryConfig(category);
    return {
      scanned_description: scanned,
      description: scanned,
      item_category: category,
      master_record_id: line.master_record_id || null,
      master_record_label: line.master_record_label || '',
      master_slug: line.master_slug || cfg.masterSlug,
      quantity: line.quantity ?? null,
      unit: line.unit || '',
      unit_price: line.unit_price ?? null,
      total: line.total ?? null,
      match_confidence: line.master_record_id ? 'high' : 'none',
    };
  });

  const now = new Date().toISOString();

  let taxItems = invoice.tax_items || [];
  if (Array.isArray(body.tax_items)) {
    taxItems = body.tax_items
      .map((t) => {
        const kind = String(t?.kind || '').toUpperCase();
        const rate = Number(t?.rate);
        const base = t?.base == null || t?.base === '' ? null : Number(t.base);
        const amount = t?.amount == null || t?.amount === '' ? null : Number(t.amount);
        return {
          kind: ['CGST', 'SGST', 'IGST', 'UTGST'].includes(kind) ? kind : 'GST',
          rate: Number.isFinite(rate) ? rate : null,
          base: Number.isFinite(base) ? base : null,
          amount: Number.isFinite(amount) ? amount : null,
        };
      })
      .filter((t) => t.rate != null || t.amount != null);
  }

  const taxAmountFromItems = taxItems.reduce(
    (sum, t) => sum + (Number.isFinite(Number(t.amount)) ? Number(t.amount) : 0),
    0
  );

  const invoiceNumber = body.invoice_number ?? invoice.invoice_number;

  const resolvedTaxAmount =
    body.tax_amount != null && body.tax_amount !== ''
      ? body.tax_amount
      : taxItems.length
        ? taxAmountFromItems
        : invoice.tax_amount;

  const reconciled = reconcileInvoiceTotals({
    baseAmount: body.base_amount ?? invoice.base_amount,
    taxAmount: resolvedTaxAmount,
    roundOff: body.round_off ?? invoice.round_off ?? 0,
    totalAmount: body.total_amount ?? invoice.total_amount,
  });

  const updatePayload = {
    supplier_id: supplierId,
    line_items: normalizedLines,
    tax_items: taxItems,
    invoice_number: invoiceNumber,
    invoice_date: body.invoice_date ?? invoice.invoice_date,
    due_date: body.due_date ?? invoice.due_date,
    total_amount: reconciled.total_amount,
    base_amount: reconciled.base_amount,
    round_off: reconciled.round_off,
    tax_amount: reconciled.tax_amount,
    // Clear OCR review state — status must not remain needs_review
    status: 'pending',
    review_status: 'confirmed',
    reviewed_at: now,
    reviewed_by: actorId || null,
    ocr_warnings: [],
    updated_at: now,
  };

  const { error } = await supabase.from('invoices').update(updatePayload).eq('id', invoiceId);
  if (error) throw error;

  // Drop abandoned OCR drafts of the same supplier invoice so Purchase Invoices
  // does not keep showing a stale "Needs review" row after confirm.
  await supersedeAbandonedReviewDrafts({
    keepInvoiceId: invoiceId,
    invoiceNumber,
    now,
  });

  await upsertAliases(supplierId, normalizedLines, actorId);

  return getInvoice(invoiceId);
}

async function supersedeAbandonedReviewDrafts({ keepInvoiceId, invoiceNumber, now }) {
  const number = String(invoiceNumber || '').trim();
  if (!number || !keepInvoiceId) return;

  // Match by invoice number only — abandoned drafts may lack supplier_id until review
  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'cancelled',
      review_status: 'superseded',
      ocr_warnings: [],
      updated_at: now || new Date().toISOString(),
    })
    .neq('id', keepInvoiceId)
    .eq('invoice_number', number)
    .in('status', ['needs_review', 'extracting', 'saving']);

  if (error) {
    console.warn('Unable to supersede abandoned invoice review drafts:', error.message);
  }
}

async function finalizeOcrReview(invoiceId, doc, invoiceDraft) {
  const classified = await classifyLinesForReview(
    invoiceDraft.supplier_id,
    (invoiceDraft.line_items || []).map((l) => ({
      ...l,
      scanned_description: l.description || '',
    }))
  );

  const enrichedLines = (invoiceDraft.line_items || []).map((line, idx) =>
    enrichLineForReview(
      { ...line, scanned_description: line.description || '' },
      classified[idx] || {}
    )
  );

  const ocrConfidenceLevel = computeOcrConfidence(doc);
  const ocrWarnings = buildOcrWarnings(
    { ...invoiceDraft, line_items: enrichedLines },
    enrichedLines,
    doc,
    ocrConfidenceLevel
  );

  const autoAccept = shouldAutoAccept({
    ocr_confidence_level: ocrConfidenceLevel,
    ocr_warnings: ocrWarnings,
  });

  const reviewStatus = autoAccept ? 'auto_accepted' : 'needs_review';
  const status = autoAccept ? 'pending' : 'needs_review';

  const updatePayload = {
    ...invoiceDraft,
    line_items: enrichedLines,
    ocr_confidence_level: ocrConfidenceLevel,
    ocr_warnings: ocrWarnings,
    review_status: reviewStatus,
    status,
  };

  const { error } = await supabase.from('invoices').update(updatePayload).eq('id', invoiceId);
    if (error) {
    if (error.code === 'PGRST204') {
      const fallback = { ...updatePayload };
      delete fallback.ocr_confidence_level;
      delete fallback.ocr_warnings;
      delete fallback.review_status;
      delete fallback.reviewed_at;
      delete fallback.reviewed_by;
      console.warn(
        'invoices is missing OCR review columns. Run server/migrations/20260823_invoice_ocr_review.sql in Supabase. Saving without those columns.'
      );
      const retry = await supabase.from('invoices').update(fallback).eq('id', invoiceId);
      if (retry.error) throw retry.error;
    } else {
      throw error;
    }
  }

  const invoice = await getInvoice(invoiceId);

  return {
    invoice,
    needs_review: !autoAccept,
    ocr_confidence_level: ocrConfidenceLevel,
    warning_count: ocrWarnings.length,
    ocr_warnings: ocrWarnings,
  };
}

module.exports = {
  AUTO_ACCEPT_THRESHOLD,
  normalizeDescription,
  computeOcrConfidence,
  buildOcrWarnings,
  shouldAutoAccept,
  classifyLinesForReview,
  buildReviewPayload,
  confirmReview,
  finalizeOcrReview,
  upsertAliases,
  lookupAlias,
  enrichLineForReview,
  reconcileInvoiceTotals,
};
