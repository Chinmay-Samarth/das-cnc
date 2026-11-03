const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const router = express.Router();

function verifyEmployeeAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }
    const token = authHeader.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function isAllowedStorageUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || ''));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || '';
  const isSupabase =
    host.endsWith('.supabase.co') && path.includes('/storage/');
  const isLocal =
    (host === '127.0.0.1' || host === 'localhost') && path.length > 1;
  return isSupabase || isLocal;
}

/**
 * Same-origin PDF/file proxy so browsers can load Supabase public URLs in
 * react-pdf (direct XHR often fails CORS even when opening the URL in a tab works).
 * GET /api/media/proxy?url=<encoded absolute url>
 */
router.get('/proxy', verifyEmployeeAuth, async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!isAllowedStorageUrl(url)) {
    return res.status(400).json({ error: 'URL is not an allowed storage link' });
  }

  try {
    const upstream = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 40 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const contentType =
      upstream.headers['content-type'] || 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Disposition', 'inline');
    return res.status(200).send(Buffer.from(upstream.data));
  } catch (err) {
    const status = err.response?.status || 502;
    console.error('Media proxy error:', err.message);
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      error: err.response?.statusText || err.message || 'Unable to fetch file',
    });
  }
});

module.exports = router;
