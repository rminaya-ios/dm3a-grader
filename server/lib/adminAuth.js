// Shared admin-key auth. Same policy as routes/adminStats.js so the access-code
// management endpoints are protected by the SAME key: env ADMIN_DASHBOARD_KEY,
// header x-admin-key, constant-time compare, and FAIL CLOSED when unconfigured
// (no key set => locked, never open).
const crypto = require('crypto');

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireAdminKey(req, res, next) {
  // Trim both sides — Railway's variable editor often stores a trailing newline.
  const expected = String(process.env.ADMIN_DASHBOARD_KEY || '').trim();
  if (!expected) return res.status(401).json({ error: 'Admin key is not configured.' });
  const provided = String(req.get('x-admin-key') || '').trim();
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' }); // never log the key
  }
  return next();
}

module.exports = { requireAdminKey, safeEqual };
