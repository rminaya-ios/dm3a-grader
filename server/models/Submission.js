// models/Submission.js
// DM3A Grader — Submission Schema
// Phase 2: Submission data model
// Drop into: /server/models/Submission.js

const mongoose = require('mongoose');

const rubricBreakdownSchema = new mongoose.Schema(
  {
    conceptualUnderstanding: { type: Number, min: 0, max: 4, required: true },
    problemSolving:          { type: Number, min: 0, max: 4, required: true },
    workShown:               { type: Number, min: 0, max: 4, required: true },
    accuracy:                { type: Number, min: 0, max: 4, required: true },
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    // ── Ownership (instructor accounts) ──────────────────────────────────
    // Backfilled from professorEmail by scripts/migrateToAccounts.js. Optional
    // and unset by default: the grading pipeline is unauthenticated and does not
    // populate it, so professorEmail remains the operative key for new records.
    // Purely additive — no existing query filters on this.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    // ── Provenance (At-Risk Bridge, Phase 2) ─────────────────────────────
    // Which app produced this record:
    //   'grader'     -> graded here (default; also what un-backfilled legacy
    //                   records mean by having no value at all)
    //   'checkpoint' -> an instructor-confirmed level bridged from DM3A
    //                   CheckPoint via POST /api/risk/bridge
    // Plain String, not an enum, so a third source needs no migration — the
    // same choice GradingEvent.recordedVia makes.
    source: {
      type: String,
      default: 'grader',
      index: true,
    },

    // ── Identity ─────────────────────────────────────────────────────────
    // Blind Grading (Part C-1): identity may be alias-only. studentEmail/
    // studentName are now OPTIONAL; a record must carry `alias` OR `studentEmail`
    // (enforced by the pre-validate hook below). Legacy email-keyed records are
    // unaffected.
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
    // Course-scoped alias (e.g. "M110-7F3K"). The server/DB identity for blind
    // courses; the instructor's client re-identifies locally.
    alias: {
      type: String,
      trim: true,
      index: true,
    },
    professorEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // ── Course context ────────────────────────────────────────────────────
    courseCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
      // e.g. "MATH110-03"
    },
    assignmentName: {
      type: String,
      required: true,
      trim: true,
    },
    // Weight category determines R4 (High-Weight P1) rule
    assignmentWeight: {
      type: String,
      enum: ['homework', 'quiz', 'practice', 'midterm', 'exam', 'project', 'other'],
      default: 'homework',
    },
    // Sequential index within the course (1 = first assignment)
    // Used for R6: First Assignment Missing detection
    assignmentIndex: {
      type: Number,
      default: null,
    },

    // ── Grading result ────────────────────────────────────────────────────
    pScore: {
      type: Number,
      required: true,
      min: 1,
      max: 4,
      // 1=Beginning, 2=Developing, 3=Approaching Mastery, 4=Mastery
    },
    pLabel: {
      type: String,
      enum: ['P1', 'P2', 'P3', 'P4'],
      required: true,
    },
    rubricBreakdown: {
      type: rubricBreakdownSchema,
      required: true,
    },

    // ── AI feedback snapshot ──────────────────────────────────────────────
    // Store a brief version for the dashboard; not the full feedback block
    feedbackSummary: {
      type: String,
      maxlength: 500,
      default: null,
    },

    // ── Risk tracking ─────────────────────────────────────────────────────
    // Set by risk evaluator after save; null = not yet evaluated
    flagTriggered: {
      type: String,
      enum: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', null],
      default: null,
    },

    // ── Timestamps ────────────────────────────────────────────────────────
    submittedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // ── Data retention ────────────────────────────────────────────────────
    // Semester tag for batch deletion after 12-month retention window
    semesterTag: {
      type: String,
      trim: true,
      // e.g. "Spring2026"
    },

    // ── API cost attribution (ADDITIVE — safe defaults) ───────────────────
    // Populated opportunistically when the client forwards per-batch usage
    // from the /grade response into /api/risk/record. Historical / un-attributed
    // records keep the zero defaults (dashboard shows "—"). Never required.
    apiUsage: {
      inputTokens:         { type: Number, default: 0 },
      outputTokens:        { type: Number, default: 0 },
      cacheCreationTokens: { type: Number, default: 0 },
      cacheReadTokens:     { type: Number, default: 0 },
      apiCalls:            { type: Number, default: 0 },
      estimatedCostUSD:    { type: Number, default: 0 },
      model:               { type: String, default: '' },
    },
    // How this submission was recorded, for the cost-by-source breakdown.
    // '' = not attributed; e.g. 'instructor' | 'student' | 'late-work'.
    recordedVia: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true, // adds createdAt + updatedAt automatically
  }
);

// ── Compound indexes for the queries the risk evaluator runs most ─────────
// "Get last N submissions for this student in this course, sorted by date"
submissionSchema.index(
  { studentEmail: 1, courseCode: 1, submittedAt: -1 },
  { name: 'student_course_date' }
);

// "Get all submissions for this assignment across this course" (misconception batch)
submissionSchema.index(
  { courseCode: 1, assignmentName: 1, submittedAt: -1 },
  { name: 'course_assignment_date' }
);

// "Get all submissions for a professor" (dashboard load)
submissionSchema.index(
  { professorEmail: 1, courseCode: 1, submittedAt: -1 },
  { name: 'professor_course_date' }
);

// ── Admin Dashboard aggregations (Phase 2) ────────────────────────────────
// Time-window + per-course grouping (overview / activity / by-course / cost).
// Uses createdAt (timestamps) — distinct from the submittedAt indexes above.
submissionSchema.index(
  { createdAt: -1, courseCode: 1 },
  { name: 'created_course' }
);
// Per-professor "who's active" + cost, newest first (by-user view).
submissionSchema.index(
  { professorEmail: 1, createdAt: -1 },
  { name: 'professor_created' }
);

// Integrity: a submission must be identifiable by SOMETHING — an alias (blind
// courses) or a studentEmail (legacy). Prevents fully-anonymous rows.
submissionSchema.pre('validate', function () {
  if (!this.alias && !this.studentEmail) {
    throw new Error('Submission requires an alias or a studentEmail.');
  }
});

const Submission = mongoose.model('Submission', submissionSchema);
module.exports = Submission;
