// lib/makeupRules.js
// DM3A Make-up — the pure rules (docs/makeup-module-spec.md). No database, no
// Express, no network, so every rule is unit-tested on its own
// (test/makeupRules.test.js).
//
//   lateCap          due date + photo arrival + Settings.latePolicy → cap
//   recommendLevel   min(AI level, cap), unless a documented exception lifts it
//   deadlines        question shown → expiresAt (24h) and missingAt (+48h)
//   reviewFlags      the flags a submission carries right now
//   pickQuestion     the server (not the AI) picks the step and question type
//   redactName       removes one student's name from a transcript
//
// None of these ever lowers a level on its own: flags only put a submission in
// front of the instructor.

const crypto = require('crypto');

const LEVELS = ['P1', 'P2', 'P3', 'P4'];
const REASONS = ['schedule_conflict', 'medical', 'other'];
const SCHOOL_DOMAINS = ['ctstate.edu', 'usj.edu'];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const QUESTION_WINDOW_MS = 24 * HOUR;
const MISSING_AFTER_MS = 48 * HOUR; // after the question expires

// The question types the server rotates through. The AI phrases the question;
// it never chooses the type or the step.
const QUESTION_TYPES = [
  { key: 'why', label: 'Why did you do this step?' },
  { key: 'what_if', label: 'What would change if something in this step were different?' },
  { key: 'check', label: 'How could you check this step is right?' },
];

// ── Request form ────────────────────────────────────────────────────────────
function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function isSchoolEmail(email) {
  const e = normEmail(email);
  const m = /^[^\s@]+@([^\s@]+)$/.exec(e);
  return !!m && SCHOOL_DOMAINS.includes(m[1]);
}

// Hash used to find duplicates and rate-limit without storing the address in
// clear. Not a secret: it only has to be stable.
function emailHash(email) {
  return crypto.createHash('sha256').update('dm3a-makeup:' + normEmail(email)).digest('hex');
}

// ── Personal-link tokens ────────────────────────────────────────────────────
// The raw token goes in the student's link; only its hash is stored.
function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

// ── Late policy ─────────────────────────────────────────────────────────────
// Whole days late, rounded UP (one minute late is one day late). 0 when on time.
function daysLate(dueAt, receivedAt) {
  const due = new Date(dueAt).getTime();
  const got = new Date(receivedAt).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(got) || got <= due) return 0;
  return Math.ceil((got - due) / DAY);
}

// → { daysLate, cap, capReason }. cap is a level, 'instructor_review' or null
// (on time, no cap). `exception` lifts the cap but the days are still recorded.
function lateCap({ dueAt, receivedAt, latePolicy, exception = false }) {
  const d = daysLate(dueAt, receivedAt);
  if (d === 0) return { daysLate: 0, cap: null, capReason: 'On time.' };
  if (exception) return { daysLate: d, cap: null, capReason: `${d} day(s) late; documented exception, cap lifted.` };
  const windows = [...((latePolicy && latePolicy.windows) || [])].sort((a, b) => a.maxDaysLate - b.maxDaysLate);
  for (const w of windows) {
    if (d <= w.maxDaysLate) return { daysLate: d, cap: w.capLevel, capReason: `${d} day(s) late; at most ${w.capLevel}.` };
  }
  const beyond = (latePolicy && latePolicy.beyond) || 'instructor_review';
  if (beyond === 'instructor_review') {
    return { daysLate: d, cap: 'instructor_review', capReason: `${d} day(s) late; beyond the late windows, needs your review.` };
  }
  return { daysLate: d, cap: beyond, capReason: `${d} day(s) late; at most ${beyond}.` };
}

// min(AI level, cap). A cap of 'instructor_review' or null leaves the AI level
// as the draft (the review flag is what brings it to the instructor).
function recommendLevel(aiLevel, cap) {
  if (!LEVELS.includes(aiLevel)) return null;
  if (!LEVELS.includes(cap)) return aiLevel;
  return LEVELS.indexOf(aiLevel) <= LEVELS.indexOf(cap) ? aiLevel : cap;
}

// ── The 24-hour question ────────────────────────────────────────────────────
function deadlines(shownAt) {
  const t = new Date(shownAt).getTime();
  return { expiresAt: new Date(t + QUESTION_WINDOW_MS), missingAt: new Date(t + QUESTION_WINDOW_MS + MISSING_AFTER_MS) };
}

