import {
  inferUntaxedLines,
  sumTaxedLineTotal,
  sumUntaxedLineTotal,
} from './invoiceReviewIssues';

const TAX_KINDS = new Set(['CGST', 'SGST', 'IGST', 'UTGST']);
const COMMON_RATES = [0.1, 0.25, 1, 1.5, 2.5, 3, 5, 6, 7.5, 9, 12, 14, 18, 28];
const FULL_GST_RATES = [5, 12, 18, 28];

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function norm(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? money(n) : null;
}

function kindOf(tax) {
  return String(tax?.kind || '').toUpperCase();
}

function isSgstFamily(kind) {
  return kind === 'SGST' || kind === 'UTGST';
}

function lineText(line) {
  return String(line?.scanned_description || line?.description || line?.item_description || '').trim();
}

function isActiveLine(line) {
  const qty = line?.quantity === '' || line?.quantity == null ? null : Number(line.quantity);
  const rate = line?.unit_price === '' || line?.unit_price == null ? null : Number(line.unit_price);
  return Boolean(lineText(line) || line?.master_record_id || qty != null || rate != null);
}

function taxSum(taxes) {
  return money((Array.isArray(taxes) ? taxes : []).reduce((sum, tax) => sum + (Number(tax?.amount) || 0), 0));
}

function expectedTotal(base, taxes, roundOff, untaxed) {
  const round = Number(roundOff);
  return money(
    money(base) +
      money(untaxed) +
      taxSum(taxes) +
      (Number.isFinite(round) ? round : 0)
  );
}

function scannedTotal(header) {
  const total = Number(header?.total_amount);
  return Number.isFinite(total) ? money(total) : null;
}

function gapToScanned(base, taxes, header, untaxed) {
  const scanned = scannedTotal(header);
  if (scanned == null) return 0;
  return Math.abs(scanned - expectedTotal(base, taxes, header?.round_off, untaxed));
}

function nearRate(rate, choices) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return false;
  return choices.some((choice) => Math.abs(choice - n) < 0.05);
}

function signatureOf(lines, taxes, header) {
  return JSON.stringify({
    lines: (lines || []).map((line) => [
      lineText(line),
      line?.taxable === false ? 0 : 1,
      norm(line?.total),
      norm(line?.quantity),
      norm(line?.unit_price),
    ]),
    taxes: (taxes || []).map((tax) => [kindOf(tax), norm(tax?.rate), norm(tax?.base), norm(tax?.amount)]),
    base: norm(header?.base_amount),
    round: norm(header?.round_off),
    total: norm(header?.total_amount),
    due: header?.due_date || '',
  });
}

function taxableBase(lines, header) {
  const taxed = sumTaxedLineTotal(lines);
  const untaxed = sumUntaxedLineTotal(lines);
  if (taxed > 0.05 || untaxed > 0.05) return money(taxed);
  const headerBase = Number(header?.base_amount);
  return Number.isFinite(headerBase) ? money(headerBase) : 0;
}

function fillEmptyLineTotals(lines) {
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const qty = Number(line?.quantity);
    const rate = Number(line?.unit_price);
    const total = Number(line?.total);
    if (!Number.isFinite(qty) || !Number.isFinite(rate) || qty === 0 || rate === 0) return line;
    if (Number.isFinite(total) && Math.abs(total) > 0.005) return line;
    return { ...line, total: money(qty * rate) };
  });
}

function taxKindFromText(text) {
  const match = String(text || '')
    .trim()
    .toUpperCase()
    .match(/^(CGST|SGST|IGST|UTGST)(?:\s*@?\s*\d+(?:\.\d+)?\s*%?)?$/);
  return match ? match[1] : '';
}

/** Drop item rows that are really a second copy of a tax line already in the tax table. */
function removeTaxLabelLines(lines, taxes) {
  const kinds = new Set((taxes || []).map(kindOf).filter((kind) => TAX_KINDS.has(kind)));
  const list = Array.isArray(lines) ? lines : [];
  const active = list.filter(isActiveLine);
  const taxish = active.filter((line) => {
    if (line?.master_record_id) return false;
    const kind = taxKindFromText(lineText(line));
    return Boolean(kind && kinds.has(kind));
  });
  if (!taxish.length || taxish.length >= active.length) return list;
  const drop = new Set(taxish);
  return list.filter((line) => !drop.has(line));
}

function isRoundOffText(text) {
  return /^(round\s*off|roundoff|r\/?off)$/i.test(String(text || '').trim());
}

