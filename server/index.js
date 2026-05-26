require('dotenv').config();
const express = require('express');
const sharp = require('sharp');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/', (req, res) => res.json({ status: 'DM3A Grader Server running' }));

app.post('/upload-pdf', (req, res) => {
  const { base64 } = req.body;
  res.json({ file_id: base64 });
});

app.post('/grade', async (req, res) => {
  try {
    const clientBlocks = req.body.contentBlocks || req.body.clientBlocks || [];

    // Step 1: Convert ALL images to sRGB JPEG; skip (null) unprocessable HEIC/HEIF on error
    const convertedRaw = await Promise.all(clientBlocks.map(async (block) => {
      if (block.type !== 'image') return block;
      const src = block.source;
      if (!src || src.type !== 'base64') return block;
      const isHEIC = src.media_type === 'image/heic' || src.media_type === 'image/heif';
      console.log(`[sharp] media_type="${src.media_type}" first20="${src.data.slice(0, 20)}" size=${(src.data.length * 0.75 / 1024).toFixed(0)}KB`);
      try {
        const buf = Buffer.from(src.data, 'base64');
        const jpegBuf = await sharp(buf).rotate().toColorspace('srgb').withMetadata(false).jpeg({ quality: 75, force: true }).toBuffer();
        console.log(`[sharp] SUCCESS — output: ${(jpegBuf.length / 1024).toFixed(0)} KB`);
        if (jpegBuf[0] !== 0xFF || jpegBuf[1] !== 0xD8) {
          console.warn(`[sharp] Invalid JPEG magic bytes: 0x${jpegBuf[0].toString(16)} 0x${jpegBuf[1].toString(16)} — dropping block`);
          return null;
        }
        return { ...block, source: { type: 'base64', media_type: 'image/jpeg', data: jpegBuf.toString('base64') } };
      } catch(e) {
        if (isHEIC) {
          console.warn('[sharp] HEIC conversion failed — skipping block\n', e.stack);
          return null;
        }
        console.warn('[sharp] Image conversion failed — sending as-is\n', e.stack);
        return block;
      }
    }));
    const droppedCount = convertedRaw.filter(b => b === null).length;
    const convertedBlocks = convertedRaw.filter(b => b !== null);
    console.log(`[step1] kept: ${convertedBlocks.length}, dropped (null): ${droppedCount}`);

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

    const systemPrompt = req.body.systemPrompt || '';
    const userPrompt = req.body.userPrompt || '';

    console.log('GRADE HIT - blocks received:', clientBlocks.length, 'system:', systemPrompt.slice(0, 50));

    const finalBlocks = clientBlocks.length > 0
      ? [...finalImageBlocks, { type: 'text', text: userPrompt }]
      : [{ type: 'text', text: userPrompt || 'No content provided' }];

    let response;
    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
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
    res.json({ result: text });
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

app.listen(PORT, () => {
  console.log(`DM3A Server running on port ${PORT}`);
  console.log(`sharp version: 0.34.5`);
});
