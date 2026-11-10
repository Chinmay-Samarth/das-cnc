/** Common GST rates used in India (percent). */
const COMMON_GST_RATES = new Set([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28]);

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isActiveLine(line) {
  const text = String(
    line?.scanned_description || line?.description || line?.item_description || ''
  ).trim();
  const qty = line?.quantity === '' || line?.quantity == null ? null : Number(line.quantity);
  const rate = line?.unit_price === '' || line?.unit_price == null ? null : Number(line.unit_price);
  return Boolean(text || line?.master_record_id || qty != null || rate != null);
}

function lineAmount(line) {
  const total = Number(line?.total);
  return Number.isFinite(total) ? total : 0;
}

/** A line counts toward GST unless it is explicitly marked untaxed. */
function isTaxableLine(line) {
  return line?.taxable !== false;
}

function sumActiveLines(lines, predicate) {
  return round2(
    (Array.isArray(lines) ? lines : []).reduce((sum, line) => {
      if (!isActiveLine(line)) return sum;
      if (predicate && !predicate(line)) return sum;
      return sum + lineAmount(line);
    }, 0)
  );
}

function sumTaxedLineTotal(lines) {
  return sumActiveLines(lines, isTaxableLine);
}

function sumUntaxedLineTotal(lines) {
  return sumActiveLines(lines, (line) => !isTaxableLine(line));
}

/** Shared GST base when every tax row agrees within 5 paise. */
function sharedTaxBase(taxes) {
  const bases = (Array.isArray(taxes) ? taxes : [])
    .map((tax) => Number(tax?.base))
    .filter((value) => Number.isFinite(value));
  if (!bases.length) return null;
  const first = round2(bases[0]);
  if (bases.some((value) => Math.abs(round2(value) - first) > 0.05)) return null;
  return first;
}

/**
 * Smallest set of line indexes whose amounts equal `gap` (within 5 paise).
 * Ties prefer lines later on the invoice. Never returns every positive line.
 */
function findUntaxedLineIndexes(lines, gap) {
  const target = round2(gap);
  if (!(target > 0.05)) return null;

  const candidates = [];
  (Array.isArray(lines) ? lines : []).forEach((line, idx) => {
    if (!isActiveLine(line)) return;
    const amount = round2(lineAmount(line));
    if (amount <= 0.05) return;
    candidates.push({ idx, amount });
  });

  const n = candidates.length;
  if (!n || n > 16) return null;

  let best = null;
  const limit = 1 << n;
  for (let mask = 1; mask < limit; mask += 1) {
    let sum = 0;
    let count = 0;
    let maxIdx = -1;
    const idxs = [];
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      sum += candidates[i].amount;
      count += 1;
      idxs.push(candidates[i].idx);
      if (candidates[i].idx > maxIdx) maxIdx = candidates[i].idx;
    }
    if (count === n) continue;
    if (Math.abs(round2(sum) - target) > 0.05) continue;
    if (!best || count < best.count || (count === best.count && maxIdx > best.maxIdx)) {
      best = { idxs, count, maxIdx };
    }
  }
  return best ? best.idxs : null;
}

/**
 * When tax rows already share one base and the gap to the line total
 * equals one or more whole lines, mark those lines untaxed.
 * Does not change tax rows. `baseAmount` is that shared tax base when inferred.
 */
function inferUntaxedLines(lines, taxes) {
  const list = (Array.isArray(lines) ? lines : []).map((line) => ({ ...line }));
  if (list.some((line) => line.taxable === false)) {
    return { lines: list, baseAmount: null, inferred: false };
  }

  const taxBase = sharedTaxBase(taxes);
  if (taxBase == null || taxBase <= 0.05) {
    return { lines: list, baseAmount: null, inferred: false };
  }

  const gap = round2(sumActiveLines(list) - taxBase);
  if (gap <= 0.05) {
    return { lines: list, baseAmount: null, inferred: false };
  }

  const idxs = findUntaxedLineIndexes(list, gap);
  if (!idxs) {
    return { lines: list, baseAmount: null, inferred: false };
  }

  const marked = new Set(idxs);
  return {
    lines: list.map((line, idx) => (marked.has(idx) ? { ...line, taxable: false } : line)),
    baseAmount: taxBase,
    inferred: true,
  };
}

function taxKind(tax) {
  return String(tax?.kind || '').toUpperCase();
}

function isSgstFamily(kind) {
  return kind === 'SGST' || kind === 'UTGST';
}

