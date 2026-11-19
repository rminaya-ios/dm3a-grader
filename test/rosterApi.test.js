// THE DEMO COURSE REHEARSAL — the Hub roster API end to end, against the real server
// and a throwaway in-memory database, with fake students.
//
// This is the rehearsal that has to pass before any live course is touched. It covers
// every property the migration depends on:
//   names round-trip through server-managed encryption (no passphrase anywhere)
//   only the course owner can read them; another instructor gets nothing
//   an issued alias can never be changed or removed
//   every read of the names is in the audit log
//   a ROSTER_KEK rotation leaves the roster identical
//   (with no ROSTER_KEK the service refuses — test/rosterNoKey.test.js, which needs
//    its own process because one test process can hold only one mongoose connection)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startRealServer, serverRequire as require, sessionCookie } from './helpers/realServer.js';

const User = require('./models/User.js');
const Roster = require('./models/Roster.js');
const RosterAudit = require('./models/RosterAudit.js');
const Course = require('./models/Course.js');
const rosterCrypto = require('./lib/rosterCrypto.js');

const KEY_V1 = crypto.randomBytes(32).toString('base64');
const KEY_V2 = crypto.randomBytes(32).toString('base64');

// A demo course with fake students — same shape a real vault holds.
const DEMO = 'DEMO101';
const STUDENTS = [
  { alias: 'DEMO10-7F3K', studentName: 'Ada Testwell', firstName: 'Ada', lastName: 'Testwell', bbUsername: 'atestwell', studentId: '09000001', studentEmail: 'ada@demo.edu' },
  { alias: 'DEMO10-QT92', studentName: 'Bruno Sample', firstName: 'Bruno', lastName: 'Sample', bbUsername: 'bsample', studentId: '09000002', studentEmail: 'bruno@demo.edu' },
  { alias: 'DEMO10-4XBN', studentName: 'Chen, Li', firstName: 'Li', lastName: 'Chen', bbUsername: 'lchen', studentId: '09000003', studentEmail: 'li@demo.edu' },
];

let srv, BASE, OWNER, OTHER, COURSE_ID, OTHER_COURSE_ID;

async function call(method, url, { who, cookie, body } = {}) {
  const c = cookie || (who && who.cookie);
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(c ? { Cookie: c } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

before(async () => {
  // The server runs on key version 2 with version 1 still available, which is exactly
  // the state a rotation leaves behind.
  srv = await startRealServer({ ROSTER_KEK: KEY_V2, ROSTER_KEK_VERSION: '2', ROSTER_KEK_V1: KEY_V1 });
  BASE = srv.base;
  const mk = async (email) => {
    const user = await User.create({ email, passwordHash: 'x' });
    return { user, cookie: sessionCookie(user) };
  };
  OWNER = await mk('demo-owner@inst.edu');
  OTHER = await mk('demo-other@inst.edu');
  // Both instructors have a course with the SAME code — the collision the old
  // code-keyed vault could not represent at all.
  assert.equal((await call('PUT', `/api/my/courses/${DEMO}`, { who: OWNER, body: {} })).status, 200);
  assert.equal((await call('PUT', `/api/my/courses/${DEMO}`, { who: OTHER, body: {} })).status, 200);
  COURSE_ID = String((await Course.findOne({ userId: OWNER.user._id, courseCode: DEMO }).lean())._id);
  OTHER_COURSE_ID = String((await Course.findOne({ userId: OTHER.user._id, courseCode: DEMO }).lean())._id);
  assert.notEqual(COURSE_ID, OTHER_COURSE_ID, 'two instructors, same code, separate rosters');
});

after(async () => { await srv?.stop(); });

test('rehearsal 1: store and read back the roster — no passphrase anywhere', async () => {
  const put = await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OWNER, body: { students: STUDENTS } });
  assert.equal(put.status, 200);
  assert.equal(put.data.studentCount, 3);
  assert.equal(put.data.keyVersion, 2, 'sealed under the current master key');

  const got = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  assert.equal(got.status, 200);
  assert.deepEqual(got.data.students, STUDENTS, 'every column round-trips, not just the alias');
  assert.equal(got.data.courseCode, DEMO);
});

