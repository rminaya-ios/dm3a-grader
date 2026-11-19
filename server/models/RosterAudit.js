// models/RosterAudit.js
// DM3A — who looked at student names, when, and for which course.
//
// Names are legitimately shown to the instructor who owns the course, so the control
// that matters is not prevention but a record. Every decrypt is written here before the
// names are returned, so "who has seen this class list" is answerable.
//
// NO NAMES IN THE LOG. A log of who-read-what must not itself become a second copy of
// the data: entries carry counts and ids only.

const mongoose = require('mongoose');

const ACTIONS = ['view', 'write', 'migrate', 'rotate', 'verify'];

const rosterAuditSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    courseCode: { type: String, default: '', trim: true },

    action: { type: String, enum: ACTIONS, required: true },
    // Which tool asked — 'grader', 'checkpoint', 'attendance', 'makeup'. Taken from the
    // request, so it is a hint for reading the trail, never an access decision.
    via: { type: String, default: '' },
    // How many students were returned or written. A count, never a name.
    count: { type: Number, default: 0 },
    // Free-text outcome for the unusual actions ("keyVersion 1 -> 2"). Caller-supplied
    // and must stay free of PII; the routes only ever put non-PII strings here.
    note: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'at', updatedAt: false } }
);

// The two questions actually asked of this collection: "what happened to this course"
// and "what has this account been reading".
rosterAuditSchema.index({ courseId: 1, at: -1 });
rosterAuditSchema.index({ ownerId: 1, at: -1 });

rosterAuditSchema.statics.ACTIONS = ACTIONS;

// Best-effort: an audit write must never be the reason an instructor cannot see their
// own roster, but a failure has to be loud in the server log.
rosterAuditSchema.statics.record = async function record(entry) {
  try {
    return await this.create(entry);
  } catch (err) {
    console.error('[ROSTER AUDIT] could not record', entry && entry.action, '-', err.message);
    return null;
  }
};

module.exports = mongoose.model('RosterAudit', rosterAuditSchema);