function removeRoundOffLines(lines, header) {
  const list = Array.isArray(lines) ? lines : [];
  const roundLines = list.filter((line) => isActiveLine(line) && isRoundOffText(lineText(line)));
  if (!roundLines.length || roundLines.length === list.filter(isActiveLine).length) {
    return { lines: list, header };
  }
  const delta = money(roundLines.reduce((sum, line) => sum + (Number(line.total) || 0), 0));
  if (Math.abs(delta) > 1) return { lines: list, header };
  const nextLines = list.filter((line) => !roundLines.includes(line));
  const current = Number(header?.round_off);
  const currentRound = Number.isFinite(current) ? current : 0;
  if (Math.abs(currentRound) < 0.001 && Math.abs(delta) > 0.005) {
    return { lines: nextLines, header: { ...header, round_off: delta } };
  }
  return { lines: nextLines, header };
}

function inferRates(taxes) {
  return taxes.map((tax) => {
    const rate = Number(tax?.rate);
    if (Number.isFinite(rate) && rate > 0) return tax;
    const base = Number(tax?.base);
    const amount = Number(tax?.amount);
    if (!(base > 0) || !(Math.abs(amount) > 0)) return tax;
    const raw = Math.abs(amount / base) * 100;
    let nearest = COMMON_RATES[0];
    for (const choice of COMMON_RATES) {
      if (Math.abs(choice - raw) < Math.abs(nearest - raw)) nearest = choice;
    }
    if (Math.abs(nearest - raw) <= 0.25) return { ...tax, rate: nearest };
    return { ...tax, rate: money(raw) };
  });
}

function withBase(tax, base) {
  const rate = Number(tax?.rate);
  const next = { ...tax, base: money(base) };
  if (!(Number(base) > 0) || !Number.isFinite(rate) || rate <= 0) return next;
  next.amount = money(Number(base) * (rate / 100));
  return next;
}

function alignTaxes(taxes, base, header, untaxed) {
  const baseNum = Number(base);
  const canUseBase = Number.isFinite(baseNum) && baseNum > 0;
  const asIs = taxes.map((tax) => (canUseBase ? { ...tax, base: money(baseNum) } : { ...tax }));
  if (!canUseBase) return asIs;
  const recalced = taxes.map((tax) => withBase(tax, baseNum));
  const scanned = scannedTotal(header);
  if (scanned == null) {
    return taxes.map((tax) => {
      const amount = Number(tax?.amount);
      if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return withBase(tax, baseNum);
      return { ...tax, base: money(baseNum) };
    });
  }
  const asIsGap = Math.abs(scanned - expectedTotal(baseNum, asIs, header?.round_off, untaxed));
  const recalcGap = Math.abs(scanned - expectedTotal(baseNum, recalced, header?.round_off, untaxed));
  if (recalcGap < asIsGap - 0.02) return recalced;
  return asIs;
}

function scoreRows(rows, base, header, untaxed) {
  const withBaseOnly = rows.map((tax) => ({ ...tax, base: money(base) }));
  return {
    gap: gapToScanned(base, alignTaxes(rows, base, header, untaxed), header, untaxed),
    rawGap: gapToScanned(base, withBaseOnly, header, untaxed),
  };
}

function betterScore(next, current) {
  if (next.gap < current.gap - 0.02) return true;
  if (Math.abs(next.gap - current.gap) <= 0.02 && next.rawGap < current.rawGap - 0.02) return true;
  return false;
}

function rowQuality(rows) {
  return rows.reduce((sum, row) => {
    const rate = Number(row?.rate);
    const amount = Number(row?.amount);
    return sum + (Number.isFinite(rate) && rate > 0 ? 2 : 0) + (Number.isFinite(amount) && Math.abs(amount) > 0.005 ? 1 : 0);
  }, 0);
}

/** Keep one row of each tax kind. The kept row is the one that lands closest to the scanned grand total. */
function dedupeKinds(taxes, base, header, untaxed) {
  const groups = [];
  const extras = [];
  const indexByTax = new Map();
  taxes.forEach((tax, index) => {
    indexByTax.set(tax, index);
    const kind = kindOf(tax);
    if (!TAX_KINDS.has(kind)) {
      extras.push(tax);
      return;
    }
    let group = groups.find((item) => item.kind === kind);
    if (!group) {
      group = { kind, rows: [] };
      groups.push(group);
    }
    group.rows.push(tax);
  });
  if (!groups.some((group) => group.rows.length > 1)) return taxes;

  let combos = [[]];
  for (const group of groups) {
    const next = [];
    for (const combo of combos) {
      for (const row of group.rows) {
        next.push([...combo, row]);
        if (next.length > 80) break;
      }
      if (next.length > 80) break;
    }
    combos = next.length > 80 ? [groups.map((group) => group.rows[0])] : next;
    if (combos.length === 1 && combos[0].length === groups.length && next.length > 80) break;
  }

  let best = null;
  for (const combo of combos) {
    const rows = [...combo, ...extras];
    const score = scoreRows(rows, base, header, untaxed);
    const quality = rowQuality(rows);
    const indexSum = combo.reduce((sum, row) => sum + (indexByTax.get(row) || 0), 0);
    if (
      !best ||
      betterScore(score, best.score) ||
      (!betterScore(best.score, score) &&
        Math.abs(score.gap - best.score.gap) <= 0.02 &&
        Math.abs(score.rawGap - best.score.rawGap) <= 0.02 &&
        (quality > best.quality || (quality === best.quality && indexSum < best.indexSum)))
    ) {
      best = { rows, score, quality, indexSum };
    }
  }
  return best ? best.rows : taxes;
}

