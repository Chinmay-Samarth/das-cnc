const { isTallyEnabled, tallyCompany, postTallyXml } = require('./tallyClient');

/** Temporary fixed voucher date (same policy as purchase/sales). */
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

function resolvePartyLedgerName(party) {
  const ledger = String(party?.ledger_name || '').trim();
  if (ledger) return ledger;
  const name = String(party?.name || party?.customer_snapshot?.name || '').trim();
  return name || null;
}

function ledgerEntryXml({ ledgerName, isDeemedPositive, amount, billAllocations }) {
  const amt = round2(amount);
  const signed = isDeemedPositive ? -Math.abs(amt) : Math.abs(amt);
  let billXml = '';
  const allocations = Array.isArray(billAllocations)
    ? billAllocations.filter((b) => b?.name && Number(b.amount) > 0)
    : [];
  if (allocations.length) {
    billXml = allocations
      .map((b) => {
        const billSigned = isDeemedPositive
          ? -Math.abs(round2(b.amount))
          : Math.abs(round2(b.amount));
        return `
            <BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(b.name)}</NAME>
              <BILLTYPE>${escapeXml(b.billType || 'Agst Ref')}</BILLTYPE>
              <AMOUNT>${billSigned.toFixed(2)}</AMOUNT>
            </BILLALLOCATIONS.LIST>`;
      })
      .join('');
  }

  return `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(ledgerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${signed.toFixed(2)}</AMOUNT>${billXml}
          </ALLLEDGERENTRIES.LIST>`;
}

/**
 * Build Receipt voucher XML.
 * Receipt: debit bank (Yes), credit party (No) with Agst Ref bill allocations.
 */
function buildReceiptVoucherXml({
  party,
  bankLedger,
  amount,
  reference,
  voucherNumber,
  narration,
  billAllocations,
}) {
  const company = tallyCompany();
  if (!company) {
    throw Object.assign(new Error('TALLY_COMPANY is not configured'), {
      code: 'TALLY_CONFIG',
    });
  }

  const partyLedger = resolvePartyLedgerName(party);
  if (!partyLedger) {
    throw Object.assign(new Error('Set ledger name on customer before Receipt voucher sync'), {
      code: 'TALLY_PARTY',
    });
  }

  const bank = String(bankLedger || '').trim();
  if (!bank) {
    throw Object.assign(new Error('Bank ledger is required for Receipt voucher'), {
      code: 'TALLY_BANK',
    });
  }

  const payAmount = round2(amount);
  if (!(payAmount > 0)) {
    throw Object.assign(new Error('Receipt amount must be > 0'), {
      code: 'TALLY_AMOUNT',
    });
  }

  const date = DEFAULT_TALLY_VOUCHER_DATE;
  const vchNo = String(voucherNumber || reference || '').trim() || `RCT-${Date.now()}`;
  const ref = String(reference || vchNo).trim();
  const narr = String(narration ?? ref).trim();

  let entriesXml = ledgerEntryXml({
    ledgerName: bank,
    isDeemedPositive: true,
    amount: payAmount,
  });

  entriesXml += ledgerEntryXml({
    ledgerName: partyLedger,
    isDeemedPositive: false,
    amount: payAmount,
    billAllocations: billAllocations || [],
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
        <VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${date}</DATE>
          <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
          <REFERENCEDATE>${date}</REFERENCEDATE>
          <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${escapeXml(vchNo)}</VOUCHERNUMBER>
          <REFERENCE>${escapeXml(ref)}</REFERENCE>
          <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>
          <NARRATION>${escapeXml(narr)}</NARRATION>
          ${entriesXml}
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

async function syncReceiptVoucher(opts) {
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
    const xml = buildReceiptVoucherXml(opts);
    const { tallyUrl } = require('./tallyClient');
    console.log(
      `[tally] posting Receipt voucher ${opts.voucherNumber || opts.reference} bank=${opts.bankLedger} → ${tallyUrl()}`
    );
    await postTallyXml(xml);
    return {
      status: 'synced',
      error: null,
      voucherNumber: String(opts.voucherNumber || opts.reference || '').trim() || null,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[tally] receipt sync failed:', err.message);
    return {
      status: 'failed',
      error: err.message || 'Tally receipt sync failed',
      voucherNumber: null,
      syncedAt: null,
    };
  }
}

async function syncReceiptVoucherForInvoice(invoice, customer, { bankLedger, amount, reference } = {}) {
  const party = customer || invoice?.customer || invoice?.customer_snapshot || null;
  const bank = String(bankLedger || invoice?.payment_bank_ledger || '').trim();
  const payAmount = amount != null ? round2(amount) : round2(invoice?.total_amount);
  const ref = String(reference || invoice?.payment_transaction_id || '').trim();
  const invoiceNumber = String(invoice?.invoice_number || '').trim();

  if (!bank) {
    return {
      status: 'failed',
      error: 'Bank ledger is required for Receipt voucher',
      voucherNumber: null,
      syncedAt: null,
    };
  }

  if (!(payAmount > 0)) {
    return {
      status: 'failed',
      error: 'Receipt amount must be > 0',
      voucherNumber: null,
      syncedAt: null,
    };
  }

  return syncReceiptVoucher({
    party,
    bankLedger: bank,
    amount: payAmount,
    reference: ref || invoiceNumber,
    voucherNumber: `RCT-${invoiceNumber || invoice?.id}`,
    narration: ref || '',
    billAllocations: invoiceNumber
      ? [{ name: invoiceNumber, amount: payAmount, billType: 'Agst Ref' }]
      : [],
  });
}

/**
 * Bulk receipt across multiple sales invoices (one voucher, many Agst Ref).
 */
async function syncReceiptVoucherForInvoices(invoices, customer, { bankLedger, amount, reference } = {}) {
  const list = Array.isArray(invoices) ? invoices : [];
  const party = customer || list[0]?.customer || list[0]?.customer_snapshot || null;
  const bank = String(bankLedger || '').trim();
  const ref = String(reference || '').trim();
  const allocations = list
    .map((inv) => ({
      name: String(inv.invoice_number || '').trim(),
      amount: round2(inv.total_amount),
      billType: 'Agst Ref',
    }))
    .filter((b) => b.name && b.amount > 0);
  const payAmount =
    amount != null
      ? round2(amount)
      : round2(allocations.reduce((s, b) => s + b.amount, 0));

  if (!bank) {
    return {
      status: 'failed',
      error: 'Bank ledger is required for Receipt voucher',
      voucherNumber: null,
      syncedAt: null,
    };
  }

  const numbers = allocations.map((b) => b.name).join(',');
  return syncReceiptVoucher({
    party,
    bankLedger: bank,
    amount: payAmount,
    reference: ref || numbers,
    voucherNumber: `RCT-BULK-${Date.now()}`,
    narration: ref || '',
    billAllocations: allocations,
  });
}

module.exports = {
  buildReceiptVoucherXml,
  syncReceiptVoucher,
  syncReceiptVoucherForInvoice,
  syncReceiptVoucherForInvoices,
  resolvePartyLedgerName,
  DEFAULT_TALLY_VOUCHER_DATE,
};
