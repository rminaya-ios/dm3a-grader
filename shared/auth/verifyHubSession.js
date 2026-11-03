// shared/auth/verifyHubSession.js
// DM3A Hub — check the shared sign-in cookie from ANY *.dm3agrader.com server.
//
// The Grader's API (api.dm3agrader.com) issues `dm3a_session`: an HS256 JWT,
// HttpOnly, Secure, SameSite=Lax, Domain=.dm3agrader.com, signed with
// HUB_JWT_SECRET. Because of the Domain, the browser sends it to every
// subdomain — so another tool (CheckPoint, Attendance, Grade Calculator) only has
// to VERIFY it. It never issues one: sign-in always happens on the hub.
//
// Zero dependencies (node:crypto only) so it can be copied verbatim into another
// repo. Copy, don't fork: if this file changes, re-copy it everywhere.
//
// Usage (Express):
//   const { requireHubSession } = require('./verifyHubSession.js');
//   app.use('/api', requireHubSession());            // 401 when not signed in
//   // req.hubUser = { uid, email }  — uid is the owner id for every record
//
// Or by hand:
//   const user = verifyHubSession(req.headers.cookie); // { uid, email } | null
//
// FAILS CLOSED: no HUB_JWT_SECRET → every check returns null.
// See RUNBOOK.md "Shared sign-in (DM3A Hub)".

const crypto = require('crypto');

const COOKIE_NAME = 'dm3a_session';

function hubSecret() {
  return String(process.env.HUB_JWT_SECRET || '').trim();
}

function b64urlDecode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function readCookie(cookieHeader, name) {
  for (const part of String(cookieHeader || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

// Verifies an HS256 JWT. Returns its payload or null (bad signature, wrong alg,
// expired, malformed, or no secret).
function verifyToken(token, secret = hubSecret()) {
  if (!secret || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(b64urlDecode(h).toString('utf8'));
    payload = JSON.parse(b64urlDecode(p).toString('utf8'));
  } catch {
    return null;
  }
  // Pin the algorithm: never trust the token to choose ("none", RS256 tricks).
  if (!header || header.alg !== 'HS256') return null;
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = b64urlDecode(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now) return null;
  return payload;
}

// { uid, email } for a real account session; null otherwise. Legacy shared-
// password sessions carry no uid and are deliberately rejected — they belong to
// no account, so there is nothing to scope to them.
function verifyHubSession(cookieHeader, secret) {
  const payload = verifyToken(readCookie(cookieHeader, COOKIE_NAME), secret);
  if (!payload || !payload.uid) return null;
  return { uid: String(payload.uid), email: String(payload.email || '') };
}

// Express middleware. 401 JSON when not signed in; sets req.hubUser otherwise.
function requireHubSession() {
  return function hubSessionGuard(req, res, next) {
    const user = verifyHubSession(req.headers && req.headers.cookie);
    if (!user) return res.status(401).json({ error: 'Not signed in. Sign in at https://app.dm3agrader.com' });
    req.hubUser = user;
    return next();
  };
}

module.exports = { COOKIE_NAME, verifyHubSession, verifyToken, requireHubSession };
