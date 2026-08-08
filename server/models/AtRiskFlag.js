// models/AtRiskFlag.js
// DM3A Grader — At-Risk Flag Schema
// Phase 2: Risk flag data model
// Drop into: /server/models/AtRiskFlag.js

const mongoose = require('mongoose');

const atRiskFlagSchema = new mongoose.Schema(
  {
    // ── Ownership (instructor accounts) ──────────────────────────────────
    // Backfilled from professorEmail by scripts/migrateToAccounts.js. See the
    // matching note in models/Submission.js — additive, nothing queries it yet.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    // ── Identity ─────────────────────────────────────────────────────────
    // Blind Grading (Part C-1): identity may be alias-only. Optional now; a flag
    // must carry `alias` OR `studentEmail` (pre-validate hook below).
    studentEmail: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
    },
    studentName: {
      type: String,
      trim: true,
    },
    alias: {
      type: String,
      trim: true,
      index: true,
    },
    courseCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    professorEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // ── Flag classification ───────────────────────────────────────────────
    triggerRule: {
      type: String,
      enum: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'],
      required: true,
    },
    // Academic = score-based (R2, R3, R4)
    // Behavioral = engagement-based (R1, R5, R6)
    flagType: {
      type: String,
      enum: ['academic', 'behavioral'],
      required: true,
    },
    // Three-state system: WATCH → ACT_NOW → CLEARED
    flagState: {
      type: String,
      enum: ['WATCH', 'ACT_NOW', 'CLEARED'],
      default: 'WATCH',
      index: true,
    },

    // ── Context snapshot (for dashboard display) ──────────────────────────
    // Human-readable trigger description
    triggerDescription: {
      type: String,
      required: true,
      // e.g. "Two consecutive P1 scores (HW3, Quiz 2)"
    },
    // The pScore(s) that caused the flag
    triggerScores: {
      type: [Number],
      default: [],
    },
    // Assignment name(s) involved
    triggerAssignments: {
      type: [String],
      default: [],
    },

    // ── Alert tracking ────────────────────────────────────────────────────
    // Which channels have been notified (prevent duplicates)
    alertsSent: {
      type: [String],
      enum: ['dashboard', 'email_professor', 'email_student', 'telegram'],
      default: [],
    },
    triggeredAt: {
      type: Date,
      default: Date.now,
    },

    // ── Professor action tracking ─────────────────────────────────────────
    professorAction: {
      type: String,
      enum: ['none', 'contacted', 'dismissed', 'resolved'],
      default: 'none',
    },
    professorNote: {
      type: String,
      maxlength: 500,
      default: null,
      // e.g. "Called student 6/22 — family issue, submitting late"
    },
    resolvedAt: {
      type: Date,
      default: null,
    },

    // ── Retention ─────────────────────────────────────────────────────────
    semesterTag: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// ── Compound indexes ──────────────────────────────────────────────────────

// Dashboard query: active flags for a professor's course
atRiskFlagSchema.index(
  { professorEmail: 1, courseCode: 1, flagState: 1 },
  { name: 'professor_course_state' }
);

// Prevent duplicate open flags for the same student+course
// (one active flag per student per course at a time)
atRiskFlagSchema.index(
  { studentEmail: 1, courseCode: 1, flagState: 1 },
  { name: 'student_course_state' }
);

atRiskFlagSchema.pre('validate', function () {
  if (!this.alias && !this.studentEmail) {
    throw new Error('AtRiskFlag requires an alias or a studentEmail.');
  }
});

const AtRiskFlag = mongoose.model('AtRiskFlag', atRiskFlagSchema);
module.exports = AtRiskFlag;
