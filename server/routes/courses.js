// routes/courses.js
// DM3A Grader — Blind Grading Mode, course-scoped roster vault (spec §2.3 option 1)
// Mounted at /api/courses.
//
//   PUT  /api/courses/:id/roster-vault   store/replace the opaque encrypted blob
//   GET  /api/courses/:id/roster-vault   fetch the opaque blob (server can't decrypt)
//   POST /api/courses/:id/submissions    alias-only intake seam (piiGuard-enforced)
//
// The server stores/returns the encrypted blob verbatim and never sees a
// passphrase or plaintext PII. All write/intake routes are behind piiGuard so a
// name/email/id field can never slip through (spec §3.2, acceptance §6.4).

const express = require('express');
const RosterVault = require('../models/RosterVault.js');
const { piiGuard } = require('../middleware/piiGuard.js');

const router = express.Router();

const MAX_BLOB_BYTES = 5 * 1024 * 1024; // generous cap for an encrypted roster blob

function blobSize(blob) {
  try {
    return Buffer.byteLength(typeof blob === 'string' ? blob : JSON.stringify(blob));
  } catch {
    return Infinity;
  }
}

// ── PUT /api/courses/:id/roster-vault ────────────────────────────────────────
router.put('/:id/roster-vault', piiGuard, async (req, res) => {
  try {
    const courseId = String(req.params.id || '').trim();
    if (!courseId) return res.status(400).json({ error: 'courseId required' });

    const { blob } = req.body || {};
    if (blob == null || (typeof blob !== 'object' && typeof blob !== 'string')) {
      return res.status(400).json({ error: 'blob (object or base64 string) required' });
    }
    if (blobSize(blob) > MAX_BLOB_BYTES) {
      return res.status(413).json({ error: 'roster vault blob too large' });
    }

    const doc = await RosterVault.findOneAndUpdate(
      { courseId },
      { $set: { blob } },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, courseId: doc.courseId, updatedAt: doc.updatedAt });
  } catch (err) {
    console.error('[roster-vault] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/courses/:id/roster-vault ────────────────────────────────────────
router.get('/:id/roster-vault', async (req, res) => {
  try {
    const courseId = String(req.params.id || '').trim();
    const doc = await RosterVault.findOne({ courseId }).lean();
    if (!doc) return res.status(404).json({ error: 'no roster vault for this course' });
    res.json({ courseId: doc.courseId, blob: doc.blob, updatedAt: doc.updatedAt });
  } catch (err) {
    console.error('[roster-vault] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/courses/:id/roster-vault ─────────────────────────────────────
// Purge path (spec §5). Removes the course's encrypted mapping blob. Idempotent:
// deleting a non-existent vault returns 200 with deleted:false rather than 404,
// so a purge-all flow never errors on already-clean courses.
router.delete('/:id/roster-vault', async (req, res) => {
  try {
    const courseId = String(req.params.id || '').trim();
    if (!courseId) return res.status(400).json({ error: 'courseId required' });
    const result = await RosterVault.deleteOne({ courseId });
    res.json({ success: true, courseId, deleted: result.deletedCount > 0 });
  } catch (err) {
    console.error('[roster-vault] DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/courses/:id/submissions ────────────────────────────────────────
// Alias-only submission intake ENFORCEMENT SEAM (Phase 2 groundwork). Behind
// piiGuard so any name/email/id field is rejected (acceptance §6.4). Does NOT
// touch the existing grading pipeline — validates the alias-only contract and
// acknowledges; persistence/grading arrives with the Phase 2 alias pipeline.
router.post('/:id/submissions', piiGuard, async (req, res) => {
  const { alias } = req.body || {};
  if (!alias || typeof alias !== 'string') {
    return res.status(400).json({ error: 'alias required (alias-only submissions)' });
  }
  res.status(202).json({ accepted: true, courseId: String(req.params.id || '').trim(), alias });
});

module.exports = router;
