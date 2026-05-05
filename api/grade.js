export const config = { maxDuration: 60, api: { bodyParser: { sizeLimit: "50mb" } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  console.log('grade.js content-length:', req.headers['content-length']);

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing API key' });

  let systemPrompt, userPrompt, fileData, mimeType, extraBlocks;
  try {
    ({ systemPrompt, userPrompt, fileData, mimeType, extraBlocks = [] } = req.body);
  } catch (parseErr) {
    console.error('grade.js body parse error:', parseErr);
    return res.status(400).json({ error: 'Failed to parse request body — payload may exceed size limit' });
  }
  if (!fileData) return res.status(400).json({ error: 'No file data provided' });

  const isImage = mimeType && mimeType.startsWith('image/');
  const contentBlock = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileData } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileData } };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: [contentBlock, ...extraBlocks, { type: 'text', text: userPrompt }] }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic API error:', response.status, JSON.stringify(err));
      return res.status(response.status).json({ error: err?.error?.message || `Claude API error ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('grade.js unhandled error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
