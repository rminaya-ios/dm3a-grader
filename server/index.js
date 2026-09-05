require('dotenv').config();
const express = require('express');
const sharp = require('sharp');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const mammoth = require('mammoth');
const htmlPdfNode = require('html-pdf-node');
const heicConvert = require('heic-convert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── At-Risk Withdrawal Predictor (Phase 1 & 2) ────────────────
const connectDB = require('./config/db.js');
const riskRoutes = require('./routes/risk.js');
const { saveSubmission } = require('./services/submissionService.js');

// ── API cost tracking (Admin Dashboard, Phase 1) ──────────────
const Submission = require('./models/Submission.js');
const GradingEvent = require('./models/GradingEvent.js');
// Cost tracking must NEVER break grading. If apiCost.js is missing or throws at
// load, fall back to no-ops so the server still boots and grading proceeds
// (acceptance test #4). Individual writes are separately try/caught.
let estimateCostUSD, extractUsage;
try {
  ({ estimateCostUSD, extractUsage } = require('./utils/apiCost.js'));
} catch (e) {
  console.warn('[COST] apiCost.js unavailable — cost estimation disabled:', e.message);
  estimateCostUSD = () => 0;
  extractUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
}

// ── Admin dashboard aggregation API (Admin Dashboard, Phase 2) ─
const adminStatsRoutes = require('./routes/adminStats.js');

// ── Student access codes (instructor-linked unlimited Student Mode) ─
const { requireAdminKey } = require('./lib/adminAuth.js');
// At-Risk Bridge (Phase 2): server-to-server auth for POST /api/risk/bridge.
const { requireBridgeKey } = require('./lib/bridgeAuth.js');
const { sendTelegramMessage } = require('./services/alertDispatcher.js');

// ── Server-side name-zone redaction (authoritative pass — reliable on every device) ─
const { redactImageServer } = require('./lib/serverRedact.js');

// ── Blind Grading Mode — roster vault + PII guard (Phase 1) ────
const coursesRoutes = require('./routes/courses.js');
const { piiGuard } = require('./middleware/piiGuard.js');

// ── Instructor accounts (email + password logins, session cookie) ─────────────
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/auth.js');
const myCoursesRoutes = require('./routes/myCourses.js');

// ── Blind Grading (Part C-final): BLANKET PII guard — zero exemptions ──────────
// piiGuard is now on every grading/recording route: /grade, /detect-work,
//   /api/courses/*, /api/risk/record, and /api/submissions/save. No route accepts
//   a student name/email field. (Account-level endpoints — trial signup, the
//   student free-tier counter — legitimately use `email` for account identity and
//   are outside §3.2's student-submission scope, so they are not guarded.)

const app = express();
const PORT = process.env.PORT || 3001;

const corsOptions = {
  origin: ['https://dm3a-grader.vercel.app',
           'https://dm3a-grader-f4cld6wk8-ralph-minayas-projects.vercel.app',
           'https://dm3agrader.com',
           'https://www.dm3agrader.com',
           'http://localhost:5173'],
  // PUT/PATCH/DELETE for the roster-vault routes; x-admin-key for the admin
  // dashboard. Missing x-admin-key here is what broke the /admin gate — the
  // preflight disallowed the header, so the browser blocked the real request
  // (roster-vault worked because it only sends Content-Type).
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // x-risk-bridge-key: the At-Risk Bridge is server-to-server (no browser, no
  // preflight) but listing it keeps the allow-list honest about what the API
  // accepts, and costs nothing.
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key', 'x-risk-bridge-key'],
  // Instructor accounts: the session cookie only rides along on cross-origin
  // requests when this is true AND the origin is an explicit allow-list (never a
  // wildcard — the browser rejects `*` with credentials). The list above is
  // explicit, so this is safe.
  credentials: true
};
app.use(cors(corsOptions));

// Use the SAME options for preflight so OPTIONS advertises the identical
// allowed methods/headers (no permissive-default divergence).
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser()); // reads the dm3a_session cookie (instructor accounts)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/', (req, res) => res.json({ status: 'DM3A Grader Server running' }));

app.post('/upload-pdf', (req, res) => {
  const { base64 } = req.body;
  res.json({ file_id: base64 });
});