test('rehearsal 2: the database holds no readable names', async () => {
  const doc = await Roster.findOne({ courseId: COURSE_ID }).lean();
  assert.ok(doc, 'the roster is stored');
  const raw = JSON.stringify(doc);
  for (const secret of ['Ada', 'Testwell', 'Bruno', 'atestwell', '09000001', 'ada@demo.edu', 'DEMO10-7F3K']) {
    assert.equal(raw.includes(secret), false, `"${secret}" must not be readable at rest`);
  }
  assert.equal(doc.studentCount, 3, 'a count is kept so a list screen never decrypts');
});

test('rehearsal 3: only the owner can read the names', async () => {
  // A different instructor, with their own course of the same code.
  assert.equal((await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OTHER })).status, 404);
  assert.equal((await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OTHER, body: { students: STUDENTS } })).status, 404);
  assert.equal((await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OTHER })).status, 404);
  // Not signed in at all.
  assert.equal((await call('GET', `/api/my/roster/${COURSE_ID}`)).status, 401);
  // A refused write changed nothing.
  const got = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  assert.deepEqual(got.data.students, STUDENTS);
  // The other instructor's own course has its own, separate (and empty) roster.
  assert.equal((await call('GET', `/api/my/roster/${OTHER_COURSE_ID}`, { who: OTHER })).status, 404);
});

test('rehearsal 4: an issued alias can never be changed or removed', async () => {
  const changed = STUDENTS.map((s, i) => (i === 1 ? { ...s, alias: 'DEMO10-NEW9' } : s));
  const res = await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OWNER, body: { students: changed } });
  assert.equal(res.status, 409);
  assert.equal(res.data.violations.length, 1);
  assert.equal(res.data.violations[0].from, 'DEMO10-QT92');
  assert.equal(res.data.violations[0].to, 'DEMO10-NEW9');

  const removed = STUDENTS.map((s, i) => (i === 0 ? { ...s, alias: '' } : s));
  assert.equal((await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OWNER, body: { students: removed } })).status, 409);

  // An alias that would belong to two students is refused as well.
  const dup = STUDENTS.map((s, i) => (i === 2 ? { ...s, alias: STUDENTS[0].alias } : s));
  const dupRes = await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OWNER, body: { students: dup } });
  assert.equal(dupRes.status, 409);
  assert.deepEqual(dupRes.data.duplicateAliases, [STUDENTS[0].alias]);

  // Through all three refusals the stored roster is untouched.
  assert.deepEqual((await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER })).data.students, STUDENTS);
});

test('rehearsal 5: a new student and a leaver are both allowed', async () => {
  const late = { alias: 'DEMO10-LATE', studentName: 'Dana Latecomer', firstName: 'Dana', lastName: 'Latecomer', bbUsername: 'dlate', studentId: '09000004' };
  assert.equal((await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OWNER, body: { students: STUDENTS.concat([late]) } })).status, 200);
  const got = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  assert.equal(got.data.students.length, 4);
  assert.equal(got.data.students[3].alias, 'DEMO10-LATE');

  // A married name on the same Username must not read as "new student, new alias".
  const renamed = got.data.students.map((s) => (s.bbUsername === 'atestwell' ? { ...s, studentName: 'Ada Marriedwell', lastName: 'Marriedwell' } : s));
  assert.equal((await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OWNER, body: { students: renamed } })).status, 200);
  const after = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  assert.equal(after.data.students.find((s) => s.bbUsername === 'atestwell').alias, 'DEMO10-7F3K', 'alias survived the rename');

  // Restore the demo roster for the rotation test.
  assert.equal((await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OWNER, body: { students: after.data.students } })).status, 200);
});

test('rehearsal 6: every read of the names is in the audit log, with no names in it', async () => {
  const res = await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OWNER });
  assert.equal(res.status, 200);
  const views = res.data.entries.filter((e) => e.action === 'view');
  assert.ok(views.length >= 4, `expected the reads so far to be logged, saw ${views.length}`);
  assert.ok(res.data.entries.some((e) => e.action === 'migrate'), 'the first write is recorded');
  assert.ok(res.data.entries.some((e) => e.action === 'write'), 'later writes are recorded');
  assert.equal(views[0].count, 4, 'the log records how many students were returned');
  assert.equal(views[0].via, 'grader');
  const raw = JSON.stringify(res.data);
  for (const secret of ['Ada', 'Testwell', 'atestwell', '09000001']) {
    assert.equal(raw.includes(secret), false, 'the audit log must not become a second copy of the names');
  }
  // The tool that asked is recorded, so a CheckPoint read is distinguishable.
  await call('GET', `/api/my/roster/${COURSE_ID}?via=checkpoint`, { who: OWNER });
  const again = await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OWNER });
  assert.equal(again.data.entries[0].via, 'checkpoint');
});

