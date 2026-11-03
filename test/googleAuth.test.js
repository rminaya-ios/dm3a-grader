// Unit tests for Google sign-in (server/lib/googleAuth.js) and the session-secret
// rename (server/lib/auth.js). No database, no network.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import googleAuth from '../server/lib/googleAuth.js';
import auth from '../server/lib/auth.js';

const { decideGoogleLogin, isEmailAllowed, signupMode, verifyGoogleCredential } = googleAuth;
const ENV_KEYS = ['SIGNUP_MODE', 'ALLOWED_EMAILS', 'GOOGLE_CLIENT_ID', 'HUB_JWT_SECRET', 'JWT_SECRET'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const claims = { email: 'a@x.edu', emailVerified: true, name: 'A' };
const user = { _id: '64b000000000000000000001' };

test('a verified, allowed address with an account is let in', () => {
  assert.equal(decideGoogleLogin({ claims, allowed: true, user }).allow, true);
});

test('an invalid token is 401', () => {
  assert.equal(decideGoogleLogin({ claims: null, allowed: false, user: null }).status, 401);
});

test('an unverified Google email is 401', () => {
  const d = decideGoogleLogin({ claims: { ...claims, emailVerified: false }, allowed: true, user });
  assert.equal(d.status, 401);
});

test('not on the allowlist and no account give the SAME refusal', () => {
  const notAllowed = decideGoogleLogin({ claims, allowed: false, user });
  const noAccount = decideGoogleLogin({ claims, allowed: true, user: null });
  assert.equal(notAllowed.status, 403);
  assert.deepEqual(notAllowed, noAccount);
});

test('SIGNUP_MODE defaults to allowlist; only "open" opens it', () => {
  delete process.env.SIGNUP_MODE;
  assert.equal(signupMode(), 'allowlist');
  process.env.SIGNUP_MODE = 'yes';
  assert.equal(signupMode(), 'allowlist');
  process.env.SIGNUP_MODE = ' Open ';
  assert.equal(signupMode(), 'open');
});

test('allowlist matches case- and space-insensitively, and nothing else', () => {
  process.env.SIGNUP_MODE = 'allowlist';
  process.env.ALLOWED_EMAILS = ' Ralph@Gmail.com , b@usj.edu ';
  assert.equal(isEmailAllowed('ralph@gmail.com'), true);
  assert.equal(isEmailAllowed('B@USJ.EDU'), true);
  assert.equal(isEmailAllowed('c@usj.edu'), false);
  assert.equal(isEmailAllowed(''), false);
});

test('an empty allowlist lets nobody in', () => {
  process.env.SIGNUP_MODE = 'allowlist';
  delete process.env.ALLOWED_EMAILS;
  assert.equal(isEmailAllowed('ralph@gmail.com'), false);
});

test('Google sign-in fails closed without GOOGLE_CLIENT_ID', async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  assert.equal(await verifyGoogleCredential('anything'), null);
});

test('a garbage token is rejected, not thrown', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  assert.equal(await verifyGoogleCredential('not-a-jwt'), null);
});

test('session secret: HUB_JWT_SECRET wins, JWT_SECRET is the fallback', () => {
  process.env.JWT_SECRET = 'old-secret';
  delete process.env.HUB_JWT_SECRET;
  const fromOld = auth.signSession({ uid: 'u1' });
  assert.equal(auth.verifySession(fromOld).uid, 'u1');

  // Same value under the new name: existing cookies keep working (no sign-outs).
  process.env.HUB_JWT_SECRET = 'old-secret';
  delete process.env.JWT_SECRET;
  assert.equal(auth.verifySession(fromOld).uid, 'u1');

  // A different HUB value takes priority over JWT_SECRET.
  process.env.HUB_JWT_SECRET = 'new-secret';
  process.env.JWT_SECRET = 'old-secret';
  assert.equal(auth.verifySession(fromOld), null);
});

test('session check fails closed with no secret at all', () => {
  delete process.env.HUB_JWT_SECRET;
  delete process.env.JWT_SECRET;
  assert.throws(() => auth.signSession({ uid: 'u1' }));
  assert.equal(auth.verifySession('x.y.z'), null);
});
