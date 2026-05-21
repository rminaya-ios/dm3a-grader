require('dotenv').config();
const express = require('express');
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
    const { contentBlocks: clientBlocks, systemPrompt, userPrompt } = req.body;
    let contentBlocks = [];
    if (clientBlocks && clientBlocks.length > 0) {
      contentBlocks = userPrompt
        ? [...clientBlocks, { type: 'text', text: userPrompt }]
        : clientBlocks;
    }
    console.log(`Grading — blocks: ${contentBlocks.length}`);
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
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
