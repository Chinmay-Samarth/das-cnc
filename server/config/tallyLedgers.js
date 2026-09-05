/** Exact Tally ledger names — must match company chart spelling. */

const EXPENSE_LEDGER_BY_TYPE = {
  labour: 'Labour',
  labour_service: 'Labour Service',
  raw_material: 'Raw Material',
};

/** Raw material + interstate IGST @18% uses this purchase ledger for the base debit. */
const RAW_MATERIAL_IGST_18_LEDGER = 'Pur Raw Material GST @18%(Interstate)';

const EXPENSE_TYPES = Object.keys(EXPENSE_LEDGER_BY_TYPE);

/** Input Tax ledgers only (purchases). Keys are percent rates. */
const INPUT_GST_LEDGERS = {
  CGST: {
    2.5: 'Input Tax CGST @ 2.5%',
    6: 'INPUT TAX CGST @ 6%',
    9: 'Input Tax CGST@ 9%',
    14: 'Input Tax CGST@ 14%',
  },
  SGST: {
    2.5: 'Input Tax SGST @ 2.5%',
    6: 'INPUT TAX SGST @ 6%',
    9: 'Input Tax SGST @ 9%',
    14: 'Input Tax SGST @ 14%',
  },
  IGST: {
    3: 'Input IGST 3% Tax',
    5: 'Input Tax IGST@5 %',
    18: 'Input Tax IGST@ 18%',
  },
};

const ROUND_OFF_LEDGER = 'Round Off';

function isValidExpenseType(value) {
  return EXPENSE_TYPES.includes(String(value || '').trim());
}

function rateToPercent(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 0 && n <= 1 ? n * 100 : n;
}

function taxItemsHaveIgst18(taxItems) {
  const items = Array.isArray(taxItems) ? taxItems : [];
  for (const tax of items) {
    const kind = String(tax?.kind || '').toUpperCase();
    const pct = rateToPercent(tax?.rate);
    const amount = Number(tax?.amount);
    const looksIgst =
      kind === 'IGST' ||
      (kind !== 'CGST' && kind !== 'SGST' && kind !== 'UTGST' && pct != null && pct > 14);
    if (!looksIgst) continue;
    if (pct != null && Math.abs(pct - 18) <= 0.6) return true;
    // Kind IGST with no usable rate but positive amount — treat as 18% for raw-material purchase ledger
    if (kind === 'IGST' && Number.isFinite(amount) && amount > 0 && pct == null) return true;
  }
  return false;
}

/**
 * Resolve purchase/expense debit ledger.
 * Raw material + IGST @18% → Pur Raw Material GST @18%(Interstate)
 */
function expenseLedgerName(type, taxItems) {
  const key = String(type || '').trim();
  if (key === 'raw_material' && taxItemsHaveIgst18(taxItems)) {
    return RAW_MATERIAL_IGST_18_LEDGER;
  }
  return EXPENSE_LEDGER_BY_TYPE[key] || null;
}

function nearestRateKey(map, percent) {
  if (percent == null || !map) return null;
  const keys = Object.keys(map).map(Number);
  let best = null;
  let bestDiff = Infinity;
  for (const key of keys) {
    const diff = Math.abs(key - percent);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = key;
    }
  }
  // Allow small OCR noise (e.g. 8.99 → 9)
  if (best == null || bestDiff > 0.6) return null;
  return best;
}

function inputGstLedgerName(kind, rate) {
  const rawKind = String(kind || '').toUpperCase();
  const normalizedKind = rawKind === 'UTGST' ? 'SGST' : rawKind;
  const map = INPUT_GST_LEDGERS[normalizedKind];
  if (!map) return null;
  const percent = rateToPercent(rate);
  const key = nearestRateKey(map, percent);
  if (key == null) return null;
  return map[key];
}

module.exports = {
  EXPENSE_LEDGER_BY_TYPE,
  RAW_MATERIAL_IGST_18_LEDGER,
  EXPENSE_TYPES,
  INPUT_GST_LEDGERS,
  ROUND_OFF_LEDGER,
  isValidExpenseType,
  expenseLedgerName,
  taxItemsHaveIgst18,
  rateToPercent,
  inputGstLedgerName,
};