app.post('/convert-heic', async (req, res) => {
  try {
    const { base64, filename } = req.body;
    if (!base64 || !filename) return res.status(400).json({ error: 'Missing base64 or filename' });
    const inputBuffer = Buffer.from(base64, 'base64');
    const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.92 });
    const jpegBase64 = Buffer.from(outputBuffer).toString('base64');
    const newFilename = filename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
    console.log('[convert-heic] success, output size:', outputBuffer.length);
    res.json({ jpeg: jpegBase64, filename: newFilename });
  } catch (err) {
    console.error('[convert-heic] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/convert-docx', async (req, res) => {
  let tmpPath = null;
  try {
    const { base64, filename } = req.body;
    const buffer = Buffer.from(base64, 'base64');
    tmpPath = path.join('/tmp', `dm3a_${Date.now()}.docx`);
    fs.writeFileSync(tmpPath, buffer);
    const { value: html } = await mammoth.convertToHtml({ path: tmpPath });
    const wrappedHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;padding:20px">${html}</body></html>`;
    const file = { content: wrappedHtml };
    const options = { format: 'A4' };
    const pdfBuf = await htmlPdfNode.generatePdf(file, options);
    const pdfName = (filename || 'document').replace(/\.docx$/i, '.pdf');
    res.json({ pdf: pdfBuf.toString('base64'), filename: pdfName });
  } catch (err) {
    console.error('[convert-docx] error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
});

// ── AT-RISK PREDICTOR — grading hook ───────────────────────────
// Opportunistic, non-blocking. The /grade endpoint is anonymous batch
// image grading and carries no student identity. To record submissions
// for the At-Risk Predictor, the client must send an OPTIONAL `riskContext`
// alongside the grade request:
//
//   riskContext: {
//     professorEmail:  "rminaya@usj.edu",   // required to record
//     courseCode:      "MATH110-03",        // required to record
//     assignmentName:  "HW3 - Hypothesis Testing",  // required to record
//     assignmentWeight:"homework",          // optional (default homework)
//     assignmentIndex: 3,                    // optional (1 = first assignment)
//     semesterTag:     "Spring2026",         // optional
//     roster: [ { studentName: "Maria Rodriguez", studentEmail: "maria@usj.edu" }, ... ]
//       // maps each graded studentName -> stable studentEmail (the risk model
//       // keys on studentEmail + courseCode). Students with no roster match are skipped.
//   }
//
// Without riskContext (or missing professorEmail/courseCode/assignmentName),
// this is a complete no-op and grading is entirely unaffected.

// "P1".."P4" -> 1..4 ; returns null if unparseable
function tierToScore(tier) {
  const m = /^P\s*([1-4])$/.exec(String(tier || '').trim());
  return m ? Number(m[1]) : null;
}

// Returns { status: 'recorded'|'skipped', flagged?: boolean, reason?: string }.
async function recordOneSubmission(ctx, student) {
  const pScore = tierToScore(student.overallTier ?? student.tier);
  if (!pScore) return { status: 'skipped', reason: 'no-score' };

  const dims = student.dimensions || {};
  const rubricBreakdown = {
    conceptualUnderstanding: tierToScore(dims.conceptualUnderstanding) ?? pScore,
    problemSolving:          tierToScore(dims.problemSolving) ?? pScore,
    workShown:               tierToScore(dims.workShown) ?? pScore,
    accuracy:                tierToScore(dims.accuracy) ?? pScore,
  };

  const roster = Array.isArray(ctx.roster) ? ctx.roster : [];

  // Blind Grading (Part C-1): alias-keyed path — record alias-only, no PII.
  // Gated on the alias appearing in the course alias roster (mirrors the legacy
  // roster-match skip). The legacy name→email path below is unchanged.
  if (student.alias) {
    const alias = String(student.alias).trim();
    const known =
      roster.length === 0 ||
      roster.some((r) => String(r.alias || '').trim().toLowerCase() === alias.toLowerCase());
    if (!known) {
      console.warn(`[AT-RISK] alias "${alias}" not in course roster — skipping save`);
      return { status: 'skipped', reason: 'no-roster-match' };
    }
    const { flagResult } = await saveSubmission({
      alias,
      professorEmail:   ctx.professorEmail,
      courseCode:       ctx.courseCode,
      assignmentName:   ctx.assignmentName,
      assignmentWeight: ctx.assignmentWeight,
      assignmentIndex:  ctx.assignmentIndex,
      pScore,
      rubricBreakdown,
      feedbackSummary:  (student.feedback || '').slice(0, 500),
      semesterTag:      ctx.semesterTag,
      source:           ctx.source || 'grader',
    });
    return { status: 'recorded', flagged: Boolean(flagResult) };
  }

  // ── UNREACHABLE AS OF 2026-08-09 — candidate for deletion ────────────────
  // The legacy name→roster→email path below cannot be reached over HTTP. Both
  // entry points (/grade and /api/risk/record) are behind piiGuard with zero
  // exemptions, and its inputs — student.studentName and ctx.roster[].
  // studentName / studentEmail — are all on the guard's denylist, so such a
  // request is rejected with 400 before this function is ever called.
  //
  // Kept deliberately (decision 2026-08-09): removing it is a separate, cleanly
  // reviewable change, and leaving it costs nothing while the alias pipeline
  // beds in. Do NOT "fix" it by exempting the guard — that would reopen the PII
  // surface Blind Grading Part C-final deliberately closed.
  const wanted = String(student.studentName || '').trim().toLowerCase();
  const match = roster.find(
    (r) => String(r.studentName || '').trim().toLowerCase() === wanted
  );
  if (!match || !match.studentEmail) {
    console.warn(`[AT-RISK] no roster email for "${student.studentName}" — skipping save`);
    return { status: 'skipped', reason: 'no-roster-match' };
  }

  // saveSubmission persists + runs the risk evaluator (which dispatches alerts
  // for a newly created / escalated flag). flagResult is the flag or null.
  const { flagResult } = await saveSubmission({
    studentEmail:     match.studentEmail,
    studentName:      student.studentName,
    professorEmail:   ctx.professorEmail,
    courseCode:       ctx.courseCode,
    assignmentName:   ctx.assignmentName,
    assignmentWeight: ctx.assignmentWeight,
    assignmentIndex:  ctx.assignmentIndex,
    pScore,
    rubricBreakdown,
    feedbackSummary:  (student.feedback || '').slice(0, 500),
    semesterTag:      ctx.semesterTag,
  });

  return { status: 'recorded', flagged: Boolean(flagResult) };
}

// Records a parsed result set against the riskContext roster and RETURNS a
// summary { recorded, skipped, alertsFired }. Never throws.
// - The /grade hook calls this WITHOUT awaiting and ignores the return value
//   (behavior there is unchanged — still fire-and-forget after the response).
// - The /api/risk/record route awaits it to report the summary back.
async function maybeRecordSubmissions(ctx, parsed) {
  const summary = { recorded: 0, skipped: 0, alertsFired: 0 };
  try {
    if (!ctx || !ctx.professorEmail || !ctx.courseCode || !ctx.assignmentName) {
      return summary; // no usable context → no-op
    }
    const students = Array.isArray(parsed) ? parsed : [parsed];
    for (const s of students) {
      try {
        const r = await recordOneSubmission(ctx, s);
        if (r?.status === 'recorded') {
          summary.recorded++;
          if (r.flagged) summary.alertsFired++;
        } else {
          summary.skipped++;
        }
      } catch (err) {
        summary.skipped++;
        console.error(`[AT-RISK] save failed for ${s?.studentName}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[AT-RISK] record error (grading unaffected):', err.message);
  }
  return summary;
}

// ── API COST TRACKING ───────────────────────────────────────────────────────
// All cost tracking is best-effort and MUST NEVER break grading. Every write is
// wrapped in try/catch; callers invoke these fire-and-forget (no await needed).

// Writes one identity-free GradingEvent for a single Anthropic call. Never throws.
async function recordGradingEvent({
  usage,
  model,
  submissionCount = 0,
  gradingDurationMs = 0,
  apiCalls = 1,
  recordedVia = 'auto',
  accessCode = '',
  courseCode = '',
}) {
  try {
    const u = usage || {};
    await GradingEvent.create({
      submissionCount,
      gradingDurationMs,
      recordedVia,
      accessCode,
      courseCode,
      apiUsage: {
        inputTokens:         u.inputTokens || 0,
        outputTokens:        u.outputTokens || 0,
        cacheCreationTokens: u.cacheCreationTokens || 0,
        cacheReadTokens:     u.cacheReadTokens || 0,
        apiCalls,
        estimatedCostUSD:    estimateCostUSD(u),
        model:               model || '',
      },
    });
  } catch (err) {
    console.error('[COST] GradingEvent write failed (grading unaffected):', err.message);
  }
}

// ADDITIVE + DORMANT: attaches per-submission apiUsage to the Submissions that
// /api/risk/record just created, IF the client forwarded `apiUsage` from the
// /grade response. Splits the batch usage evenly across the recorded students.
// Does NOT touch maybeRecordSubmissions / saveSubmission core logic. Never throws.
// No-op today (the frontend does not forward apiUsage yet) — ready to light up
// the by-user / by-course cost views the moment it does.
async function attachApiUsageToSubmissions(ctx, apiUsage, summary) {
  try {
    if (!apiUsage || !ctx || !ctx.professorEmail || !ctx.courseCode || !ctx.assignmentName) return;
    const n = summary && summary.recorded ? summary.recorded : 0;
    if (n < 1) return;

    const split = {
      inputTokens:         (apiUsage.inputTokens || 0) / n,
      outputTokens:        (apiUsage.outputTokens || 0) / n,
      cacheCreationTokens: (apiUsage.cacheCreationTokens || 0) / n,
      cacheReadTokens:     (apiUsage.cacheReadTokens || 0) / n,
    };
    const perDoc = {
      ...split,
      apiCalls:         (apiUsage.apiCalls || 1) / n,
      estimatedCostUSD: estimateCostUSD(split),
      model:            apiUsage.model || '',
    };

    // Target the N most-recently created Submissions for this prof+course+assignment.
    const recent = await Submission.find({
      professorEmail: String(ctx.professorEmail).toLowerCase(),
      courseCode:     String(ctx.courseCode).toUpperCase(),
      assignmentName: ctx.assignmentName,
    })
      .sort({ createdAt: -1 })
      .limit(n)
      .select('_id')
      .lean();

    const ids = recent.map((d) => d._id);
    if (ids.length) {
      await Submission.updateMany(
        { _id: { $in: ids } },
        { $set: { apiUsage: perDoc, recordedVia: 'instructor' } }
      );
    }
  } catch (err) {
    console.error('[COST] attachApiUsageToSubmissions failed (recording unaffected):', err.message);
  }
}
// ── END API COST TRACKING ────────────────────────────────────────────────────

app.post('/grade', piiGuard, async (req, res) => {
  const gradeStartedAt = Date.now();
  try {
    const clientBlocks = req.body.contentBlocks || req.body.clientBlocks || [];
    const recvImageBlocks = clientBlocks.filter(b => b.type === 'image');
    console.log('[SERVER RECV]', clientBlocks.length, 'blocks,', recvImageBlocks.length, 'image blocks');

    // Step 1: Attempt sharp conversion on ALL image blocks regardless of media_type.
    // If sharp succeeds, use the converted JPEG. If it fails, pass the original block through.
    const convertedRaw = await Promise.all(clientBlocks.map(async (block) => {
      if (block.type !== 'image') return block;
      const src = block.source;
      if (!src || src.type !== 'base64') return block;
      console.log(`[sharp] media_type="${src.media_type}" size=${(src.data.length * 0.75 / 1024).toFixed(0)}KB`);
      try {
        const buf = Buffer.from(src.data, 'base64');
        // Filter: skip ZIP/DOCX files (PK magic bytes 0x50 0x4B)
        if (buf[0] === 0x50 && buf[1] === 0x4B) {
          console.warn(`[sharp] SKIPPED — block starts with PK magic bytes (DOCX/ZIP), not an image`);
          return null;
        }
        // Filter: skip raw PDFs mislabeled as images (%PDF magic bytes 0x25 0x50 0x44 0x46)
        if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
          console.warn(`[sharp] SKIPPED — block starts with %PDF magic bytes, mislabeled as ${src.media_type}`);
          return null;
        }
        const jpegBuf = await sharp(buf).jpeg({ quality: 85 }).toBuffer();
        console.log(`[sharp] SUCCESS — output: ${(jpegBuf.length / 1024).toFixed(0)} KB`);
        return { ...block, source: { type: 'base64', media_type: 'image/jpeg', data: jpegBuf.toString('base64') } };
      } catch(e) {
        const isHEIC = buf.slice(0, 12).toString('binary').includes('ftyp');
        if (isHEIC) {
          console.warn(`[sharp] HEIC conversion failed — dropping block: ${e.message}`);
          return null;
        }
        console.warn(`[sharp] Conversion failed for ${src.media_type} — passing original through: ${e.message}`);
        return block;
      }
    }));
    const convertedBlocks = convertedRaw.filter(b => b !== null);
    console.log(`[step1] processed ${convertedBlocks.length} blocks (${convertedRaw.length - convertedBlocks.length} skipped)`);

    // Step 2: Deduplicate image blocks by hashing the full base64 data.
    // (Hashing only a short prefix is unsafe — photos from the same camera/phone
    // often share an identical JFIF/EXIF header in the first bytes, which caused
    // distinct images to be falsely treated as duplicates and dropped.)
    const seen = new Set();
    const dedupedBlocks = convertedBlocks.filter(block => {
      if (block.type !== 'image') return true;
      const fp = block.source?.data
        ? crypto.createHash('md5').update(block.source.data).digest('hex')
        : '';
      if (seen.has(fp)) return false;
      seen.add(fp);
      return true;
    });

    // Step 3: If total image payload > 15 MB, re-compress all images to 800x800 max at quality 50
    const totalBytes = dedupedBlocks.reduce((s, b) =>
      s + (b.type === 'image' ? Buffer.byteLength(b.source.data, 'base64') : 0), 0);
    const finalImageBlocks = totalBytes > 15 * 1024 * 1024
      ? await Promise.all(dedupedBlocks.map(async (block) => {
          if (block.type !== 'image') return block;
          try {
            const buf = Buffer.from(block.source.data, 'base64');
            const smallBuf = await sharp(buf).resize(800, 800, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 50 }).toBuffer();
            return { ...block, source: { type: 'base64', media_type: 'image/jpeg', data: smallBuf.toString('base64') } };
          } catch(e) {
            return block;
          }
        }))
      : dedupedBlocks;

    console.log(`[step2] after dedup: ${dedupedBlocks.length} blocks (was ${convertedBlocks.length})`);
    console.log(`GRADE HIT — blocks in: ${clientBlocks.length}, after dedup: ${dedupedBlocks.length}, payload: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

    const IMAGE_READING_PREFIX = `You will receive one or more images of a student's handwritten or typed math assignment. The images may be photos, scans, or PDF pages rendered as JPEGs. Even if the image appears faint, low-contrast, or partially legible, attempt to read and grade all visible work. Do not report that no student work is found unless the image is completely blank (solid white or black with no marks whatsoever).

If handwriting is difficult to read, give the student benefit of the doubt and attempt a best-effort interpretation before assigning a score.

`;
    const systemPrompt = IMAGE_READING_PREFIX + (req.body.systemPrompt || '');
    const userPrompt = req.body.userPrompt || '';

    console.log('GRADE HIT - blocks received:', clientBlocks.length, 'system:', systemPrompt.slice(0, 50));

    const hasImages = finalImageBlocks.some(b => b.type === 'image');
    const inputHadImages = clientBlocks.some(b => b.type === 'image');
    const allImagesDropped = inputHadImages && !hasImages;
    if (allImagesDropped) {
      console.warn('[grade] All image blocks were dropped — injecting fallback text block');
    }
    const fallbackBlock = { type: 'text', text: '[Note: Student submitted images in a format that could not be processed. Grade based on text content only if available, otherwise return P1 with feedback asking student to resubmit in JPG or PDF format.]' };
    const finalBlocks = clientBlocks.length > 0
      ? [...finalImageBlocks, ...(allImagesDropped ? [fallbackBlock] : []), { type: 'text', text: userPrompt }]
      : [{ type: 'text', text: userPrompt || 'No content provided' }];

    let response;
    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 64000,
        // Grading is a judgement task, not a creative one: the same paper must score
        // the same way on every run or an instructor cannot defend a grade on appeal.
        // The API default of 1.0 was measurably costing reproducibility.
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: finalBlocks }],
      });
    } catch (apiErr) {
      console.error('[anthropic] API call failed\n', apiErr.stack);
      console.error('[anthropic] status:', apiErr.status, 'headers:', JSON.stringify(apiErr.headers ?? {}));
      console.error('[anthropic] error body:', JSON.stringify(apiErr.error ?? apiErr.message));
      throw apiErr;
    }
    const text = response.content?.[0]?.text ?? '';
    console.log('Sending result, length:', text?.length);
    console.log('AI response preview:', text.slice(0, 200));

    // Cost tracking: capture usage from the main grading call (best-effort).
    const usage = extractUsage(response);
    const usedModel = response.model || 'claude-sonnet-4-6';

    // Validate that the AI returned parseable JSON before sending to client
    const cleaned = text.replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      res.json({ result: text });
      // At-Risk Predictor: opportunistic, non-blocking, runs after the response.
      maybeRecordSubmissions(req.body.riskContext, parsed);
      // Access-code daily counter + early-warning alert (fire-and-forget). Only
      // does anything when the client forwarded a valid coded session.
      const codeCtx = req.body.codeContext || null;
      if (codeCtx && codeCtx.code) tallyCodedSubmission(codeCtx);
      // API cost: identity-free GradingEvent, fire-and-forget, never blocks/breaks.
      recordGradingEvent({
        usage,
        model: usedModel,
        submissionCount: Array.isArray(parsed) ? parsed.length : 1,
        gradingDurationMs: Date.now() - gradeStartedAt,
        recordedVia: 'auto',
        accessCode: normalizeCode(codeCtx?.code),
        courseCode: codeCtx?.course || '',
      });
    } catch (parseErr) {
      console.error('[parse] AI returned non-JSON response. Full text:', text.slice(0, 500));
      const fallback = JSON.stringify([{
        studentName: 'Unknown',
        overallTier: 'P1',
        dimensions: { conceptualUnderstanding: 'P1', problemSolving: 'P1', workShown: 'P1', accuracy: 'P1' },
        problems: [],
        strengths: [],
        growthAreas: [],
        feedback: 'Grading error: AI returned an unexpected response. Please resubmit this student.',
        instructorNote: 'Server could not parse AI response as JSON. Raw preview: ' + text.slice(0, 200)
      }]);
      res.json({ result: fallback });
      // Tokens were still consumed even though the AI response was unparseable —
      // still count it against the code's daily budget and tag the cost record.
      const codeCtxErr = req.body.codeContext || null;
      if (codeCtxErr && codeCtxErr.code) tallyCodedSubmission(codeCtxErr);
      recordGradingEvent({
        usage,
        model: usedModel,
        submissionCount: 1,
        gradingDurationMs: Date.now() - gradeStartedAt,
        recordedVia: 'auto',
        accessCode: normalizeCode(codeCtxErr?.code),
        courseCode: codeCtxErr?.course || '',
      });
    }
  } catch (err) {
    console.error('Grade error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AT-RISK: explicit recording endpoint ───────────────────────────────────
// Called by the frontend AFTER the professor confirms the roster on the results
// screen (the grade flow can't carry confirmation, since confirmation happens
// post-grade). Reuses the SAME maybeRecordSubmissions logic the dormant /grade
// hook uses. Same protection as /grade (CORS only). Never throws.
// Body: { riskContext, results }  ->  { success, recorded, skipped, alertsFired }
// Part C-final: blanket guard mounted (zero exemptions). All recording is
// alias-only now; a name/email payload is rejected here just like everywhere else.
app.post('/api/risk/record', piiGuard, async (req, res) => {
  try {
    const { riskContext, results, apiUsage } = req.body || {};
    const summary = await maybeRecordSubmissions(riskContext, results);
    // ADDITIVE cost attribution: only runs if the client forwarded `apiUsage`
    // (dormant today). Fire-and-forget; never alters recording or the response.
    attachApiUsageToSubmissions(riskContext, apiUsage, summary).catch(() => {});
    res.json({ success: true, ...summary });
  } catch (err) {
    console.error('[AT-RISK] /api/risk/record error:', err.message);
    res.status(500).json({ success: false, error: err.message, recorded: 0, skipped: 0, alertsFired: 0 });
  }
});

// ── AT-RISK BRIDGE: single alias-keyed record from DM3A CheckPoint ─────────
// Phase 2, Option A. CheckPoint posts ONE instructor-confirmed level here so a
// student sliding across both apps trips one rule set and one alert stream.
//
// Distinct from /api/risk/record on purpose: that one is a grading-shaped BATCH
// ({ riskContext, results[] }) and is left completely untouched. This one takes
// a single flat record, and skips the roster-membership check because the
// caller is authenticated — CheckPoint already validated the alias against its
// own course before sending.
//
// Auth: X-Risk-Bridge-Key (fail closed). piiGuard still applies, so a name field
// is rejected here exactly as everywhere else — the bridge is alias-only by
// construction AND by enforcement.
//
// body: { alias, courseCode, professorEmail, assignmentName, pScore,
//         assignmentWeight?, source?, semesterTag?, sessionDate?, submittedAt? }
//   -> { success, recorded, flagged }

// Weights the rule engine treats as high-stakes (mirrors HIGH_WEIGHT_TYPES in
// services/riskEvaluator.js). A bridged record must never look like one: R4
// ("P1 on a high-weight assignment") is meaningless for a formative in-class
// check, so the weight is forced to 'practice' if a caller claims otherwise.
// Enforcing the invariant here, rather than trusting the sender, is what makes
// "CheckPoint never fires R4" a property of the system instead of a convention.
const BRIDGE_FORBIDDEN_WEIGHTS = ['quiz', 'midterm', 'exam'];
const BRIDGE_DEFAULT_WEIGHT = 'practice';

app.post('/api/risk/bridge', requireBridgeKey, piiGuard, async (req, res) => {
  try {
    const b = req.body || {};
    const alias = String(b.alias || '').trim();
    const courseCode = String(b.courseCode || '').trim();
    const professorEmail = String(b.professorEmail || '').trim();
    const assignmentName = String(b.assignmentName || '').trim();
    const pScore = Number(b.pScore);

    if (!alias) return res.status(400).json({ error: 'alias required (bridge records are alias-only)' });
    if (!courseCode) return res.status(400).json({ error: 'courseCode required' });
    if (!professorEmail) return res.status(400).json({ error: 'professorEmail required' });
    if (!assignmentName) return res.status(400).json({ error: 'assignmentName required' });
    if (!Number.isInteger(pScore) || pScore < 1 || pScore > 4) {
      // CheckPoint's P0 ("did not attempt") has no equivalent here and is
      // filtered on its side; reject it explicitly rather than coercing.
      return res.status(400).json({ error: 'pScore must be an integer 1-4' });
    }

    let assignmentWeight = String(b.assignmentWeight || BRIDGE_DEFAULT_WEIGHT).trim();
    if (BRIDGE_FORBIDDEN_WEIGHTS.includes(assignmentWeight)) {
      console.warn(
        `[RISK BRIDGE] refusing high-weight "${assignmentWeight}" on a bridged record — ` +
          `forcing "${BRIDGE_DEFAULT_WEIGHT}" (course=${courseCode})`
      );
      assignmentWeight = BRIDGE_DEFAULT_WEIGHT;
    }

    const ctx = {
      professorEmail,
      courseCode,
      assignmentName,
      assignmentWeight,
      // assignmentIndex deliberately absent: R6 ("P1 on the FIRST assignment")
      // must not fire on a formative checkpoint.
      semesterTag: b.semesterTag || null,
      source: String(b.source || 'checkpoint').trim() || 'checkpoint',
      roster: [], // empty => recordOneSubmission skips the roster-match gate
    };

    // Reuse the existing alias path verbatim. Building the same shape /grade
    // produces means one save/evaluate/alert code path, not a parallel one that
    // can drift.
    const student = { alias, overallTier: `P${pScore}` };
    const result = await recordOneSubmission(ctx, student);

    if (result?.status !== 'recorded') {
      console.warn(`[RISK BRIDGE] not recorded (${result?.reason || 'unknown'}) alias=${alias}`);
      return res.status(422).json({ success: false, recorded: 0, reason: result?.reason || 'not-recorded' });
    }

    console.log(
      `[RISK BRIDGE] recorded ${alias} | ${courseCode} | ${assignmentName} | P${pScore}` +
        (result.flagged ? ' | FLAGGED' : '')
    );
    return res.json({ success: true, recorded: 1, flagged: Boolean(result.flagged) });
  } catch (err) {
    console.error('[RISK BRIDGE] error:', err.message);
    // 5xx so the sender queues and retries rather than dropping the record.
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── STUDENT WORK GATEKEEPER ────────────────────────────────────────────────
// Cheap/fast haiku call — returns classification JSON without grading anything.
// Called by the student flow ONLY. Any error fails open (passes through).
app.post('/detect-work', piiGuard, async (req, res) => {
  const detectStartedAt = Date.now();
  let gatekeeperUsage = null;                          // set once the API call returns
  let gatekeeperModel = 'claude-haiku-4-5-20251001';
  try {
    const clientBlocks = req.body.contentBlocks || [];
    const imageBlocks = clientBlocks.filter(b => b.type === 'image');
    console.log(`[STUDENT GATEKEEPER] /detect-work called — ${imageBlocks.length} image block(s)`);

    if (imageBlocks.length === 0) {
      console.log('[STUDENT GATEKEEPER] no images → PASS');
      return res.json({ classification: 'HAS_WORK', work_present: true, confidence: 0, reason: 'No images received' });
    }

    // Run through sharp (same as /grade) so haiku sees clean JPEGs
    const convertedBlocks = await Promise.all(imageBlocks.map(async (block) => {
      try {
        const buf = Buffer.from(block.source.data, 'base64');
        const jpegBuf = await sharp(buf).jpeg({ quality: 85 }).toBuffer();
        return { ...block, source: { type: 'base64', media_type: 'image/jpeg', data: jpegBuf.toString('base64') } };
      } catch { return block; }
    }));

    const detectionPrompt = req.body.detectionPrompt || '';

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: [...convertedBlocks, { type: 'text', text: detectionPrompt }] }]
    });

    // Cost tracking: capture gatekeeper usage (best-effort).
    gatekeeperUsage = extractUsage(response);
    gatekeeperModel = response.model || gatekeeperModel;

    const raw = response.content?.[0]?.text ?? '';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const decision = parsed.work_present ? 'PASS' : 'BLOCK';
    console.log(`[STUDENT GATEKEEPER] classification=${parsed.classification} confidence=${parsed.confidence} → ${decision}: "${parsed.reason}"`);
    res.json(parsed);
    // API cost: gatekeeper call (no grading → submissionCount 0). Fire-and-forget.
    recordGradingEvent({
      usage: gatekeeperUsage,
      model: gatekeeperModel,
      submissionCount: 0,
      gradingDurationMs: Date.now() - detectStartedAt,
      recordedVia: 'gatekeeper',
    });
  } catch (err) {
    // Fail open — a detection error must never block a real student attempt
    console.error('[STUDENT GATEKEEPER] error — PASS:', err.message);
    res.json({ classification: 'HAS_WORK', work_present: true, confidence: 0, reason: 'Detection error — passing through' });
    // If the API call returned before a later step threw, tokens were still
    // consumed — record them so cost attribution stays complete.
    if (gatekeeperUsage) {
      recordGradingEvent({
        usage: gatekeeperUsage,
        model: gatekeeperModel,
        submissionCount: 0,
        gradingDurationMs: Date.now() - detectStartedAt,
        recordedVia: 'gatekeeper',
      });
    }
  }
});
// ── END STUDENT WORK GATEKEEPER ────────────────────────────────────────────

// ── STUDENT SUBMISSION COUNTER ─────────────────────────────────────────────
const STUDENT_FREE_MAX = 5;

app.post('/student-check-allowance', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

    const key = `student:subs:${email}`;
    const raw = await redis.get(key);
    const used = raw === null ? 0 : parseInt(raw, 10);
    const remaining = Math.max(0, STUDENT_FREE_MAX - used);
    res.json({ allowed: remaining > 0, used, remaining, max: STUDENT_FREE_MAX });
  } catch (err) {
    console.error('[STUDENT COUNTER] check-allowance error — allowing:', err.message);
    res.json({ allowed: true, used: 0, remaining: STUDENT_FREE_MAX, max: STUDENT_FREE_MAX });
  }
});

