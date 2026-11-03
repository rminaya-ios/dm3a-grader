// routes/makeup.js
// DM3A Make-up — the instructor's side. Mounted at /api/my/makeup, signed in,
// every query scoped to the caller (lib/owner.js); another owner's record is a 404.
// (docs/makeup-module-spec.md §2, §5–§7)
//
//   GET  /summary                      pending-request count (the tile badge)
//   GET  /courses                      courses + request link + assignments
//   PUT  /courses/:courseCode          set the make-up assignments and due dates
//   GET  /requests?status=             the queue (names shown to the owner only)
//   POST /requests/:id/approve         { endDate? } → personal link (+ email)
//   POST /requests/:id/deny            → office-hours reply (email)
//   POST /requests/:id/new-link        replace a lost link (old one stops working)
//   POST /requests/:id/revoke          stop the link now
//   DELETE /requests/:id               remove the request and its submissions
//                                      (e.g. the instructor's own test record)
//   GET  /submissions                  review list with cards and flags
//   GET  /submissions/:id              one submission (+ photo pages, transcript)
//   POST /submissions/:id/exception    { exception, reason } → cap lifted/restored
//   POST /submissions/:id/confirm      { level } → confirmed (ready for Blackboard)
//   POST /submissions/:id/review       re-run the AI review card
//   GET  /export?courseCode=           confirmed levels for the Blackboard file
//   POST /export/mark                  { ids } → marked as added to the file

const express = require('express');
const mongoose = require('mongoose');
const Course = require('../models/Course.js');
const Settings = require('../models/Settings.js');
const { DEFAULT_SETTINGS } = require('../models/Settings.js');
const { MakeupCourse, MakeupRequest, MakeupSubmission, MakeupPhoto } = require('../models/Makeup.js');
const { requireAuth } = require('../lib/auth.js');
const { getOwnerId } = require('../lib/owner.js');
const rules = require('../lib/makeupRules.js');
const piiBox = require('../lib/piiBox.js');
const { sendStudentEmail } = require('../services/makeupEmails.js');
const { runReview, personalLink } = require('./makeupPublic.js');

const router = express.Router();
router.use(requireAuth);

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LINK_DAYS = 30;
const HUB_BASE_URL = () => String(process.env.HUB_BASE_URL || 'https://app.dm3agrader.com').replace(/\/+$/, '');

const notFound = (res) => res.status(404).json({ error: 'Not found.' });
const owner = (req) => getOwnerId(req);

function safeContact(boxed) {
  try {
    return piiBox.open(boxed);
  } catch {
    return { name: '(unavailable)', email: '', note: '' };
  }
}

async function findOwned(Model, req, id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Model.findOne({ _id: id, ownerId: owner(req) });
}

// ── Badge ───────────────────────────────────────────────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const [pending, toReview] = await Promise.all([
      MakeupRequest.countDocuments({ ownerId: owner(req), status: 'pending' }),
      MakeupSubmission.countDocuments({ ownerId: owner(req), transcriptReceivedAt: { $ne: null }, confirmedLevel: null }),
    ]);
    return res.json({ pending, toReview });
  } catch (err) {
    console.error('[makeup] summary error:', err.message);
    return res.status(500).json({ error: 'Could not load make-up summary.' });
  }
});

// ── Courses and assignments ─────────────────────────────────────────────────
function coursePublic(code, mc) {
  return {
    courseCode: code,
    requestUrl: mc ? `${HUB_BASE_URL()}/makeup/request/${mc.requestToken}` : null,
    assignments: mc ? mc.assignments.map((a) => ({ id: String(a._id), name: a.name, dueAt: a.dueAt })) : [],
  };
}

