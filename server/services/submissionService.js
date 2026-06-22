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

  // ── Save submission ────────────────────────────────────────────────────
  const submission = await Submission.create({
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
    `📝 Submission saved: ${studentEmail} | ${courseCode} | ${assignmentName} | ${pLabel}`
  );

  // ── Trigger risk evaluator (non-blocking) ──────────────────────────────
  // Run async so the grading response returns to the student immediately.
  // Risk evaluation and alerts happen in the background.
  let flagResult = null;
  try {
    flagResult = await evaluateRisk({
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
const getStudentHistory = async (studentEmail, courseCode, limit = 10) => {
  return Submission.find({ studentEmail, courseCode })
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
