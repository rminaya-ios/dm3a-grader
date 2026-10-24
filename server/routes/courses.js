// routes/courses.js
// DM3A Grader — Blind Grading Mode, course-scoped roster vault (spec §2.3 option 1)
// Mounted at /api/courses.
//
//   PUT    /api/courses/:id/roster-vault   store/replace the opaque encrypted blob
//   GET    /api/courses/:id/roster-vault   fetch the opaque blob (server can't decrypt)
//   DELETE /api/courses/:id/roster-vault   purge it
//   (all three: signed-in owner only — see lib/vaultAccess.js)
//   POST /api/courses/:id/submissions    alias-only intake seam (piiGuard-enforced)
//
// The server stores/returns the encrypted blob verbatim and never sees a
// passphrase or plaintext PII. All write/intake routes are behind piiGuard so a
// name/email/id field can never slip through (spec §3.2, acceptance §6.4).

const express = require('express');
const RosterVault = require('../models/RosterVault.js');
const Course = require('../models/Course.js');
const { piiGuard } = require('../middleware/piiGuard.js');
const { requireAuth } = require('../lib/auth.js');
const { decideVaultAccess } = require('../lib/vaultAccess.js');

const router = express.Router();

const MAX_BLOB_BYTES = 5 * 1024 * 1024; // generous cap for an encrypted roster blob

function blobSize(blob) {
  try {
    return Buffer.byteLength(typeof blob === 'string' ? blob : JSON.stringify(blob));
  } catch {
    return Infinity;
  }
}

// Gathers the facts for lib/vaultAccess.js and sends the refusal itself.
// Returns { courseId, vault, claim } when the request may proceed, else null.
async function authorizeVault(req, res, method) {
  const courseId = String(req.params.id || '').trim();
  if (!courseId) {
    res.status(400).json({ error: 'courseId required' });
    return null;
  }
  const userId = req.user && req.user.id;
  const [ownsCourse, vault] = await Promise.all([
    Course.exists({ userId, courseCode: courseId }),
    RosterVault.findOne({ courseId }).lean(),
  ]);
  // Only needed for a legacy (ownerless) vault, so only counted then.
  const courseOwnerCount = vault && !vault.ownerId ? await Course.countDocuments({ courseCode: courseId }) : 0;

  const decision = decideVaultAccess({ method, userId, ownsCourse: !!ownsCourse, vault, courseOwnerCount });
  if (!decision.allow) {
    res.status(decision.status).json({ error: decision.error });
    return null;
  }
  return { courseId, vault, claim: !!decision.claim, userId };
}

// ── PUT /api/courses/:id/roster-vault ────────────────────────────────────────
router.put('/:id/roster-vault', requireAuth, piiGuard, async (req, res) => {
  try {
    const { blob } = req.body || {};
    if (blob == null || (typeof blob !== 'object' && typeof blob !== 'string')) {
      return res.status(400).json({ error: 'blob (object or base64 string) required' });
    }
    if (blobSize(blob) > MAX_BLOB_BYTES) {
      return res.status(413).json({ error: 'roster vault blob too large' });
    }

    const ok = await authorizeVault(req, res, 'PUT');
    if (!ok) return;

    // The filter only matches a vault this account owns or an ownerless one it
    // was just allowed to claim, so a race can't overwrite someone else's.
    const doc = await RosterVault.findOneAndUpdate(
      { courseId: ok.courseId, ownerId: { $in: [ok.userId, null] } },
      { $set: { blob, ownerId: ok.userId } },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, courseId: doc.courseId, updatedAt: doc.updatedAt });
  } catch (err) {
    console.error('[roster-vault] PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/courses/:id/roster-vault ────────────────────────────────────────
router.get('/:id/roster-vault', requireAuth, async (req, res) => {
  try {
    const ok = await authorizeVault(req, res, 'GET');
    if (!ok) return;
    // Claiming does not touch the blob or updatedAt — only who may open it.
    if (ok.claim) {
      await RosterVault.updateOne(
        { courseId: ok.courseId, ownerId: null },
        { $set: { ownerId: ok.userId } },
        { timestamps: false }
      );
      console.log(`[roster-vault] ${ok.courseId} claimed by its owner`);
    }
    const doc = ok.vault;
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
router.delete('/:id/roster-vault', requireAuth, async (req, res) => {
  try {
    const ok = await authorizeVault(req, res, 'DELETE');
    if (!ok) return;
    const result = await RosterVault.deleteOne({ courseId: ok.courseId, ownerId: { $in: [ok.userId, null] } });
    res.json({ success: true, courseId: ok.courseId, deleted: result.deletedCount > 0 });
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
