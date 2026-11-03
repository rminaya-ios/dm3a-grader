// shared/auth/verifyHubSession.js must accept exactly the cookies the Grader's
// API issues (server/lib/auth.js) and nothing else.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import hub from '../shared/auth/verifyHubSession.js';
import auth from '../server/lib/auth.js';

const require = createRequire(import.meta.url);
const jwt = require('../server/node_modules/jsonwebtoken');
const { verifyHubSession, requireHubSession } = hub;

const SECRET = 'shared-secret-for-tests-' + 'y'.repeat(30);
const saved = { HUB_JWT_SECRET: process.env.HUB_JWT_SECRET, JWT_SECRET: process.env.JWT_SECRET };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const cookie = (token) => `other=1; dm3a_session=${token}; theme=dark`;

test('accepts a session issued by the Grader API', () => {
  process.env.HUB_JWT_SECRET = SECRET;
  const token = auth.signSession({ uid: 'u123', email: 'a@x.edu' });
  assert.deepEqual(verifyHubSession(cookie(token)), { uid: 'u123', email: 'a@x.edu' });
});

test('rejects a wrong secret, a tampered payload, and an expired token', () => {
  process.env.HUB_JWT_SECRET = SECRET;
  assert.equal(verifyHubSession(cookie(jwt.sign({ uid: 'u1' }, 'other-secret', { expiresIn: '1h' }))), null);

  const [h, , s] = jwt.sign({ uid: 'u1' }, SECRET, { expiresIn: '1h' }).split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'admin', exp: 9999999999 })).toString('base64url');
  assert.equal(verifyHubSession(cookie(`${h}.${forged}.${s}`)), null);

  const expired = jwt.sign({ uid: 'u1', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  assert.equal(verifyHubSession(cookie(expired)), null);
});

test('rejects alg=none and tokens without an expiry', () => {
  process.env.HUB_JWT_SECRET = SECRET;
  const none = jwt.sign({ uid: 'u1', exp: 9999999999 }, null, { algorithm: 'none' });
  assert.equal(verifyHubSession(cookie(none)), null);
  assert.equal(verifyHubSession(cookie(jwt.sign({ uid: 'u1' }, SECRET))), null);
});

test('rejects legacy account-less sessions and missing cookies', () => {
  process.env.HUB_JWT_SECRET = SECRET;
  assert.equal(verifyHubSession(cookie(jwt.sign({ legacy: true }, SECRET, { expiresIn: '1h' }))), null);
  assert.equal(verifyHubSession('theme=dark'), null);
  assert.equal(verifyHubSession(undefined), null);
});

test('fails closed with no HUB_JWT_SECRET', () => {
  delete process.env.HUB_JWT_SECRET;
  const token = jwt.sign({ uid: 'u1' }, SECRET, { expiresIn: '1h' });
  assert.equal(verifyHubSession(cookie(token)), null);
});

test('middleware: 401 when signed out, req.hubUser when signed in', () => {
  process.env.HUB_JWT_SECRET = SECRET;
  const mw = requireHubSession();
  let status = 0;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  let nexted = false;
  mw({ headers: {} }, res, () => { nexted = true; });
  assert.equal(status, 401);
  assert.equal(nexted, false);

  const req = { headers: { cookie: cookie(jwt.sign({ uid: 'u9', email: 'b@y.edu' }, SECRET, { expiresIn: '1h' })) } };
  mw(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.deepEqual(req.hubUser, { uid: 'u9', email: 'b@y.edu' });
});
