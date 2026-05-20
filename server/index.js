require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get('/', (req, res) => res.json({ status: 'DM3A Grader Server running' }));

app.post('/upload-pdf', async (req, res) => {
  try {
    const { base64, mediaType } = req.body;
    const buffer = Buffer.from(base64, 'base64');
    const blob = new Blob([buffer], { type: mediaType || 'application/pdf' });
    const file = await anthropic.beta.files.upload({
      file: new File([blob], 'exam.pdf', { type: mediaType || 'application/pdf' }),
    });
    res.json({ file_id: file.id });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/grade', async (req, res) => {
  try {
    const { file_id, imageBlocks, systemPrompt, userPrompt } = req.body;
    let contentBlocks = [];
    if (file_id) {
      contentBlocks = [
        { type: 'document', source: { type: 'file', file_id: file_id } },
        { type: 'text', text: userPrompt || 'Grade this exam.' }
      ];
    } else if (imageBlocks && imageBlocks.length > 0) {
      contentBlocks = [
        ...imageBlocks,
        { type: 'text', text: userPrompt || 'Grade this exam.' }
      ];
    }
    console.log(`Grading — blocks: ${contentBlocks.length}`);
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: contentBlocks }],
    });
    const text = response.content?.[0]?.text ?? '';
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
