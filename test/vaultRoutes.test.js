// Roster-vault routes end to end: no login, wrong instructor, right instructor.
// The access rule itself is unit-tested in test/vaultAccess.test.js; this checks
// the REAL server answers with it on every vault action — read (restore), store
// (secure / update roster) and delete — and that a refused write changes nothing.
//
// Runs server/index.js against a throwaway in-memory MongoDB (helpers/realServer.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startRealServer, serverRequire as require, sessionCookie, SECRET } from './helpers/realServer.js';

const User = require('./models/User.js');
const RosterVault = require('./models/RosterVault.js');

let srv;
let BASE;
let OWNER; // created the course and its vault
let OTHER; // a different instructor who uses the SAME course code
let STRANGER; // signed in, but has no course with that code

const CODE = 'MATH11003';
const URL = `/api/courses/${CODE}/roster-vault`;
const BLOB = { salt: 's', iv: 'i', ciphertext: 'owner-ciphertext', kdf: 'pbkdf2' };

async function call(method, url, { who, cookie, body } = {}) {
  const c = cookie || (who && who.cookie);
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(c ? { Cookie: c } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

// The vault must still hold exactly the owner's blob.
async function assertVaultUntouched() {
  const doc = await RosterVault.findOne({ courseId: CODE }).lean();
  assert.ok(doc, 'the vault must still exist');
  assert.deepEqual(doc.blob, BLOB);
  assert.equal(String(doc.ownerId), String(OWNER.user._id));
}

before(async () => {
  srv = await startRealServer();
  BASE = srv.base;
  const mk = async (email) => {
    const user = await User.create({ email, passwordHash: 'x' });
    return { user, cookie: sessionCookie(user) };
  };
  OWNER = await mk('owner@inst.edu');
  OTHER = await mk('other@inst.edu');
  STRANGER = await mk('stranger@inst.edu');
  for (const who of [OWNER, OTHER]) {
    assert.equal((await call('PUT', `/api/my/courses/${CODE}`, { who, body: {} })).status, 200);
  }
  assert.equal((await call('PUT', URL, { who: OWNER, body: { blob: BLOB } })).status, 200);
});

after(async () => {
  await srv?.stop();
});

test('no login: every vault action is 401 and nothing changes', async () => {
  assert.equal((await call('GET', URL)).status, 401);
  assert.equal((await call('PUT', URL, { body: { blob: { x: 1 } } })).status, 401);
  assert.equal((await call('DELETE', URL)).status, 401);
  await assertVaultUntouched();
});

test('a shared-password (legacy) session has no account, so it is 401 too', async () => {
  const jwt = require('jsonwebtoken');
  const cookie = `dm3a_session=${jwt.sign({ legacy: true }, SECRET, { expiresIn: '1h' })}`;
  assert.equal((await call('GET', URL, { cookie })).status, 401);
  assert.equal((await call('PUT', URL, { cookie, body: { blob: { x: 1 } } })).status, 401);
  assert.equal((await call('DELETE', URL, { cookie })).status, 401);
  await assertVaultUntouched();
});

test('wrong instructor with the same course code: 403 on read, update and delete', async () => {
  const read = await call('GET', URL, { who: OTHER });
  assert.equal(read.status, 403);
  assert.equal(read.data.blob, undefined, 'the blob must not be in a refusal');
  assert.equal((await call('PUT', URL, { who: OTHER, body: { blob: { x: 1 } } })).status, 403);
  assert.equal((await call('DELETE', URL, { who: OTHER })).status, 403);
  await assertVaultUntouched();
});

test('wrong instructor without the course: 403, same as when no vault exists', async () => {
  assert.equal((await call('GET', URL, { who: STRANGER })).status, 403);
  assert.equal((await call('PUT', URL, { who: STRANGER, body: { blob: { x: 1 } } })).status, 403);
  assert.equal((await call('DELETE', URL, { who: STRANGER })).status, 403);
  // A course code nobody has a vault for answers the same — no way to probe.
  assert.equal((await call('GET', '/api/courses/NOVAULT1/roster-vault', { who: STRANGER })).status, 403);
  await assertVaultUntouched();
});

test('right instructor: reads, updates, then deletes their own vault', async () => {
  const read = await call('GET', URL, { who: OWNER });
  assert.equal(read.status, 200);
  assert.deepEqual(read.data.blob, BLOB);

  const updated = { ...BLOB, ciphertext: 'roster-updated' };
  assert.equal((await call('PUT', URL, { who: OWNER, body: { blob: updated } })).status, 200);
  assert.deepEqual((await call('GET', URL, { who: OWNER })).data.blob, updated);

  const del = await call('DELETE', URL, { who: OWNER });
  assert.deepEqual([del.status, del.data.deleted], [200, true]);
  assert.equal((await call('GET', URL, { who: OWNER })).status, 404, 'own course, no vault yet = 404');
});
