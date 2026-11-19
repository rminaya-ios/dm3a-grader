// routes/roster.js
// DM3A — the Hub roster API. ONE roster per course, shared by Grader, CheckPoint,
// attendance and make-up. Mounted at /api/my/roster.
//
//   GET    /api/my/roster/:courseId          the decrypted roster (owner only, audited)
//   PUT    /api/my/roster/:courseId          replace it (owner only, alias-permanence enforced)
//   GET    /api/my/roster/:courseId/audit    who has read the names, when
//   POST   /api/my/roster/:courseId/rotate   re-wrap under the current ROSTER_KEK
//
// WHY THIS ACCEPTS PII AT ALL. Every grading and recording route is behind piiGuard, so
// a name can never reach the model path. This route is the single deliberate exception:
// it is where the instructor's own class list is stored, and it seals the names with
// lib/rosterCrypto.js before they touch the database. piiGuard is therefore NOT applied
// here, on purpose — applying it would make server-managed encryption impossible.
//
// WHO MAY READ. The course owner, and nobody else. Ownership is Course.userId (see
// lib/owner.js). A course that is not yours answers 404, never 403, so the API cannot
// be used to discover another account's courses — the roster is keyed by a
// non-guessable ObjectId, so unlike the old passphrase vault there is nothing here that
// needs to distinguish "not yours" from "not there".
//
// NAMES NEVER GO TO AN AI. This route returns names to the instructor's browser only.
// CheckPoint, attendance and make-up read it in the browser and join names to aliases
// there (docs/roster-vault-v2.md); no tool stores a name and no tool holds ROSTER_KEK.

const express = require('express');
const mongoose = require('mongoose');
const Roster = require('../models/Roster.js');
const RosterAudit = require('../models/RosterAudit.js');
const Course = require('../models/Course.js');
const { requireAuth } = require('../lib/auth.js');
const { getOwnerId } = require('../lib/owner.js');
const rosterCrypto = require('../lib/rosterCrypto.js');
const { checkAliasesPreserved, duplicateAliases } = require('../lib/aliasGuard.js');

const router = express.Router();
router.use(requireAuth);

// An alias as this app mints them: a course prefix, a hyphen, then code letters. Used to
// keep anything that is not an alias out of the audit log.
const ALIAS_SHAPE = /^[A-Z0-9]{1,12}-[A-Z0-9]{2,10}$/;
const MAX_ACK_ALIASES = 50;
const MAX_STUDENTS = 2000;         // a class, not a database export
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const AUDIT_PAGE = 100;

// Which tool is asking. A hint for reading the audit trail only — never an access
// decision, so it is not trusted for anything and is clamped to a short safe string.
const viaOf = (req) =>
  String(req.query.via || req.get('X-DM3A-Tool') || 'grader').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);

// Fail closed: with no master key the service cannot seal or open anything, and must
// not quietly fall back to storing clear text.
function requireKey(res) {
  if (rosterCrypto.configured()) return true;
  res.status(503).json({ error: 'Roster encryption is not configured on the server (ROSTER_KEK). No roster can be read or stored until it is.' });
  return false;
}

// The caller's own course, or null. 404 for anything else (lib/owner.js rule).
async function ownCourse(req) {
  const { courseId } = req.params;
  if (!mongoose.isValidObjectId(courseId)) return null;
  const userId = getOwnerId(req);
  if (!userId) return null;
  return Course.findOne({ _id: courseId, userId }, { courseCode: 1 }).lean();
}

const notYours = (res) => res.status(404).json({ error: 'No such course in your account.' });