function isPaired(taxes) {
  const hasCgst = taxes.some((tax) => kindOf(tax) === 'CGST');
  const hasSgst = taxes.some((tax) => isSgstFamily(kindOf(tax)));
  const hasIgst = taxes.some((tax) => kindOf(tax) === 'IGST');
  return (hasIgst && !hasCgst && !hasSgst) || (hasCgst && hasSgst && !hasIgst);
}

function resolveIgstMix(taxes, base, header, untaxed) {
  const igst = taxes.filter((tax) => kindOf(tax) === 'IGST');
  const intra = taxes.filter((tax) => kindOf(tax) === 'CGST' || isSgstFamily(kindOf(tax)));
  if (!igst.length || !intra.length) return taxes;
  const other = taxes.filter((tax) => {
    const kind = kindOf(tax);
    return kind !== 'IGST' && kind !== 'CGST' && !isSgstFamily(kind);
  });
  const candidates = [
    [...intra, ...other],
    [...igst, ...other],
  ];
  let best = candidates[0];
  let bestScore = scoreRows(best, base, header, untaxed);
  const altScore = scoreRows(candidates[1], base, header, untaxed);
  if (betterScore(altScore, bestScore)) return candidates[1];
  if (
    Math.abs(altScore.gap - bestScore.gap) <= 0.02 &&
    Math.abs(altScore.rawGap - bestScore.rawGap) <= 0.02 &&
    isPaired(candidates[1]) &&
    !isPaired(best)
  ) {
    return candidates[1];
  }
  return best;
}

function synthesizeTaxPair(base, header, untaxed) {
  const scanned = scannedTotal(header);
  if (scanned == null || !(Number(base) > 0)) return [];
  const round = Number(header?.round_off);
  const roundPart = Number.isFinite(round) ? round : 0;
  const implied = money(scanned - money(base) - money(untaxed) - roundPart);
  if (implied <= 0.05) return [];
  const rawRate = (implied / Number(base)) * 100;
  const full = FULL_GST_RATES.find((rate) => Math.abs(rate - rawRate) < 0.35);
  if (!full) return [];
  const half = money(full / 2);
  const halfAmount = money(implied / 2);
  const baseAmount = money(base);
  return [
    { kind: 'CGST', rate: half, base: baseAmount, amount: halfAmount },
    { kind: 'SGST', rate: half, base: baseAmount, amount: halfAmount },
  ];
}

