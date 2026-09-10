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
  const name = String(party?.name || '').trim();
  return name || null;
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

/**
 * Build Payment voucher XML.
 * @param {{ party, bankLedger, amount, reference, voucherNumber, narration, billRefName }} opts
 */
function buildPaymentVoucherXml({
  party,
  bankLedger,
  amount,
  reference,
  voucherNumber,
  narration,
  billRefName,
}) {
  const company = tallyCompany();
  if (!company) {
    throw Object.assign(new Error('TALLY_COMPANY is not configured'), {
      code: 'TALLY_CONFIG',
    });
  }

  const partyLedger = resolvePartyLedgerName(party);
  if (!partyLedger) {
    throw Object.assign(new Error('Set ledger name on supplier before Payment voucher sync'), {
      code: 'TALLY_PARTY',
    });
  }

  const bank = String(bankLedger || '').trim();
  if (!bank) {
    throw Object.assign(new Error('Bank ledger is required for Payment voucher'), {
      code: 'TALLY_BANK',
    });
  }

  const payAmount = round2(amount);
  if (!(payAmount > 0)) {
    throw Object.assign(new Error('Payment amount must be > 0'), {
      code: 'TALLY_AMOUNT',
    });
  }

  const date = DEFAULT_TALLY_VOUCHER_DATE;
  const vchNo = String(voucherNumber || reference || '').trim() || `PAY-${Date.now()}`;
  const ref = String(reference || vchNo).trim();
  const narr = String(narration || `Payment ${ref} | ERP sync`).trim();

  // Payment: debit party (Yes), credit bank (No)
  let entriesXml = ledgerEntryXml({
    ledgerName: partyLedger,
    isDeemedPositive: true,
    amount: payAmount,
    billAllocation: billRefName
      ? { name: billRefName, billType: 'Agst Ref' }
      : undefined,
  });

  entriesXml += ledgerEntryXml({
    ledgerName: bank,
    isDeemedPositive: false,
    amount: payAmount,
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
        <VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>${date}</DATE>
          <EFFECTIVEDATE>${date}</EFFECTIVEDATE>
          <REFERENCEDATE>${date}</REFERENCEDATE>
          <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
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

async function syncPaymentVoucher(opts) {
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
    const xml = buildPaymentVoucherXml(opts);
    const { tallyUrl } = require('./tallyClient');
    console.log(
      `[tally] posting Payment voucher ${opts.voucherNumber || opts.reference} bank=${opts.bankLedger} → ${tallyUrl()}`
    );
    await postTallyXml(xml);
    return {
      status: 'synced',
      error: null,
      voucherNumber: String(opts.voucherNumber || opts.reference || '').trim() || null,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[tally] payment sync failed:', err.message);
    return {
      status: 'failed',
      error: err.message || 'Tally payment sync failed',
      voucherNumber: null,
      syncedAt: null,
    };
  }
}

async function syncPaymentVoucherForInvoice(invoice, supplier, { bankLedger, amount, reference } = {}) {
  const party = supplier || invoice?.suppliers || null;
  const bank = String(bankLedger || invoice?.payment_bank_ledger || '').trim();
  const payAmount =
    amount != null
      ? round2(amount)
      : round2(
          Number(invoice?.total_amount || 0) - Number(invoice?.po_advance_amount || 0)
        );
  const ref = String(reference || invoice?.payment_reference || '').trim();
  const invoiceNumber = String(invoice?.invoice_number || '').trim();

  if (!bank) {
    return {
      status: 'failed',
      error: 'Bank ledger is required for Payment voucher',
      voucherNumber: null,
      syncedAt: null,
    };
  }

  if (!(payAmount > 0)) {
    return {
      status: 'skipped',
      error: 'Payment amount is zero after advance — no Payment voucher needed',
      voucherNumber: null,
      syncedAt: null,
    };
  }

  return syncPaymentVoucher({
    party,
    bankLedger: bank,
    amount: payAmount,
    reference: ref || invoiceNumber,
    voucherNumber: `PAY-${invoiceNumber || invoice?.id}`,
    narration: `Payment ${ref || invoiceNumber} | Invoice ${invoiceNumber} | ERP`,
    billRefName: invoiceNumber || null,
  });
}

async function syncAdvancePaymentVoucher(po, supplier, { bankLedger, amount, reference } = {}) {
  const party = supplier || po?.suppliers || po?.supplier || null;
  const bank = String(bankLedger || po?.advance_bank_ledger || '').trim();
  const payAmount = amount != null ? round2(amount) : round2(po?.advance_amount);
  const ref = String(reference || po?.advance_reference || po?.po_number || '').trim();
  const poNumber = String(po?.po_number || '').trim();

  return syncPaymentVoucher({
    party,
    bankLedger: bank,
    amount: payAmount,
    reference: ref || poNumber,
    voucherNumber: `ADV-${poNumber || po?.id}`,
    narration: `Advance ${ref || poNumber} | PO ${poNumber} | ERP`,
    billRefName: null,
  });
}

module.exports = {
  buildPaymentVoucherXml,
  syncPaymentVoucher,
  syncPaymentVoucherForInvoice,
  syncAdvancePaymentVoucher,
  resolvePartyLedgerName,
  DEFAULT_TALLY_VOUCHER_DATE,
};