test('rehearsal 7: ROTATING ROSTER_KEK leaves the roster identical', async () => {
  const before = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  assert.equal(before.data.keyVersion, 2);

  // Put the record back on key version 1, as it would be before a rotation. Sealed in
  // THIS process under KEY_V1; the running server has KEY_V1 as ROSTER_KEK_V1.
  const saveEnv = { k: process.env.ROSTER_KEK, v: process.env.ROSTER_KEK_VERSION };
  process.env.ROSTER_KEK = KEY_V1;
  process.env.ROSTER_KEK_VERSION = '1';
  const oldSealed = rosterCrypto.seal({ courseId: COURSE_ID, courseCode: DEMO, version: 2, students: before.data.students });
  process.env.ROSTER_KEK = saveEnv.k;
  process.env.ROSTER_KEK_VERSION = saveEnv.v;
  assert.equal(oldSealed.keyVersion, 1);
  await Roster.updateOne({ courseId: COURSE_ID }, { $set: { sealed: oldSealed, keyVersion: 1 } });

  // The server still reads it, via the retained old key.
  const onV1 = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  assert.equal(onV1.status, 200);
  assert.equal(onV1.data.keyVersion, 1);
  assert.deepEqual(onV1.data.students, before.data.students);

  // Rotate.
  const rot = await call('POST', `/api/my/roster/${COURSE_ID}/rotate`, { who: OWNER });
  assert.equal(rot.status, 200);
  assert.equal(rot.data.rotated, true);
  assert.equal(rot.data.from, 1);
  assert.equal(rot.data.keyVersion, 2);

  // THE PROPERTY THAT MATTERS: not one student, and not one alias, changed.
  const afterRot = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  assert.equal(afterRot.data.keyVersion, 2);
  assert.deepEqual(afterRot.data.students, before.data.students, 'rotation must not alter the roster');

  // Rotating again is a no-op, and it is recorded.
  const twice = await call('POST', `/api/my/roster/${COURSE_ID}/rotate`, { who: OWNER });
  assert.equal(twice.data.rotated, false);
  const audit = await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OWNER });
  const rotEntry = audit.data.entries.find((e) => e.action === 'rotate');
  assert.ok(rotEntry, 'the rotation is in the audit log');
  assert.equal(rotEntry.note, 'keyVersion 1 -> 2');
});

test('rehearsal 8: a nonexistent or malformed course id is 404, never a server error', async () => {
  assert.equal((await call('GET', '/api/my/roster/not-an-id', { who: OWNER })).status, 404);
  assert.equal((await call('GET', '/api/my/roster/0123456789abcdef01234567', { who: OWNER })).status, 404);
  assert.equal((await call('PUT', `/api/my/roster/${COURSE_ID}`, { who: OWNER, body: { students: [] } })).status, 400);
});

test('the audit log never records a student name, whatever is stored', async () => {
  const all = await RosterAudit.find({}).lean();
  assert.ok(all.length > 0);
  const raw = JSON.stringify(all);
  for (const secret of ['Ada', 'Testwell', 'Bruno', 'Sample', 'Latecomer', 'atestwell', '09000001']) {
    assert.equal(raw.includes(secret), false, `"${secret}" in the audit log`);
  }
});

// ── The instructor's sign-off ──────────────────────────────────────────────
// Modelled on the real MATH1010050 migration, where two printed cards belonged to a
// withdrawn student and to the instructor's own preview account. The browser records
// what it waved through; the server must log it as its own action, and must still hold
// no names.
test('rehearsal 10: confirming a migration is logged as a verify, with aliases but no names', async () => {
  const got = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  assert.equal(got.status, 200);

  const put = await call('PUT', `/api/my/roster/${COURSE_ID}`, {
    who: OWNER,
    body: {
      students: got.data.students,
      verified: true,
      acknowledgedAliases: ['DEMO10-HN4G', 'demo10-f6g7'],
      skippedCount: 1,
    },
  });
  assert.equal(put.status, 200);

  const stored = await Roster.findOne({ courseId: COURSE_ID }).lean();
  assert.ok(stored.verifiedAt, 'the sign-off is recorded on the roster record');

  const audit = await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OWNER });
  const verifies = audit.data.entries.filter((e) => e.action === 'verify');
  assert.equal(verifies.length, 1, 'the sign-off is its own action, not just another write');
  assert.match(verifies[0].note, /verified against printed cards/);
  assert.match(verifies[0].note, /DEMO10-HN4G/, 'the aliases waved through are on the record');

  const raw = JSON.stringify(audit.data);
  for (const secret of ['Ada', 'Testwell', 'atestwell', '09000001']) {
    assert.ok(!raw.includes(secret), `audit log leaked ${secret}`);
  }
});

