// routes/makeupPublic.js
// DM3A Make-up — the two PUBLIC student pages' API. No hub sign-in; mounted at
// /api/makeup. (docs/makeup-module-spec.md §1, §3)
//
//   GET  /request/:courseToken         course code + make-up assignment list
//   POST /request/:courseToken         submit a request (school email only)
//   GET  /s/:token                     the personal link's state
//   POST /s/:token/photo               photo → redacted → one random question
//   POST /s/:token/explain             Loom link + transcript → review card
//
// The personal link token IS the credential: only its hash is stored, it expires
// with the approval, and the instructor can revoke it. Wrong/expired/revoked
// tokens all get the same 404.
//
// PRIVACY: no student name, email, work, question or transcript is ever logged.
// Photos are redacted on the server (lib/serverRedact.js, fail-closed) before
// they are stored or sent to the AI; the unredacted upload is never stored.

const express = require('express');
const mongoose = require('mongoose');
const sharp = require('sharp');
const { MakeupCourse, MakeupRequest, MakeupSubmission, MakeupPhoto } = require('../models/Makeup.js');
const Settings = require('../models/Settings.js');
const { DEFAULT_SETTINGS } = require('../models/Settings.js');
const rules = require('../lib/makeupRules.js');
const piiBox = require('../lib/piiBox.js');
const { overLimit, clientIp } = require('../lib/clients.js');
const { redactImageServer } = require('../lib/serverRedact.js');
const ai = require('../services/makeupAi.js');
const { sendStudentEmail } = require('../services/makeupEmails.js');

const router = express.Router();

const HUB_BASE_URL = () => String(process.env.HUB_BASE_URL || 'https://app.dm3agrader.com').replace(/\/+$/, '');
const personalLink = (raw) => `${HUB_BASE_URL()}/makeup/${raw}`;
const MAX_PAGES = 4;
const MAX_NOTE = 300;
const REDACT_BAND = Number(process.env.REDACT_BAND_FRACTION || 0.15);

const notFound = (res) => res.status(404).json({ error: 'This link is not valid or has expired.' });

// ── Request form ────────────────────────────────────────────────────────────
async function courseByToken(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return null;
  return MakeupCourse.findOne({ requestToken: t });
}

router.get('/request/:courseToken', async (req, res) => {
  try {
    const course = await courseByToken(req.params.courseToken);
    if (!course) return notFound(res);
    return res.json({
      courseCode: course.courseCode,
      assignments: course.assignments.map((a) => ({ id: String(a._id), name: a.name })),
      schoolDomains: rules.SCHOOL_DOMAINS,
    });
  } catch (err) {
    console.error('[makeup] request form load error:', err.message);
    return res.status(500).json({ error: 'Could not load the form.' });
  }
});

