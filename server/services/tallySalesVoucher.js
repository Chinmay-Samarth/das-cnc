const {
  DEFAULT_SALES_LEDGER,
  outputGstLedgerName,
  rateToPercent,
  salesLedgerName,
} = require('../config/tallyLedgers');
const { isTallyEnabled, tallyCompany, postTallyXml } = require('./tallyClient');

/** Temporary fixed voucher date for all Tally posts (same as purchase). */
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

function resolvePartyLedgerName(customer) {
  const ledger = String(customer?.ledger_name || '').trim();
  if (ledger) return ledger;
  const name = String(customer?.name || customer?.customer_snapshot?.name || '').trim();
  return name || null;
}

function buildOutputGstLegs(invoice) {
  const taxType = String(invoice?.tax_type || '').toUpperCase();
  const gstRate = rateToPercent(invoice?.gst_rate) ?? 18;
  const legs = [];

  if (taxType === 'IGST') {
    const amount = round2(invoice?.igst_amount);
    if (amount > 0) {
      const ledger = outputGstLedgerName('IGST', gstRate);
      if (!ledger) {
        throw Object.assign(
          new Error(`No Output Tax ledger mapping for IGST @ ${gstRate}%`),
          { code: 'TALLY_GST_MAP' }
        );
      }
      legs.push({ ledgerName: ledger, amount });
    }
    return legs;
  }

  // Default / CGST_SGST — half rates (9% each when gst_rate is 18)
  const halfRate = gstRate / 2;
  const cgst = round2(invoice?.cgst_amount);
  const sgst = round2(invoice?.sgst_amount);

  if (cgst > 0) {
    const ledger = outputGstLedgerName('CGST', halfRate);
    if (!ledger) {
      throw Object.assign(
        new Error(`No Output Tax ledger mapping for CGST @ ${halfRate}%`),
        { code: 'TALLY_GST_MAP' }
      );
    }
    legs.push({ ledgerName: ledger, amount: cgst });
  }
  if (sgst > 0) {
    const ledger = outputGstLedgerName('SGST', halfRate);
    if (!ledger) {
      throw Object.assign(
        new Error(`No Output Tax ledger mapping for SGST @ ${halfRate}%`),
        { code: 'TALLY_GST_MAP' }
      );
    }
    legs.push({ ledgerName: ledger, amount: sgst });
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

function buildSalesVoucherXml({ invoice, customer }) {
  const company = tallyCompany();
  if (!company) {
    throw Object.assign(new Error('TALLY_COMPANY is not configured'), {
      code: 'TALLY_CONFIG',
    });
  }

  const invoiceNumber = String(invoice?.invoice_number || '').trim();
  if (!invoiceNumber) {
    throw Object.assign(new Error('Invoice number is required for Tally Sales voucher'), {
      code: 'TALLY_INVOICE',
    });
  }

  const partyLedger = resolvePartyLedgerName(customer || invoice?.customer || invoice);
  if (!partyLedger) {
    throw Object.assign(new Error('Set ledger name on customer before syncing to Tally'), {
      code: 'TALLY_PARTY',
    });
  }

  const salesLedger = salesLedgerName() || DEFAULT_SALES_LEDGER;
  const date = DEFAULT_TALLY_VOUCHER_DATE;

  const taxableAmount = round2(invoice?.taxable_amount);
  const totalAmount = round2(invoice?.total_amount);

  if (!(taxableAmount > 0)) {
    throw Object.assign(new Error('Invoice taxable_amount must be > 0 for Tally sync'), {
      code: 'TALLY_AMOUNT',
    });
  }
  if (!(totalAmount > 0)) {
    throw Object.assign(new Error('Invoice total_amount must be > 0 for Tally sync'), {
      code: 'TALLY_AMOUNT',
    });
  }

  const gstLegs = buildOutputGstLegs(invoice);
  const taxSum = round2(gstLegs.reduce((sum, leg) => sum + leg.amount, 0));
  const gap = round2(totalAmount - taxableAmount - taxSum);
  if (Math.abs(gap) > 25) {
    throw Object.assign(
      new Error(
        `Amounts do not balance for Tally (taxable ${taxableAmount} + tax ${taxSum} = ${round2(
          taxableAmount + taxSum
        )}, total ${totalAmount}, gap ${gap})`
      ),
      { code: 'TALLY_BALANCE' }
    );
  }
  const salesCredit = round2(taxableAmount + gap);

  const expectedTax =
    round2(invoice?.cgst_amount || 0) +
    round2(invoice?.sgst_amount || 0) +
    round2(invoice?.igst_amount || 0);
  if (!gstLegs.length && expectedTax > 0.05) {
    throw Object.assign(
      new Error('Invoice has GST amounts but no Output Tax ledger mapping'),
      { code: 'TALLY_TAX_ITEMS' }
    );
  }

  const narration = String(invoiceNumber || '').trim();

  // Sales: party debit (ISDEEMEDPOSITIVE Yes), sales + GST credits (No)
  let entriesXml = ledgerEntryXml({
    ledgerName: partyLedger,
    isDeemedPositive: true,
    amount: totalAmount,
    billAllocation: { name: invoiceNumber, billType: 'New Ref' },
  });

  entriesXml += ledgerEntryXml({
    ledgerName: salesLedger,
    isDeemedPositive: false,
    amount: salesCredit,
  });

  for (const leg of gstLegs) {
    entriesXml += ledgerEntryXml({
      ledgerName: leg.ledgerName,
      isDeemedPositive: false,
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
        <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${date}</DATE>
          <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
          <REFERENCEDATE>${date}</REFERENCEDATE>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
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
 * Post Sales voucher for a paid sales invoice. Does not throw for Tally failures —
 * returns a sync result object for the caller to persist.
 */
async function syncSalesVoucherForInvoice(invoice, customer) {
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
    const xml = buildSalesVoucherXml({ invoice, customer });
    const { tallyUrl } = require('./tallyClient');
    console.log(
      `[tally] posting Sales voucher ${invoice?.invoice_number} date=${DEFAULT_TALLY_VOUCHER_DATE} (fixed) → ${tallyUrl()}`
    );
    await postTallyXml(xml);
    return {
      status: 'synced',
      error: null,
      voucherNumber: String(invoice.invoice_number || '').trim(),
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[tally] sales sync failed:', err.message);
    return {
      status: 'failed',
      error: err.message || 'Tally sync failed',
      voucherNumber: null,
      syncedAt: null,
    };
  }
}

function assertReadyForSalesTallySync(invoice, customer) {
  if (!isTallyEnabled()) return null;

  if (!resolvePartyLedgerName(customer || invoice?.customer || invoice)) {
    return 'Set ledger name on the customer before recording payment (Tally sync is enabled)';
  }
  if (!String(invoice?.invoice_number || '').trim()) {
    return 'Invoice number is required before Tally sync';
  }
  return null;
}

module.exports = {
  buildSalesVoucherXml,
  syncSalesVoucherForInvoice,
  resolvePartyLedgerName,
  assertReadyForSalesTallySync,
  DEFAULT_TALLY_VOUCHER_DATE,
};
