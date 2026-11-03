// Make-up module — the pure rules (server/lib/makeupRules.js) and the at-rest
// encryption (server/lib/piiBox.js). docs/makeup-module-spec.md §4–§6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { serverRequire as require } from './helpers/realServer.js';

const rules = require('./lib/makeupRules.js');
const piiBox = require('./lib/piiBox.js');

const DAY = 24 * 60 * 60 * 1000;
const POLICY = { windows: [{ maxDaysLate: 7, capLevel: 'P3' }, { maxDaysLate: 14, capLevel: 'P2' }], beyond: 'instructor_review' };
const due = new Date('2026-11-02T04:59:00Z');
const at = (days) => new Date(due.getTime() + days * DAY);

test('school email: only @ctstate.edu and @usj.edu', () => {
  assert.equal(rules.isSchoolEmail('Student.One@CTState.edu '), true);
  assert.equal(rules.isSchoolEmail('s1@usj.edu'), true);
  assert.equal(rules.isSchoolEmail('s1@gmail.com'), false);
  assert.equal(rules.isSchoolEmail('s1@ctstate.edu.evil.com'), false);
  assert.equal(rules.isSchoolEmail('s1@mail.ctstate.edu'), false);
  assert.equal(rules.isSchoolEmail('not an email'), false);
});

test('days late are whole days rounded up, 0 when on time', () => {
  assert.equal(rules.daysLate(due, at(-1)), 0);
  assert.equal(rules.daysLate(due, due), 0);
  assert.equal(rules.daysLate(due, new Date(due.getTime() + 60_000)), 1);
  assert.equal(rules.daysLate(due, at(7)), 7);
  assert.equal(rules.daysLate(due, at(7.01)), 8);
});

test('late caps: ≤1 week → P3, ≤2 weeks → P2, beyond → instructor review', () => {
  assert.deepEqual(rules.lateCap({ dueAt: due, receivedAt: at(-0.5), latePolicy: POLICY }).cap, null);
  assert.equal(rules.lateCap({ dueAt: due, receivedAt: at(1), latePolicy: POLICY }).cap, 'P3');
  assert.equal(rules.lateCap({ dueAt: due, receivedAt: at(7), latePolicy: POLICY }).cap, 'P3');
  assert.equal(rules.lateCap({ dueAt: due, receivedAt: at(8), latePolicy: POLICY }).cap, 'P2');
  assert.equal(rules.lateCap({ dueAt: due, receivedAt: at(14), latePolicy: POLICY }).cap, 'P2');
  assert.equal(rules.lateCap({ dueAt: due, receivedAt: at(15), latePolicy: POLICY }).cap, 'instructor_review');
});

test('a documented exception lifts the cap but keeps the days late', () => {
  const r = rules.lateCap({ dueAt: due, receivedAt: at(10), latePolicy: POLICY, exception: true });
  assert.equal(r.cap, null);
  assert.equal(r.daysLate, 10);
  assert.match(r.capReason, /exception/);
});

test('recommended level = min(AI level, cap); review/none caps leave the AI level', () => {
  assert.equal(rules.recommendLevel('P4', 'P3'), 'P3');
  assert.equal(rules.recommendLevel('P2', 'P3'), 'P2');
  assert.equal(rules.recommendLevel('P4', null), 'P4');
  assert.equal(rules.recommendLevel('P4', 'instructor_review'), 'P4');
  assert.equal(rules.recommendLevel(null, 'P3'), null);
});

test('question deadlines: 24h from display, missing flag 48h after that', () => {
  const shown = new Date('2026-11-03T15:00:00Z');
  const d = rules.deadlines(shown);
  assert.equal(d.expiresAt.toISOString(), '2026-11-04T15:00:00.000Z');
  assert.equal(d.missingAt.toISOString(), '2026-11-06T15:00:00.000Z');
});