router.post('/request/:courseToken', async (req, res) => {
  try {
    if (!piiBox.configured()) return res.status(503).json({ error: 'Requests are not open yet. Please try again later.' });
    if (await overLimit(`mu-req-ip:${clientIp(req)}`, 10, 3600)) {
      return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' });
    }
    const course = await courseByToken(req.params.courseToken);
    if (!course) return notFound(res);

    const b = req.body || {};
    const name = String(b.name || '').trim().replace(/\s+/g, ' ');
    const email = rules.normEmail(b.email);
    const note = String(b.note || '').trim().slice(0, MAX_NOTE);
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Please enter your full name.' });
    if (!rules.isSchoolEmail(email)) {
      return res.status(400).json({ error: 'Please use your school email (@ctstate.edu or @usj.edu).' });
    }
    if (!rules.REASONS.includes(b.reasonCategory)) return res.status(400).json({ error: 'Please choose a reason.' });
    const assignment = course.assignments.id(String(b.assignmentId || ''));
    if (!assignment) return res.status(400).json({ error: 'Please choose the assignment.' });

    const hash = rules.emailHash(email);
    if (await overLimit(`mu-req-em:${hash}`, 5, 3600)) {
      return res.status(429).json({ error: 'Too many requests. Please try again in an hour.' });
    }

    const contact = piiBox.seal({ name, email, note });
    // One open request per student + assignment: a repeat updates it.
    const existing = await MakeupRequest.findOne({
      ownerId: course.ownerId, makeupCourseId: course._id, assignmentId: assignment._id, emailHash: hash, status: 'pending',
    });
    if (existing) {
      existing.contact = contact;
      existing.reasonCategory = b.reasonCategory;
      await existing.save();
    } else {
      await MakeupRequest.create({
        ownerId: course.ownerId,
        makeupCourseId: course._id,
        courseCode: course.courseCode,
        assignmentId: assignment._id,
        assignmentName: assignment.name,
        reasonCategory: b.reasonCategory,
        contact,
        emailHash: hash,
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[makeup] request submit error:', err.message);
    return res.status(500).json({ error: 'Could not send your request. Please try again.' });
  }
});

// ── Personal link ───────────────────────────────────────────────────────────
// → { request, course } for a live link, else null.
async function liveLink(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(t)) return null;
  const request = await MakeupRequest.findOne({ linkTokenHash: rules.hashToken(t), status: 'approved' });
  if (!request || request.revokedAt || !request.linkExpiresAt || request.linkExpiresAt <= new Date()) return null;
  const course = await MakeupCourse.findOne({ _id: request.makeupCourseId, ownerId: request.ownerId });
  return course ? { request, course } : null;
}

function studentView(sub) {
  if (!sub) return null;
  return {
    assignmentId: String(sub.assignmentId),
    assignmentName: sub.assignmentName,
    photoReceived: !!sub.photoReceivedAt,
    needsBetterPhoto: !sub.question && (sub.storedFlags || []).includes('unreadable_work'),
    question: sub.question || null,
    questionShownAt: sub.questionShownAt,
    expiresAt: sub.expiresAt,
    explained: !!sub.transcriptReceivedAt,
  };
}

router.get('/s/:token', async (req, res) => {
  try {
    const live = await liveLink(req.params.token);
    if (!live) return notFound(res);
    const subs = await MakeupSubmission.find({ requestId: live.request._id, ownerId: live.request.ownerId });
    return res.json({
      courseCode: live.course.courseCode,
      linkExpiresAt: live.request.linkExpiresAt,
      requestedAssignmentId: String(live.request.assignmentId),
      assignments: live.course.assignments.map((a) => ({ id: String(a._id), name: a.name })),
      submissions: subs.map(studentView),
    });
  } catch (err) {
    console.error('[makeup] link load error:', err.message);
    return res.status(500).json({ error: 'Could not load your page.' });
  }
});

async function latePolicyFor(ownerId) {
  const s = await Settings.findOne({ ownerId }).lean();
  return (s && s.latePolicy) || DEFAULT_SETTINGS.latePolicy;
}

// base64 (any common image) → upright JPEG, longest edge ≤ 2000px.
async function normalizePage(b64) {
  const raw = Buffer.from(String(b64 || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (raw.length < 1000 || raw.length > 15 * 1024 * 1024) throw Object.assign(new Error('bad size'), { userError: true });
  try {
    const out = await sharp(raw).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return out.toString('base64');
  } catch {
    throw Object.assign(new Error('not an image'), { userError: true });
  }
}

router.post('/s/:token/photo', async (req, res) => {
  try {
    if (await overLimit(`mu-photo:${clientIp(req)}`, 20, 3600)) {
      return res.status(429).json({ error: 'Too many uploads. Please try again in an hour.' });
    }
    const live = await liveLink(req.params.token);
    if (!live) return notFound(res);
    const { request, course } = live;
    const assignment = course.assignments.id(String(req.body?.assignmentId || ''));
    if (!assignment) return res.status(400).json({ error: 'Please choose the assignment.' });
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length || images.length > MAX_PAGES) {
      return res.status(400).json({ error: `Please upload 1 to ${MAX_PAGES} photos of your work.` });
    }

    let sub = await MakeupSubmission.findOne({ requestId: request._id, assignmentId: assignment._id, ownerId: request.ownerId });
    if (sub && sub.question) return res.status(409).json({ error: 'Your question is already set.', submission: studentView(sub) });

    // 1. Normalize, then REDACT (fail closed) before anything is stored or sent.
    let pages;
    try {
      const normalized = [];
      for (const b of images) normalized.push(await normalizePage(b));
      pages = [];
      for (let i = 0; i < normalized.length; i++) {
        const r = await redactImageServer(normalized[i], { positionalBand: i === 0 ? REDACT_BAND : 0 });
        pages.push(r.base64);
      }
    } catch (err) {
      console.error(`[makeup] photo redaction failed (fail-closed) for request ${request._id}:`, err.message);
      return res.status(422).json({
        error: err.userError
          ? 'That file is not a photo we can read. Please upload a JPG or PNG photo of your work.'
          : 'We could not check your photo. Please retake it flat, in good light, with the whole page showing, and try again.',
      });
    }

    // 2. Store the redacted photo; days late count from the FIRST upload.
    const now = new Date();
    if (!sub) {
      sub = new MakeupSubmission({
        ownerId: request.ownerId,
        requestId: request._id,
        courseCode: course.courseCode,
        assignmentId: assignment._id,
        assignmentName: assignment.name,
        dueAt: assignment.dueAt,
      });
    }
    if (!sub.photoReceivedAt) sub.photoReceivedAt = now;
    sub.photoPages = pages.length;
    const late = rules.lateCap({
      dueAt: sub.dueAt, receivedAt: sub.photoReceivedAt, latePolicy: await latePolicyFor(request.ownerId), exception: sub.exception,
    });
    Object.assign(sub, { daysLate: late.daysLate, cap: late.cap, capReason: late.capReason });
    await sub.save();
    await MakeupPhoto.findOneAndUpdate(
      { submissionId: sub._id, ownerId: request.ownerId },
      { $set: { pages } },
      { upsert: true, setDefaultsOnInsert: true }
    );

    // 3. The steps the student wrote. Unreadable → flag, never guess.
    const read = await ai.readSteps({ ownerId: request.ownerId, pages });
    const pick = read.readable ? rules.pickQuestion(read.steps) : null;
    if (!pick) {
      sub.storedFlags = [...new Set([...(sub.storedFlags || []), 'unreadable_work'])];
      sub.steps = read.steps.map(({ id, problem, text }) => ({ id, problem, text }));
      await sub.save();
      console.log(`[makeup] submission ${sub._id}: work not readable, flagged`);
      return res.json({ submission: studentView(sub) });
    }

    // 4. One question about that step; the name check runs before it is shown.
    const { name, email } = piiBox.open(request.contact);
    let question = await ai.writeQuestion({ ownerId: request.ownerId, pages, step: pick.step, type: pick.type });
    question = rules.redactName(question, name).text;

    const shownAt = new Date();
    const { expiresAt } = rules.deadlines(shownAt);
    Object.assign(sub, {
      steps: read.steps.map(({ id, problem, text }) => ({ id, problem, text })),
      question,
      questionStep: pick.step.text,
      questionType: pick.type.key,
      questionShownAt: shownAt,
      expiresAt,
      storedFlags: (sub.storedFlags || []).filter((f) => f !== 'unreadable_work'),
    });
    await sub.save();
    console.log(`[makeup] submission ${sub._id}: question issued (${read.steps.length} steps read)`);

    const result = await sendStudentEmail('question', {
      to: email,
      requestId: String(request._id),
      firstName: rules.firstName(name),
      course: course.courseCode,
      assignment: assignment.name,
      question,
      expiresAt,
      link: personalLink(req.params.token),
    });
    request.emails.push({ kind: 'question', at: new Date(), ok: result.sent });
    await request.save();

    return res.json({ submission: studentView(sub) });
  } catch (err) {
    console.error('[makeup] photo error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

async function runReview(subId) {
  const sub = await MakeupSubmission.findById(subId);
  if (!sub) return;
  try {
    const photo = await MakeupPhoto.findOne({ submissionId: sub._id, ownerId: sub.ownerId }).lean();
    const card = await ai.reviewCard({
      ownerId: sub.ownerId, pages: (photo && photo.pages) || [], question: sub.question, transcript: sub.transcript,
    });
    const flags = new Set((sub.storedFlags || []).filter((f) => !['possible_script_reading', 'question_not_answered', 'unclear_answer'].includes(f)));
    if (card.scriptSigns.length) flags.add('possible_script_reading');
    if (card.answerStatus === 'not_answered') flags.add('question_not_answered');
    if (card.answerStatus === 'unclear') flags.add('unclear_answer');
    sub.review = { status: 'ready', ...card, at: new Date() };
    sub.recommendedLevel = rules.recommendLevel(card.aiLevel, sub.exception ? null : sub.cap);
    sub.storedFlags = [...flags];
    await sub.save();
    console.log(`[makeup] submission ${sub._id}: review card ready`);
  } catch (err) {
    console.error(`[makeup] submission ${sub._id}: review failed:`, err.message);
    sub.review = { ...(sub.review?.toObject?.() || {}), status: 'failed', at: new Date() };
    await sub.save().catch(() => {});
  }
}

router.post('/s/:token/explain', async (req, res) => {
  try {
    const live = await liveLink(req.params.token);
    if (!live) return notFound(res);
    const { request } = live;
    const sub = await MakeupSubmission.findOne({
      requestId: request._id, ownerId: request.ownerId, assignmentId: mongoose.isValidObjectId(req.body?.assignmentId) ? req.body.assignmentId : null,
    });
    if (!sub || !sub.question) return res.status(400).json({ error: 'Upload your photo first.' });
    if (sub.transcriptReceivedAt) return res.status(409).json({ error: 'You already sent your video.', submission: studentView(sub) });

    const loomUrl = String(req.body?.loomUrl || '').trim();
    const transcript = String(req.body?.transcript || '').trim();
    if (!rules.isLoomUrl(loomUrl)) return res.status(400).json({ error: 'Please paste your Loom share link (it starts with https://www.loom.com/).' });
    if (transcript.length < 40) return res.status(400).json({ error: 'Please paste the full Loom transcript.' });
    if (transcript.length > 50000) return res.status(400).json({ error: 'That transcript is too long. Please paste only this video\'s transcript.' });

    const { name } = piiBox.open(request.contact);
    sub.loomUrl = loomUrl;
    sub.transcript = rules.redactName(transcript, name).text;
    sub.transcriptReceivedAt = new Date();
    sub.review = { status: 'pending' };
    await sub.save();
    console.log(`[makeup] submission ${sub._id}: video received`);

    setImmediate(() => runReview(sub._id));
    return res.json({ submission: studentView(sub) });
  } catch (err) {
    console.error('[makeup] explain error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
module.exports.runReview = runReview;
module.exports.personalLink = personalLink;