router.get('/courses', async (req, res) => {
  try {
    const [courses, configs] = await Promise.all([
      Course.find({ userId: owner(req) }).sort({ courseCode: 1 }).lean(),
      MakeupCourse.find({ ownerId: owner(req) }),
    ]);
    const byCode = new Map(configs.map((c) => [c.courseCode, c]));
    return res.json({ courses: courses.map((c) => coursePublic(c.courseCode, byCode.get(c.courseCode))) });
  } catch (err) {
    console.error('[makeup] courses error:', err.message);
    return res.status(500).json({ error: 'Could not load courses.' });
  }
});

router.put('/courses/:courseCode', async (req, res) => {
  try {
    const code = String(req.params.courseCode || '');
    const course = await Course.findOne({ userId: owner(req), courseCode: code }).lean();
    if (!course) return notFound(res);

    const raw = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
    if (!raw || raw.length > 60) return res.status(400).json({ error: 'Send a list of up to 60 assignments.' });
    const list = [];
    for (const a of raw) {
      const name = String(a?.name || '').trim();
      const dueAt = new Date(a?.dueAt);
      if (!name || name.length > 120) return res.status(400).json({ error: 'Each assignment needs a name (up to 120 characters).' });
      if (Number.isNaN(dueAt.getTime())) return res.status(400).json({ error: `"${name}" needs a due date.` });
      const item = { name, dueAt };
      if (a.id && mongoose.isValidObjectId(a.id)) item._id = a.id; // keep ids stable for existing requests
      list.push(item);
    }

    let mc = await MakeupCourse.findOne({ ownerId: owner(req), courseCode: code });
    if (!mc) mc = new MakeupCourse({ ownerId: owner(req), courseCode: code, requestToken: rules.newToken(18) });
    mc.assignments = list;
    await mc.save();
    return res.json({ course: coursePublic(code, mc) });
  } catch (err) {
    console.error('[makeup] course save error:', err.message);
    return res.status(500).json({ error: 'Could not save assignments.' });
  }
});

// ── The queue ───────────────────────────────────────────────────────────────
function requestPublic(r) {
  const c = safeContact(r.contact);
  const live = r.status === 'approved' && !r.revokedAt && r.linkExpiresAt && r.linkExpiresAt > new Date();
  return {
    id: String(r._id),
    courseCode: r.courseCode,
    assignmentName: r.assignmentName,
    reasonCategory: r.reasonCategory,
    name: c.name,
    email: c.email,
    note: c.note || '',
    status: r.status,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    linkExpiresAt: r.linkExpiresAt,
    linkLive: !!live,
    emails: (r.emails || []).map((e) => ({ kind: e.kind, at: e.at, ok: e.ok })),
  };
}

router.get('/requests', async (req, res) => {
  try {
    const filter = { ownerId: owner(req) };
    if (['pending', 'approved', 'denied'].includes(req.query.status)) filter.status = req.query.status;
    const list = await MakeupRequest.find(filter).sort({ createdAt: -1 }).limit(300);
    return res.json({ requests: list.map(requestPublic) });
  } catch (err) {
    console.error('[makeup] requests error:', err.message);
    return res.status(500).json({ error: 'Could not load requests.' });
  }
});

// End of the chosen day, New York time is close enough: 23:59 UTC-5.
function endOfDay(d) {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 23 + 5, 59));
}

async function issueLink(request, endDate) {
  const raw = rules.newToken(32);
  request.linkTokenHash = rules.hashToken(raw);
  request.linkExpiresAt = endDate || new Date(Date.now() + DEFAULT_LINK_DAYS * DAY);
  request.revokedAt = null;
  return raw;
}

