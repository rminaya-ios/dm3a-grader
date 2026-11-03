// lib/googleAuth.js
// DM3A Grader — "Sign in with Google" for EXISTING instructor accounts.
//
// Google sign-in is a second way to get the same dm3a_session cookie that the
// email+password login issues (lib/auth.js). It never creates an account: a
// verified Google address is matched to a User by its primary email or one of its
// linkedEmails, and anything else is refused. Email+password stays as the
// fallback for school accounts that block Google sign-in.
//
// Who may sign in is config, not code:
//   SIGNUP_MODE=allowlist|open   (default allowlist — an unset flag never opens it)
//   ALLOWED_EMAILS=a@x.com,b@y.edu
//   GOOGLE_CLIENT_ID=<the Web OAuth client id; public, not a secret>
//
// FAIL CLOSED: no GOOGLE_CLIENT_ID → every Google sign-in is refused.

const { OAuth2Client } = require('google-auth-library');

function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

function signupMode() {
  return String(process.env.SIGNUP_MODE || '').trim().toLowerCase() === 'open' ? 'open' : 'allowlist';
}

function allowedEmails() {
  return String(process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isEmailAllowed(email) {
  if (signupMode() === 'open') return true;
  return allowedEmails().includes(String(email || '').trim().toLowerCase());
}

let _client = null;
function client() {
  if (!_client) _client = new OAuth2Client();
  return _client;
}

// Verifies signature, expiry, issuer and audience. Returns the claims we use, or
// null for any invalid token — callers treat null as "not signed in".
async function verifyGoogleCredential(credential) {
  const audience = googleClientId();
  if (!audience || !credential) return null;
  try {
    const ticket = await client().verifyIdToken({ idToken: String(credential), audience });
    const p = ticket.getPayload() || {};
    return {
      email: String(p.email || '').trim().toLowerCase(),
      emailVerified: p.email_verified === true,
      name: p.name || '',
    };
  } catch {
    return null;
  }
}

// Pure decision, unit-tested in test/googleAuth.test.js.
//   claims   output of verifyGoogleCredential (or null)
//   allowed  isEmailAllowed(claims.email)
//   user     the User matched by email/linkedEmails, or null
// Answer: { allow: true } or { allow: false, status, error }.
function decideGoogleLogin({ claims, allowed, user }) {
  if (!claims) return { allow: false, status: 401, error: 'Google sign-in could not be verified. Please try again.' };
  if (!claims.email || !claims.emailVerified) {
    return { allow: false, status: 401, error: 'Google did not confirm that email address.' };
  }
  // Same message for "not on the list" and "no account", so this can't be used to
  // discover which addresses have accounts.
  const refused = {
    allow: false,
    status: 403,
    error: 'That Google account is not set up for DM3A. Sign in with your email and password instead.',
  };
  if (!allowed || !user) return refused;
  return { allow: true };
}

module.exports = {
  googleClientId,
  signupMode,
  allowedEmails,
  isEmailAllowed,
  verifyGoogleCredential,
  decideGoogleLogin,
};
