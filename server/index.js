require('dotenv').config();
const express = require('express');
const sharp = require('sharp');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/', (req, res) => res.json({ status: 'DM3A Grader Server running' }));

app.post('/upload-pdf', (req, res) => {
  const { base64 } = req.body;
  res.json({ file_id: base64 });
});

app.post('/grade', async (req, res) => {
  try {
    const clientBlocks = req.body.contentBlocks || req.body.clientBlocks || [];

    // Convert any HEIC/HEIF images to JPEG transparently
    const convertedBlocks = await Promise.all(clientBlocks.map(async (block) => {
      if (block.type !== 'image') return block;
      const src = block.source;
      if (!src || src.type !== 'base64') return block;
      const isHEIC = src.media_type === 'image/heic' || src.media_type === 'image/heif';
      if (!isHEIC) return block;
      try {
        const buf = Buffer.from(src.data, 'base64');
        const jpegBuf = await sharp(buf).jpeg({ quality: 85 }).toBuffer();
        return { ...block, source: { ...src, media_type: 'image/jpeg', data: jpegBuf.toString('base64') } };
      } catch(e) {
        console.warn('HEIC conversion failed for block, sending as-is:', e.message);
        return block;
      }
    }));
    const systemPrompt = req.body.systemPrompt || '';
    const userPrompt = req.body.userPrompt || '';

    console.log('GRADE HIT - blocks received:', clientBlocks.length, 'system:', systemPrompt.slice(0, 50));

    const finalBlocks = clientBlocks.length > 0
      ? [...convertedBlocks, { type: 'text', text: userPrompt }]
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