router.post('/requests/:id/approve', async (req, res) => {
  try {
    const r = await findOwned(MakeupRequest, req, req.params.id);
    if (!r) return notFound(res);
    if (r.status !== 'pending') return res.status(409).json({ error: `This request was already ${r.status}.` });
    let endDate = null;
    if (req.body?.endDate) {
      endDate = endOfDay(req.body.endDate);
      if (!endDate || endDate <= new Date()) return res.status(400).json({ error: 'The end date must be in the future.' });
    }
    const raw = await issueLink(r, endDate);
    r.status = 'approved';
    r.endDate = endDate;
    r.decidedAt = new Date();
    const { name, email } = safeContact(r.contact);
    const link = personalLink(raw);
    const sent = await sendStudentEmail('approved', {
      to: email, requestId: String(r._id), firstName: rules.firstName(name), course: r.courseCode,
      assignment: r.assignmentName, link, endDate: r.linkExpiresAt,
    });
    r.emails.push({ kind: 'approved', at: new Date(), ok: sent.sent });
    await r.save();
    return res.json({ request: requestPublic(r), link, emailSent: sent.sent, emailNote: sent.reason || null });
  } catch (err) {
    console.error('[makeup] approve error:', err.message);
    return res.status(500).json({ error: 'Could not approve.' });
  }
});

router.post('/requests/:id/deny', async (req, res) => {
  try {
    const r = await findOwned(MakeupRequest, req, req.params.id);
    if (!r) return notFound(res);
    if (r.status !== 'pending') return res.status(409).json({ error: `This request was already ${r.status}.` });
    r.status = 'denied';
    r.decidedAt = new Date();
    const { name, email } = safeContact(r.contact);
    const sent = await sendStudentEmail('denied', {
      to: email, requestId: String(r._id), firstName: rules.firstName(name), course: r.courseCode, assignment: r.assignmentName,
    });
    r.emails.push({ kind: 'denied', at: new Date(), ok: sent.sent });
    await r.save();
    return res.json({ request: requestPublic(r), emailSent: sent.sent, emailNote: sent.reason || null });
  } catch (err) {
    console.error('[makeup] deny error:', err.message);
    return res.status(500).json({ error: 'Could not deny.' });
  }
});

router.post('/requests/:id/new-link', async (req, res) => {
  try {
    const r = await findOwned(MakeupRequest, req, req.params.id);
    if (!r) return notFound(res);
    if (r.status !== 'approved') return res.status(409).json({ error: 'Only approved requests have a link.' });
    const keepUntil = r.linkExpiresAt && r.linkExpiresAt > new Date() ? r.linkExpiresAt : null;
    const raw = await issueLink(r, keepUntil);
    await r.save();
    return res.json({ request: requestPublic(r), link: personalLink(raw) });
  } catch (err) {
    console.error('[makeup] new-link error:', err.message);
    return res.status(500).json({ error: 'Could not make a new link.' });
  }
});

router.post('/requests/:id/revoke', async (req, res) => {
  try {
    const r = await findOwned(MakeupRequest, req, req.params.id);
    if (!r) return notFound(res);
    r.revokedAt = new Date();
    await r.save();
    return res.json({ request: requestPublic(r) });
  } catch (err) {
    console.error('[makeup] revoke error:', err.message);
    return res.status(500).json({ error: 'Could not stop the link.' });
  }
});

// Removes the request, its submissions and their photos for good. The UI asks
// first. Owner-scoped like everything else.
router.delete('/requests/:id', async (req, res) => {
  try {
    const r = await findOwned(MakeupRequest, req, req.params.id);
    if (!r) return notFound(res);
    const subs = await MakeupSubmission.find({ requestId: r._id, ownerId: owner(req) }).select('_id').lean();
    const subIds = subs.map((x) => x._id);
    await MakeupPhoto.deleteMany({ submissionId: { $in: subIds }, ownerId: owner(req) });
    await MakeupSubmission.deleteMany({ _id: { $in: subIds }, ownerId: owner(req) });
    await MakeupRequest.deleteOne({ _id: r._id, ownerId: owner(req) });
    return res.json({ removed: true, submissions: subIds.length });
  } catch (err) {
    console.error('[makeup] remove error:', err.message);
    return res.status(500).json({ error: 'Could not remove the record.' });
  }
});

