// routes/auth.js
// DM3A Grader — instructor accounts. Mounted at /api/auth.
//
//   POST /register        create an account + sign in
//   POST /login           sign in
//   POST /logout          sign out
//   GET  /me              current session (200 even when signed out)
//   POST /legacy-login    shared-password fallback, while ALLOW_LEGACY_LOGIN=true
//   POST /request-reset   email a reset link (always reports success)
//   POST /reset           consume a reset token, set a new password
//
// Does not touch: Student Access Codes, the trial-password system, piiGuard, the
// roster vault, or the grading/redaction pipeline.

const express = require('express');
const User = require('../models/User.js');
const { safeEqual } = require('../lib/adminAuth.js');
const { getResend, overLimit, clientIp } = require('../lib/clients.js');
const {
  hashPassword,
  verifyPassword,
  passwordProblem,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  generateResetToken,
  hashResetToken,
} = require('../lib/auth.js');

const router = express.Router();

const APP_BASE_URL = String(process.env.APP_BASE_URL || 'https://dm3agrader.com').replace(/\/+$/, '');
const SUPPORT_FROM = 'DM3A Grader <support@dm3agrader.com>';

// Rate limits (per fixed window). Deliberately generous — an instructor fat-
// fingering a password five times in a row must not be locked out mid-class.
const LOGIN_MAX_PER_IP      = 10;  // per 5 min
const LOGIN_WINDOW_S        = 300;
const REGISTER_MAX_PER_IP   = 5;   // per hour
const REGISTER_WINDOW_S     = 3600;
const RESET_MAX_PER_IP      = 5;   // per hour
const RESET_MAX_PER_EMAIL   = 3;   // per hour
const RESET_WINDOW_S        = 3600;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

