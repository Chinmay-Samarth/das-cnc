const { isTallyEnabled, tallyCompany, exportTallyXml } = require('./tallyClient');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Export a single ledger's closing balance from Tally.
 * Closing balance convention: positive = debit (customer owes us for Sundry Debtors).
 */
function buildLedgerOutstandingXml(ledgerName) {
  const company = tallyCompany();
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>ERP Customer Outstanding</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${company ? `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>` : ''}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="ERP Customer Outstanding" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FILTERS>ERPMatchLedger</FILTERS>
            <FETCH>Name, ClosingBalance, Parent</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="ERPMatchLedger" ISMODIFY="No">
            $Name = "${escapeXml(ledgerName)}"
          </SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseClosingBalance(xmlBody) {
  const body = String(xmlBody || '');
  const closingRe = /<CLOSINGBALANCE[^>]*>(-?[\d.]+)<\/CLOSINGBALANCE>/i;
  const match = body.match(closingRe);
  if (match) return round2(match[1]);

  // Some exports use attribute form
  const attrRe = /CLOSINGBALANCE="(-?[\d.]+)"/i;
  const attr = body.match(attrRe);
  if (attr) return round2(attr[1]);

  return null;
}

/**
 * Fetch how much a customer owes (ledger closing balance) from Tally.
 * @returns {{ outstanding: number|null, ledger_name: string, error: string|null }}
 */
async function fetchCustomerOutstandingFromTally(ledgerName) {
  const name = String(ledgerName || '').trim();
  if (!name) {
    return { outstanding: null, ledger_name: null, error: 'Customer ledger name is required' };
  }

  if (!isTallyEnabled()) {
    return {
      outstanding: null,
      ledger_name: name,
      error: 'TALLY_ENABLED is not true',
    };
  }

  try {
    const { body } = await exportTallyXml(buildLedgerOutstandingXml(name));
    const balance = parseClosingBalance(body);
    if (balance == null) {
      return {
        outstanding: null,
        ledger_name: name,
        error: 'Could not parse closing balance from Tally',
      };
    }
    // For debtors, debit (positive in Tally ISDEEMEDPOSITIVE convention) means they owe us.
    // Exported CLOSINGBALANCE is often negative for credit balances; take absolute when
    // parent is Sundry Debtors-style. We return raw balance and a positive "owes" amount.
    const owes = Math.abs(balance);
    return { outstanding: owes, closing_balance: balance, ledger_name: name, error: null };
  } catch (err) {
    return {
      outstanding: null,
      ledger_name: name,
      error: err.message || 'Unable to fetch outstanding from Tally',
    };
  }
}

module.exports = {
  fetchCustomerOutstandingFromTally,
  buildLedgerOutstandingXml,
  parseClosingBalance,
};
