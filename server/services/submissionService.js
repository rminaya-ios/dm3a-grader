// services/submissionService.js
// DM3A Grader — Submission Save Service
// Phase 2: Called after every successful DM3A grade
// Drop into: /server/services/submissionService.js

const Submission = require('../models/Submission.js');
const { evaluateRisk } = require('./riskEvaluator.js');

/**
 * saveSubmission
 * Persists a graded submission to MongoDB, then immediately
 * triggers the risk evaluator for this student+course.
 *
 * @param {Object} data - Graded submission data from the grading endpoint
 * @returns {Object} { submission, flagResult }
 */
const saveSubmission = async (data) => {
  const {
    alias,
    studentEmail,
    studentName,
    professorEmail,
    courseCode,
    assignmentName,
    assignmentWeight,
    assignmentIndex,
    pScore,
    rubricBreakdown,
    feedbackSummary,
    semesterTag,
  } = data;

  // ── Derive pLabel from pScore ──────────────────────────────────────────
  const pLabel = `P${pScore}`;

  // Blind Grading (Part C-1): identity key is the alias when present (blind
  // courses), else the email (legacy). All history/flag lookups key on this.
  const studentKey = alias || studentEmail;

  // ── Save submission ────────────────────────────────────────────────────
  const submission = await Submission.create({
    alias,
    studentEmail,
    studentName,
    professorEmail,
    courseCode,
    assignmentName,
    assignmentWeight: assignmentWeight || 'homework',
    assignmentIndex: assignmentIndex || null,
    pScore,
    pLabel,
    rubricBreakdown,
    feedbackSummary: feedbackSummary || null,
    semesterTag: semesterTag || null,
  });

  console.log(
    `📝 Submission saved: ${studentKey} | ${courseCode} | ${assignmentName} | ${pLabel}`
  );

  // ── Trigger risk evaluator (non-blocking) ──────────────────────────────
  // Run async so the grading response returns to the student immediately.
  // Risk evaluation and alerts happen in the background.
  let flagResult = null;
  try {
    flagResult = await evaluateRisk({
      studentKey,
      alias,
      studentEmail,
      studentName,
      professorEmail,
      courseCode,
      currentSubmission: submission,
    });
  } catch (err) {
    // Never let risk evaluation failure break the grading flow
    console.error(`⚠️  Risk evaluation failed for ${studentEmail}: ${err.message}`);
  }

  return { submission, flagResult };
};

/**
 * getStudentHistory
 * Returns the last N submissions for a student in a course, newest first.
 * Used by the risk evaluator and the professor dashboard.
 *
 * @param {string} studentEmail
 * @param {string} courseCode
 * @param {number} limit - default 10
 */
// studentKey may be an alias (blind) or a studentEmail (legacy). Match either so
// both identity models resolve a student's history. Legacy callers passing an
// email are unaffected (the alias branch simply matches nothing).
const getStudentHistory = async (studentKey, courseCode, limit = 10) => {
  if (!studentKey) return [];
  return Submission.find({
    courseCode,
    $or: [{ studentEmail: studentKey }, { alias: studentKey }],
  })
    .sort({ submittedAt: -1 })
    .limit(limit)
    .lean();
};

/**
 * getAssignmentSubmissions
 * Returns all submissions for a specific assignment in a course.
 * Used by the misconception batch job.
 *
 * @param {string} courseCode
 * @param {string} assignmentName
 */
const getAssignmentSubmissions = async (courseCode, assignmentName) => {
  return Submission.find({ courseCode, assignmentName })
    .sort({ submittedAt: -1 })
    .lean();
};

module.exports = { saveSubmission, getStudentHistory, getAssignmentSubmissions };