// Is the shared-password fallback still switched on? Default OFF: an unset flag
// must not silently re-enable the old shared password.
function legacyLoginEnabled() {
  return String(process.env.ALLOW_LEGACY_LOGIN || '').trim().toLowerCase() === 'true';
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    if (await overLimit(`register:${clientIp(req)}`, REGISTER_MAX_PER_IP, REGISTER_WINDOW_S)) {
      return res.status(429).json({ error: 'Too many sign-up attempts. Try again in a little while.' });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });

    if (await User.exists({ email })) {
      // Registration necessarily reveals that an address is taken — there is no
      // way around it without a confirm-by-email flow. Reset does not leak.
      return res.status(409).json({ error: 'An account with that email already exists. Try signing in instead.' });
    }

    const user = await User.create({ email, passwordHash: await hashPassword(password), name });
    setSessionCookie(res, { uid: String(user._id), email: user.email });
    console.log(`[auth] account created: ${email}`); // address only — never the password
    return res.status(201).json({ user: user.toPublic() });
  } catch (err) {
    // Unique-index race: two simultaneous registrations for the same address.
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'An account with that email already exists. Try signing in instead.' });
    }
    console.error('[auth] register error:', err.message);
    return res.status(500).json({ error: 'Could not create the account. Please try again.' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    if (await overLimit(`login:${clientIp(req)}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_S)) {
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = await User.findOne({ email });
    // Same message and (roughly) the same timing whether the account is missing
    // or the password is wrong — don't confirm which addresses are registered.
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!user || !ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    setSessionCookie(res, { uid: String(user._id), email: user.email });
    return res.json({ user: user.toPublic() });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    return res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return res.json({ success: true });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
// 200 even when signed out, so the frontend can ask "who am I?" on every load
// without treating a normal logged-out state as an error.
router.get('/me', async (req, res) => {
  try {
    const session = readSession(req);
    if (!session) return res.json({ user: null, legacy: false });

    if (session.legacy) {
      // Shared-password session: signed in to the app, but not as an account.
      return res.json({ user: null, legacy: true });
    }

    const user = session.uid ? await User.findById(session.uid) : null;
    if (!user) {
      // Account deleted (or a stale cookie from another environment).
      clearSessionCookie(res);
      return res.json({ user: null, legacy: false });
    }
    return res.json({ user: user.toPublic(), legacy: false });
  } catch (err) {
    console.error('[auth] me error:', err.message);
    return res.json({ user: null, legacy: false });
  }
});

// ── POST /api/auth/legacy-login ──────────────────────────────────────────────
// The old shared app password, kept alive as a migration fallback and as the
// break-glass for a Mongo outage (accounts need the DB; grading does not).
//
// A legacy session is ACCOUNT-LESS on purpose — it carries no uid, so it cannot
// read anybody's courses through /api/my/courses. The shared password shipped
// inside the public JS bundle for months; anyone who viewed source has it. Tying
// it to a real account would hand strangers that instructor's data.
router.post('/legacy-login', async (req, res) => {
  try {
    if (await overLimit(`legacy:${clientIp(req)}`, LOGIN_MAX_PER_IP, LOGIN_WINDOW_S)) {
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
    }

    if (!legacyLoginEnabled()) {
      return res.status(403).json({ error: 'The shared password has been retired. Please sign in with your account.', retired: true });
    }

    const expected = String(process.env.LEGACY_SHARED_PASSWORD || '').trim();
    if (!expected) return res.status(403).json({ error: 'The shared password is not configured.', retired: true });

    const provided = String(req.body?.password || '').trim();
    if (!provided || !safeEqual(provided, expected)) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    setSessionCookie(res, { legacy: true });
    console.log('[auth] legacy shared-password sign-in');
    return res.json({ legacy: true });
  } catch (err) {
    console.error('[auth] legacy-login error:', err.message);
    return res.status(500).json({ error: 'Could not sign in. Please try again.' });
  }
});

// ── POST /api/auth/request-reset ─────────────────────────────────────────────
// ALWAYS reports success, whether or not the address is registered — otherwise
// this endpoint becomes a way to enumerate who has an account.
router.post('/request-reset', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const generic = { success: true };

  try {
    if (!EMAIL_RE.test(email)) return res.json(generic);
    if (await overLimit(`reset-ip:${clientIp(req)}`, RESET_MAX_PER_IP, RESET_WINDOW_S)) return res.json(generic);
    if (await overLimit(`reset-em:${email}`, RESET_MAX_PER_EMAIL, RESET_WINDOW_S)) return res.json(generic);

    const user = await User.findOne({ email });
    if (!user) return res.json(generic);

    const { raw, hash, expiresAt } = generateResetToken();
    user.resetTokenHash = hash;
    user.resetTokenExpiresAt = expiresAt;
    await user.save();

    const link = `${APP_BASE_URL}/reset?token=${raw}`;

    // Local development has no Resend key — print the link instead of emailing
    // so the flow is testable end-to-end offline.
    const mailer = getResend();
    if (!mailer) {
      console.log(`\n[auth] DEV password-reset link for ${email}:\n${link}\n`);
      return res.json(generic);
    }

    await mailer.emails.send({
      from: SUPPORT_FROM,
      to: email,
      subject: 'Reset your DM3A Grader password',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
          <div style="background:#1B2A4A;padding:24px;border-radius:8px 8px 0 0;">
            <h2 style="color:#fff;margin:0;">DM3A Grader</h2>
            <p style="color:#C9A84C;margin:4px 0 0;">Mastery-Based Grading for Math Instructors</p>
          </div>
          <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #eee;">
            <p>We received a request to reset the password for <strong>${email}</strong>.</p>
            <div style="text-align:center;margin:24px 0;">
              <a href="${link}" style="background:#1B2A4A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;display:inline-block;">Reset my password</a>
            </div>
            <p style="color:#666;font-size:14px;">This link expires in 60 minutes and can only be used once.</p>
            <p style="color:#666;font-size:14px;">If you didn't request this, you can ignore this email — your password won't change.</p>
            <p style="color:#666;font-size:12px;word-break:break-all;">Button not working? Paste this into your browser:<br>${link}</p>
            <p style="margin-top:24px;">— Dr. Ralph Minaya, Ed.D.<br>Creator, DM3A Grader</p>
          </div>
        </div>
      `,
    });

    return res.json(generic);
  } catch (err) {
    // Even on failure the response is identical — no information leak.
    console.error('[auth] request-reset error:', err.message);
    return res.json(generic);
  }
});

// ── POST /api/auth/reset ─────────────────────────────────────────────────────
router.post('/reset', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token) return res.status(400).json({ error: 'This reset link is invalid.' });

    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });

    const user = await User.findOne({ resetTokenHash: hashResetToken(token) })
      .select('+resetTokenHash +resetTokenExpiresAt');

    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'This reset link has expired or already been used. Please request a new one.' });
    }

    user.passwordHash = await hashPassword(password);
    user.resetTokenHash = null;       // single-use
    user.resetTokenExpiresAt = null;
    await user.save();

    // Do NOT auto-sign-in: send them to the login page to confirm the new
    // password works, and so a forwarded link can't hand over a live session.
    clearSessionCookie(res);
    console.log(`[auth] password reset completed: ${user.email}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] reset error:', err.message);
    return res.status(500).json({ error: 'Could not reset the password. Please try again.' });
  }
});

module.exports = router;
