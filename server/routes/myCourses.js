// routes/myCourses.js
// DM3A Grader — the signed-in instructor's own courses. Mounted at /api/my/courses.
//
//   GET    /                list my courses
//   POST   /                create one
//   POST   /import          bulk import from a browser's localStorage (one-time)
//   PUT    /:courseCode     update one
//   DELETE /:courseCode     delete one
//
// EVERY query is filtered by req.user.id, so one instructor can never read or
// write another's course — including by guessing an id. Courses are addressed by
// courseCode (not database id) because that is the key the rest of the app
// already speaks: RosterVault.courseId, Submission.courseCode, GradingEvent.
//
// This route is metadata-only. Student names never arrive here — rosters stay
// client-side-encrypted in the roster vault, untouched by the accounts work.

const express = require('express');
const Course = require('../models/Course.js');
const { requireAuth } = require('../lib/auth.js');

const router = express.Router();

// Every route below requires a real account. Legacy shared-password sessions
// have no uid and are rejected here — they keep using browser-local courses.
router.use(requireAuth);

const MAX_COURSES_PER_USER = 200; // sanity bound, far above real use

// Pick only the fields a client may set. Anything else in the body (userId,
// _id, timestamps) is ignored rather than trusted.
function sanitize(body) {
  const out = {};
  if (body.professorEmail !== undefined) out.professorEmail = String(body.professorEmail || '').trim().toLowerCase();
  if (body.studentAccessCode !== undefined) out.studentAccessCode = String(body.studentAccessCode || '').trim();
  if (body.vaulted !== undefined) out.vaulted = !!body.vaulted;
  if (body.vaultUpdatedAt !== undefined) out.vaultUpdatedAt = body.vaultUpdatedAt ? new Date(body.vaultUpdatedAt) : null;
  if (body.redactNames !== undefined) out.redactNames = body.redactNames !== false;
  if (body.studentDims && typeof body.studentDims === 'object') {
    out.studentDims = {
      conceptualUnderstanding: body.studentDims.conceptualUnderstanding !== false,
      problemSolving:          body.studentDims.problemSolving !== false,
      workShown:               body.studentDims.workShown !== false,
      accuracy:                body.studentDims.accuracy !== false,
    };
  }
  return out;
}

function normalizeCode(raw) {
  return String(raw || '').trim();
}

// ── GET /api/my/courses ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const courses = await Course.find({ userId: req.user.id }).sort({ courseCode: 1 });
    res.json({ courses: courses.map((c) => c.toPublic()) });
  } catch (err) {
    console.error('[my/courses] list error:', err.message);
    res.status(500).json({ error: 'Could not load your courses.' });
  }
});

// ── POST /api/my/courses ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const courseCode = normalizeCode(req.body?.courseCode);
    if (!courseCode) return res.status(400).json({ error: 'courseCode required' });

    if (await Course.countDocuments({ userId: req.user.id }) >= MAX_COURSES_PER_USER) {
      return res.status(409).json({ error: 'Course limit reached.' });
    }

    // Explicit duplicate check. The unique index is the authoritative guard (and
    // still catches the concurrent-request race below), but don't depend on it
    // alone: if that index is ever missing, silently creating duplicate courses
    // is a much worse failure than a redundant query.
    if (await Course.exists({ userId: req.user.id, courseCode })) {
      return res.status(409).json({ error: 'You already have a course with that code.' });
    }

    const course = await Course.create({ userId: req.user.id, courseCode, ...sanitize(req.body || {}) });
    res.status(201).json({ course: course.toPublic() });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'You already have a course with that code.' });
    }
    console.error('[my/courses] create error:', err.message);
    res.status(500).json({ error: 'Could not create the course.' });
  }
});

// ── POST /api/my/courses/import ──────────────────────────────────────────────
// One-time migration seam: upload the courses sitting in this browser's
// localStorage. Idempotent — a course code you already own is SKIPPED, never
// overwritten, so re-clicking (or importing from a second machine) is safe.
// body: { courses: [{ courseCode, professorEmail, ... }] }
router.post('/import', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.courses) ? req.body.courses : [];
    if (!incoming.length) return res.json({ imported: 0, skipped: 0, courses: [] });

    const existing = new Set(
      (await Course.find({ userId: req.user.id }).select('courseCode').lean()).map((c) => c.courseCode)
    );

    let imported = 0;
    let skipped = 0;
    for (const raw of incoming.slice(0, MAX_COURSES_PER_USER)) {
      const courseCode = normalizeCode(raw?.courseCode);
      if (!courseCode || existing.has(courseCode)) { skipped++; continue; }
      try {
        await Course.create({ userId: req.user.id, courseCode, ...sanitize(raw || {}) });
        existing.add(courseCode);
        imported++;
      } catch (e) {
        if (e && e.code === 11000) { skipped++; continue; } // concurrent import
        throw e;
      }
    }

    const courses = await Course.find({ userId: req.user.id }).sort({ courseCode: 1 });
    console.log(`[my/courses] import for ${req.user.email}: ${imported} imported, ${skipped} skipped`);
    res.json({ imported, skipped, courses: courses.map((c) => c.toPublic()) });
  } catch (err) {
    console.error('[my/courses] import error:', err.message);
    res.status(500).json({ error: 'Could not import courses.' });
  }
});

// ── PUT /api/my/courses/:courseCode ──────────────────────────────────────────
// Upsert: the frontend syncs whole-course state after each edit and shouldn't
// have to care whether the server already knows about the course.
router.put('/:courseCode', async (req, res) => {
  try {
    const courseCode = normalizeCode(req.params.courseCode);
    if (!courseCode) return res.status(400).json({ error: 'courseCode required' });

    const course = await Course.findOneAndUpdate(
      { userId: req.user.id, courseCode },
      { $set: sanitize(req.body || {}), $setOnInsert: { userId: req.user.id, courseCode } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ course: course.toPublic() });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'You already have a course with that code.' });
    }
    console.error('[my/courses] update error:', err.message);
    res.status(500).json({ error: 'Could not save the course.' });
  }
});

// ── DELETE /api/my/courses/:courseCode ───────────────────────────────────────
// Removes the course record only. The encrypted roster vault and grade history
// are NOT touched here — purging those stays with the existing vault-purge flow.
router.delete('/:courseCode', async (req, res) => {
  try {
    const courseCode = normalizeCode(req.params.courseCode);
    const result = await Course.deleteOne({ userId: req.user.id, courseCode });
    res.json({ success: true, courseCode, deleted: result.deletedCount > 0 });
  } catch (err) {
    console.error('[my/courses] delete error:', err.message);
    res.status(500).json({ error: 'Could not delete the course.' });
  }
});

module.exports = router;