// ── Review ──────────────────────────────────────────────────────────────────
async function contactsFor(ownerId, subs) {
  const ids = [...new Set(subs.map((s) => String(s.requestId)))];
  const reqs = await MakeupRequest.find({ _id: { $in: ids }, ownerId }).select('contact').lean();
  return new Map(reqs.map((r) => [String(r._id), safeContact(r.contact)]));
}

function submissionPublic(s, contact, now = new Date()) {
  return {
    id: String(s._id),
    requestId: String(s.requestId),
    name: contact ? contact.name : '',
    email: contact ? contact.email : '',
    courseCode: s.courseCode,
    assignmentName: s.assignmentName,
    dueAt: s.dueAt,
    photoReceivedAt: s.photoReceivedAt,
    daysLate: s.daysLate,
    cap: s.exception ? null : s.cap,
    capReason: s.capReason,
    exception: s.exception,
    exceptionReason: s.exceptionReason,
    question: s.question,
    questionShownAt: s.questionShownAt,
    expiresAt: s.expiresAt,
    transcriptReceivedAt: s.transcriptReceivedAt,
    loomUrl: s.loomUrl,
    review: s.review,
    recommendedLevel: s.recommendedLevel,
    flags: rules.reviewFlags(s, now),
    confirmedLevel: s.confirmedLevel,
    confirmedAt: s.confirmedAt,
    exportedAt: s.exportedAt,
  };
}

router.get('/submissions', async (req, res) => {
  try {
    const subs = await MakeupSubmission.find({ ownerId: owner(req) }).sort({ updatedAt: -1 }).limit(300).lean();
    const contacts = await contactsFor(owner(req), subs);
    return res.json({ submissions: subs.map((s) => submissionPublic(s, contacts.get(String(s.requestId)))) });
  } catch (err) {
    console.error('[makeup] submissions error:', err.message);
    return res.status(500).json({ error: 'Could not load submissions.' });
  }
});

router.get('/submissions/:id', async (req, res) => {
  try {
    const s = await findOwned(MakeupSubmission, req, req.params.id);
    if (!s) return notFound(res);
    const [contacts, photo] = await Promise.all([
      contactsFor(owner(req), [s]),
      MakeupPhoto.findOne({ submissionId: s._id, ownerId: owner(req) }).lean(),
    ]);
    return res.json({
      submission: {
        ...submissionPublic(s.toObject(), contacts.get(String(s.requestId))),
        transcript: s.transcript,
        steps: s.steps,
        pages: (photo && photo.pages) || [],
      },
    });
  } catch (err) {
    console.error('[makeup] submission error:', err.message);
    return res.status(500).json({ error: 'Could not load the submission.' });
  }
});

async function latePolicyFor(ownerId) {
  const s = await Settings.findOne({ ownerId }).lean();
  return (s && s.latePolicy) || DEFAULT_SETTINGS.latePolicy;
}

router.post('/submissions/:id/exception', async (req, res) => {
  try {
    const s = await findOwned(MakeupSubmission, req, req.params.id);
    if (!s) return notFound(res);
    const on = !!req.body?.exception;
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (on && !reason) return res.status(400).json({ error: 'A documented exception needs a short reason.' });
    s.exception = on;
    s.exceptionReason = on ? reason : '';
    if (s.photoReceivedAt) {
      const late = rules.lateCap({ dueAt: s.dueAt, receivedAt: s.photoReceivedAt, latePolicy: await latePolicyFor(s.ownerId), exception: on });
      Object.assign(s, { daysLate: late.daysLate, cap: late.cap, capReason: late.capReason });
    }
    s.recommendedLevel = rules.recommendLevel(s.review?.aiLevel, on ? null : s.cap);
    await s.save();
    const contacts = await contactsFor(owner(req), [s]);
    return res.json({ submission: submissionPublic(s.toObject(), contacts.get(String(s.requestId))) });
  } catch (err) {
    console.error('[makeup] exception error:', err.message);
    return res.status(500).json({ error: 'Could not save the exception.' });
  }
});