test('rehearsal 11: a name cannot be smuggled into the audit log through the sign-off', async () => {
  const got = await call('GET', `/api/my/roster/${COURSE_ID}`, { who: OWNER });
  const put = await call('PUT', `/api/my/roster/${COURSE_ID}`, {
    who: OWNER,
    body: {
      students: got.data.students,
      verified: true,
      // A caller trying to write prose, a name, and a flood of entries into the log.
      acknowledgedAliases: [
        'Ada Testwell withdrew',
        'atestwell',
        '09000001',
        'DEMO10-OK42',
        ...Array.from({ length: 200 }, (_, i) => `DEMO10-X${i}`),
      ],
      skippedCount: 10 ** 9,
    },
  });
  assert.equal(put.status, 200);

  const audit = await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OWNER });
  const note = audit.data.entries.filter((e) => e.action === 'verify')[0].note;
  assert.ok(note.length <= 300, `note should be capped, was ${note.length}`);
  assert.ok(note.includes('DEMO10-OK42'), 'a real alias is kept');
  for (const junk of ['Ada', 'Testwell', 'withdrew', 'atestwell', '09000001']) {
    assert.ok(!note.includes(junk), `audit note kept non-alias text: ${junk}`);
  }

  const raw = JSON.stringify(audit.data);
  for (const secret of ['Ada', 'Testwell', 'atestwell', '09000001']) {
    assert.ok(!raw.includes(secret), `audit log leaked ${secret}`);
  }
});

// ── CheckPoint reading the roster ──────────────────────────────────────────
// CheckPoint never holds ROSTER_KEK and never stores names: the instructor's signed-in
// browser reads them straight from here. These are the properties that makes that safe.
test('rehearsal 12: a CheckPoint read is owner-only and logged as via=checkpoint', async () => {
  const before = (await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OWNER })).data.entries.length;

  const mine = await call('GET', `/api/my/roster/${COURSE_ID}?via=checkpoint`, { who: OWNER });
  assert.equal(mine.status, 200);
  assert.ok(mine.data.students.length > 0, 'the owner gets the names');

  // Another instructor, signed in, asking for a course that is not theirs.
  const theirs = await call('GET', `/api/my/roster/${COURSE_ID}?via=checkpoint`, { who: OTHER });
  assert.equal(theirs.status, 404, 'a course that is not yours is indistinguishable from one that does not exist');
  assert.ok(!JSON.stringify(theirs.data).includes('Testwell'), 'and leaks no name on the way out');

  // Signed out entirely.
  const anon = await call('GET', `/api/my/roster/${COURSE_ID}?via=checkpoint`);
  assert.equal(anon.status, 401);

  const audit = await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OWNER });
  const cp = audit.data.entries.filter((e) => e.via === 'checkpoint' && e.action === 'view');
  assert.ok(cp.length >= 1, 'the CheckPoint read is in the log, tagged with the tool');
  assert.equal(cp[0].count, mine.data.students.length, 'the log records how many names were handed over');
  assert.ok(audit.data.entries.length > before, 'reading names always adds to the log');

  const raw = JSON.stringify(audit.data);
  for (const secret of ['Ada', 'Testwell', 'atestwell', '09000001']) {
    assert.ok(!raw.includes(secret), `audit log leaked ${secret}`);
  }
});

test('rehearsal 13: the via tag is sanitised, so it cannot smuggle anything into the log', async () => {
  await call('GET', `/api/my/roster/${COURSE_ID}?via=${encodeURIComponent('checkpoint; Ada Testwell <script>')}`, { who: OWNER });
  const audit = await call('GET', `/api/my/roster/${COURSE_ID}/audit`, { who: OWNER });
  const raw = JSON.stringify(audit.data);
  for (const secret of ['Ada', 'Testwell', '<script>']) {
    assert.ok(!raw.includes(secret), `audit log kept ${secret} from the via tag`);
  }
});
