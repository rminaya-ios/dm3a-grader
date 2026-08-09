// services/riskEvaluator.js
// DM3A Grader — Risk Evaluator Service
// Phase 2: Evaluates R1–R6 rules after every submission save
// Drop into: /server/services/riskEvaluator.js

const AtRiskFlag = require('../models/AtRiskFlag.js');
const { dispatchAlerts } = require('./alertDispatcher.js');
// NOTE: submissionService is required lazily inside evaluateRisk() to avoid a
// circular-dependency pitfall in CommonJS. submissionService requires this file
// and vice versa; the ESM original relied on live bindings. Requiring it at call
// time guarantees the fully-populated module.exports (otherwise getStudentHistory
// would be undefined at load time).

const HIGH_WEIGHT_TYPES = ['quiz', 'midterm', 'exam'];
const INACTIVITY_DAYS   = 7;

/**
 * evaluateRisk
 * Runs all 6 risk rules for a student after a new submission is saved.
 * Creates or escalates AtRiskFlag documents, then dispatches alerts.
 *
 * @param {Object} params
 * @param {string} params.studentEmail
 * @param {string} params.studentName
 * @param {string} params.professorEmail
 * @param {string} params.courseCode
 * @param {Object} params.currentSubmission - the just-saved Submission document
 * @returns {Object|null} - the flag created/updated, or null if no flag
 */
const evaluateRisk = async ({
  studentKey,
  alias,
  studentEmail,
  studentName,
  professorEmail,
  courseCode,
  currentSubmission,
}) => {
  // Lazy require to safely resolve the circular dependency (see note above).
  const { getStudentHistory } = require('./submissionService.js');

  // Blind Grading (Part C-1): key on the alias when present, else the email.
  // Back-compat: legacy callers pass no studentKey → fall back to studentEmail.
  const key = studentKey || studentEmail;

  // ── Fetch recent history (newest first) ───────────────────────────────
  const history = await getStudentHistory(key, courseCode, 10);
  // history[0] is the submission just saved (most recent)

  // ── Check for existing open flag ──────────────────────────────────────
  const existingFlag = await AtRiskFlag.findOne({
    courseCode,
    flagState: { $in: ['WATCH', 'ACT_NOW'] },
    $or: [{ studentEmail: key }, { alias: key }],
  });

  // ── Auto-clear: if student just scored P2+ and had an open flag ───────
  if (existingFlag && currentSubmission.pScore >= 2) {
    existingFlag.flagState    = 'CLEARED';
    existingFlag.resolvedAt   = new Date();
    await existingFlag.save();
    console.log(`✅ Flag cleared for ${studentEmail} — scored ${currentSubmission.pLabel}`);
    return null;
  }

  // ── Run rules ─────────────────────────────────────────────────────────
  const triggered = runRules(history, currentSubmission);

  if (!triggered) {
    return null; // Student is on track
  }

  const { rule, flagType, flagState, description, scores, assignments } = triggered;

  // ── If existing flag, escalate if needed ─────────────────────────────
  if (existingFlag) {
    const shouldEscalate =
      flagState === 'ACT_NOW' && existingFlag.flagState === 'WATCH';

    if (shouldEscalate) {
      existingFlag.flagState          = 'ACT_NOW';
      existingFlag.triggerRule        = rule;
      existingFlag.flagType           = flagType;
      existingFlag.triggerDescription = description;
      existingFlag.triggerScores      = scores;
      existingFlag.triggerAssignments = assignments;
      existingFlag.triggeredAt        = new Date();
      await existingFlag.save();
      console.log(`🔴 Flag escalated to ACT_NOW for ${studentEmail} — Rule ${rule}`);
      await dispatchAlerts(existingFlag);
    }
    return existingFlag;
  }

  // ── Create new flag ───────────────────────────────────────────────────
  const newFlag = await AtRiskFlag.create({
    alias,
    studentEmail,
    studentName,
    professorEmail,
    courseCode,
    triggerRule:         rule,
    flagType,
    flagState,
    triggerDescription:  description,
    triggerScores:       scores,
    triggerAssignments:  assignments,
    semesterTag:         currentSubmission.semesterTag,
  });

  console.log(
    `⚠️  New flag created: ${studentEmail} | ${courseCode} | Rule ${rule} | ${flagState}`
  );

  await dispatchAlerts(newFlag);
  return newFlag;
};

// ─────────────────────────────────────────────────────────────────────────────
// Rule engine — returns first triggered rule or null
// ─────────────────────────────────────────────────────────────────────────────

