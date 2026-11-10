const {
  expenseLedgerName,
  inputGstLedgerName,
  isValidExpenseType,
  rateToPercent,
} = require('../config/tallyLedgers');
const { isTallyEnabled, tallyCompany, toTallyDate, postTallyXml } = require('./tallyClient');

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

function taxLineAmount(tax, baseAmount) {
  const amount = Number(tax?.amount);
  if (Number.isFinite(amount) && amount !== 0) return round2(amount);
  const base = Number(tax?.base ?? baseAmount ?? 0);
  const pct = rateToPercent(tax?.rate);
  if (Number.isFinite(base) && pct != null) return round2(base * (pct / 100));
  return 0;
}

function resolveExpenseType(invoice, supplier) {
  // Supplier is source of truth (one type per supplier)
  const fromSupplier = String(supplier?.tally_expense_ledger_type || '').trim();
  if (isValidExpenseType(fromSupplier)) return fromSupplier;
  const fromInvoice = String(invoice?.tally_expense_ledger_type || '').trim();
  if (isValidExpenseType(fromInvoice)) return fromInvoice;
  return null;
}

function resolvePartyLedgerName(supplier) {
  const ledger = String(supplier?.ledger_name || '').trim();
  if (ledger) return ledger;
  const name = String(supplier?.name || '').trim();
  return name || null;
}

function untaxedLineTotal(invoice) {
  const lines = Array.isArray(invoice?.line_items) ? invoice.line_items : [];
  return round2(
    lines.reduce((sum, line) => {
      if (line?.taxable !== false) return sum;
      const total = Number(line?.total);
      return sum + (Number.isFinite(total) ? total : 0);
    }, 0)
  );
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

  const date = toTallyDate(invoice?.invoice_date);
  if (!date) {
    throw Object.assign(new Error('Invoice date is required for Tally Purchase voucher'), {
      code: 'TALLY_DATE',
    });
  }
  const expenseLedger = expenseLedgerName(expenseType, invoice?.tax_items);
  if (!expenseLedger) {
    throw Object.assign(new Error('Unable to resolve expense ledger for Tally debit'), {
      code: 'TALLY_EXPENSE',
    });
  }

  const baseAmount = round2(invoice?.base_amount);
  const untaxedAmount = untaxedLineTotal(invoice);
  const preTaxAmount = round2(baseAmount + untaxedAmount);
  const totalAmount = round2(invoice?.total_amount);

  if (!(preTaxAmount > 0)) {
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
  // so the voucher still balances to total_amount. Untaxed lines stay in that debit.
  const gap = round2(totalAmount - preTaxAmount - taxSum);
  if (Math.abs(gap) > 25) {
    const preTaxLabel =
      untaxedAmount > 0
        ? `taxable ${baseAmount} + no tax ${untaxedAmount}`
        : `base ${baseAmount}`;
    throw Object.assign(
      new Error(
        `Amounts do not balance for Tally (${preTaxLabel} + tax ${taxSum} = ${round2(
          preTaxAmount + taxSum
        )}, total ${totalAmount}, gap ${gap})`
      ),
      { code: 'TALLY_BALANCE' }
    );
  }
  const expenseDebit = round2(preTaxAmount + gap);

  if (!gstLegs.length && round2(invoice?.tax_amount || 0) > 0.05) {
    throw Object.assign(
      new Error('Invoice has tax_amount but no usable tax_items for Tally GST ledgers'),
      { code: 'TALLY_TAX_ITEMS' }
    );
  }

  const narration = String(invoiceNumber || '').trim();

  // Credit (To) first so the party line stays on top in Tally, then debit legs.
  let entriesXml = ledgerEntryXml({
    ledgerName: partyLedger,
    isDeemedPositive: false,
    amount: totalAmount,
    billAllocation: { name: invoiceNumber, billType: 'New Ref' },
  });

  entriesXml += ledgerEntryXml({
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
          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
          <VCHENTRYMODE>As Voucher</VCHENTRYMODE>
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
      `[tally] posting Purchase voucher ${invoice?.invoice_number} date=${toTallyDate(invoice?.invoice_date)} invoice_date=${invoice?.invoice_date} → ${tallyUrl()}`
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
    return 'Set expense ledger type (Labour / Labour Service / Consumable / Raw Material / Spares and Tools) on the supplier before syncing';
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
};
