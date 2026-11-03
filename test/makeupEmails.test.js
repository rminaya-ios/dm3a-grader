// The three automatic student emails (server/services/makeupEmails.js), wording
// approved by Ralph 2026-11-03. Rendering only — nothing is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverRequire as require } from './helpers/realServer.js';

const { render, TEMPLATES_APPROVED } = require('./services/makeupEmails.js');
const base = { firstName: 'Pat', course: 'MATH110-04', assignment: 'Quiz 4' };
const link = 'https://app.dm3agrader.com/makeup/abc123';

test('the approved wording is switched on', () => {
  assert.equal(TEMPLATES_APPROVED, true);
});

test('approved: subject, link, end date, the five steps', () => {
  const m = render('approved', { ...base, link, endDate: new Date('2026-12-03T15:00:00Z') });
  assert.equal(m.subject, 'Video make-up approved — MATH110-04 Quiz 4');
  assert.match(m.text, /^Hi Pat,/);
  assert.match(m.text, /Your personal link: https:\/\/app\.dm3agrader\.com\/makeup\/abc123/);
  assert.match(m.text, /expires on Thursday, December 3\./);
  assert.match(m.text, /You have 24 hours to answer it\./);
  assert.match(m.text, /At the end, answer the question\./);
  assert.match(m.text, /— Dr\. Ralph Minaya$/);
  assert.doesNotMatch(m.text, /\*\*/);
  assert.match(m.html, /<a href="https:\/\/app\.dm3agrader\.com\/makeup\/abc123">/);
});

test('denied: points to office hours MWF 11–12', () => {
  const m = render('denied', base);
  assert.equal(m.subject, 'Your make-up request — MATH110-04 Quiz 4');
  assert.match(m.text, /office hours, Monday, Wednesday and Friday, 11:00 AM–12:00 PM/);
});

test('question: the question, the deadline in New York time, the link; HTML is escaped', () => {
  const m = render('question', { ...base, link, question: 'Why <b>"2x = 4"</b>?', expiresAt: new Date('2026-11-04T15:23:00Z') });
  assert.equal(m.subject, 'Your make-up question — MATH110-04 Quiz 4');
  assert.match(m.text, /Why <b>"2x = 4"<\/b>\?/);
  assert.match(m.text, /You have until Wednesday, November 4 at 10:23 AM EST/);
  assert.match(m.html, /Why &lt;b&gt;&quot;2x = 4&quot;&lt;\/b&gt;\?/);
});