function humanOcrTitle(warning) {
  const code = String(warning?.code || '');
  const map = {
    missing_invoice_number: 'Invoice number',
    missing_invoice_date: 'Invoice date',
    supplier_unmatched: 'Supplier',
    low_ocr_confidence: 'Scan confidence',
    line_unmatched: 'Line item link',
    line_low_match: 'Line item match',
    total_mismatch: 'Totals',
    low_field_confidence: 'Field confidence',
    duplicate_invoice_number: 'Duplicate invoice',
    ocr_service_warning: 'Scan note',
  };
  return map[code] || 'Scan note';
}

function ocrSeverity(warning) {
  const severity = String(warning?.severity || '').toLowerCase();
  if (severity === 'error' || severity === 'danger') return 'error';
  return 'warning';
}

/**
 * Build prioritized review issues for the invoice edit window.
 * Errors block save; warnings flag potential wrong values.
 */
export function buildInvoiceReviewIssues({
  supplierId,
  header,
  lines,
  taxes,
  taxTotal,
  expectedGrandTotal,
  totalsBalanced,
  ocrWarnings = [],
}) {
  const issues = [];
  const taxRowIssues = {}; // idx -> { kind?, rate?, base?, amount?, severity }
  const lineRowIssues = {}; // idx -> { quantity?, unit_price?, total?, severity }

  const push = (issue) => {
    issues.push(issue);
  };

  if (!supplierId) {
    push({
      id: 'supplier',
      severity: 'error',
      target: 'supplier',
      title: 'Supplier missing',
      message: 'Choose the supplier from the ledger before saving.',
    });
  }

  if (!String(header?.invoice_number || '').trim()) {
    push({
      id: 'invoice_number',
      severity: 'error',
      target: 'invoice_number',
      title: 'Invoice number missing',
      message: 'Enter the number printed on the supplier invoice.',
    });
  }

  if (!String(header?.invoice_date || '').trim()) {
    push({
      id: 'invoice_date',
      severity: 'error',
      target: 'invoice_date',
      title: 'Invoice date missing',
      message: 'Enter the invoice date from the document.',
    });
  }

  if (!String(header?.due_date || '').trim()) {
    push({
      id: 'due_date',
      severity: 'error',
      target: 'due_date',
      title: 'Due date missing',
      message: 'Due date is required. It defaults to invoice date + 30 days when blank.',
    });
  }

  const taxedLinesTotal = sumTaxedLineTotal(lines);
  const untaxedLinesTotal = sumUntaxedLineTotal(lines);
  const headerBaseEarly = Number(header?.base_amount);
  const linesMatchTaxable =
    Number.isFinite(headerBaseEarly) &&
    Math.abs(taxedLinesTotal - round2(headerBaseEarly)) <= 0.05;

  if (!linesMatchTaxable) {
    push({
      id: 'lines_subtotal',
      severity: 'error',
      target: 'amounts',
      title: 'Taxed lines do not match taxable',
      message: `Taxed lines total ₹${formatMoney(taxedLinesTotal)} but taxable is ₹${formatMoney(
        header?.base_amount
      )}.`,
      action: 'recalc_lines',
    });
  }

  if (!totalsBalanced) {
    push({
      id: 'totals',
      severity: 'error',
      target: 'amounts',
      title: 'Grand total does not balance',
      message: `Taxable${
        untaxedLinesTotal > 0.05 ? ' + no tax' : ''
      } + tax + round off = ₹${formatMoney(expectedGrandTotal)}, but grand total is ₹${formatMoney(
        header?.total_amount
      )}.`,
    });
  }

  // --- Tax pairing ---
  const kinds = taxes.map((t, idx) => ({ kind: taxKind(t), idx, tax: t }));
  const hasCgst = kinds.some((k) => k.kind === 'CGST');
  const hasSgst = kinds.some((k) => isSgstFamily(k.kind));
  const hasIgst = kinds.some((k) => k.kind === 'IGST');
  const kindCounts = {};
  for (const row of kinds) {
    if (!row.kind) continue;
    kindCounts[row.kind] = (kindCounts[row.kind] || 0) + 1;
  }

  if (hasCgst !== hasSgst) {
    const missing = hasCgst ? 'SGST' : 'CGST';
    const present = hasCgst ? 'CGST' : 'SGST';
    const orphanIdxs = kinds
      .filter((k) => (hasCgst ? k.kind === 'CGST' : isSgstFamily(k.kind)))
      .map((k) => k.idx);
    for (const idx of orphanIdxs) {
      taxRowIssues[idx] = { ...(taxRowIssues[idx] || {}), kind: true, severity: 'error' };
    }
    push({
      id: 'tax_pair',
      severity: 'error',
      target: 'tax',
      title: `${present} needs ${missing}`,
      message: `CGST and SGST must both be present. Only IGST may stand alone. Add the missing ${missing} line.`,
      action: 'add_missing_tax',
      missingKind: missing,
      sourceIdx: orphanIdxs[0],
    });
  }

  if (hasIgst && (hasCgst || hasSgst)) {
    for (const row of kinds) {
      taxRowIssues[row.idx] = { ...(taxRowIssues[row.idx] || {}), kind: true, severity: 'error' };
    }
    push({
      id: 'tax_igst_mix',
      severity: 'error',
      target: 'tax',
      title: 'IGST mixed with CGST/SGST',
      message: 'Use either IGST alone, or CGST + SGST together — not both.',
    });
  }

  for (const [kind, count] of Object.entries(kindCounts)) {
    if (count > 1) {
      kinds
        .filter((k) => k.kind === kind)
        .forEach((k) => {
          taxRowIssues[k.idx] = { ...(taxRowIssues[k.idx] || {}), kind: true, severity: 'error' };
        });
      push({
        id: `tax_dup_${kind}`,
        severity: 'error',
        target: 'tax',
        title: `Duplicate ${kind}`,
        message: `There are ${count} ${kind} lines. Keep only one of each tax kind.`,
      });
    }
  }

  // Empty rate/amount on tax rows when kind is set
  taxes.forEach((tax, idx) => {
    const kind = taxKind(tax);
    if (!kind) return;
    const rate = Number(tax.rate);
    const amount = Number(tax.amount);
    const base = Number(tax.base);
    if (!Number.isFinite(rate) || rate <= 0) {
      taxRowIssues[idx] = { ...(taxRowIssues[idx] || {}), rate: true, severity: 'error' };
      push({
        id: `tax_rate_${idx}`,
        severity: 'error',
        target: 'tax',
        title: `${kind} rate missing`,
        message: `Enter a tax rate % for the ${kind} line.`,
        rowIndex: idx,
      });
    }
    if (!Number.isFinite(amount) && !(Number.isFinite(base) && Number.isFinite(rate) && rate > 0)) {
      taxRowIssues[idx] = { ...(taxRowIssues[idx] || {}), amount: true, severity: 'error' };
    }
  });

  // --- Warnings ---
  const headerBase = Number(header?.base_amount);
  taxes.forEach((tax, idx) => {
    const kind = taxKind(tax);
    const rate = Number(tax.rate);
    const base = Number(tax.base);
    const amount = Number(tax.amount);

    if (Number.isFinite(rate) && rate > 0) {
      const rounded = round2(rate);
      const nearCommon = [...COMMON_GST_RATES].some((r) => Math.abs(r - rounded) < 0.05);
      if (!nearCommon) {
        taxRowIssues[idx] = {
          ...(taxRowIssues[idx] || {}),
          rate: taxRowIssues[idx]?.rate || true,
          severity: taxRowIssues[idx]?.severity === 'error' ? 'error' : 'warning',
        };
        push({
          id: `tax_rate_unusual_${idx}`,
          severity: 'warning',
          target: 'tax',
          title: `Unusual ${kind || 'tax'} rate`,
          message: `${rate}% is uncommon for GST. Confirm against the invoice.`,
          rowIndex: idx,
        });
      }
    }

    if (
      Number.isFinite(headerBase) &&
      Number.isFinite(base) &&
      Math.abs(base - headerBase) > 0.05
    ) {
      const gap = Math.abs(base - headerBase);
      const explainedByUntaxed =
        untaxedLinesTotal > 0.05 && Math.abs(gap - untaxedLinesTotal) <= 0.05;
      if (!explainedByUntaxed) {
        taxRowIssues[idx] = {
          ...(taxRowIssues[idx] || {}),
          base: true,
          severity: 'error',
        };
        push({
          id: `tax_base_${idx}`,
          severity: 'error',
          target: 'tax',
          title: `${kind || 'Tax'} base differs from taxable`,
          message: `Tax base ₹${formatMoney(base)} must match taxable ₹${formatMoney(
            headerBase
          )}. Turn tax off on a line that has no GST if that line should stay out of this base.`,
          rowIndex: idx,
        });
      }
    }
  });

  if (hasCgst && hasSgst) {
    const cgst = taxes.find((t) => taxKind(t) === 'CGST');
    const sgst = taxes.find((t) => isSgstFamily(taxKind(t)));
    const cAmt = Number(cgst?.amount);
    const sAmt = Number(sgst?.amount);
    if (Number.isFinite(cAmt) && Number.isFinite(sAmt) && Math.abs(cAmt - sAmt) > 0.05) {
      const cIdx = taxes.indexOf(cgst);
      const sIdx = taxes.indexOf(sgst);
      if (cIdx >= 0) {
        taxRowIssues[cIdx] = {
          ...(taxRowIssues[cIdx] || {}),
          amount: true,
          severity: taxRowIssues[cIdx]?.severity === 'error' ? 'error' : 'warning',
        };
      }
      if (sIdx >= 0) {
        taxRowIssues[sIdx] = {
          ...(taxRowIssues[sIdx] || {}),
          amount: true,
          severity: taxRowIssues[sIdx]?.severity === 'error' ? 'error' : 'warning',
        };
      }
      push({
        id: 'tax_cgst_sgst_amount',
        severity: 'warning',
        target: 'tax',
        title: 'CGST and SGST amounts differ',
        message: `CGST ₹${formatMoney(cAmt)} vs SGST ₹${formatMoney(
          sAmt
        )}. They are usually equal.`,
      });
    }
  }

  lines.forEach((line, idx) => {
    const text = String(
      line.scanned_description || line.description || line.item_description || ''
    ).trim();
    const qty = line.quantity === '' || line.quantity == null ? null : Number(line.quantity);
    const rate = line.unit_price === '' || line.unit_price == null ? null : Number(line.unit_price);
    const total = Number(line.total);
    const active = Boolean(text || line.master_record_id || qty != null || rate != null);
    if (!active) return;

    const qtyZero = qty != null && Number.isFinite(qty) && qty === 0;
    const rateZero = rate != null && Number.isFinite(rate) && rate === 0;
    if (qtyZero && rateZero) {
      lineRowIssues[idx] = {
        quantity: true,
        unit_price: true,
        severity: 'error',
      };
      push({
        id: `line_zero_qty_rate_${idx}`,
        severity: 'error',
        target: 'lines',
        title: `Line ${idx + 1} has 0 qty and 0 rate`,
        message: 'Enter quantity and rate for this line item before saving.',
        rowIndex: idx,
      });
      return;
    }

    if (Number.isFinite(qty) && Number.isFinite(rate)) {
      const expected = round2(qty * rate);
      if (Number.isFinite(total) && Math.abs(total - expected) > 0.05) {
        lineRowIssues[idx] = {
          quantity: true,
          unit_price: true,
          total: true,
          severity: 'warning',
        };
        push({
          id: `line_amount_${idx}`,
          severity: 'warning',
          target: 'lines',
          title: `Line ${idx + 1} amount mismatch`,
          message: `Qty × rate = ₹${formatMoney(expected)} but amount is ₹${formatMoney(total)}.`,
          rowIndex: idx,
        });
      }
    } else if ((qty != null || rate != null) && (!Number.isFinite(total) || total === 0)) {
      lineRowIssues[idx] = {
        ...(lineRowIssues[idx] || {}),
        total: true,
        severity: 'warning',
      };
      push({
        id: `line_zero_${idx}`,
        severity: 'warning',
        target: 'lines',
        title: `Line ${idx + 1} has no amount`,
        message: 'Enter quantity and rate so the line amount can be calculated.',
        rowIndex: idx,
      });
    }
  });

  // OCR notes — skip codes already covered by live field errors
  const coveredOcr = new Set([
    'missing_invoice_number',
    'missing_invoice_date',
    'supplier_unmatched',
    'total_mismatch',
  ]);
  for (const [idx, w] of (ocrWarnings || []).entries()) {
    const code = String(w?.code || '');
    if (coveredOcr.has(code)) continue;
    const sev = ocrSeverity(w) === 'error' ? 'warning' : 'warning'; // OCR notes stay soft unless still missing at save
    push({
      id: `ocr_${code}_${idx}`,
      severity: sev,
      target:
        code.startsWith('line_') || code === 'line_unmatched' || code === 'line_low_match'
          ? 'lines'
          : 'header',
      title: humanOcrTitle(w),
      message: w?.message || 'Review this scan note against the source file.',
    });
  }

  const severityRank = { error: 0, warning: 1 };
  issues.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return {
    issues,
    errors,
    warnings,
    taxRowIssues,
    lineRowIssues,
    taxTotal,
    hasTarget(target) {
      return issues.some((i) => i.target === target);
    },
    hasErrorTarget(target) {
      return errors.some((i) => i.target === target);
    },
    hasWarningTarget(target) {
      return warnings.some((i) => i.target === target);
    },
  };
}

export {
  COMMON_GST_RATES,
  formatMoney as formatReviewMoney,
  inferUntaxedLines,
  sumTaxedLineTotal,
  sumUntaxedLineTotal,
};
