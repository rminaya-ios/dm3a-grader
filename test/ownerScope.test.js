// Cross-account isolation (Hub Phase 2): instructor B can't read, list or change
// instructor A's courses, vaults, results or settings — and the CheckPoint
// bridge still records with only its X-Risk-Bridge-Key.
//
// Runs the REAL server (server/index.js) as a child process against a throwaway
// in-memory MongoDB, so route wiring and mount order are what's tested. The child
// runs from an empty temp directory, so server/.env is never loaded and the
// production database can't be reached.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startRealServer, serverRequire as require, sessionCookie } from './helpers/realServer.js';

const User = require('./models/User.js');
const Submission = require('./models/Submission.js');
const AtRiskFlag = require('./models/AtRiskFlag.js');

const BRIDGE_KEY = 'test-bridge-key-123';

let srv;
let BASE;
let A; // { user, cookie }
let B;

async function call(method, url, { who, body, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(who ? { Cookie: who.cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

before(async () => {
  srv = await startRealServer({
    RISK_BRIDGE_KEY: BRIDGE_KEY,
    GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    SIGNUP_MODE: 'allowlist',
    ALLOWED_EMAILS: 'a@inst.edu',
  });
  BASE = srv.base;
  const { hashPassword } = require('./lib/auth.js');
  const hash = await hashPassword('correct horse battery');
  const ua = await User.create({ email: 'a@inst.edu', passwordHash: hash, linkedEmails: ['a@school.edu'] });
  const ub = await User.create({ email: 'b@inst.edu', passwordHash: hash });
  A = { user: ua, cookie: sessionCookie(ua) };
  B = { user: ub, cookie: sessionCookie(ub) };
});

after(async () => {
  await srv?.stop();
});

// ── Sign-in still works ───────────────────────────────────────────────────────
test('email+password login works, including a linked address', async () => {
  const primary = await call('POST', '/api/auth/login', { body: { email: 'a@inst.edu', password: 'correct horse battery' } });
  assert.equal(primary.status, 200);
  const linked = await call('POST', '/api/auth/login', { body: { email: 'A@School.edu', password: 'correct horse battery' } });
  assert.equal(linked.status, 200);
  assert.equal(linked.data.user.email, 'a@inst.edu');
  const wrong = await call('POST', '/api/auth/login', { body: { email: 'a@school.edu', password: 'nope nope nope' } });
  assert.equal(wrong.status, 401);
});

test('a forged Google token is refused', async () => {
  const r = await call('POST', '/api/auth/google', { body: { credential: 'forged.token.value' } });
  assert.equal(r.status, 401);
});

// ── Courses ───────────────────────────────────────────────────────────────────
test('B cannot list, change or delete A\'s courses', async () => {
  assert.equal((await call('PUT', '/api/my/courses/AONLY101', { who: A, body: { professorEmail: 'a@inst.edu' } })).status, 200);
  assert.equal((await call('PUT', '/api/my/courses/SHARED1', { who: A, body: {} })).status, 200);
  assert.equal((await call('PUT', '/api/my/courses/SHARED1', { who: B, body: {} })).status, 200);

  const bList = await call('GET', '/api/my/courses', { who: B });
  assert.deepEqual(bList.data.courses.map((c) => c.courseCode), ['SHARED1']);

  assert.equal((await call('DELETE', '/api/my/courses/AONLY101', { who: B })).status, 404);
  const aList = await call('GET', '/api/my/courses', { who: A });
  assert.deepEqual(aList.data.courses.map((c) => c.courseCode).sort(), ['AONLY101', 'SHARED1']);
});

// ── Vaults ────────────────────────────────────────────────────────────────────
test('B cannot read, overwrite or delete A\'s vault — even with the same course code', async () => {
  const blob = { salt: 's', iv: 'i', ciphertext: 'c', kdf: 'pbkdf2' };
  assert.equal((await call('PUT', '/api/courses/AONLY101/roster-vault', { who: A, body: { blob } })).status, 200);

  assert.equal((await call('GET', '/api/courses/AONLY101/roster-vault', { who: B })).status, 404);
  assert.equal((await call('PUT', '/api/courses/AONLY101/roster-vault', { who: B, body: { blob: { x: 1 } } })).status, 404);
  assert.equal((await call('DELETE', '/api/courses/AONLY101/roster-vault', { who: B })).status, 404);
  assert.equal((await call('GET', '/api/courses/AONLY101/roster-vault')).status, 401);

  const mine = await call('GET', '/api/courses/AONLY101/roster-vault', { who: A });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.data.blob, blob);
});

// ── Results (via the bridge, which is also the bridge test) ───────────────────
test('the CheckPoint bridge records with only its key, and stamps the owner', async () => {
  const record = { alias: 'AONLY101-7F3K', courseCode: 'AONLY101', professorEmail: 'a@school.edu', assignmentName: 'CP1', pScore: 1 };
  assert.equal((await call('POST', '/api/risk/bridge', { body: record })).status, 401);
  assert.equal((await call('POST', '/api/risk/bridge', { body: record, headers: { 'x-risk-bridge-key': 'wrong' } })).status, 401);

  for (const name of ['CP1', 'CP2']) {
    const ok = await call('POST', '/api/risk/bridge', { body: { ...record, assignmentName: name }, headers: { 'x-risk-bridge-key': BRIDGE_KEY } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.recorded, 1);
  }
  const saved = await Submission.find({ alias: 'AONLY101-7F3K' }).lean();
  assert.equal(saved.length, 2);
  // Owner resolved from a LINKED professor address.
  for (const s of saved) assert.equal(String(s.userId), String(A.user._id));
});

test('B cannot read or change A\'s results and flags', async () => {
  const flags = await AtRiskFlag.find({ alias: 'AONLY101-7F3K' }).lean();
  assert.ok(flags.length >= 1, 'two P1s should have raised a flag');
  assert.equal(String(flags[0].userId), String(A.user._id));
  const flagId = String(flags[0]._id);

  const bFlags = await call('GET', '/api/risk/flags?courseCode=AONLY101', { who: B });
  assert.equal(bFlags.status, 200);
  assert.equal(bFlags.data.flags.length, 0);
  const aFlags = await call('GET', '/api/risk/flags?courseCode=AONLY101', { who: A });
  assert.equal(aFlags.data.flags.length, flags.length);
  assert.equal(aFlags.data.flags[0].recentSubmissions.length, 2);

  const bPatch = await call('PATCH', `/api/risk/flags/${flagId}`, { who: B, body: { action: 'dismissed' } });
  assert.equal(bPatch.status, 404);
  assert.equal((await AtRiskFlag.findById(flagId).lean()).flagState, flags[0].flagState);
  assert.equal((await call('PATCH', '/api/risk/flags/not-an-id', { who: B, body: { action: 'dismissed' } })).status, 404);

  const bInsight = await call('GET', '/api/insights/assignment?courseCode=AONLY101&assignmentName=CP1', { who: B });
  assert.match(bInsight.data.message, /Only 0 submission/);
  const aInsight = await call('GET', '/api/insights/assignment?courseCode=AONLY101&assignmentName=CP1', { who: A });
  assert.match(aInsight.data.message, /Only 1 submission/);
});

test('risk read routes refuse a signed-out caller', async () => {
  for (const url of ['/api/risk/flags?courseCode=AONLY101', '/api/submissions/student?studentEmail=x@y.z&courseCode=AONLY101', '/api/insights/assignment?courseCode=AONLY101&assignmentName=CP1']) {
    assert.equal((await call('GET', url)).status, 401, url);
  }
  assert.equal((await call('PATCH', '/api/risk/flags/64b000000000000000000001', { body: { action: 'dismissed' } })).status, 401);
  assert.equal((await call('POST', '/api/submissions/save', { body: {} })).status, 401);
});

test('signing in does not leak other routes: /api/auth/me still answers signed-out', async () => {
  const r = await call('GET', '/api/auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.data.user, null);
});

// ── Settings ──────────────────────────────────────────────────────────────────
test('settings start at the DM3A defaults and are private to each owner', async () => {
  const aFirst = await call('GET', '/api/my/settings', { who: A });
  assert.equal(aFirst.status, 200);
  assert.deepEqual(aFirst.data.settings.bands, { p4Min: 90, p3Min: 80, p2Min: 60 });
  assert.deepEqual(aFirst.data.settings.bbPoints, { P4: 90, P3: 80, P2: 60, P1: 50, talkToStudent: 26 });
  assert.deepEqual(aFirst.data.settings.latePolicy, {
    windows: [{ maxDaysLate: 7, capLevel: 'P3' }, { maxDaysLate: 14, capLevel: 'P2' }],
    beyond: 'instructor_review',
  });

  const put = await call('PUT', '/api/my/settings', { who: A, body: { bands: { p4Min: 92, p3Min: 82, p2Min: 65 } } });
  assert.equal(put.status, 200);
  assert.equal(put.data.settings.bands.p4Min, 92);
  assert.equal(put.data.settings.bbPoints.P4, 90, 'a partial update leaves other sections alone');

  const bView = await call('GET', '/api/my/settings', { who: B });
  assert.equal(bView.data.settings.bands.p4Min, 90, 'B sees their own defaults, not A\'s edit');
  await call('PUT', '/api/my/settings', { who: B, body: { bands: { p4Min: 95, p3Min: 85, p2Min: 70 } } });
  assert.equal((await call('GET', '/api/my/settings', { who: A })).data.settings.bands.p4Min, 92);

  assert.equal((await call('PUT', '/api/my/settings', { who: A, body: { bands: { p4Min: 50, p3Min: 80, p2Min: 60 } } })).status, 400);
  assert.equal((await call('GET', '/api/my/settings')).status, 401);
});
