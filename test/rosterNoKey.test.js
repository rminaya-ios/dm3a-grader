// The Hub roster API with NO ROSTER_KEK configured: it must refuse, not fall back to
// storing clear text. Its own file because startRealServer connects mongoose, and one
// test process can hold only one connection — so a second server with a different
// environment needs a second process.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startRealServer, serverRequire as require, sessionCookie } from './helpers/realServer.js';

const User = require('./models/User.js');
const Course = require('./models/Course.js');
const Roster = require('./models/Roster.js');

let srv, BASE, WHO, COURSE_ID;

before(async () => {
  srv = await startRealServer({}); // deliberately no ROSTER_KEK
  BASE = srv.base;
  const user = await User.create({ email: 'nokey@inst.edu', passwordHash: 'x' });
  WHO = { user, cookie: sessionCookie(user) };
  const res = await fetch(`${BASE}/api/my/courses/NOKEY101`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: WHO.cookie }, body: '{}',
  });
  assert.equal(res.status, 200);
  COURSE_ID = String((await Course.findOne({ userId: user._id, courseCode: 'NOKEY101' }).lean())._id);
});

after(async () => { await srv?.stop(); });

const call = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: WHO.cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
};

test('a write is refused with 503 and nothing is stored', async () => {
  const res = await call('PUT', `/api/my/roster/${COURSE_ID}`, {
    students: [{ alias: 'NOKEY-0001', studentName: 'Should Not Persist', bbUsername: 'snp' }],
  });
  assert.equal(res.status, 503);
  assert.match(res.data.error, /ROSTER_KEK/);
  assert.equal(await Roster.countDocuments({ courseId: COURSE_ID }), 0, 'no clear-text fallback');
});

test('a read and a rotate are refused too', async () => {
  assert.equal((await call('GET', `/api/my/roster/${COURSE_ID}`)).status, 503);
  assert.equal((await call('POST', `/api/my/roster/${COURSE_ID}/rotate`)).status, 503);
});

test('the audit log is still readable — it holds no names, so it needs no key', async () => {
  const res = await call('GET', `/api/my/roster/${COURSE_ID}/audit`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.entries, []);
});
