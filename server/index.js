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

    // Step 1: Convert ALL images to sRGB JPEG
    const convertedBlocks = await Promise.all(clientBlocks.map(async (block) => {
      if (block.type !== 'image') return block;
      const src = block.source;
      if (!src || src.type !== 'base64') return block;
      try {
        const buf = Buffer.from(src.data, 'base64');
        const jpegBuf = await sharp(buf).toColorspace('srgb').jpeg({ quality: 75, mozjpeg: false }).toBuffer();
        return { ...block, source: { type: 'base64', media_type: 'image/jpeg', data: jpegBuf.toString('base64') } };
      } catch(e) {
        console.warn('Image conversion failed, sending as-is:', e.message);
        return block;
      }
    }));

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

    console.log(`GRADE HIT — blocks in: ${clientBlocks.length}, after dedup: ${dedupedBlocks.length}, payload: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

    const systemPrompt = req.body.systemPrompt || '';
    const userPrompt = req.body.userPrompt || '';

    console.log('GRADE HIT - blocks received:', clientBlocks.length, 'system:', systemPrompt.slice(0, 50));

    const finalBlocks = clientBlocks.length > 0
      ? [...finalImageBlocks, { type: 'text', text: userPrompt }]
      : [{ type: 'text', text: userPrompt || 'No content provided' }];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: finalBlocks }],
    });
    const text = response.content?.[0]?.text ?? '';
    console.log('Sending result, length:', text?.length);
    res.json({ result: text });
  } catch (err) {
    console.error('Grade error:', err);
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

app.listen(PORT, () => console.log(`DM3A Server running on port ${PORT}`));
