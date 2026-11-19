// models/Roster.js
// DM3A — the ONE roster per course, shared by Grader, CheckPoint, attendance and
// make-up. Server-managed encryption: the instructor never types a passphrase.
//
// This is roster v2 (docs/roster-vault-v2.md). It does NOT replace RosterVault in
// place — the old passphrase blobs stay exactly where they are until each course has
// been migrated and the match report signed off, so a migration can always be undone
// by simply ignoring this collection.
//
// KEYED BY COURSE _id, NOT COURSE CODE. RosterVault.courseId is a globally unique
// string holding the course code, while Course is unique on {userId, courseCode} — so
// the old schema can hold exactly one vault per code across the whole system, and the
// second instructor to secure "MATH11003" could never create one at all. A stable
// ObjectId has no such collision.

const mongoose = require('mongoose');

const rosterSchema = new mongoose.Schema(
  {
    // The stable course identity. One roster per course, hence unique.
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      unique: true,
    },

    // The account that may decrypt this roster. Checked on every route; see lib/owner.js.
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // A human label only — for logs, the audit trail and support. Never an identity:
    // two instructors may both have "MATH11003".
    courseCode: { type: String, default: '', trim: true },

    // The sealed roster: lib/rosterCrypto.js envelope
    // { f: 'rv1', keyVersion, key: {iv,tag,ct}, data: {iv,tag,ct} }.
    // Unreadable without ROSTER_KEK. Nothing else in this document is sensitive.
    sealed: { type: mongoose.Schema.Types.Mixed, required: true },

    // Denormalised from `sealed` so a rotation can find the records it still has to
    // re-wrap without opening a single one of them.
    keyVersion: { type: Number, required: true, index: true },

    // How many students are inside, so a list screen never has to decrypt. A count is
    // not PII.
    studentCount: { type: Number, default: 0 },

    // Provenance, for the migration: which old vault this roster came from, and when
    // its alias set was verified against the printed cards. An unverified roster is
    // never the one a tool reads.
    migratedFrom: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true, minimize: false }
);

module.exports = mongoose.model('Roster', rosterSchema);
