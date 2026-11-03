// models/Makeup.js
// DM3A Make-up module — the records behind docs/makeup-module-spec.md.
//
//   MakeupCourse      per course: the public request-link token + the make-up
//                     assignments and their due dates
//   MakeupRequest     one student's request; the approval and personal link
//   MakeupSubmission  one assignment's photo → question → Loom → review card
//   MakeupPhoto       the REDACTED photo pages (kept apart so lists stay light)
//
// Every record carries ownerId (models/User.js) and every instructor query is
// filtered by it (lib/owner.js). Student name/email/note are sealed with
// lib/piiBox.js; the rest holds no names. Nothing here is ever logged.

const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;
const LEVELS = ['P1', 'P2', 'P3', 'P4'];

const assignmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    dueAt: { type: Date, required: true },
  },
  { _id: true }
);

const makeupCourseSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'User', required: true, index: true },
    courseCode: { type: String, required: true, trim: true },
    // Public request link: app.dm3agrader.com/makeup/request/<requestToken>.
    // Random, so the link does not reveal the course code or the owner.
    requestToken: { type: String, required: true, unique: true },
    assignments: { type: [assignmentSchema], default: [] },
  },
  { timestamps: true }
);
makeupCourseSchema.index({ ownerId: 1, courseCode: 1 }, { unique: true });

const makeupRequestSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'User', required: true, index: true },
    makeupCourseId: { type: ObjectId, ref: 'MakeupCourse', required: true },
    courseCode: { type: String, required: true },
    assignmentId: { type: ObjectId, required: true },
    assignmentName: { type: String, required: true },
    reasonCategory: { type: String, enum: ['schedule_conflict', 'medical', 'other'], required: true },
    // Sealed { name, email, note } — lib/piiBox.js.
    contact: { type: String, required: true },
    emailHash: { type: String, required: true, index: true },
    status: { type: String, enum: ['pending', 'approved', 'denied'], default: 'pending', index: true },
    decidedAt: { type: Date, default: null },
    endDate: { type: Date, default: null },
    // Personal link: only the hash of the token is kept.
    linkTokenHash: { type: String, default: null, index: { unique: true, sparse: true } },
    linkExpiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    // Which automatic emails went out (ids/time only, never content).
    emails: { type: [{ kind: String, at: Date, ok: Boolean, _id: false }], default: [] },
  },
  { timestamps: true }
);

const makeupSubmissionSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'User', required: true, index: true },
    requestId: { type: ObjectId, ref: 'MakeupRequest', required: true, index: true },
    courseCode: { type: String, required: true },
    assignmentId: { type: ObjectId, required: true },
    assignmentName: { type: String, required: true },
    dueAt: { type: Date, required: true },

    // Step 1 — the photo. Days late are counted from the FIRST upload.
    photoReceivedAt: { type: Date, default: null },
    photoPages: { type: Number, default: 0 },
    daysLate: { type: Number, default: 0 },
    cap: { type: String, default: null }, // P1–P4, 'instructor_review' or null
    capReason: { type: String, default: '' },
    exception: { type: Boolean, default: false },
    exceptionReason: { type: String, default: '' },

    // Step 2 — the random question (about a step the student wrote).
    steps: { type: [{ id: String, problem: String, text: String, _id: false }], default: [] },
    question: { type: String, default: '' },
    questionStep: { type: String, default: '' },
    questionType: { type: String, default: '' },
    questionShownAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    // Step 3 — the Loom. The link is for the instructor's eyes only: code never
    // opens it. The transcript is stored with the student's name removed.
    loomUrl: { type: String, default: '' },
    transcript: { type: String, default: '' },
    transcriptReceivedAt: { type: Date, default: null },

    // Step 4 — the AI review card. Flags only; nothing here changes a level.
    review: {
      status: { type: String, enum: ['none', 'pending', 'ready', 'failed'], default: 'none' },
      aiLevel: { type: String, enum: [...LEVELS, null], default: null },
      levelReason: { type: String, default: '' },
      answerStatus: { type: String, enum: ['answered', 'not_answered', 'unclear', null], default: null },
      answerNote: { type: String, default: '' },
      scriptSigns: { type: [String], default: [] },
      at: { type: Date, default: null },
    },
    recommendedLevel: { type: String, enum: [...LEVELS, null], default: null },
    storedFlags: { type: [String], default: [] },

    // Step 5 — the instructor decides.
    confirmedLevel: { type: String, enum: [...LEVELS, null], default: null },
    confirmedAt: { type: Date, default: null },
    exportedAt: { type: Date, default: null },
  },
  { timestamps: true }
);
makeupSubmissionSchema.index({ requestId: 1, assignmentId: 1 }, { unique: true });

const makeupPhotoSchema = new mongoose.Schema(
  {
    ownerId: { type: ObjectId, ref: 'User', required: true, index: true },
    submissionId: { type: ObjectId, ref: 'MakeupSubmission', required: true, unique: true },
    // Redacted JPEG pages, base64. The unredacted upload is never stored.
    pages: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = {
  MakeupCourse: mongoose.model('MakeupCourse', makeupCourseSchema),
  MakeupRequest: mongoose.model('MakeupRequest', makeupRequestSchema),
  MakeupSubmission: mongoose.model('MakeupSubmission', makeupSubmissionSchema),
  MakeupPhoto: mongoose.model('MakeupPhoto', makeupPhotoSchema),
};