// The flags a submission carries at `now`. Stored flags (set when something
// happened, e.g. the AI saw signs of script reading) are kept; the time-based
// ones are derived here so they appear on time without a background job.
function reviewFlags(sub, now = new Date()) {
  const flags = new Set(sub.storedFlags || []);
  const t = new Date(now).getTime();
  if (sub.expiresAt && sub.transcriptReceivedAt && new Date(sub.transcriptReceivedAt) > new Date(sub.expiresAt)) {
    flags.add('expired_answer');
  }
  if (sub.expiresAt && !sub.transcriptReceivedAt && t >= new Date(sub.expiresAt).getTime() + MISSING_AFTER_MS) {
    flags.add('missing_answer');
  }
  if (sub.cap === 'instructor_review') flags.add('late_beyond_policy');
  return [...flags].sort();
}

// The server picks a step the student actually wrote, and a question type, at
// random. `steps` comes from the AI's transcription of the photo. rng is
// injectable for tests. → { step, type } or null when nothing is usable.
function pickQuestion(steps, rng = Math.random) {
  const usable = (Array.isArray(steps) ? steps : []).filter(
    (s) => s && typeof s.text === 'string' && s.text.trim().length >= 3 && s.readable !== false
  );
  if (!usable.length) return null;
  const step = usable[Math.floor(rng() * usable.length) % usable.length];
  const type = QUESTION_TYPES[Math.floor(rng() * QUESTION_TYPES.length) % QUESTION_TYPES.length];
  return { step, type };
}

// The AI's question must stay on the chosen step: it has to quote that step's
// own text (the server compares, ignoring spacing/case) and must not introduce
// a new problem. → true when acceptable.
function questionIsOnStep(question, step) {
  const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
  const q = String(question || '').trim();
  if (q.length < 10 || q.length > 400) return false;
  return !!step && squash(q).includes(squash(step.quote || step.text));
}

// ── Transcript name removal (ported from src/blind/textRedact.js) ────────────
// The server never sees the roster vault; for a make-up it knows exactly one
// name — the one the student typed on the request — so it removes that.
const SHORT_NAME_MAX = 3;
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_LABEL_LINE = /^([ \t]*(?:student[ \t]+)?(?:name|nombre)s?[ \t]*:[ \t]*)(.*)$/gim;

function nameParts(fullName) {
  const whole = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!whole) return [];
  if (whole.includes(',')) {
    const [l, f] = whole.split(',');
    return [String(f || '').trim(), String(l || '').trim()].filter(Boolean);
  }
  return whole.split(' ').filter(Boolean);
}

// → { text, replacements }. Never returns or logs the name itself.
function redactName(text, fullName, replacement = '[STUDENT]') {
  let out = String(text || '');
  let replacements = 0;
  out = out.replace(NAME_LABEL_LINE, (whole, label, value) => {
    if (!String(value).trim()) return whole;
    replacements++;
    return `${label}${replacement}`;
  });
  const parts = nameParts(fullName);
  const patterns = [];
  if (parts.length >= 2) {
    const f = escapeRe(parts[0]);
    const l = escapeRe(parts[parts.length - 1]);
    patterns.push(new RegExp(`\\b${f}(?:\\s+[A-Za-z]\\.?)*\\s+${l}\\b`, 'gi'));
    patterns.push(new RegExp(`\\b${l}\\s*,\\s*${f}\\b`, 'gi'));
  }
  // Longest single parts first; short parts (≤3 letters) only when capitalised,
  // so a name like "An" can't wipe out the English word "an".
  for (const p of [...parts].sort((a, b) => b.length - a.length)) {
    patterns.push(new RegExp(`\\b${escapeRe(p)}\\b`, p.length <= SHORT_NAME_MAX ? 'g' : 'gi'));
  }
  for (const re of patterns) {
    out = out.replace(re, () => {
      replacements++;
      return replacement;
    });
  }
  return { text: out, replacements };
}

// ── Loom link ───────────────────────────────────────────────────────────────
// Format check only. The link is stored for the instructor's eyes; code never
// opens, fetches or previews it.
function isLoomUrl(u) {
  try {
    const url = new URL(String(u || '').trim());
    return url.protocol === 'https:' && /(^|\.)loom\.com$/i.test(url.hostname) && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function firstName(fullName) {
  return nameParts(fullName)[0] || '';
}

module.exports = {
  LEVELS,
  REASONS,
  SCHOOL_DOMAINS,
  QUESTION_TYPES,
  QUESTION_WINDOW_MS,
  MISSING_AFTER_MS,
  normEmail,
  isSchoolEmail,
  emailHash,
  newToken,
  hashToken,
  daysLate,
  lateCap,
  recommendLevel,
  deadlines,
  reviewFlags,
  pickQuestion,
  questionIsOnStep,
  redactName,
  isLoomUrl,
  firstName,
};
