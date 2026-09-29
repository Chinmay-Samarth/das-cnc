const net = require('net');
const { ipKeyGenerator } = require('express-rate-limit');

// IIS ARR forwards X-Forwarded-For with the client port (e.g. "192.168.1.61:52246"),
// which express-rate-limit rejects as an invalid IP.
function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    ip = bracketed[1];
  } else {
    const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (ipv4WithPort) ip = ipv4WithPort[1];
  }
  return net.isIP(ip) ? ip : null;
}

function rateLimitKey(req) {
  const ip = normalizeIp(req.ip) || normalizeIp(req.socket?.remoteAddress) || 'unknown';
  return ipKeyGenerator(ip);
}

module.exports = { rateLimitKey, normalizeIp };
