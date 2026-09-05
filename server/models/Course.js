// models/Course.js
// DM3A Grader — instructor-owned course metadata.
//
// Courses used to live ONLY in the browser (localStorage `dm3a-courses`), which is
// why RosterVault.js says "there is no Course collection in this app" — that was
// true until instructor accounts landed. This collection gives each course an
// owner so instructors see only their own, and so courses follow them across
// devices. The browser copy remains as an offline cache.
//
// PRIVACY: metadata ONLY. Student names/emails are NOT stored here — the roster
// stays client-side-encrypted in RosterVault, unchanged by the accounts work.

const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema(
  {
    // Owning instructor (models/User.js). Every query in routes/myCourses.js is
    // filtered by this, so a course can never be read across accounts.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Instructor-facing course code, e.g. "M110". This is the key the rest of the
    // app already uses (RosterVault.courseId, Submission.courseCode,
    // GradingEvent.courseCode), so it is kept verbatim rather than renamed.
    courseCode: {
      type: String,
      required: true,
      trim: true,
    },

    // Contact address used by the at-risk flow. Distinct from User.email: an
    // instructor may run a course under a departmental address.
    professorEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },

    // ── Mirrors of existing client-side course flags ─────────────────────────
    // Student Access Code for this course (DM3A-XXXXXX). The authoritative copy
    // lives in Redis and is managed by the untouched access-code endpoints; this
    // is a display mirror so the UI can show it after a fresh login.
    studentAccessCode: { type: String, default: '' },

    // Whether a client-side-encrypted roster vault exists for this course.
    vaulted: { type: Boolean, default: false },
    vaultUpdatedAt: { type: Date, default: null },

    // Per-course opt-out for name-zone redaction. Default true = redaction ON,
    // matching the fail-closed default in App.jsx (`c.redactNames !== false`).
    redactNames: { type: Boolean, default: true },

    // Which DM3A dimensions a STUDENT's self-check is scored on for this course.
    // The instructor owns this; /code-check hands it to the student flow so a
    // student checking a true/false quiz is not scored on Work Shown they were
    // never asked to produce. All true = the behaviour that existed before.
    studentDims: {
      conceptualUnderstanding: { type: Boolean, default: true },
      problemSolving:          { type: Boolean, default: true },
      workShown:               { type: Boolean, default: true },
      accuracy:                { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

// One "M110" per instructor — but two instructors may both have an "M110".
courseSchema.index({ userId: 1, courseCode: 1 }, { unique: true, name: 'user_course_unique' });

courseSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    courseCode: this.courseCode,
    professorEmail: this.professorEmail || '',
    studentAccessCode: this.studentAccessCode || '',
    vaulted: !!this.vaulted,
    vaultUpdatedAt: this.vaultUpdatedAt,
    redactNames: this.redactNames !== false,
    studentDims: {
      conceptualUnderstanding: this.studentDims?.conceptualUnderstanding !== false,
      problemSolving:          this.studentDims?.problemSolving !== false,
      workShown:               this.studentDims?.workShown !== false,
      accuracy:                this.studentDims?.accuracy !== false,
    },
  };
};

module.exports = mongoose.model('Course', courseSchema);
