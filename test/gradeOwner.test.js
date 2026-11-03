// /grade sends the sign-in cookie now (App.jsx `credentials: "include"`) so the
// cost record gets the instructor's owner id. This proves that is ALL it does:
// the grade returned, and the request sent to the AI, are byte-identical whether
// the caller is signed out, signed in, or holding a forged cookie.
//
// The real server runs against a fake Anthropic API on localhost
// (ANTHROPIC_BASE_URL), so no real model is called and no tokens are spent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startRealServer, serverRequire as require, sessionCookie } from './helpers/realServer.js';

const User = require('./models/User.js');
const GradingEvent = require('./models/GradingEvent.js');

const GRADED = [{
  studentName: 'M110-7F3K',
  overallTier: 'P3',
  dimensions: { conceptualUnderstanding: 3, problemSolving: 3, workShown: 3, accuracy: 3 },
  problems: [],
  strengths: ['Clear steps'],
  growthAreas: [],
  feedback: 'Solid work.',
}];

let fakeAi;
const aiRequests = [];
let srv;
let owner;

before(async () => {
  fakeAi = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      aiRequests.push({ url: req.url, body: JSON.parse(body) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: JSON.stringify(GRADED) }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 300 },
      }));
    });
  });
  await new Promise((r) => fakeAi.listen(0, '127.0.0.1', r));
  const aiBase = `http://127.0.0.1:${fakeAi.address().port}`;

  srv = await startRealServer({ ANTHROPIC_BASE_URL: aiBase, ANTHROPIC_API_KEY: 'test-key' });
  owner = await User.create({ email: 'grader@inst.edu', passwordHash: 'x' });
});

after(async () => {
  await srv?.stop();
  await new Promise((r) => fakeAi?.close(r));
});

const gradeBody = {
  contentBlocks: [{ type: 'text', text: 'Problem 1: 2x + 3 = 7, so x = 2.' }],
  systemPrompt: 'Grade with the DM3A rubric.',
  userPrompt: 'Return JSON.',
};

async function grade(cookie) {
  const res = await fetch(`${srv.base}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(gradeBody),
  });
  return { status: res.status, body: await res.text() };
}

test('grading is identical signed out, signed in, and with a forged cookie; only the cost-record owner differs', async () => {
  const signedOut = await grade(null);
  const signedIn = await grade(sessionCookie(owner));
  const forged = await grade(sessionCookie(owner, 'not-the-real-secret'));

  // 1. Same grade back, byte for byte.
  assert.equal(signedOut.status, 200);
  assert.equal(signedIn.body, signedOut.body);
  assert.equal(forged.body, signedOut.body);
  assert.deepEqual(JSON.parse(JSON.parse(signedIn.body).result), GRADED);

  // 2. Same request to the AI: model, temperature, prompt and student work.
  assert.equal(aiRequests.length, 3);
  assert.deepEqual(aiRequests[1].body, aiRequests[0].body);
  assert.deepEqual(aiRequests[2].body, aiRequests[0].body);

  // 3. Cost records: owner only for the genuine session. Written after the
  //    response (fire-and-forget), so wait for all three.
  let events = [];
  for (let i = 0; i < 50 && events.length < 3; i++) {
    events = await GradingEvent.find({}).sort({ createdAt: 1, _id: 1 }).lean();
    if (events.length < 3) await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => (e.ownerId ? String(e.ownerId) : null)), [null, String(owner._id), null]);
  for (const e of events) {
    assert.equal(e.submissionCount, 1);
    assert.equal(e.apiUsage.inputTokens, 1200);
  }
});
