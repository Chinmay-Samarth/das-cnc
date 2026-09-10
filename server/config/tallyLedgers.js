/** Exact Tally ledger names — must match company chart spelling. */

/**
 * Supplier product/service types (one per supplier).
 * Labels match ERP UI; keys are stored on suppliers.tally_expense_ledger_type.
 */
const EXPENSE_TYPE_META = {
  labour: { label: 'Labour' },
  labour_service: { label: 'Labour Service' },
  consumable: { label: 'Consumable' },
  raw_material: { label: 'Raw Material' },
  spares_and_tools: { label: 'Spares and Tools' },
};

const EXPENSE_TYPES = Object.keys(EXPENSE_TYPE_META);

/**
 * Purchase Account ledgers by type → tax channel → rate %.
 * Spellings copied from Tally Chart of Accounts (Purchase Accounts).
 */
const PURCHASE_LEDGERS_BY_TYPE = {
  labour: {
    cgst: {
      12: 'Labour Charges -GST @12%',
      18: 'Labour Charges -GST@18%',
    },
    igst: {
      18: 'Contractors Employees @GST 18 %',
    },
    fallback: 'Labour Charges Paid',
  },
  labour_service: {
    cgst: {
      18: 'Service Charges @ GST 18%',
    },
    igst: {
      18: 'Service Charges @IGST 18%',
    },
    fallback: 'Service Charges @ GST 18%',
  },
  consumable: {
    cgst: {
      5: 'Pur Consumable Gst @ 5%',
      12: 'Pur Consumbale Gst @ 12%',
      18: 'Pur, Consumable GST@ 18%',
    },
    igst: {
      18: 'Pur Consumable Igst @ 18%',
    },
    fallback: 'Pur Consumable',
  },
  raw_material: {
    cgst: {
      12: 'Pur Raw Material GST @ 12%',
      18: 'PUR RawMaterial GST@18%',
    },
    igst: {
      18: 'Pur Raw Material GST @18%(Interstate)',
    },
    fallback: 'PUR RawMaterial GST@18%',
  },
  spares_and_tools: {
    cgst: {
      5: 'Pur Sapres & Tool GST @ 5%',
      12: 'Pur Spares & Tools Gst @ 12%',
      18: 'Pur Spares & Tools Gst @ 18%',
      28: 'Pur Spares & Tools Gst @ 28%',
    },
    igst: {
      18: 'Pur Spares &Tools Gst @ 18%(Interstate)',
    },
    fallback: 'Spares & Tools',
  },
};

/** @deprecated kept for callers that still reference the old constant */
const RAW_MATERIAL_IGST_18_LEDGER = 'Pur Raw Material GST @18%(Interstate)';

/** Back-compat simple map (fallback names only). */
const EXPENSE_LEDGER_BY_TYPE = Object.fromEntries(
  Object.entries(PURCHASE_LEDGERS_BY_TYPE).map(([k, v]) => [k, v.fallback])
);

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

/** Single sales ledger for Phase 1 — must exist in Tally chart. */
const DEFAULT_SALES_LEDGER = 'Das Cnc Products PVT LTD';

/**
 * Output Tax ledgers (sales). Exact spellings from company chart
 * (Duties & Taxes → GST). Keys are percent rates.
 */
const OUTPUT_GST_LEDGERS = {
  CGST: {
    9: 'Output Tax CGST@9%',
  },
  SGST: {
    9: 'Output Tax SGST@9%',
  },
  IGST: {
    18: 'OUTPUT TAX IGST@18%',
  },
};

/**
 * Map GIRN item_category → supplier expense type for mismatch checks.
 * Labour / Labour Service are service purchases (often GIRN "other" or no stock).
 */
const GIRN_CATEGORY_TO_EXPENSE_TYPE = {
  raw_material: 'raw_material',
  tool: 'spares_and_tools',
  gauge: 'spares_and_tools',
  oil: 'consumable',
  // component / unfinished_lot / other: not mapped — skipped in mismatch unless all mapable
};

function isValidExpenseType(value) {
  return EXPENSE_TYPES.includes(String(value || '').trim());
}

function expenseTypeLabel(value) {
  const key = String(value || '').trim();
  return EXPENSE_TYPE_META[key]?.label || key || null;
}

function rateToPercent(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 0 && n <= 1 ? n * 100 : n;
}

function taxItemsHaveIgst(taxItems) {
  const items = Array.isArray(taxItems) ? taxItems : [];
  for (const tax of items) {
    const kind = String(tax?.kind || '').toUpperCase();
    if (kind === 'IGST') return true;
  }
  return false;
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
    if (kind === 'IGST' && Number.isFinite(amount) && amount > 0 && pct == null) return true;
  }
  return false;
}

