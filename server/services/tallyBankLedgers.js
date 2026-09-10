const { isTallyEnabled, tallyCompany, exportTallyXml } = require('./tallyClient');

const CACHE_TTL_MS = 60_000;
const BANK_PARENT_GROUPS = ['Bank Accounts', 'Bank OD A/c'];

let cache = { at: 0, ledgers: null };

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildLedgerCollectionXml(parentName) {
  const company = tallyCompany();
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>ERP Bank Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${company ? `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>` : ''}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="ERP Bank Ledgers" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <CHILDOF>${escapeXml(parentName)}</CHILDOF>
            <BELONGSTO>Yes</BELONGSTO>
            <FETCH>Name, Parent</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function parseLedgerNames(xmlBody) {
  const body = String(xmlBody || '');
  const names = new Set();

  // <NAME>...</NAME> inside ledger blocks, or NAME attribute
  const nameTagRe = /<NAME[^>]*>([^<]+)<\/NAME>/gi;
  let match;
  while ((match = nameTagRe.exec(body))) {
    const name = String(match[1] || '').trim();
    if (name && !/^ERP Bank Ledgers$/i.test(name)) names.add(name);
  }

  const ledgerNameRe = /<LEDGER[^>]*NAME="([^"]+)"/gi;
  while ((match = ledgerNameRe.exec(body))) {
    const name = String(match[1] || '').trim();
    if (name) names.add(name);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Fetch bank ledgers from Tally under Bank Accounts / Bank OD A/c.
 * Returns sorted unique names. Uses a short in-memory cache.
 */
async function fetchBankLedgersFromTally({ force = false } = {}) {
  if (!isTallyEnabled()) {
    const err = new Error('TALLY_ENABLED is not true');
    err.code = 'TALLY_DISABLED';
    throw err;
  }

  const now = Date.now();
  if (!force && cache.ledgers && now - cache.at < CACHE_TTL_MS) {
    return cache.ledgers;
  }

  const all = new Set();
  let lastError = null;

  for (const parent of BANK_PARENT_GROUPS) {
    try {
      const xml = buildLedgerCollectionXml(parent);
      const result = await exportTallyXml(xml);
      for (const name of parseLedgerNames(result.body)) {
        all.add(name);
      }
    } catch (err) {
      if (err.responseBody) {
        for (const name of parseLedgerNames(err.responseBody)) {
          all.add(name);
        }
      } else {
        lastError = err;
      }
    }
  }

  const ledgers = [...all].sort((a, b) => a.localeCompare(b));
  if (!ledgers.length) {
    const err = new Error(
      lastError?.message ||
        'No bank ledgers found in Tally under Bank Accounts / Bank OD A/c'
    );
    err.code = 'TALLY_BANK_EMPTY';
    throw err;
  }

  cache = { at: Date.now(), ledgers };
  return ledgers;
}

function clearBankLedgerCache() {
  cache = { at: 0, ledgers: null };
}

module.exports = {
  fetchBankLedgersFromTally,
  clearBankLedgerCache,
  BANK_PARENT_GROUPS,
  parseLedgerNames,
};