const runRules = (history, current) => {
  // history is sorted newest→oldest; history[0] = current submission

  // R6: First assignment missing / first submission is P1
  // Fires when assignmentIndex === 1 and student scored P1
  if (current.assignmentIndex === 1 && current.pScore === 1) {
    return {
      rule:        'R6',
      flagType:    'behavioral',
      flagState:   'ACT_NOW',
      description: `P1 on the first assignment (${current.assignmentName})`,
      scores:      [current.pScore],
      assignments: [current.assignmentName],
    };
  }

  // Precedence note: the multi-point trend rules (R3 then R2) are checked
  // BEFORE the single-point high-weight rule (R4). A sustained decline ending
  // on a high-weight P1 is the more specific, more diagnostic signal, so it is
  // reported as R3 rather than being masked by R4. R4 still fires for an
  // isolated high-weight P1 with no qualifying trend.

  // R3: Declining trend P3 → P2 → P1
  if (history.length >= 3) {
    const [s1, s2, s3] = history; // newest first
    if (s1.pScore === 1 && s2.pScore === 2 && s3.pScore === 3) {
      return {
        rule:        'R3',
        flagType:    'academic',
        flagState:   'ACT_NOW',
        description: `Declining trend: P3 → P2 → P1 (${s3.assignmentName} → ${s2.assignmentName} → ${s1.assignmentName})`,
        scores:      [s3.pScore, s2.pScore, s1.pScore],
        assignments: [s3.assignmentName, s2.assignmentName, s1.assignmentName],
      };
    }
  }

  // R2: Two consecutive P1s
  if (history.length >= 2) {
    const [s1, s2] = history; // newest, second-newest
    if (s1.pScore === 1 && s2.pScore === 1) {
      return {
        rule:        'R2',
        flagType:    'academic',
        flagState:   'ACT_NOW',
        description: `Two consecutive P1 scores (${s2.assignmentName}, ${s1.assignmentName})`,
        scores:      [s2.pScore, s1.pScore],
        assignments: [s2.assignmentName, s1.assignmentName],
      };
    }
  }

  // R4: High-weight P1
  if (
    HIGH_WEIGHT_TYPES.includes(current.assignmentWeight) &&
    current.pScore === 1
  ) {
    return {
      rule:        'R4',
      flagType:    'academic',
      flagState:   'ACT_NOW',
      description: `P1 on high-weight assignment: ${current.assignmentName} (${current.assignmentWeight})`,
      scores:      [current.pScore],
      assignments: [current.assignmentName],
    };
  }

  // ── TODO / KNOWN BROKEN (found 2026-08-09, out of scope then) ────────────
  // R5 and R1 do not work. Documented here rather than quietly fixed, because
  // repairing them changes which students get flagged and deserves its own
  // scoped change with real verification.
  //
  // R5 (feedback ignored): NOT IMPLEMENTED AT ALL. The comment below refers to
  //   services/riskScheduler.js — that file has never existed in this repo. No
  //   code anywhere evaluates R5, so the rule can never fire.
  //
  // R1 (inactivity >= 7 days): DEAD ON ARRIVAL on this path. runRules() is only
  //   called from evaluateRisk() immediately after a submission is saved, and
  //   history[0] IS that submission — so daysSinceLast is always ~0 and the
  //   threshold is unreachable. Detecting inactivity requires a scheduled sweep
  //   over students who have NOT submitted; nothing does that today.
  //
  // Consequence: of R1–R6, only R2, R3, R4 and R6 can actually fire. Both gaps
  // trace to the same missing scheduler. Also recorded in CHANGES.md and in
  // CheckPoint's RUNBOOK §I (they gate whether CheckPoint's P0 "did not attempt"
  // signal can ever be bridged).

  // R5: Feedback ignored — submitted but no follow-up within window
  // (This rule is evaluated separately by a scheduled job; see riskScheduler.js)

  // R1: Inactivity — also evaluated by scheduler, but we check here
  // as a snapshot based on last submission date
  if (history.length > 0) {
    const lastSubmission = history[0];
    const daysSinceLast  = daysBetween(new Date(lastSubmission.submittedAt), new Date());
    if (daysSinceLast >= INACTIVITY_DAYS) {
      return {
        rule:        'R1',
        flagType:    'behavioral',
        flagState:   'WATCH',
        description: `No submission in ${daysSinceLast} days (last: ${lastSubmission.assignmentName})`,
        scores:      [lastSubmission.pScore],
        assignments: [lastSubmission.assignmentName],
      };
    }
  }

  return null; // No rule triggered
};

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const daysBetween = (dateA, dateB) => {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor(Math.abs(dateB - dateA) / msPerDay);
};

// runRules is exported for dry-run verification (exercises the rule engine
// without creating flags or dispatching alerts).
module.exports = { evaluateRisk, runRules };