test('flags: expired answer, missing answer at +48h, beyond-policy; stored flags kept', () => {
  const shown = new Date('2026-11-03T15:00:00Z');
  const { expiresAt } = rules.deadlines(shown);
  const base = { expiresAt, storedFlags: ['possible_script_reading'] };

  assert.deepEqual(rules.reviewFlags({ ...base, transcriptReceivedAt: new Date('2026-11-04T10:00:00Z') }), ['possible_script_reading']);
  assert.deepEqual(
    rules.reviewFlags({ ...base, transcriptReceivedAt: new Date('2026-11-04T16:00:00Z') }),
    ['expired_answer', 'possible_script_reading']
  );
  // No transcript: nothing until 48h after expiry, then missing_answer.
  assert.deepEqual(rules.reviewFlags(base, new Date('2026-11-06T14:59:00Z')), ['possible_script_reading']);
  assert.deepEqual(rules.reviewFlags(base, new Date('2026-11-06T15:00:00Z')), ['missing_answer', 'possible_script_reading']);
  assert.deepEqual(rules.reviewFlags({ cap: 'instructor_review' }), ['late_beyond_policy']);
});

test('pickQuestion picks only readable steps the student wrote, and varies step and type', () => {
  const steps = [
    { id: '1', text: '2x + 3 = 7' },
    { id: '2', text: '2x = 4' },
    { id: '3', text: '??', readable: false },
    { id: '4', text: 'x = 2' },
  ];
  const seenSteps = new Set();
  const seenTypes = new Set();
  for (let i = 0; i < 300; i++) {
    const p = rules.pickQuestion(steps);
    assert.notEqual(p.step.id, '3');
    seenSteps.add(p.step.id);
    seenTypes.add(p.type.key);
  }
  assert.deepEqual([...seenSteps].sort(), ['1', '2', '4']);
  assert.deepEqual([...seenTypes].sort(), ['check', 'what_if', 'why']);
  assert.equal(rules.pickQuestion([]), null);
  assert.equal(rules.pickQuestion([{ text: '?', readable: false }]), null);
});

test('a question must quote the chosen step', () => {
  const step = { text: '2x = 4' };
  assert.equal(rules.questionIsOnStep('In the step where you wrote "2x = 4", why did you divide by 2?', step), true);
  assert.equal(rules.questionIsOnStep('In the step "2x=4" why divide?', step), true);
  assert.equal(rules.questionIsOnStep('Solve 3x + 1 = 10. What is x?', step), false);
});

test('transcript name removal: full name, parts, "Last, First", Name: lines; short names only when capitalised', () => {
  const t = 'Hi, my name is Jordan Testperson. Name: J. Testperson\nTestperson, Jordan here. jordan again.';
  const r = rules.redactName(t, 'Jordan Testperson');
  assert.doesNotMatch(r.text, /jordan|testperson/i);
  assert.ok(r.replacements >= 4);

  const short = rules.redactName('An answer is an idea. An Li wrote it, li', 'An Li');
  assert.equal(short.text, '[STUDENT] answer is an idea. [STUDENT] wrote it, li');
});

test('Loom link: format check only', () => {
  assert.equal(rules.isLoomUrl('https://www.loom.com/share/abc123'), true);
  assert.equal(rules.isLoomUrl('https://loom.com/share/abc'), true);
  assert.equal(rules.isLoomUrl('http://www.loom.com/share/abc'), false);
  assert.equal(rules.isLoomUrl('https://loom.com.evil.com/share/abc'), false);
  assert.equal(rules.isLoomUrl('javascript:alert(1)'), false);
});

test('tokens: long, url-safe, and only the hash is stable', () => {
  const t = rules.newToken();
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rules.newToken(), t);
  assert.equal(rules.hashToken(t), rules.hashToken(t));
  assert.notEqual(rules.hashToken(t), t);
});

test('piiBox seals and opens; fails closed without a key; detects tampering', () => {
  const prev = process.env.MAKEUP_PII_KEY;
  try {
    delete process.env.MAKEUP_PII_KEY;
    assert.equal(piiBox.configured(), false);
    assert.throws(() => piiBox.seal({ a: 1 }));

    process.env.MAKEUP_PII_KEY = crypto.randomBytes(32).toString('base64');
    const v = { name: 'Jordan Testperson', email: 'jt@ctstate.edu' };
    const boxed = piiBox.seal(v);
    assert.doesNotMatch(boxed, /Jordan|ctstate/);
    assert.deepEqual(piiBox.open(boxed), v);

    const parts = boxed.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'B' : 'A') + parts[3].slice(-1);
    assert.throws(() => piiBox.open(parts.join('.')));
  } finally {
    if (prev === undefined) delete process.env.MAKEUP_PII_KEY;
    else process.env.MAKEUP_PII_KEY = prev;
  }
});
