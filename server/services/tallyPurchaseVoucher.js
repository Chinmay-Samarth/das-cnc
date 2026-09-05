const {
  expenseLedgerName,
  inputGstLedgerName,
  isValidExpenseType,
  rateToPercent,
} = require('../config/tallyLedgers');
const { isTallyEnabled, tallyCompany, postTallyXml } = require('./tallyClient');

/** Temporary fixed voucher date for all Tally posts (DD-MM-YYYY → 01-09-2026). */
const DEFAULT_TALLY_VOUCHER_DATE = '20260901';

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toTallyDate(value) {
  if (value == null || value === '') return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  const raw = String(value).trim();

  // Already YYYYMMDD
  if (/^\d{8}$/.test(raw)) return raw;

  // YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;

  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}${dmy[2].padStart(2, '0')}${dmy[1].padStart(2, '0')}`;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function taxLineAmount(tax, baseAmount) {
  const amount = Number(tax?.amount);
  if (Number.isFinite(amount) && amount !== 0) return round2(amount);
  const base = Number(tax?.base ?? baseAmount ?? 0);
  const pct = rateToPercent(tax?.rate);
  if (Number.isFinite(base) && pct != null) return round2(base * (pct / 100));
  return 0;
}

function resolveExpenseType(invoice, supplier) {
  const fromInvoice = String(invoice?.tally_expense_ledger_type || '').trim();
  if (isValidExpenseType(fromInvoice)) return fromInvoice;
  const fromSupplier = String(supplier?.tally_expense_ledger_type || '').trim();
  if (isValidExpenseType(fromSupplier)) return fromSupplier;
  return null;
}

function resolvePartyLedgerName(supplier) {
  const ledger = String(supplier?.ledger_name || '').trim();
  if (ledger) return ledger;
  const name = String(supplier?.name || '').trim();
  return name || null;
}

function buildGstLegs(taxItems, baseAmount) {
  const items = Array.isArray(taxItems) ? taxItems : [];
  const legs = [];
  let assignedCgst = false;

  for (const tax of items) {
    const amount = taxLineAmount(tax, baseAmount);
    if (!(amount > 0)) continue;

    let kind = String(tax?.kind || '').toUpperCase();
    if (!kind) {
      const pct = rateToPercent(tax?.rate);
      if (pct != null && pct <= 14) {
        kind = assignedCgst ? 'SGST' : 'CGST';
        if (kind === 'CGST') assignedCgst = true;
      } else {
        kind = 'IGST';
      }
    } else if (kind === 'CGST') {
      assignedCgst = true;
    }

    const ledger = inputGstLedgerName(kind, tax?.rate);
    if (!ledger) {
      const pct = rateToPercent(tax?.rate);
      throw Object.assign(
        new Error(
          `No Input Tax ledger mapping for ${kind || 'GST'} @ ${pct != null ? pct : '?'}%`
        ),
        { code: 'TALLY_GST_MAP' }
      );
    }

    legs.push({ ledgerName: ledger, amount });
  }

  return legs;
}

function ledgerEntryXml({ ledgerName, isDeemedPositive, amount, billAllocation }) {
  const amt = round2(amount);
  const signed = isDeemedPositive ? -Math.abs(amt) : Math.abs(amt);
  let billXml = '';
  if (billAllocation) {
    billXml = `
            <BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(billAllocation.name)}</NAME>
              <BILLTYPE>${escapeXml(billAllocation.billType)}</BILLTYPE>
              <AMOUNT>${signed.toFixed(2)}</AMOUNT>
            </BILLALLOCATIONS.LIST>`;
  }

  return `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(ledgerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${signed.toFixed(2)}</AMOUNT>${billXml}
          </ALLLEDGERENTRIES.LIST>`;
}

function buildPurchaseVoucherXml({ invoice, supplier, expenseType }) {
  const company = tallyCompany();
  if (!company) {
    throw Object.assign(new Error('TALLY_COMPANY is not configured'), {
      code: 'TALLY_CONFIG',
    });
  }

  const invoiceNumber = String(invoice?.invoice_number || '').trim();
  if (!invoiceNumber) {
    throw Object.assign(new Error('Invoice number is required for Tally Purchase voucher'), {
      code: 'TALLY_INVOICE',
    });
  }

  const partyLedger = resolvePartyLedgerName(supplier);
  if (!partyLedger) {
    throw Object.assign(new Error('Set ledger name on supplier before syncing to Tally'), {
      code: 'TALLY_PARTY',
    });
  }

  if (!isValidExpenseType(expenseType)) {
    throw Object.assign(
      new Error('Set expense ledger type (labour / labour service / raw material)'),
      { code: 'TALLY_EXPENSE' }
    );
  }

  const date = DEFAULT_TALLY_VOUCHER_DATE;
  const expenseLedger = expenseLedgerName(expenseType, invoice?.tax_items);
  if (!expenseLedger) {
    throw Object.assign(new Error('Unable to resolve expense ledger for Tally debit'), {
      code: 'TALLY_EXPENSE',
    });
  }

  const baseAmount = round2(invoice?.base_amount);
  const totalAmount = round2(invoice?.total_amount);

  if (!(baseAmount > 0)) {
    throw Object.assign(new Error('Invoice base_amount must be > 0 for Tally sync'), {
      code: 'TALLY_AMOUNT',
    });
  }
  if (!(totalAmount > 0)) {
    throw Object.assign(new Error('Invoice total_amount must be > 0 for Tally sync'), {
      code: 'TALLY_AMOUNT',
    });
  }

  const gstLegs = buildGstLegs(invoice?.tax_items, baseAmount);
  const taxSum = round2(gstLegs.reduce((sum, leg) => sum + leg.amount, 0));

  // Round Off ledger excluded for now — fold small OCR gaps into the expense debit
  // so the voucher still balances to total_amount.
  const gap = round2(totalAmount - baseAmount - taxSum);
  if (Math.abs(gap) > 25) {
    throw Object.assign(
      new Error(
        `Amounts do not balance for Tally (base ${baseAmount} + tax ${taxSum} = ${round2(
          baseAmount + taxSum
        )}, total ${totalAmount}, gap ${gap})`
      ),
      { code: 'TALLY_BALANCE' }
    );
  }
  const expenseDebit = round2(baseAmount + gap);

  if (!gstLegs.length && round2(invoice?.tax_amount || 0) > 0.05) {
    throw Object.assign(
      new Error('Invoice has tax_amount but no usable tax_items for Tally GST ledgers'),
      { code: 'TALLY_TAX_ITEMS' }
    );
  }

  const narration = `Purchase ${invoiceNumber} | ERP invoice sync`;

  let entriesXml = ledgerEntryXml({
    ledgerName: expenseLedger,
    isDeemedPositive: true,
    amount: expenseDebit,
  });

  for (const leg of gstLegs) {
    entriesXml += ledgerEntryXml({
      ledgerName: leg.ledgerName,
      isDeemedPositive: true,
      amount: leg.amount,
    });
  }

  entriesXml += ledgerEntryXml({
    ledgerName: partyLedger,
    isDeemedPositive: false,
    amount: totalAmount,
    billAllocation: { name: invoiceNumber, billType: 'New Ref' },
  });

  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${date}</DATE>
          <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
          <REFERENCEDATE>${date}</REFERENCEDATE>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(invoiceNumber)}</VOUCHERNUMBER>
          <REFERENCE>${escapeXml(invoiceNumber)}</REFERENCE>
          <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>
          <NARRATION>${escapeXml(narration)}</NARRATION>
          ${entriesXml}
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

/**
 * Post Purchase voucher for a paid vendor invoice. Does not throw for Tally failures —
 * returns a sync result object for the caller to persist.
 */
async function syncPurchaseVoucherForInvoice(invoice, supplier) {
  if (!isTallyEnabled()) {
    return {
      status: 'skipped',
      error: 'TALLY_ENABLED is not true — set TALLY_ENABLED=true and restart the API',
      voucherNumber: null,
      syncedAt: null,
    };
  }

  if (!tallyCompany()) {
    return {
      status: 'failed',
      error: 'TALLY_COMPANY is not configured',
      voucherNumber: null,
      syncedAt: null,
    };
  }

  try {
    const expenseType = resolveExpenseType(invoice, supplier);
    const xml = buildPurchaseVoucherXml({ invoice, supplier, expenseType });
    const { tallyUrl } = require('./tallyClient');
    console.log(
      `[tally] posting Purchase voucher ${invoice?.invoice_number} date=${DEFAULT_TALLY_VOUCHER_DATE} (fixed) invoice_date=${invoice?.invoice_date} → ${tallyUrl()}`
    );
    await postTallyXml(xml);
    return {
      status: 'synced',
      error: null,
      voucherNumber: String(invoice.invoice_number || '').trim(),
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[tally] sync failed:', err.message);
    return {
      status: 'failed',
      error: err.message || 'Tally sync failed',
      voucherNumber: null,
      syncedAt: null,
    };
  }
}

function assertReadyForTallySync(invoice, supplier) {
  if (!isTallyEnabled()) return null;

  if (!resolvePartyLedgerName(supplier)) {
    return 'Set ledger name on the supplier before recording payment (Tally sync is enabled)';
  }
  if (!resolveExpenseType(invoice, supplier)) {
    return 'Set expense ledger type (labour / labour service / raw material) on the supplier or this invoice before recording payment';
  }
  if (!String(invoice?.invoice_number || '').trim()) {
    return 'Invoice number is required before Tally sync';
  }
  return null;
}

module.exports = {
  buildPurchaseVoucherXml,
  syncPurchaseVoucherForInvoice,
  resolveExpenseType,
  resolvePartyLedgerName,
  assertReadyForTallySync,
  toTallyDate,
  DEFAULT_TALLY_VOUCHER_DATE,
};
