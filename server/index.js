require('dotenv').config();
const express = require('express');
const sharp = require('sharp');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const mammoth = require('mammoth');
const htmlPdfNode = require('html-pdf-node');
const heicConvert = require('heic-convert');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: ['https://dm3a-grader.vercel.app',
           'https://dm3a-grader-f4cld6wk8-ralph-minayas-projects.vercel.app',
           'https://dm3agrader.com',
           'https://www.dm3agrader.com',
           'http://localhost:5173'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.options('*', cors());
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

app.post('/grade', async (req, res) => {
  try {
    const clientBlocks = req.body.contentBlocks || req.body.clientBlocks || [];

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

    // Step 2: Deduplicate image blocks by fingerprinting first 100 chars of base64
    const seen = new Set();
    const dedupedBlocks = convertedBlocks.filter(block => {
      if (block.type !== 'image') return true;
      const fp = block.source?.data?.slice(0, 100) || '';
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

    // Validate that the AI returned parseable JSON before sending to client
    const cleaned = text.replace(/```json|```/g, '').trim();
    try {
      JSON.parse(cleaned);
      res.json({ result: text });
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
    }
  } catch (err) {
    console.error('Grade error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

app.listen(PORT, () => {
  console.log(`DM3A Server running on port ${PORT}`);
  console.log(`sharp version: 0.34.5`);
});