/** CGST and SGST are both required when the invoice is not IGST. */
function repairTaxPair(taxes, base, header, untaxed) {
  const hasCgst = taxes.some((tax) => kindOf(tax) === 'CGST');
  const hasSgst = taxes.some((tax) => isSgstFamily(kindOf(tax)));
  const hasIgst = taxes.some((tax) => kindOf(tax) === 'IGST');
  if (hasIgst || (hasCgst && hasSgst)) return taxes;
  if (!hasCgst && !hasSgst) {
    const created = synthesizeTaxPair(base, header, untaxed);
    return created.length ? created : taxes;
  }

  const source = taxes.find((tax) => (hasCgst ? kindOf(tax) === 'CGST' : isSgstFamily(kindOf(tax))));
  if (!source) return taxes;

  const missing = hasCgst ? 'SGST' : 'CGST';
  const added = [...taxes, { ...source, kind: missing }];
  const rate = Number(source.rate);
  const candidates = [added];
  if (nearRate(rate, FULL_GST_RATES)) {
    const halfRate = money(rate / 2);
    const amount = Number(source.amount);
    const halfAmount = Number.isFinite(amount) ? money(amount / 2) : '';
    const rest = taxes.filter((tax) => tax !== source);
    candidates.push([
      ...rest,
      { ...source, kind: 'CGST', rate: halfRate, amount: halfAmount },
      { ...source, kind: 'SGST', rate: halfRate, amount: halfAmount },
    ]);
  }

  let best = candidates[0];
  let bestScore = scoreRows(best, base, header, untaxed);
  for (const candidate of candidates.slice(1)) {
    const score = scoreRows(candidate, base, header, untaxed);
    if (betterScore(score, bestScore)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function balanceSplitPair(taxes, base) {
  const cgst = taxes.find((tax) => kindOf(tax) === 'CGST');
  const sgst = taxes.find((tax) => isSgstFamily(kindOf(tax)));
  if (!cgst || !sgst) return taxes;
  const cRate = Number(cgst.rate);
  const sRate = Number(sgst.rate);
  if (!Number.isFinite(cRate) || !Number.isFinite(sRate) || Math.abs(cRate - sRate) > 0.05) return taxes;
  const cAmt = Number(cgst.amount);
  const sAmt = Number(sgst.amount);
  if (!Number.isFinite(cAmt) || !Number.isFinite(sAmt) || Math.abs(cAmt - sAmt) <= 0.05) return taxes;
  const expected = money(Number(base) * (cRate / 100));
  if (money(expected * 2) !== money(cAmt + sAmt)) return taxes;
  return taxes.map((tax) => (tax === cgst || tax === sgst ? { ...tax, amount: expected } : tax));
}

function chooseTaxStructure(taxes, base, header, untaxed, { editing }) {
  let rows = Array.isArray(taxes) ? taxes : [];
  if (!editing) rows = inferRates(rows);
  rows = dedupeKinds(rows, base, header, untaxed);
  if (editing) return rows;
  rows = resolveIgstMix(rows, base, header, untaxed);
  rows = repairTaxPair(rows, base, header, untaxed);
  return rows;
}

function applyRoundOff(header, base, taxes, untaxed) {
  const scanned = scannedTotal(header);
  if (scanned == null) return header;
  const current = Number(header?.round_off);
  const currentRound = Number.isFinite(current) ? current : 0;
  if (Math.abs(currentRound) >= 0.001) return header;
  const residual = money(scanned - money(base) - money(untaxed) - taxSum(taxes));
  if (Math.abs(residual) > 0.005 && Math.abs(residual) <= 1) {
    return { ...header, round_off: residual };
  }
  return header;
}

/**
 * Fix invoice review errors that can be checked against the scanned grand total.
 * Duplicate tax kinds are removed. The scanned grand total is left as printed.
 * If the invoice still does not tally, the totals error stays visible.
 */
export function repairInvoiceDraft({ lines, taxes, header, mode = 'load' }) {
  const editing = mode === 'edit';
  const sourceLines = Array.isArray(lines) ? lines : [];
  const sourceTaxes = Array.isArray(taxes) ? taxes : [];
  const sourceHeader = header || {};

  let nextHeader = { ...sourceHeader };
  let nextLines = editing ? sourceLines : fillEmptyLineTotals(sourceLines);
  if (!editing) {
    nextLines = removeTaxLabelLines(nextLines, sourceTaxes);
    const roundOffCleaned = removeRoundOffLines(nextLines, nextHeader);
    nextLines = roundOffCleaned.lines;
    nextHeader = roundOffCleaned.header;
    const inferred = inferUntaxedLines(nextLines, sourceTaxes);
    if (inferred.inferred) nextLines = inferred.lines;
  }

  let base = taxableBase(nextLines, nextHeader);
  let untaxed = sumUntaxedLineTotal(nextLines);
  let structured = chooseTaxStructure(sourceTaxes, base, nextHeader, untaxed, { editing });

  if (!editing) {
    const inferred = inferUntaxedLines(nextLines, structured);
    if (inferred.inferred) {
      nextLines = inferred.lines;
      base = taxableBase(nextLines, nextHeader);
      untaxed = sumUntaxedLineTotal(nextLines);
    }
  }

  let nextTaxes = alignTaxes(structured, base, nextHeader, untaxed);
  if (!editing) nextTaxes = balanceSplitPair(nextTaxes, base);

  const hasLineAmounts = sumTaxedLineTotal(nextLines) > 0.05 || untaxed > 0.05;
  if (hasLineAmounts && Math.abs(money(nextHeader.base_amount) - money(base)) > 0.001) {
    nextHeader = { ...nextHeader, base_amount: money(base) };
  }
  if (!editing) nextHeader = applyRoundOff(nextHeader, base, nextTaxes, untaxed);

  const signature = signatureOf(nextLines, nextTaxes, nextHeader);
  const changed = signature !== signatureOf(sourceLines, sourceTaxes, sourceHeader);
  if (!changed) {
    return { lines: sourceLines, taxes: sourceTaxes, header: sourceHeader, changed: false, signature };
  }
  return { lines: nextLines, taxes: nextTaxes, header: nextHeader, changed: true, signature };
}
