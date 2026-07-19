// routes/adminStats.js
// DM3A Grader — Admin Dashboard aggregation API (Phase 2)
// Mounted at /api/admin. Every route is READ-ONLY.
//
// In index.js:
//   const adminStatsRoutes = require('./routes/adminStats.js');
//   app.use('/api/admin', adminStatsRoutes);
//
// Auth: header `x-admin-key` must match env `ADMIN_DASHBOARD_KEY`.
// Rate limit: best-effort fixed-window via Upstash Redis (default 60 req/min).
//
// Cost/volume AGGREGATES come from the identity-free GradingEvent collection.
// Mastery + per-course / per-user DETAIL comes from Submission. Because
// per-submission apiUsage attribution is dormant (the /grade body carries no
// identity by design), per-course / per-user *cost* reads ~0 today — shown as
// "—" in the UI. Aggregate cost is fully accurate from GradingEvent.

const express = require('express');
const crypto = require('crypto');
const Submission = require('../models/Submission.js');
const GradingEvent = require('../models/GradingEvent.js');
const AtRiskFlag = require('../models/AtRiskFlag.js');

const router = express.Router();

// Timezone for day-bucketing time series (Ralph is US Eastern / USJ, CT).
const TZ = process.env.DASHBOARD_TZ || 'America/New_York';
const RATE_LIMIT = Number(process.env.ADMIN_RATE_LIMIT_PER_MIN || 60);

// ── Optional Upstash rate limiter (best-effort; never blocks on failure) ─────
let redis = null;
try {
  const { Redis } = require('@upstash/redis');
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
} catch (_e) {
  redis = null;
}