// ── GET the decrypted roster ───────────────────────────────────────────────
router.get('/:courseId', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const course = await ownCourse(req);
    if (!course) return notYours(res);

    const doc = await Roster.findOne({ courseId: course._id, ownerId: getOwnerId(req) }).lean();
    if (!doc) return res.status(404).json({ error: 'No roster stored for this course yet.' });

    let roster;
    try {
      roster = rosterCrypto.open(doc.sealed);
    } catch (err) {
      // A roster that cannot be opened must be reported as such, never as an empty
      // class — an empty roster silently turns every submission into "Unknown Student".
      console.error('[ROSTER] could not open', String(course._id), '-', err.message);
      return res.status(500).json({ error: 'The stored roster could not be decrypted. Do not overwrite it; this needs looking at.' });
    }

    const students = Array.isArray(roster && roster.students) ? roster.students : [];
    // Recorded BEFORE the names are returned, so a read is never invisible.
    await RosterAudit.record({
      ownerId: getOwnerId(req), courseId: course._id, courseCode: course.courseCode,
      action: 'view', via: viaOf(req), count: students.length,
    });

    res.json({
      courseId: String(course._id),
      courseCode: course.courseCode,
      students,
      keyVersion: doc.keyVersion,
      studentCount: students.length,
      verifiedAt: doc.verifiedAt || null,
      migratedFrom: doc.migratedFrom || '',
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    console.error('[ROSTER] GET failed:', err.message);
    res.status(500).json({ error: 'Could not read the roster.' });
  }
});

// ── PUT the roster ─────────────────────────────────────────────────────────
// Enforces alias permanence against what is already stored. A request that would
// change or remove an existing student's alias is REFUSED (409) and nothing is written;
// the response names the students so the caller can show the instructor exactly what it
// would have done.
router.put('/:courseId', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const course = await ownCourse(req);
    if (!course) return notYours(res);

    const students = req.body && req.body.students;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: 'students must be a non-empty array.' });
    }
    if (students.length > MAX_STUDENTS) {
      return res.status(413).json({ error: `A roster of ${students.length} is larger than this endpoint accepts.` });
    }
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'Roster payload is too large.' });
    }
    const dupes = duplicateAliases(students);
    if (dupes.length) {
      return res.status(409).json({ error: 'An alias would belong to two students.', duplicateAliases: dupes });
    }

    const ownerId = getOwnerId(req);
    const existing = await Roster.findOne({ courseId: course._id, ownerId }).lean();
    let priorStudents = [];
    if (existing) {
      try {
        const prior = rosterCrypto.open(existing.sealed);
        priorStudents = Array.isArray(prior && prior.students) ? prior.students : [];
      } catch (err) {
        // Refuse rather than overwrite something we cannot read: the unreadable record
        // may be the only copy of a live alias set.
        console.error('[ROSTER] refusing a write over an unopenable roster', String(course._id), '-', err.message);
        return res.status(500).json({ error: 'The stored roster could not be decrypted, so it will not be overwritten. This needs looking at.' });
      }
      const check = checkAliasesPreserved(priorStudents, students);
      if (!check.ok) {
        return res.status(409).json({
          error: 'This would change an alias that has already been issued. Aliases are permanent once students have them on paper, so nothing was written.',
          violations: check.violations,
        });
      }
    }

    const sealed = rosterCrypto.seal({
      courseId: String(course._id),
      courseCode: course.courseCode,
      version: 2,
      updatedAt: new Date().toISOString(),
      students,
    });

    await Roster.findOneAndUpdate(
      { courseId: course._id, ownerId },
      {
        $set: {
          sealed,
          keyVersion: sealed.keyVersion,
          studentCount: students.length,
          courseCode: course.courseCode,
          ownerId,
          ...(req.body.migratedFrom ? { migratedFrom: String(req.body.migratedFrom).slice(0, 120) } : {}),
          ...(req.body.verified === true ? { verifiedAt: new Date() } : {}),
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    // The instructor's sign-off is its own action in the log, and it records which
    // printed cards were waved through. The browser sends ALIASES and COUNTS, never
    // prose: free text would let a bug — or a caller — put a student name in the one
    // place that must never hold one. Anything that is not alias-shaped is dropped, and
    // the server composes the sentence itself.
    const verified = req.body.verified === true;
    const ackAliases = (Array.isArray(req.body.acknowledgedAliases) ? req.body.acknowledgedAliases : [])
      .map((a) => String(a == null ? '' : a).trim().toUpperCase())
      .filter((a) => ALIAS_SHAPE.test(a))
      .slice(0, MAX_ACK_ALIASES);
    const skippedCount = Number.isInteger(req.body.skippedCount) && req.body.skippedCount > 0
      ? Math.min(req.body.skippedCount, 999) : 0;
    const extraNote = [
      ackAliases.length ? `${ackAliases.length} card(s) accounted for as no longer in the course: ${ackAliases.join(', ')}` : '',
      skippedCount ? `${skippedCount} non-student card row(s) skipped` : '',
    ].filter(Boolean).join('; ');
    await RosterAudit.record({
      ownerId, courseId: course._id, courseCode: course.courseCode,
      action: verified ? 'verify' : (existing ? 'write' : 'migrate'),
      via: viaOf(req), count: students.length,
      note: [
        existing ? `${students.length} students` : 'first roster for this course',
        verified ? 'verified against printed cards' : '',
        extraNote,
      ].filter(Boolean).join('; ').slice(0, 300),
    });

    res.json({ success: true, courseId: String(course._id), studentCount: students.length, keyVersion: sealed.keyVersion });
  } catch (err) {
    console.error('[ROSTER] PUT failed:', err.message);
    res.status(500).json({ error: 'Could not store the roster.' });
  }
});

