// Make-up module end to end (docs/makeup-module-spec.md): the real server, an
// in-memory database and a FAKE Anthropic API on localhost (no real model, no
// cost). One student goes request → approve → photo → question → Loom →
// review card → exception → confirm → Blackboard rows, while a second
// instructor tries to reach the first one's records.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startRealServer, serverRequire as require, sessionCookie } from './helpers/realServer.js';

const sharp = require('sharp');
const User = require('./models/User.js');
const Course = require('./models/Course.js');
const { MakeupRequest, MakeupSubmission, MakeupPhoto } = require('./models/Makeup.js');

const STUDENT = { name: 'Jordan Testperson', email: 'jordan.testperson@ctstate.edu' };
const DAY = 24 * 60 * 60 * 1000;

const aiRequests = [];
let fakeAi;
let srv;
let ownerA;
let ownerB;
let cookieA;
let cookieB;
let pagePhoto;

function fakeAnswer(body) {
  const system = String(body.system || '');
  const text = body.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (system.includes('Transcribe the steps')) {
    return {
      readable: true,
      steps: [
        { id: '1', problem: '1', text: '2x + 3 = 7', readable: true },
        { id: '2', problem: '1', text: '2x = 4', readable: true },
        { id: '3', problem: '1', text: 'x = 2', readable: true },
      ],
    };
  }
  if (system.includes('ONE short follow-up question')) {
    const step = /The step \(problem [^)]*\): (.*)/.exec(text)[1].trim();
    return { question: `In the step where you wrote "${step}", why did you do that?`, quote: step };
  }
  if (system.includes('review card')) {
    return {
      aiLevel: 'P4',
      levelReason: 'Complete, correct steps.',
      answerStatus: 'answered',
      answerNote: 'Explains subtracting 3 first.',
      scriptSigns: ['no_hesitation'],
    };
  }
  throw new Error('unexpected AI call');
}

before(async () => {
  fakeAi = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      aiRequests.push(parsed);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: JSON.stringify(fakeAnswer(parsed)) }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 120 },
      }));
    });
  });
  await new Promise((r) => fakeAi.listen(0, '127.0.0.1', r));

  srv = await startRealServer({
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${fakeAi.address().port}`,
    ANTHROPIC_API_KEY: 'test-key',
    MAKEUP_PII_KEY: crypto.randomBytes(32).toString('base64'),
    HUB_BASE_URL: 'http://localhost:5173',
  });
  ownerA = await User.create({ email: 'a@inst.edu', passwordHash: 'x' });
  ownerB = await User.create({ email: 'b@inst.edu', passwordHash: 'x' });
  cookieA = sessionCookie(ownerA);
  cookieB = sessionCookie(ownerB);
  await Course.create({ userId: ownerA._id, courseCode: 'MATH110-04' });
  await Course.create({ userId: ownerB._id, courseCode: 'MATH200-01' });

  // A "photo" of written work with the student's name on it.
  const lines = [`Name: ${STUDENT.name}`, 'Problem 1: Solve 2x + 3 = 7', '2x + 3 = 7', '2x = 4', 'x = 2'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="100%" height="100%" fill="white"/>${lines
    .map((l, i) => `<text x="60" y="${100 + i * 110}" font-family="Helvetica" font-size="48" fill="black">${l}</text>`)
    .join('')}</svg>`;
  pagePhoto = (await sharp(Buffer.from(svg)).jpeg().toBuffer()).toString('base64');
});

after(async () => {
  await srv?.stop();
  await new Promise((r) => fakeAi?.close(r));
});