router.post('/submissions/:id/confirm', async (req, res) => {
  try {
    const s = await findOwned(MakeupSubmission, req, req.params.id);
    if (!s) return notFound(res);
    const level = req.body?.level;
    if (!rules.LEVELS.includes(level)) return res.status(400).json({ error: 'Choose P1, P2, P3 or P4.' });
    s.confirmedLevel = level;
    s.confirmedAt = new Date();
    s.exportedAt = null; // a changed level needs to go into the file again
    await s.save();
    console.log(`[makeup] submission ${s._id}: level confirmed`);
    const contacts = await contactsFor(owner(req), [s]);
    return res.json({ submission: submissionPublic(s.toObject(), contacts.get(String(s.requestId))) });
  } catch (err) {
    console.error('[makeup] confirm error:', err.message);
    return res.status(500).json({ error: 'Could not confirm.' });
  }
});

router.post('/submissions/:id/review', async (req, res) => {
  try {
    const s = await findOwned(MakeupSubmission, req, req.params.id);
    if (!s) return notFound(res);
    if (!s.transcriptReceivedAt) return res.status(409).json({ error: 'The student has not sent the video yet.' });
    s.review = { status: 'pending' };
    await s.save();
    await runReview(s._id);
    const fresh = await MakeupSubmission.findById(s._id).lean();
    const contacts = await contactsFor(owner(req), [fresh]);
    return res.json({ submission: submissionPublic(fresh, contacts.get(String(fresh.requestId))) });
  } catch (err) {
    console.error('[makeup] re-review error:', err.message);
    return res.status(500).json({ error: 'Could not re-run the review.' });
  }
});

// ── Blackboard file ─────────────────────────────────────────────────────────
// Confirmed levels in the shape src/blind/bbExport.js joinGrades expects: a
// result per alias + a mapping alias → email / first / last name. The join runs
// in the instructor's browser, like the Grader's, and the file never leaves it.
router.get('/export', async (req, res) => {
  try {
    const filter = { ownerId: owner(req), confirmedLevel: { $ne: null } };
    if (req.query.courseCode) filter.courseCode = String(req.query.courseCode);
    if (req.query.onlyNew === '1') filter.exportedAt = null;
    const subs = await MakeupSubmission.find(filter).sort({ confirmedAt: 1 }).lean();
    const contacts = await contactsFor(owner(req), subs);
    const settings = await Settings.findOne({ ownerId: owner(req) }).lean();
    const points = (settings && settings.bbPoints) || DEFAULT_SETTINGS.bbPoints;
    const rows = subs.map((s) => {
      const c = contacts.get(String(s.requestId)) || {};
      const parts = String(c.name || '').trim().split(/\s+/);
      return {
        id: String(s._id),
        alias: `MU-${String(s._id).slice(-6).toUpperCase()}`,
        courseCode: s.courseCode,
        assignmentName: s.assignmentName,
        level: s.confirmedLevel,
        points: points[s.confirmedLevel],
        studentEmail: c.email || '',
        firstName: parts[0] || '',
        lastName: parts.length > 1 ? parts[parts.length - 1] : '',
        name: c.name || '',
        exportedAt: s.exportedAt,
      };
    });
    return res.json({ rows });
  } catch (err) {
    console.error('[makeup] export error:', err.message);
    return res.status(500).json({ error: 'Could not load confirmed levels.' });
  }
});

router.post('/export/mark', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((id) => mongoose.isValidObjectId(id));
    const r = await MakeupSubmission.updateMany({ _id: { $in: ids }, ownerId: owner(req), confirmedLevel: { $ne: null } }, { $set: { exportedAt: new Date() } });
    return res.json({ marked: r.modifiedCount });
  } catch (err) {
    console.error('[makeup] export mark error:', err.message);
    return res.status(500).json({ error: 'Could not mark as added.' });
  }
});

module.exports = router;