app.post('/student-record-submission', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

    const key = `student:subs:${email}`;
    const used = await redis.incr(key);
    const remaining = Math.max(0, STUDENT_FREE_MAX - used);
    console.log(`[STUDENT COUNTER] ${email} : used ${used}/${STUDENT_FREE_MAX} (remaining: ${remaining})`);
    res.json({ used, remaining, max: STUDENT_FREE_MAX });
  } catch (err) {
    console.error('[STUDENT COUNTER] record error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
// ── END STUDENT SUBMISSION COUNTER ────────────────────────────────────────────

app.post('/delete-file', async (req, res) => {
  try {
    const { file_id } = req.body;
    await anthropic.beta.files.delete(file_id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TRIAL SYSTEM ──────────────────────────────────────────────
const { Redis } = require('@upstash/redis');
const { Resend } = require('resend');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
// Lazy for the same reason as services/alertDispatcher.js: Resend throws from its
// constructor without a key, which made the server unbootable locally. Unchanged
// on Railway, where RESEND_API_KEY is set.
let _resend = null;
function resendClient() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ── STUDENT ACCESS CODES (instructor-linked unlimited Student Mode) ────────────
// A code maps ONLY to a course (course code + instructor email) — never to a
// student. Creating codes requires the admin key (they grant unlimited API use).
// Checking a code is public but rate-limited. A daily circuit breaker caps each
// code at CODE_DAILY_MAX submissions/day (reset at ET midnight) so a leaked code
// produces at most a one-day burst; at CODE_ALERT_AT the first crossing pushes one
// Telegram warning for the day.
const CODE_DAILY_MAX        = Number(process.env.CODE_DAILY_MAX || 100);
const CODE_ALERT_AT         = Number(process.env.CODE_ALERT_AT || 60);
const CODE_CHECK_RL_PER_MIN = Number(process.env.CODE_CHECK_RL_PER_MIN || 20);
const CODE_TZ               = process.env.DASHBOARD_TZ || 'America/New_York';
const CODE_ALPHABET         = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
const CODE_KEY_TTL          = 129600; // ~36h — daily counters/alert flags auto-clean

// YYYY-MM-DD in Eastern time — the daily bucket. Rolls over at ET midnight.
function etDayKey(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: CODE_TZ });
}
// Student self-check dimension scope carried on an access code. Anything absent
// defaults to true, so a code minted before this existed behaves exactly as before.
function normalizeDims(d) {
  const o = d && typeof d === 'object' ? d : {};
  return {
    conceptualUnderstanding: o.conceptualUnderstanding !== false,
    problemSolving:          o.problemSolving !== false,
    workShown:               o.workShown !== false,
    accuracy:                o.accuracy !== false,
  };
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
}
function makeCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return `DM3A-${s}`;
}

// Fire-and-forget: count one coded submission for today and, the first time the
// day's count crosses CODE_ALERT_AT, push ONE Telegram warning. Validates the code
// first and no-ops on an unknown code. The daily CAP is enforced by /code-check
// before grading, not here. Never throws (grading must be unaffected).
async function tallyCodedSubmission(codeContext) {
  try {
    const code = normalizeCode(codeContext?.code);
    if (!code) return;
    const raw = await redis.get(`accesscode:${code}`);
    if (!raw) return; // unknown code — don't count or alert
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const day = etDayKey();
    const countKey = `codecount:${code}:${day}`;
    const count = await redis.incr(countKey);
    if (count === 1) await redis.expire(countKey, CODE_KEY_TTL);
    console.log(`[ACCESS CODE] ${code} (${meta.course || '?'}) — ${count}/${CODE_DAILY_MAX} today`);
    if (count >= CODE_ALERT_AT) {
      const alertKey = `codealert:${code}:${day}`;
      const first = await redis.set(alertKey, '1', { nx: true, ex: CODE_KEY_TTL });
      if (first) {
        console.warn(`[ACCESS CODE ALERT] ${code} (${meta.course || '?'}) crossed ${CODE_ALERT_AT} — ${count} today`);
        await sendTelegramMessage([
          `⚠️ *DM3A Access-Code Usage*`,
          `🔑 Code: ${code}`,
          `📚 Course: ${meta.course || '(unknown)'}`,
          `📈 Today: ${count}/${CODE_DAILY_MAX} submissions (warn at ${CODE_ALERT_AT})`,
          `Daily cap ${CODE_DAILY_MAX} contains a leaked code within a day.`,
        ].join('\n'));
      }
    }
  } catch (err) {
    console.error('[ACCESS CODE] tally failed (grading unaffected):', err.message);
  }
}

// Generate (or regenerate) an access code for a course. ADMIN-ONLY (same key as
// /api/admin). Regenerating invalidates the previous code immediately.
// body: { course, professorEmail?, previousCode? } -> { code, course }
app.post('/instructor/access-code/generate', requireAdminKey, async (req, res) => {
  try {
    const course = String(req.body?.course || '').trim();
    if (!course) return res.status(400).json({ error: 'course is required' });
    const professorEmail = String(req.body?.professorEmail || '').trim().toLowerCase();
    const previousCode = normalizeCode(req.body?.previousCode);

    if (previousCode) await redis.del(`accesscode:${previousCode}`); // invalidate old

    let code = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = makeCode();
      const ok = await redis.set(
        `accesscode:${candidate}`,
        JSON.stringify({ course, professorEmail, dims: normalizeDims(req.body?.dims), createdAt: new Date().toISOString() }),
        { nx: true }
      );
      if (ok) { code = candidate; break; }
    }
    if (!code) return res.status(500).json({ error: 'Could not allocate a unique code — try again.' });
    console.log(`[ACCESS CODE] generated ${code} for "${course}"${previousCode ? ` (replaced ${previousCode})` : ''}`);
    res.json({ code, course });
  } catch (err) {
    console.error('[ACCESS CODE] generate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update the student self-check dimension scope for an EXISTING code, without
// rotating the code. ADMIN-ONLY. body: { code, dims } -> { ok, dims }
app.post('/instructor/access-code/dims', requireAdminKey, async (req, res) => {
  try {
    const code = normalizeCode(req.body?.code);
    if (!code) return res.status(400).json({ error: 'code is required' });
    const raw = await redis.get(`accesscode:${code}`);
    if (!raw) return res.status(404).json({ error: 'Unknown or expired code' });
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
    meta.dims = normalizeDims(req.body?.dims);
    await redis.set(`accesscode:${code}`, JSON.stringify(meta));
    console.log(`[ACCESS CODE] dims updated for ${code}: ${Object.entries(meta.dims).filter(([, v]) => v).map(([k]) => k).join(',')}`);
    res.json({ ok: true, dims: meta.dims });
  } catch (err) {
    console.error('[ACCESS CODE] dims error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Validate a code + report today's headroom. PUBLIC. Anti-brute-force limiter
// counts ONLY wrong guesses per IP/minute — a correct code is never rate-limited,
// so a whole computer lab sharing one NAT IP and entering the SAME valid code is
// never throttled, while guessing (mostly-invalid) attempts are still capped.
// body: { code } -> { valid, allowed, course?, usedToday?, max }
app.post('/code-check', async (req, res) => {
  try {
    const code = normalizeCode(req.body?.code);
    if (!code) return res.json({ valid: false });
    const raw = await redis.get(`accesscode:${code}`);
    if (!raw) {
      // Unknown code — count as a guess against the per-IP limit (best-effort).
      try {
        const minute = Math.floor(Date.now() / 60000);
        const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
          .toString().split(',')[0].trim();
        const rlKey = `codecheck:bad:${ip}:${minute}`;
        const bad = await redis.incr(rlKey);
        if (bad === 1) await redis.expire(rlKey, 65);
        if (bad > CODE_CHECK_RL_PER_MIN) {
          return res.status(429).json({ error: 'Too many attempts — try again shortly.' });
        }
      } catch (_e) { /* limiter is best-effort — never block a real student */ }
      return res.json({ valid: false });
    }
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const countRaw = await redis.get(`codecount:${code}:${etDayKey()}`);
    const used = countRaw ? parseInt(countRaw, 10) : 0;
    res.json({ valid: true, allowed: used < CODE_DAILY_MAX, course: meta.course || '', dims: normalizeDims(meta.dims), usedToday: used, max: CODE_DAILY_MAX });
  } catch (err) {
    console.error('[ACCESS CODE] check error:', err.message);
    // Fail SAFE for students: on our error, don't grant unlimited — fall to free tier.
    res.json({ valid: false, error: 'check_failed' });
  }
});

// ── SERVER-SIDE NAME-ZONE REDACTION (authoritative pass) ──────────────────────
// The browser attempts redaction first (so on a capable device the name never
// leaves it), then sends the page images here for the reliable pass — this catches
// what a device's browser OCR missed (e.g. iPad). FAIL CLOSED: if ANY page can't be
// verified, respond 422 so the client aborts grading instead of sending it onward.
// body: { images: [base64,...] } -> { images: [base64,...], perPage: [{redacted,words}] }
// Top fraction of the first page to black out as a safety net when OCR finds no name
// (catches handwritten names OCR can't read). Tunable via env.
const REDACT_BAND_FRACTION = Number(process.env.REDACT_BAND_FRACTION || 0.15);

app.post('/redact', async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) return res.json({ images: [], perPage: [] });
    const out = [];
    const perPage = [];
    let redactedCount = 0, positionalCount = 0;
    for (let idx = 0; idx < images.length; idx++) {
      // Positional safety net only on the first page (where a name would be).
      const r = await redactImageServer(images[idx], { positionalBand: idx === 0 ? REDACT_BAND_FRACTION : 0 });
      out.push(r.base64);
      perPage.push({ redacted: !!r.redacted, words: r.words || 0, positional: !!r.positional });
      if (r.redacted) redactedCount++;
      if (r.positional) positionalCount++;
    }
    console.log(`[REDACT SERVER] verified ${images.length} page(s); redacted ${redactedCount} (positional safety net on ${positionalCount})`);
    res.json({ images: out, perPage });
  } catch (err) {
    console.error('[REDACT SERVER] fail-closed:', err.message);
    res.status(422).json({ error: 'Could not verify name-zone redaction: ' + err.message });
  }
});

// Health check for uptime monitoring (e.g. UptimeRobot). Returns 200 whenever the server
// is up. DB state is informational only — Mongo is fail-open, so a DB blip must NOT read
// as "site down". mongo: 1=connected, 0/2=reconnecting.
app.get('/healthz', (req, res) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()), mongo: require('mongoose').connection.readyState });
});

function generateTrialPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let pwd = 'trial-';
  for (let i = 0; i < 6; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

app.post('/request-trial', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

    const password = generateTrialPassword();
    const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const signupDate = new Date().toISOString();

    await redis.set(`trial:${password}`, JSON.stringify({ email, expiry, signupDate }), { ex: 7 * 24 * 60 * 60 });

    await resendClient().emails.send({
      from: 'DM3A Grader <support@dm3agrader.com>',
      to: email,
      bcc: 'ralph.minaya@drminaya.com',
      subject: 'Your DM3A Grader Trial Access',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;">
          <div style="background:#1B2A4A;padding:24px;border-radius:8px 8px 0 0;">
            <h2 style="color:#fff;margin:0;">DM3A Grader</h2>
            <p style="color:#C9A84C;margin:4px 0 0;">Mastery-Based Grading for Math Instructors</p>
          </div>
          <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #eee;">
            <p>Your 7-day free trial is ready. Use the password below to sign in at <a href="https://dm3agrader.com">dm3agrader.com</a>:</p>
            <div style="background:#fff;border:2px solid #1B2A4A;border-radius:6px;padding:16px;text-align:center;margin:20px 0;">
              <span style="font-size:24px;font-weight:bold;letter-spacing:2px;color:#1B2A4A;">${password}</span>
            </div>
            <p style="color:#666;font-size:14px;">This password expires in 7 days. No credit card required.</p>
            <p style="color:#666;font-size:14px;">Questions? Reply to this email or contact <a href="mailto:support@dm3agrader.com">support@dm3agrader.com</a>.</p>
            <p style="margin-top:24px;">— Dr. Ralph Minaya, Ed.D.<br>Creator, DM3A Grader</p>
          </div>
        </div>
      `
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Trial request error:', err);
    res.status(500).json({ error: 'Failed to create trial' });
  }
});

app.post('/validate-trial', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ valid: false });

    const data = await redis.get(`trial:${password}`);
    if (!data) return res.json({ valid: false, reason: 'not_found' });

    const { expiry } = typeof data === 'string' ? JSON.parse(data) : data;
    if (Date.now() > expiry) return res.json({ valid: false, reason: 'expired' });

    res.json({ valid: true });
  } catch (err) {
    console.error('Validate trial error:', err);
    res.status(500).json({ valid: false });
  }
});
// ── END TRIAL SYSTEM ───────────────────────────────────────────

// ── AT-RISK WITHDRAWAL PREDICTOR ───────────────────────────────
// Connect MongoDB before the server starts accepting traffic, then
// mount the risk + submission + insights routes under /api.
connectDB();
app.use('/api', riskRoutes);
// ── END AT-RISK PREDICTOR ──────────────────────────────────────

// ── ADMIN DASHBOARD (read-only aggregation API, Phase 2) ───────
app.use('/api/admin', adminStatsRoutes);
// ── END ADMIN DASHBOARD ────────────────────────────────────────

// ── BLIND GRADING (roster vault + PII guard, Phase 1) ──────────
app.use('/api/courses', coursesRoutes);
// ── END BLIND GRADING ──────────────────────────────────────────

// ── INSTRUCTOR ACCOUNTS ────────────────────────────────────────
// Replaces the shared app password with per-instructor logins. /api/auth also
// serves the shared-password fallback (ALLOW_LEGACY_LOGIN) so nothing breaks
// mid-migration; /api/my/courses is strictly account-scoped.
app.use('/api/auth', authRoutes);
app.use('/api/my/courses', myCoursesRoutes);
// ── END INSTRUCTOR ACCOUNTS ────────────────────────────────────

app.listen(PORT, () => {
  console.log(`DM3A Server running on port ${PORT}`);
  console.log(`sharp version: 0.34.5`);
});