async function api(method, path, { cookie, body } = {}) {
  const res = await fetch(`${srv.base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}

test('the whole make-up flow, owner-scoped, with no student name in the logs or the AI text', async () => {
  // ── Ralph sets up the course's make-up assignments ────────────────────────
  const dueAt = new Date(Date.now() - 3 * DAY + 60 * 60 * 1000).toISOString(); // 3 days late (part days round up) → cap P3
  const put = await api('PUT', '/api/my/makeup/courses/MATH110-04', { cookie: cookieA, body: { assignments: [{ name: 'Quiz 4', dueAt }] } });
  assert.equal(put.status, 200);
  const requestUrl = put.body.course.requestUrl;
  assert.match(requestUrl, /^http:\/\/localhost:5173\/makeup\/request\/[A-Za-z0-9_-]{20,}$/);
  const courseToken = requestUrl.split('/').pop();
  const assignmentId = put.body.course.assignments[0].id;

  // Another instructor cannot touch this course's settings.
  assert.equal((await api('PUT', '/api/my/makeup/courses/MATH110-04', { cookie: cookieB, body: { assignments: [] } })).status, 404);
  // Signed out → 401.
  assert.equal((await api('GET', '/api/my/makeup/summary')).status, 401);

  // ── The public request form ───────────────────────────────────────────────
  assert.equal((await api('GET', '/api/makeup/request/not-a-real-token-xxxx')).status, 404);
  const form = await api('GET', `/api/makeup/request/${courseToken}`);
  assert.equal(form.status, 200);
  assert.equal(form.body.courseCode, 'MATH110-04');
  assert.deepEqual(form.body.assignments, [{ id: assignmentId, name: 'Quiz 4' }]);

  const reqBody = { name: STUDENT.name, email: STUDENT.email, assignmentId, reasonCategory: 'medical', note: '' };
  const gmail = await api('POST', `/api/makeup/request/${courseToken}`, { body: { ...reqBody, email: 'jt@gmail.com' } });
  assert.equal(gmail.status, 400);
  assert.match(gmail.body.error, /ctstate\.edu or @usj\.edu/);
  assert.equal((await api('POST', `/api/makeup/request/${courseToken}`, { body: { ...reqBody, reasonCategory: 'bored' } })).status, 400);
  assert.equal((await api('POST', `/api/makeup/request/${courseToken}`, { body: reqBody })).status, 200);
  // A repeat merges into the same open request.
  assert.equal((await api('POST', `/api/makeup/request/${courseToken}`, { body: reqBody })).status, 200);
  assert.equal(await MakeupRequest.countDocuments({}), 1);

  // Name and email are encrypted at rest.
  const stored = await MakeupRequest.findOne({}).lean();
  assert.doesNotMatch(JSON.stringify(stored), /Jordan|Testperson|ctstate/i);
  assert.equal(String(stored.ownerId), String(ownerA._id));

  // ── Ralph's queue ─────────────────────────────────────────────────────────
  assert.deepEqual((await api('GET', '/api/my/makeup/summary', { cookie: cookieA })).body, { pending: 1, toReview: 0 });
  assert.deepEqual((await api('GET', '/api/my/makeup/summary', { cookie: cookieB })).body, { pending: 0, toReview: 0 });
  assert.deepEqual((await api('GET', '/api/my/makeup/requests', { cookie: cookieB })).body.requests, []);

  const queue = await api('GET', '/api/my/makeup/requests?status=pending', { cookie: cookieA });
  assert.equal(queue.body.requests.length, 1);
  const r1 = queue.body.requests[0];
  assert.equal(r1.name, STUDENT.name);
  assert.equal(r1.reasonCategory, 'medical');

  assert.equal((await api('POST', `/api/my/makeup/requests/${r1.id}/approve`, { cookie: cookieB })).status, 404);
  const approved = await api('POST', `/api/my/makeup/requests/${r1.id}/approve`, { cookie: cookieA, body: {} });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.emailSent, false); // wording not approved yet → nothing sent
  const link = approved.body.link;
  assert.match(link, /^http:\/\/localhost:5173\/makeup\/[A-Za-z0-9_-]{43}$/);
  const token = link.split('/').pop();
  assert.equal((await api('POST', `/api/my/makeup/requests/${r1.id}/approve`, { cookie: cookieA })).status, 409);
  const dbReq = await MakeupRequest.findById(r1.id).lean();
  assert.notEqual(dbReq.linkTokenHash, token); // only the hash is stored
  assert.ok(new Date(dbReq.linkExpiresAt) > new Date(Date.now() + 29 * DAY));

  // ── The student's personal link ───────────────────────────────────────────
  assert.equal((await api('GET', `/api/makeup/s/${'x'.repeat(43)}`)).status, 404);
  const page = await api('GET', `/api/makeup/s/${token}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.requestedAssignmentId, assignmentId);
  assert.deepEqual(page.body.submissions, []);

  const before = Date.now();
  const photo = await api('POST', `/api/makeup/s/${token}/photo`, { body: { assignmentId, images: [pagePhoto] } });
  assert.equal(photo.status, 200, JSON.stringify(photo.body));
  const sub = photo.body.submission;
  assert.match(sub.question, /^In the step where you wrote "(2x \+ 3 = 7|2x = 4|x = 2)", why did you do that\?$/);
  const shown = new Date(sub.questionShownAt).getTime();
  assert.ok(shown >= before && shown <= Date.now());
  assert.equal(new Date(sub.expiresAt).getTime() - shown, DAY); // 24h from display

  // The photo was redacted before it was stored or sent: the stored page differs
  // from the upload and the AI only ever got the stored (redacted) page.
  const storedPhoto = await MakeupPhoto.findOne({}).lean();
  assert.notEqual(storedPhoto.pages[0], pagePhoto);
  const aiImages = aiRequests.flatMap((r) => r.messages[0].content.filter((b) => b.type === 'image').map((b) => b.source.data));
  assert.ok(aiImages.length >= 2);
  for (const img of aiImages) assert.equal(img, storedPhoto.pages[0]);

  // A second photo can't re-roll the question.
  assert.equal((await api('POST', `/api/makeup/s/${token}/photo`, { body: { assignmentId, images: [pagePhoto] } })).status, 409);

  // ── The Loom ──────────────────────────────────────────────────────────────
  const badLoom = await api('POST', `/api/makeup/s/${token}/explain`, {
    body: { assignmentId, loomUrl: 'https://example.com/v', transcript: 'x'.repeat(100) },
  });
  assert.equal(badLoom.status, 400);
  const transcript = `Hi, I'm ${STUDENT.name}. First I subtract three from both sides to get 2x = 4, then I divide by two so x = 2. `
    + 'For the question, I subtracted three first because it undoes the plus three.';
  const explained = await api('POST', `/api/makeup/s/${token}/explain`, {
    body: { assignmentId, loomUrl: 'https://www.loom.com/share/abc123', transcript },
  });
  assert.equal(explained.status, 200);
  assert.equal(explained.body.submission.explained, true);

  // The review card is built in the background.
  let subs;
  for (let i = 0; i < 50; i++) {
    subs = (await api('GET', '/api/my/makeup/submissions', { cookie: cookieA })).body.submissions;
    if (subs[0]?.review?.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const card = subs[0];
  assert.equal(card.review.status, 'ready');
  assert.equal(card.review.aiLevel, 'P4');
  assert.equal(card.daysLate, 3);
  assert.equal(card.cap, 'P3');
  assert.equal(card.recommendedLevel, 'P3'); // min(P4, cap P3)
  assert.deepEqual(card.flags, ['possible_script_reading']);
  assert.equal(card.confirmedLevel, null); // nothing is confirmed by the AI
  assert.equal(card.loomUrl, 'https://www.loom.com/share/abc123');

  // The other instructor sees nothing and can't open or confirm it.
  assert.deepEqual((await api('GET', '/api/my/makeup/submissions', { cookie: cookieB })).body.submissions, []);
  assert.equal((await api('GET', `/api/my/makeup/submissions/${card.id}`, { cookie: cookieB })).status, 404);
  assert.equal((await api('POST', `/api/my/makeup/submissions/${card.id}/confirm`, { cookie: cookieB, body: { level: 'P1' } })).status, 404);

  // The transcript was stored, and sent to the AI, without the name.
  const full = await api('GET', `/api/my/makeup/submissions/${card.id}`, { cookie: cookieA });
  assert.match(full.body.submission.transcript, /^Hi, I'm \[STUDENT\]\./);
  assert.equal(full.body.submission.pages.length, 1);
  const aiText = JSON.stringify(aiRequests.map((r) => r.messages[0].content.filter((b) => b.type === 'text')));
  assert.doesNotMatch(aiText, /Jordan|Testperson|ctstate|loom\.com/i);

  // ── Exception lifts the cap; Ralph confirms ───────────────────────────────
  assert.equal((await api('POST', `/api/my/makeup/submissions/${card.id}/exception`, { cookie: cookieA, body: { exception: true } })).status, 400);
  const ex = await api('POST', `/api/my/makeup/submissions/${card.id}/exception`, { cookie: cookieA, body: { exception: true, reason: 'Doctor note on file' } });
  assert.equal(ex.body.submission.cap, null);
  assert.equal(ex.body.submission.recommendedLevel, 'P4');
  assert.equal(ex.body.submission.daysLate, 3);

  assert.equal((await api('POST', `/api/my/makeup/submissions/${card.id}/confirm`, { cookie: cookieA, body: { level: 'P5' } })).status, 400);
  const conf = await api('POST', `/api/my/makeup/submissions/${card.id}/confirm`, { cookie: cookieA, body: { level: 'P4' } });
  assert.equal(conf.body.submission.confirmedLevel, 'P4');

  // ── Blackboard rows ───────────────────────────────────────────────────────
  const exp = await api('GET', '/api/my/makeup/export?courseCode=MATH110-04&onlyNew=1', { cookie: cookieA });
  assert.equal(exp.body.rows.length, 1);
  assert.deepEqual(
    { level: exp.body.rows[0].level, points: exp.body.rows[0].points, email: exp.body.rows[0].studentEmail, first: exp.body.rows[0].firstName, last: exp.body.rows[0].lastName },
    { level: 'P4', points: 90, email: STUDENT.email, first: 'Jordan', last: 'Testperson' }
  );
  assert.deepEqual((await api('GET', '/api/my/makeup/export', { cookie: cookieB })).body.rows, []);
  assert.equal((await api('POST', '/api/my/makeup/export/mark', { cookie: cookieA, body: { ids: [card.id] } })).body.marked, 1);
  assert.equal((await api('GET', '/api/my/makeup/export?onlyNew=1', { cookie: cookieA })).body.rows.length, 0);

  // ── Revoke stops the link ─────────────────────────────────────────────────
  assert.equal((await api('POST', `/api/my/makeup/requests/${r1.id}/revoke`, { cookie: cookieA })).status, 200);
  assert.equal((await api('GET', `/api/makeup/s/${token}`)).status, 404);

  // ── Nothing identifying in the server's logs ──────────────────────────────
  const log = srv.log();
  assert.doesNotMatch(log, /Jordan|Testperson|ctstate\.edu|loom\.com|2x \+ 3/i);
  assert.match(log, /\[makeup\] email "approved" for request [0-9a-f]{24} not sent: templates awaiting approval/);

  // Cost records carry the owner and no student.
  const GradingEvent = require('./models/GradingEvent.js');
  const events = await GradingEvent.find({ recordedVia: /^makeup:/ }).lean();
  assert.deepEqual([...new Set(events.map((e) => e.recordedVia))].sort(), ['makeup:question', 'makeup:review', 'makeup:steps']);
  for (const e of events) assert.equal(String(e.ownerId), String(ownerA._id));
  assert.equal(await MakeupSubmission.countDocuments({ ownerId: ownerA._id }), 1);
});

test('denial: office-hours reply path, and a denied request has no link', async () => {
  const put = await api('PUT', '/api/my/makeup/courses/MATH200-01', {
    cookie: cookieB, body: { assignments: [{ name: 'Task 1', dueAt: new Date().toISOString() }] },
  });
  const courseToken = put.body.course.requestUrl.split('/').pop();
  const assignmentId = put.body.course.assignments[0].id;
  await api('POST', `/api/makeup/request/${courseToken}`, {
    body: { name: 'Sam Other', email: 'sam.other@usj.edu', assignmentId, reasonCategory: 'schedule_conflict' },
  });
  const [r] = (await api('GET', '/api/my/makeup/requests', { cookie: cookieB })).body.requests;
  const denied = await api('POST', `/api/my/makeup/requests/${r.id}/deny`, { cookie: cookieB });
  assert.equal(denied.status, 200);
  assert.equal(denied.body.request.status, 'denied');
  assert.equal(denied.body.request.linkLive, false);
  assert.equal((await api('POST', `/api/my/makeup/requests/${r.id}/new-link`, { cookie: cookieB })).status, 409);
  assert.match(srv.log(), /\[makeup\] email "denied" for request [0-9a-f]{24} not sent: templates awaiting approval/);
});