async function rateLimit(req, res, next) {
  try {
    if (!redis) return next(); // rate limiting is best-effort infra
    const minute = Math.floor(Date.now() / 60000);
    const key = `admin:rl:${minute}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 65);
    if (count > RATE_LIMIT) {
      return res.status(429).json({ error: 'Rate limit exceeded — try again shortly.' });
    }
    return next();
  } catch (_e) {
    return next(); // never block the dashboard on a limiter hiccup
  }
}

// ── Auth: constant-time compare of x-admin-key against ADMIN_DASHBOARD_KEY ────
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireAdminKey(req, res, next) {
  // Trim both sides: Railway's Variables editor commonly stores a trailing
  // newline/space in the value, and headers can pick up stray whitespace. Without
  // this, the exact key copied from Railway fails the byte-for-byte compare.
  const expected = String(process.env.ADMIN_DASHBOARD_KEY || '').trim();
  // Fail CLOSED: if no key is configured, the dashboard is disabled, not open.
  if (!expected) {
    return res.status(401).json({ error: 'Admin dashboard is not configured.' });
  }
  const provided = String(req.get('x-admin-key') || '').trim();
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' }); // never log the key
  }
  return next();
}

router.use(rateLimit);
router.use(requireAdminKey);

// ── Helpers ──────────────────────────────────────────────────────────────────
function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function clampDays(v, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, 365);
}

// YYYY-MM-DD for a Date in the dashboard timezone (en-CA => ISO-like).
function dateKeyInTZ(date) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

// Merge daily submission + cost series and fill every day in the window with 0s.
function fillDailySeries(days, subDaily, costDaily) {
  const subMap = new Map(subDaily.map((r) => [r.date, r]));
  const costMap = new Map(costDaily.map((r) => [r.date, r.estimatedCostUSD]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dateKeyInTZ(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    const s = subMap.get(key);
    out.push({
      date: key,
      submissions: s ? s.submissions : 0,
      distinctUsers: s ? s.distinctUsers : 0,
      estimatedCostUSD: costMap.get(key) || 0,
    });
  }
  return out;
}

const DAY_FMT = { format: '%Y-%m-%d', timezone: TZ };

// ─────────────────────────────────────────────────────────────────────────────
// 1) GET /api/admin/stats/overview
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/overview', async (req, res) => {
  try {
    const d7 = daysAgo(7);
    const d30 = daysAgo(30);

    const [subsAll, subs7, subs30, professors, students, courses, activeProfs7d] =
      await Promise.all([
        Submission.countDocuments({}),
        Submission.countDocuments({ createdAt: { $gte: d7 } }),
        Submission.countDocuments({ createdAt: { $gte: d30 } }),
        Submission.distinct('professorEmail'),
        Submission.distinct('studentEmail'),
        Submission.distinct('courseCode'),
        Submission.distinct('professorEmail', { createdAt: { $gte: d7 } }),
      ]);

    const facet = await GradingEvent.aggregate([
      {
        $facet: {
          allTime: [
            {
              $group: {
                _id: null,
                cost: { $sum: '$apiUsage.estimatedCostUSD' },
                graded: { $sum: '$submissionCount' },
              },
            },
          ],
          last30: [
            { $match: { createdAt: { $gte: d30 } } },
            { $group: { _id: null, cost: { $sum: '$apiUsage.estimatedCostUSD' } } },
          ],
          // Grading duration only from actual grading calls (not the gatekeeper).
          duration: [
            { $match: { recordedVia: 'auto' } },
            { $group: { _id: null, avgMs: { $avg: '$gradingDurationMs' } } },
          ],
        },
      },
    ]);
    const f = facet[0] || {};
    const costAllTime = f.allTime?.[0]?.cost || 0;
    const gradedAllTime = f.allTime?.[0]?.graded || 0;

    res.json({
      submissions: { last7d: subs7, last30d: subs30, allTime: subsAll },
      distinctProfessors: professors.length,
      distinctStudents: students.length,
      distinctCourses: courses.length,
      activeProfessors7d: activeProfs7d.length,
      estimatedCost: { last30d: f.last30?.[0]?.cost || 0, allTime: costAllTime },
      avgCostPerSubmission: gradedAllTime > 0 ? costAllTime / gradedAllTime : 0,
      avgGradingDurationMs: f.duration?.[0]?.avgMs || 0,
      errorCount: null, // not currently tracked in the schema
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) GET /api/admin/stats/activity?days=30
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/activity', async (req, res) => {
  try {
    const days = clampDays(req.query.days, 30);
    const since = daysAgo(days);

    const [subDaily, costDaily] = await Promise.all([
      Submission.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { ...DAY_FMT, date: '$createdAt' } },
            submissions: { $sum: 1 },
            users: { $addToSet: '$professorEmail' },
          },
        },
        { $project: { _id: 0, date: '$_id', submissions: 1, distinctUsers: { $size: '$users' } } },
      ]),
      GradingEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { ...DAY_FMT, date: '$createdAt' } },
            estimatedCostUSD: { $sum: '$apiUsage.estimatedCostUSD' },
          },
        },
        { $project: { _id: 0, date: '$_id', estimatedCostUSD: 1 } },
      ]),
    ]);

    res.json({ days, timezone: TZ, series: fillDailySeries(days, subDaily, costDaily) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) GET /api/admin/stats/by-course
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/by-course', async (req, res) => {
  try {
    const [rows, resub] = await Promise.all([
      Submission.aggregate([
        {
          $group: {
            _id: '$courseCode',
            submissions: { $sum: 1 },
            students: { $addToSet: '$studentEmail' },
            p1: { $sum: { $cond: [{ $eq: ['$pLabel', 'P1'] }, 1, 0] } },
            p2: { $sum: { $cond: [{ $eq: ['$pLabel', 'P2'] }, 1, 0] } },
            p3: { $sum: { $cond: [{ $eq: ['$pLabel', 'P3'] }, 1, 0] } },
            p4: { $sum: { $cond: [{ $eq: ['$pLabel', 'P4'] }, 1, 0] } },
            estimatedCostUSD: { $sum: '$apiUsage.estimatedCostUSD' },
            lastActivity: { $max: '$createdAt' },
          },
        },
        {
          $project: {
            _id: 0,
            courseCode: '$_id',
            submissions: 1,
            distinctStudents: { $size: '$students' },
            pDistribution: { P1: '$p1', P2: '$p2', P3: '$p3', P4: '$p4' },
            estimatedCostUSD: 1,
            lastActivity: 1,
          },
        },
        { $sort: { submissions: -1 } },
      ]),
      // Resubmission rate: attempts beyond the first per (student, assignment).
      Submission.aggregate([
        {
          $group: {
            _id: { course: '$courseCode', student: '$studentEmail', assignment: '$assignmentName' },
            attempts: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: '$_id.course',
            total: { $sum: '$attempts' },
            firstAttempts: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            courseCode: '$_id',
            resubmissionRate: {
              $cond: [
                { $gt: ['$total', 0] },
                { $divide: [{ $subtract: ['$total', '$firstAttempts'] }, '$total'] },
                0,
              ],
            },
          },
        },
      ]),
    ]);

    const resubMap = new Map(resub.map((r) => [r.courseCode, r.resubmissionRate]));
    rows.forEach((r) => {
      r.resubmissionRate = resubMap.get(r.courseCode) || 0;
    });

    res.json({ courses: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) GET /api/admin/stats/by-user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/by-user', async (req, res) => {
  try {
    const groupStage = (field) => [
      {
        $group: {
          _id: `$${field}`,
          submissions: { $sum: 1 },
          lastActive: { $max: '$createdAt' },
          estimatedCostUSD: { $sum: '$apiUsage.estimatedCostUSD' },
        },
      },
      { $sort: { estimatedCostUSD: -1, submissions: -1 } },
    ];

    const [professors, students] = await Promise.all([
      Submission.aggregate([
        ...groupStage('professorEmail'),
        { $project: { _id: 0, professorEmail: '$_id', submissions: 1, lastActive: 1, estimatedCostUSD: 1 } },
      ]),
      Submission.aggregate([
        ...groupStage('studentEmail'),
        { $project: { _id: 0, studentEmail: '$_id', submissions: 1, lastActive: 1, estimatedCostUSD: 1 } },
      ]),
    ]);

    res.json({ professors, students });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) GET /api/admin/stats/cost?days=30
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/cost', async (req, res) => {
  try {
    const days = clampDays(req.query.days, 30);
    const since = daysAgo(days);

    const [totalsAgg, byDay, byRecordedVia, byCourse] = await Promise.all([
      GradingEvent.aggregate([
        {
          $group: {
            _id: null,
            inputTokens: { $sum: '$apiUsage.inputTokens' },
            outputTokens: { $sum: '$apiUsage.outputTokens' },
            cacheCreationTokens: { $sum: '$apiUsage.cacheCreationTokens' },
            cacheReadTokens: { $sum: '$apiUsage.cacheReadTokens' },
            estimatedCostUSD: { $sum: '$apiUsage.estimatedCostUSD' },
            graded: { $sum: '$submissionCount' },
          },
        },
      ]),
      GradingEvent.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { ...DAY_FMT, date: '$createdAt' } },
            estimatedCostUSD: { $sum: '$apiUsage.estimatedCostUSD' },
          },
        },
        { $project: { _id: 0, date: '$_id', estimatedCostUSD: 1 } },
        { $sort: { date: 1 } },
      ]),
      GradingEvent.aggregate([
        {
          $group: {
            _id: '$recordedVia',
            estimatedCostUSD: { $sum: '$apiUsage.estimatedCostUSD' },
            calls: { $sum: '$apiUsage.apiCalls' },
          },
        },
        { $project: { _id: 0, recordedVia: '$_id', estimatedCostUSD: 1, calls: 1 } },
        { $sort: { estimatedCostUSD: -1 } },
      ]),
      // From Submission.apiUsage — dormant, so ~0 today (honest "—" in the UI).
      Submission.aggregate([
        {
          $group: {
            _id: '$courseCode',
            estimatedCostUSD: { $sum: '$apiUsage.estimatedCostUSD' },
            submissions: { $sum: 1 },
          },
        },
        { $project: { _id: 0, courseCode: '$_id', estimatedCostUSD: 1, submissions: 1 } },
        { $sort: { estimatedCostUSD: -1 } },
      ]),
    ]);

    const t = totalsAgg[0] || {};
    const graded = t.graded || 0;

    res.json({
      days,
      timezone: TZ,
      totals: {
        inputTokens: t.inputTokens || 0,
        outputTokens: t.outputTokens || 0,
        cacheCreationTokens: t.cacheCreationTokens || 0,
        cacheReadTokens: t.cacheReadTokens || 0,
        estimatedCostUSD: t.estimatedCostUSD || 0,
      },
      avgCostPerSubmission: graded > 0 ? (t.estimatedCostUSD || 0) / graded : 0,
      byDay,
      byRecordedVia,
      byCourse,
      pricing: {
        inputPerMTok: Number(process.env.ANTHROPIC_PRICE_INPUT_PER_MTOK ?? 3.0),
        outputPerMTok: Number(process.env.ANTHROPIC_PRICE_OUTPUT_PER_MTOK ?? 15.0),
        cacheWritePerMTok: Number(process.env.ANTHROPIC_PRICE_CACHE_WRITE_PER_MTOK ?? 3.75),
        cacheReadPerMTok: Number(process.env.ANTHROPIC_PRICE_CACHE_READ_PER_MTOK ?? 0.3),
      },
      note: 'Estimated — see Anthropic Console for billed amounts.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) GET /api/admin/stats/risk?days=30
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/risk', async (req, res) => {
  try {
    const days = clampDays(req.query.days, 30);
    const since = daysAgo(days);

    const [total, byRule, byCourse, overTime] = await Promise.all([
      AtRiskFlag.countDocuments({}),
      AtRiskFlag.aggregate([
        { $group: { _id: '$triggerRule', count: { $sum: 1 } } },
        { $project: { _id: 0, rule: '$_id', count: 1 } },
        { $sort: { rule: 1 } },
      ]),
      AtRiskFlag.aggregate([
        { $group: { _id: '$courseCode', count: { $sum: 1 } } },
        { $project: { _id: 0, courseCode: '$_id', count: 1 } },
        { $sort: { count: -1 } },
      ]),
      AtRiskFlag.aggregate([
        { $match: { triggeredAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { ...DAY_FMT, date: '$triggeredAt' } },
            count: { $sum: 1 },
          },
        },
        { $project: { _id: 0, date: '$_id', count: 1 } },
        { $sort: { date: 1 } },
      ]),
    ]);

    // Ensure all six rules appear (0-fill) for a stable R1–R6 bar chart.
    const ruleMap = new Map(byRule.map((r) => [r.rule, r.count]));
    const rules = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'].map((rule) => ({
      rule,
      count: ruleMap.get(rule) || 0,
    }));

    res.json({ total, byRule: rules, byCourse, overTime, days, timezone: TZ });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7) GET /api/admin/stats/mastery
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats/mastery', async (req, res) => {
  try {
    const [overallAgg, byCourseAgg] = await Promise.all([
      Submission.aggregate([{ $group: { _id: '$pLabel', count: { $sum: 1 } } }]),
      Submission.aggregate([
        { $group: { _id: { course: '$courseCode', p: '$pLabel' }, count: { $sum: 1 } } },
      ]),
    ]);

    const overall = { P1: 0, P2: 0, P3: 0, P4: 0 };
    overallAgg.forEach((r) => {
      if (r._id in overall) overall[r._id] = r.count;
    });

    const byCourseMap = new Map();
    byCourseAgg.forEach((r) => {
      const c = r._id.course;
      const p = r._id.p;
      if (!byCourseMap.has(c)) byCourseMap.set(c, { courseCode: c, P1: 0, P2: 0, P3: 0, P4: 0 });
      if (p && p in byCourseMap.get(c)) byCourseMap.get(c)[p] = r.count;
    });

    res.json({ overall, byCourse: Array.from(byCourseMap.values()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
