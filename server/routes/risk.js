// routes/risk.js
// DM3A Grader — Risk & Submission API Routes
// Phase 2: Mount these in your main server.js / app.js
// Drop into: /server/routes/risk.js
//
// In server.js add:
//   const riskRoutes = require('./routes/risk.js');
//   app.use('/api', riskRoutes);

const express = require('express');
const mongoose = require('mongoose');
const Submission = require('../models/Submission.js');
const AtRiskFlag = require('../models/AtRiskFlag.js');
const { saveSubmission, getAssignmentSubmissions } = require('../services/submissionService.js');
const { piiGuard } = require('../middleware/piiGuard.js');
const { requireAuth } = require('../lib/auth.js');
const { getOwnerId, ownerFilter } = require('../lib/owner.js');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/submissions/save
 * Called internally after every DM3A grade completes.
 * Body: { studentEmail, studentName, professorEmail, courseCode,
 *         assignmentName, assignmentWeight, assignmentIndex,
 *         pScore, rubricBreakdown, feedbackSummary, semesterTag }
 */
// Hub Phase 2: every route here needs a signed-in account and only sees that
// account's records (lib/owner.js). requireAuth is per-route, NOT router.use():
// this router is mounted at /api, so a router-level guard would also lock
// /api/auth and friends. /api/risk/record and /api/risk/bridge live in index.js
// and are unchanged (the bridge keeps its X-Risk-Bridge-Key, no cookie).
router.post('/submissions/save', requireAuth, piiGuard, async (req, res) => {
  try {
    const { submission, flagResult } = await saveSubmission({ ...req.body, userId: getOwnerId(req) });
    res.status(201).json({
      success: true,
      submission: submission._id,
      flagCreated: flagResult ? flagResult.triggerRule : null,
    });
  } catch (err) {
    console.error('Submission save error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/submissions/student
 * Returns submission history for a single student in a course.
 * Query: ?studentEmail=&courseCode=&limit=10
 */
router.get('/submissions/student', requireAuth, async (req, res) => {
  try {
    const { studentEmail, courseCode, limit = 10 } = req.query;
    if (!studentEmail || !courseCode) {
      return res.status(400).json({ error: 'studentEmail and courseCode are required' });
    }
    const submissions = await Submission.find({ ...ownerFilter(req), studentEmail, courseCode })
      .sort({ submittedAt: -1 })
      .limit(Number(limit))
      .lean();
    res.json({ success: true, submissions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RISK FLAGS — Professor Dashboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/risk/flags
 * Returns all active (WATCH or ACT_NOW) flags for a professor's course.
 * Sorted: ACT_NOW first, then WATCH, then by triggeredAt desc.
 * Query: ?professorEmail=&courseCode=
 */
router.get('/risk/flags', requireAuth, async (req, res) => {
  try {
    // professorEmail is optional now: the owner already scopes the query, and
    // one owner may teach under several addresses (User.linkedEmails).
    const { professorEmail, courseCode } = req.query;
    if (!courseCode) {
      return res.status(400).json({ error: 'courseCode is required' });
    }

    const flags = await AtRiskFlag.find({
      ...ownerFilter(req),
      ...(professorEmail ? { professorEmail } : {}),
      courseCode,
      flagState: { $in: ['WATCH', 'ACT_NOW'] },
    })
      .sort({ flagState: -1, triggeredAt: -1 }) // ACT_NOW sorts before WATCH lexically
      .lean();

    // Attach last 3 submission scores for sparkline display
    const flagsWithHistory = await Promise.all(
      flags.map(async (flag) => {
        const studentKey = flag.alias || flag.studentEmail;
        const recent = await Submission.find({
          ...ownerFilter(req),
          courseCode,
          $or: [{ alias: studentKey }, { studentEmail: studentKey }],
        })
          .sort({ submittedAt: -1 })
          .limit(5)
          .select('pScore pLabel assignmentName submittedAt')
          .lean();
        return { ...flag, recentSubmissions: recent };
      })
    );

    res.json({
      success: true,
      counts: {
        actNow: flags.filter((f) => f.flagState === 'ACT_NOW').length,
        watch:  flags.filter((f) => f.flagState === 'WATCH').length,
      },
      flags: flagsWithHistory,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /api/risk/flags/:flagId
 * Professor updates flag status after taking action.
 * Body: { action: 'contacted' | 'dismissed' | 'resolved', note: string }
 */
router.patch('/risk/flags/:flagId', requireAuth, async (req, res) => {
  try {
    const { action, note } = req.body;
    if (!mongoose.isValidObjectId(req.params.flagId)) return res.status(404).json({ error: 'Flag not found' });
    const flag = await AtRiskFlag.findOne({ _id: req.params.flagId, ...ownerFilter(req) });

    if (!flag) {
      return res.status(404).json({ error: 'Flag not found' });
    }

    flag.professorAction = action;
    if (note) flag.professorNote = note;

    if (['dismissed', 'resolved'].includes(action)) {
      flag.flagState  = 'CLEARED';
      flag.resolvedAt = new Date();
    }

    await flag.save();
    res.json({ success: true, flag });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CLASS-LEVEL INSIGHTS (Misconception batch — Phase 3 preview)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/insights/assignment
 * Returns rubric breakdown summary for all submissions on one assignment.
 * The frontend or a follow-up Haiku call uses this to generate misconception insight.
 * Query: ?courseCode=&assignmentName=
 */
router.get('/insights/assignment', requireAuth, async (req, res) => {
  try {
    const { courseCode, assignmentName } = req.query;
    if (!courseCode || !assignmentName) {
      return res.status(400).json({ error: 'courseCode and assignmentName are required' });
    }

    const submissions = await getAssignmentSubmissions(courseCode, assignmentName, getOwnerId(req));

    if (submissions.length < 5) {
      return res.json({
        success: true,
        ready: false,
        message: `Only ${submissions.length} submission(s) — need at least 5 for class insight.`,
      });
    }

    // Aggregate rubric dimension averages
    const dims = ['conceptualUnderstanding', 'problemSolving', 'workShown', 'accuracy'];
    const totals = { conceptualUnderstanding: 0, problemSolving: 0, workShown: 0, accuracy: 0 };

    submissions.forEach((s) => {
      dims.forEach((d) => { totals[d] += s.rubricBreakdown?.[d] || 0; });
    });

    const n = submissions.length;
    const averages = {};
    dims.forEach((d) => { averages[d] = +(totals[d] / n).toFixed(2); });

    // P-score distribution
    const distribution = { P1: 0, P2: 0, P3: 0, P4: 0 };
    submissions.forEach((s) => { distribution[s.pLabel]++; });

    res.json({
      success:      true,
      ready:        true,
      courseCode,
      assignmentName,
      submissionCount: n,
      pScoreDistribution: distribution,
      rubricAverages: averages,
      // Raw breakdown for Haiku call (Phase 3)
      rubricDetails: submissions.map((s) => ({
        pScore:   s.pScore,
        rubric:   s.rubricBreakdown,
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
