const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

app.post('/convert-docx', async (req, res) => {
  const { base64, filename } = req.body;
  if (!base64 || !filename) return res.status(400).json({ error: 'Missing base64 or filename' });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
  const docxPath = path.join(tmpDir, filename);
  const pdfName = filename.replace(/\.docx$/i, '.pdf');
  const pdfPath = path.join(tmpDir, pdfName);
  try {
    fs.writeFileSync(docxPath, Buffer.from(base64, 'base64'));
    execSync(`"${SOFFICE}" --headless --convert-to pdf --outdir "${tmpDir}" "${docxPath}"`, { timeout: 30000 });
    if (!fs.existsSync(pdfPath)) throw new Error('PDF not created');
    const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
    res.json({ pdf: pdfBase64, pdfName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(3333, () => console.log('DM3A Local Converter running on port 3333'));
