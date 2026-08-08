// lib/auth.js
// DM3A Grader — instructor session auth (bcrypt + JWT in an httpOnly cookie).
//
// Policy mirrors lib/adminAuth.js: read config from env, trim it (Railway's
// variable editor loves trailing newlines), and FAIL CLOSED when unconfigured —
// no JWT_SECRET means every session check rejects, never opens.
//
// The session cookie is httpOnly (JavaScript on the page cannot read it, so an XSS
// bug can't exfiltrate a session), Secure + SameSite=Lax in production, and scoped
// to .dm3agrader.com so the site (dm3agrader.com) and API (api.dm3agrader.com) are
// first-party to each other. That subdomain setup is what makes this work in iOS
// Safari, which blocks third-party cookies outright.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const COOKIE_NAME = 'dm3a_session';
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const BCRYPT_COST = 12;

// Minimum password length. Long-but-simple beats short-but-gnarly, and a floor
// this low with no composition rules is current NIST guidance.
const MIN_PASSWORD_LENGTH = 10;

const isProd = () => process.env.NODE_ENV === 'production';

function jwtSecret() {
  return String(process.env.JWT_SECRET || '').trim();
}

// ── Passwords ────────────────────────────────────────────────────────────────
async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_COST);
}

async function verifyPassword(plain, hash) {
  if (!hash) {
    // No hash on record. Still burn a comparison so a missing-account response
    // doesn't return measurably faster than a wrong-password one (user
    // enumeration via timing).
    await bcrypt.compare(String(plain), '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    return false;
  }
  return bcrypt.compare(String(plain), hash);
}

function passwordProblem(plain) {
  const p = String(plain || '');
  if (p.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (p.length > 200) return 'Password is too long.';
  return null;
}

// ── Session tokens ───────────────────────────────────────────────────────────
// A legacy (shared-password) session carries legacy:true and NO userId — it is
// deliberately account-less. See routes/auth.js for why.
function signSession(payload) {
  const secret = jwtSecret();
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return jwt.sign(payload, secret, { expiresIn: `${SESSION_DAYS}d` });
}

function verifySession(token) {
  const secret = jwtSecret();
  if (!secret || !token) return null;
  try {
    return jwt.verify(token, secret);
  } catch {
    return null; // expired or tampered — treat as logged out
  }
}

function cookieOptions() {
  const opts = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd(),
    maxAge: SESSION_MS,
    path: '/',
  };
  // Share the cookie between dm3agrader.com and api.dm3agrader.com. Omitted in
  // dev, where both ends are localhost and a Domain attribute would break it.
  if (isProd()) opts.domain = '.dm3agrader.com';
  return opts;
}

function setSessionCookie(res, payload) {
  res.cookie(COOKIE_NAME, signSession(payload), cookieOptions());
}

function clearSessionCookie(res) {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(COOKIE_NAME, opts);
}

function readSession(req) {
  return verifySession(req.cookies && req.cookies[COOKIE_NAME]);
}

// ── Middleware ───────────────────────────────────────────────────────────────
// requireAuth: a real account is required. Legacy shared-password sessions are
// rejected here — they have no account, so there is no data to scope to them.
function requireAuth(req, res, next) {
  if (!jwtSecret()) {
    return res.status(401).json({ error: 'Auth is not configured.' }); // fail closed
  }
  const session = readSession(req);
  if (!session || !session.uid) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  req.user = { id: String(session.uid), email: session.email || '' };
  return next();
}

// attachSession: never rejects; populates req.session for routes that behave
// differently when signed in but must still serve anonymous callers.
function attachSession(req, _res, next) {
  req.session = readSession(req);
  if (req.session && req.session.uid) {
    req.user = { id: String(req.session.uid), email: req.session.email || '' };
  }
  return next();
}

// ── Password-reset tokens ────────────────────────────────────────────────────
// Raw token goes in the email; only its SHA-256 is stored, so a database leak
// cannot be replayed into an account takeover.
const RESET_TTL_MS = 60 * 60 * 1000; // 60 minutes

function generateResetToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashResetToken(raw), expiresAt: new Date(Date.now() + RESET_TTL_MS) };
}

function hashResetToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

module.exports = {
  COOKIE_NAME,
  SESSION_DAYS,
  MIN_PASSWORD_LENGTH,
  RESET_TTL_MS,
  hashPassword,
  verifyPassword,
  passwordProblem,
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireAuth,
  attachSession,
  generateResetToken,
  hashResetToken,
};