// ── GET the audit trail ────────────────────────────────────────────────────
router.get('/:courseId/audit', async (req, res) => {
  try {
    const course = await ownCourse(req);
    if (!course) return notYours(res);
    const entries = await RosterAudit.find({ courseId: course._id, ownerId: getOwnerId(req) })
      .sort({ at: -1 }).limit(AUDIT_PAGE)
      .select({ action: 1, via: 1, count: 1, note: 1, at: 1, _id: 0 })
      .lean();
    res.json({ courseId: String(course._id), courseCode: course.courseCode, entries });
  } catch (err) {
    console.error('[ROSTER] audit read failed:', err.message);
    res.status(500).json({ error: 'Could not read the audit log.' });
  }
});

// ── POST rotate ────────────────────────────────────────────────────────────
// Re-wraps the data key under the current ROSTER_KEK. The roster ciphertext is returned
// byte-for-byte unchanged, so a rotation cannot alter or lose an alias.
router.post('/:courseId/rotate', async (req, res) => {
  try {
    if (!requireKey(res)) return;
    const course = await ownCourse(req);
    if (!course) return notYours(res);
    const ownerId = getOwnerId(req);
    const doc = await Roster.findOne({ courseId: course._id, ownerId }).lean();
    if (!doc) return res.status(404).json({ error: 'No roster stored for this course yet.' });

    const from = doc.keyVersion;
    let sealed;
    try {
      sealed = rosterCrypto.rewrap(doc.sealed);
    } catch (err) {
      // Typically the old key was removed from the environment too early. Nothing is
      // written, so the record is still openable with whatever key it was sealed under.
      console.error('[ROSTER] rotate failed for', String(course._id), '-', err.message);
      return res.status(409).json({ error: `Could not rotate: ${err.message}` });
    }
    if (sealed.keyVersion === from) {
      return res.json({ success: true, rotated: false, keyVersion: from, note: 'already on the current key' });
    }

    // Verified before storing: a rotation that produced something unopenable must never
    // replace a record that was fine.
    try { rosterCrypto.open(sealed); }
    catch (err) {
      console.error('[ROSTER] rotate produced an unopenable record for', String(course._id), '-', err.message);
      return res.status(500).json({ error: 'The rotated roster did not verify, so nothing was changed.' });
    }

    await Roster.updateOne({ _id: doc._id }, { $set: { sealed, keyVersion: sealed.keyVersion } });
    await RosterAudit.record({
      ownerId, courseId: course._id, courseCode: course.courseCode,
      action: 'rotate', via: viaOf(req), count: doc.studentCount || 0,
      note: `keyVersion ${from} -> ${sealed.keyVersion}`,
    });
    res.json({ success: true, rotated: true, from, keyVersion: sealed.keyVersion });
  } catch (err) {
    console.error('[ROSTER] rotate failed:', err.message);
    res.status(500).json({ error: 'Could not rotate the roster.' });
  }
});

module.exports = router;
