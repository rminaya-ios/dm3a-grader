// lib/piiBox.js
// DM3A Make-up — encryption at rest for the few student details the server has
// to hold (the name and school email typed on a request, and the optional note).
// They are needed to send the student their link and for the instructor to see
// who asked; they are never logged and never sent to the AI.
//
// AES-256-GCM with MAKEUP_PII_KEY (32 bytes, base64 or hex) from the environment
// — separate from the session secret. FAIL CLOSED: no key means nothing can be
// stored or read, and the request routes answer 503 instead of storing clear text.

const crypto = require('crypto');

function key() {
  const raw = String(process.env.MAKEUP_PII_KEY || '').trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

function configured() {
  return !!key();
}

// value (any JSON) → "v1.<iv>.<tag>.<ciphertext>" (base64url parts).
function seal(value) {
  const k = key();
  if (!k) throw new Error('MAKEUP_PII_KEY is not configured');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

function open(boxed) {
  const k = key();
  if (!k) throw new Error('MAKEUP_PII_KEY is not configured');
  const [v, iv, tag, ct] = String(boxed || '').split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('not a sealed value');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8'));
}

module.exports = { configured, seal, open };
