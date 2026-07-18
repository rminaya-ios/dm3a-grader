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

// ── Blind Grading Mode — roster vault + PII guard (Phase 1) ────
const coursesRoutes = require('./routes/courses.js');

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
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
  credentials: false
};
app.use(cors(corsOptions));

// Use the SAME options for preflight so OPTIONS advertises the identical
// allowed methods/headers (no permissive-default divergence).
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '50mb' }));

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
}) {
  try {
    const u = usage || {};
    await GradingEvent.create({
      submissionCount,
      gradingDurationMs,
      recordedVia,
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

app.post('/grade', async (req, res) => {
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
      // API cost: identity-free GradingEvent, fire-and-forget, never blocks/breaks.
      recordGradingEvent({
        usage,
        model: usedModel,
        submissionCount: Array.isArray(parsed) ? parsed.length : 1,
        gradingDurationMs: Date.now() - gradeStartedAt,
        recordedVia: 'auto',
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
      // Tokens were still consumed even though the AI response was unparseable.
      recordGradingEvent({
        usage,
        model: usedModel,
        submissionCount: 1,
        gradingDurationMs: Date.now() - gradeStartedAt,
        recordedVia: 'auto',
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
app.post('/api/risk/record', async (req, res) => {
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

// ── STUDENT WORK GATEKEEPER ────────────────────────────────────────────────
// Cheap/fast haiku call — returns classification JSON without grading anything.
// Called by the student flow ONLY. Any error fails open (passes through).
app.post('/detect-work', async (req, res) => {
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
const resend = new Resend(process.env.RESEND_API_KEY);

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

    await resend.emails.send({
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

app.listen(PORT, () => {
  console.log(`DM3A Server running on port ${PORT}`);
  console.log(`sharp version: 0.34.5`);
});
