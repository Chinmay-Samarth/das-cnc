const axios = require('axios');

function isTallyEnabled() {
  const raw = String(process.env.TALLY_ENABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function tallyUrl() {
  return String(process.env.TALLY_URL || 'http://127.0.0.1:9000').replace(/\/$/, '');
}

function tallyCompany() {
  return String(process.env.TALLY_COMPANY || '').trim();
}

/**
 * POST XML to Tally HTTP server. Parses created / error markers from the response body.
 */
async function postTallyXml(xml) {
  const url = tallyUrl();
  const timeout = Number(process.env.TALLY_TIMEOUT_MS) || 30000;

  let response;
  try {
    response = await axios.post(url, xml, {
      headers: { 'Content-Type': 'text/xml;charset=utf-8' },
      timeout,
      responseType: 'text',
      transformResponse: [(data) => data],
      validateStatus: () => true,
    });
  } catch (err) {
    const message =
      err.code === 'ECONNREFUSED'
        ? `Tally not reachable at ${url}`
        : err.message || 'Tally request failed';
    const error = new Error(message);
    error.code = 'TALLY_UNREACHABLE';
    throw error;
  }

  const body = String(response.data || '');
  const lineError = extractTag(body, 'LINEERROR') || extractTag(body, 'ERROR');
  const exceptions = extractTag(body, 'EXCEPTIONS');
  const created = Number(extractTag(body, 'CREATED') || 0);
  const altered = Number(extractTag(body, 'ALTERED') || 0);
  const errors = Number(extractTag(body, 'ERRORS') || 0);
  const exceptionsCount = Number(exceptions || 0);

  if (response.status >= 400) {
    const error = new Error(`Tally HTTP ${response.status}: ${lineError || body.slice(0, 240)}`);
    error.code = 'TALLY_HTTP';
    error.responseBody = body;
    throw error;
  }

  if (lineError || errors > 0 || exceptionsCount > 0) {
    const error = new Error(lineError || `Tally reported ${errors || exceptionsCount} error(s)`);
    error.code = 'TALLY_REJECT';
    error.responseBody = body;
    throw error;
  }

  if (created < 1 && altered < 1) {
    // Some Tally builds omit counters but still succeed; treat empty success carefully
    if (/<RESPONSE>/i.test(body) && !/<CREATED>/i.test(body)) {
      return { ok: true, created: 0, altered: 0, body };
    }
  }

  return { ok: true, created, altered, body };
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = String(xml || '').match(re);
  return match ? String(match[1]).trim() : null;
}

module.exports = {
  isTallyEnabled,
  tallyUrl,
  tallyCompany,
  postTallyXml,
};