function primaryGstPercent(taxItems) {
  const items = Array.isArray(taxItems) ? taxItems : [];
  let best = null;
  for (const tax of items) {
    const kind = String(tax?.kind || '').toUpperCase();
    const pct = rateToPercent(tax?.rate);
    if (pct == null) continue;
    // Prefer IGST full rate; for CGST/SGST use doubled half-rate as total GST
    if (kind === 'IGST') return pct;
    if (kind === 'CGST' || kind === 'SGST' || kind === 'UTGST') {
      const total = pct <= 14.5 ? pct * 2 : pct;
      if (best == null || total > best) best = total;
    } else if (best == null || pct > best) {
      best = pct;
    }
  }
  return best;
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
  if (best == null || bestDiff > 0.6) return null;
  return best;
}

/**
 * Resolve purchase debit ledger from supplier type + invoice tax_items.
 */
function expenseLedgerName(type, taxItems) {
  const key = String(type || '').trim();
  const cfg = PURCHASE_LEDGERS_BY_TYPE[key];
  if (!cfg) return null;

  const useIgst = taxItemsHaveIgst(taxItems) || taxItemsHaveIgst18(taxItems);
  const channel = useIgst ? cfg.igst : cfg.cgst;
  const pct = primaryGstPercent(taxItems);

  if (channel && pct != null) {
    const rateKey = nearestRateKey(channel, pct);
    if (rateKey != null && channel[rateKey]) return channel[rateKey];
  }

  // Interstate raw material / spares often only have 18% IGST ledger
  if (useIgst && cfg.igst) {
    const only = Object.keys(cfg.igst).map(Number);
    if (only.length === 1) return cfg.igst[only[0]];
    const k18 = nearestRateKey(cfg.igst, 18);
    if (k18 != null) return cfg.igst[k18];
  }

  if (!useIgst && cfg.cgst && pct != null) {
    const rateKey = nearestRateKey(cfg.cgst, pct);
    if (rateKey != null) return cfg.cgst[rateKey];
  }

  return cfg.fallback || null;
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

function outputGstLedgerName(kind, rate) {
  const rawKind = String(kind || '').toUpperCase();
  const normalizedKind = rawKind === 'UTGST' ? 'SGST' : rawKind;
  const map = OUTPUT_GST_LEDGERS[normalizedKind];
  if (!map) return null;
  const percent = rateToPercent(rate);
  const key = nearestRateKey(map, percent);
  if (key == null) return null;
  return map[key];
}

function salesLedgerName(_type) {
  return DEFAULT_SALES_LEDGER;
}

function girnCategoryToExpenseType(category) {
  const cat = String(category || '').trim();
  return GIRN_CATEGORY_TO_EXPENSE_TYPE[cat] || null;
}

/**
 * Compare supplier expense type vs GIRN line item categories.
 * Returns { ok, message, supplierType, girnTypes } — notify when not ok.
 */
function compareSupplierAndGirnTypes(supplierExpenseType, girnItems = []) {
  const supplierType = String(supplierExpenseType || '').trim();
  const mapped = new Set();
  for (const item of girnItems || []) {
    const t = girnCategoryToExpenseType(item.item_category || item.category);
    if (t) mapped.add(t);
  }

  if (!supplierType) {
    return {
      ok: false,
      message:
        'Supplier has no expense ledger type set. Set Labour / Labour Service / Consumable / Raw Material / Spares and Tools on the supplier.',
      supplierType: null,
      girnTypes: [...mapped],
    };
  }

  if (!mapped.size) {
    // GIRN lines are component/other — cannot auto-check
    return { ok: true, message: null, supplierType, girnTypes: [] };
  }

  if (mapped.size === 1 && mapped.has(supplierType)) {
    return { ok: true, message: null, supplierType, girnTypes: [...mapped] };
  }

  if (mapped.has(supplierType) && mapped.size > 1) {
    return {
      ok: false,
      message: `GIRN has mixed item types (${[...mapped]
        .map(expenseTypeLabel)
        .join(', ')}) but supplier is typed as ${expenseTypeLabel(supplierType)}.`,
      supplierType,
      girnTypes: [...mapped],
    };
  }

  if (!mapped.has(supplierType)) {
    return {
      ok: false,
      message: `Supplier type is ${expenseTypeLabel(supplierType)} but GIRN items map to ${[...mapped]
        .map(expenseTypeLabel)
        .join(', ')}. They must match.`,
      supplierType,
      girnTypes: [...mapped],
    };
  }

  return { ok: true, message: null, supplierType, girnTypes: [...mapped] };
}

module.exports = {
  EXPENSE_TYPE_META,
  EXPENSE_LEDGER_BY_TYPE,
  PURCHASE_LEDGERS_BY_TYPE,
  RAW_MATERIAL_IGST_18_LEDGER,
  EXPENSE_TYPES,
  INPUT_GST_LEDGERS,
  OUTPUT_GST_LEDGERS,
  DEFAULT_SALES_LEDGER,
  ROUND_OFF_LEDGER,
  GIRN_CATEGORY_TO_EXPENSE_TYPE,
  isValidExpenseType,
  expenseTypeLabel,
  expenseLedgerName,
  taxItemsHaveIgst18,
  taxItemsHaveIgst,
  rateToPercent,
  inputGstLedgerName,
  outputGstLedgerName,
  salesLedgerName,
  girnCategoryToExpenseType,
  compareSupplierAndGirnTypes,
  primaryGstPercent,
};
