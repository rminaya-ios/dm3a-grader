// server/lib/serverRedact.js
// DM3A Grader — SERVER-SIDE name-zone redaction (the authoritative pass).
//
// Runs the SAME name detection as the browser module (src/blind/redact.js) but with
// device-independent OCR (tesseract.js in Node) + image ops (sharp), so it works the
// same on every device — including iPads, where the browser OCR silently misses the
// handwritten name. FAIL CLOSED: throws on an OCR/decode error OR when OCR reads no
// text at all from a page (a strong signal it did not actually run / a blank page) —
// the caller then aborts grading rather than let an unverified image through.
//
// The detection logic (wordsFromTsv / mergeBoxes / findNameRegions / stopwords) is
// ported verbatim from the client module so both passes agree on what a "name" is.

const sharp = require('sharp');

const BAND_FRACTION = 0.30; // top ~30% band for the bare First-Last pair heuristic
const OCR_MAX_DIM = 1600;   // OCR at ≤ this longest-edge (downscaled for speed)
const MIN_SCAN_WORDS = 6;   // ≥ this many high-confidence words at 0° ⇒ upright-readable

// ─── pure detection logic (ported verbatim from src/blind/redact.js) ─────────────
const clean = (t) => String(t || '').replace(/[^A-Za-z:']/g, '');
const NAME_STOPWORDS = new Set([
  'problem', 'set', 'exam', 'test', 'quiz', 'chapter', 'section', 'unit', 'lesson', 'page',
  'part', 'answer', 'answers', 'key', 'name', 'date', 'score', 'total', 'math', 'algebra',
  'calculus', 'geometry', 'statistics', 'trigonometry', 'homework', 'assignment', 'activity',
  'worksheet', 'solution', 'solutions', 'class', 'period', 'due', 'points', 'point', 'grade',
  'student', 'spring', 'fall', 'summer', 'winter', 'final', 'midterm', 'review', 'practice',
  'mean', 'value', 'theorem', 'derivative', 'question', 'questions', 'instructions', 'directions',
  'show', 'work', 'solve', 'find', 'evaluate', 'simplify', 'graph', 'number', 'course', 'form',
  'dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'professor', 'instructor', 'teacher', 'precalculus', 'precalc',
  'performance', 'task', 'project', 'presentation', 'essay', 'lab', 'report', 'portfolio',
  'players', 'radio', 'satellite', 'portable', 'average', 'title', 'topic', 'due', 'name',
]);
const isNameTok = (t) => {
  const c = clean(t);
  return /^[A-Z][a-z]{1,}$/.test(c) && !NAME_STOPWORDS.has(c.toLowerCase());
};
const isNameLabelLoose = (t) => /^(student)?(name|nombre)s?:?$/i.test(clean(t));
const isNameLabelStrict = (t) => /^(student)?(name|nombre)s?:$/i.test(clean(t));

function wordsFromTsv(tsv) {
  const words = [];
  for (const row of String(tsv || '').split('\n')) {
    const c = row.split('\t');
    if (c.length < 12) continue;
    if (Number(c[0]) !== 5) continue; // level 5 = word
    const left = Number(c[6]), top = Number(c[7]), width = Number(c[8]), height = Number(c[9]);
    const text = (c[11] || '').trim();
    if (!text) continue;
    words.push({ text, confidence: Number(c[10]), bbox: { x0: left, y0: top, x1: left + width, y1: top + height } });
  }
  return words;
}

function mergeBoxes(regions) {
  const boxes = (regions || []).map((r) => ({ ...r }));
  const overlaps = (a, b) => {
    const pad = 6;
    return a.x0 <= b.x1 + pad && b.x0 <= a.x1 + pad && a.y0 <= b.y1 + pad && b.y0 <= a.y1 + pad;
  };
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (overlaps(boxes[i], boxes[j])) {
          boxes[i] = {
            x0: Math.min(boxes[i].x0, boxes[j].x0), y0: Math.min(boxes[i].y0, boxes[j].y0),
            x1: Math.max(boxes[i].x1, boxes[j].x1), y1: Math.max(boxes[i].y1, boxes[j].y1),
          };
          boxes.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }
  return boxes;
}

function findNameRegions(words, pairMaxY = Infinity) {
  const regions = [];
  const list = (words || []).filter((w) => w && w.bbox);

  for (const w of list) {
    const inBand = w.bbox.y1 <= pairMaxY;
    if (!(inBand ? isNameLabelLoose(w.text) : isNameLabelStrict(w.text))) continue;
    const lineH = w.bbox.y1 - w.bbox.y0;
    const yMid = (w.bbox.y0 + w.bbox.y1) / 2;
    const box = { ...w.bbox };
    for (const o of list) {
      const oMid = (o.bbox.y0 + o.bbox.y1) / 2;
      if (o.bbox.x1 >= w.bbox.x0 && Math.abs(oMid - yMid) <= lineH) {
        box.x0 = Math.min(box.x0, o.bbox.x0);
        box.y0 = Math.min(box.y0, o.bbox.y0);
        box.x1 = Math.max(box.x1, o.bbox.x1);
        box.y1 = Math.max(box.y1, o.bbox.y1);
      }
    }
    regions.push(box);
  }

  if (regions.length === 0) {
    for (let i = 0; i < list.length - 1; i++) {
      if ((list[i].confidence ?? 100) < 30) continue;
      if (list[i].bbox.y1 > pairMaxY) continue;
      if (isNameTok(list[i].text) && isNameTok(list[i + 1].text)) {
        const py = (list[i].bbox.y0 + list[i].bbox.y1) / 2;
        const lineH = list[i].bbox.y1 - list[i].bbox.y0;
        let lineNameToks = 0;
        for (const o of list) {
          const om = (o.bbox.y0 + o.bbox.y1) / 2;
          if (Math.abs(om - py) <= lineH && isNameTok(o.text)) lineNameToks++;
        }
        if (lineNameToks > 3) continue;
        const a = list[i].bbox, b = list[i + 1].bbox;
        regions.push({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
      }
    }
  }
  return regions;
}

// ─── Tesseract worker (single, reused across calls/pages) ────────────────────────
let _workerPromise = null;
function getWorker() {
  if (!_workerPromise) {
    _workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      return createWorker('eng');
    })();
  }
  return _workerPromise;
}

// ─── image ops (sharp) ───────────────────────────────────────────────────────────
function stripDataUri(b64) {
  return String(b64 || '').replace(/^data:[^,]+,/, '');
}

// Rotate the source by deg (0/90/180/270) at full resolution. Returns { buffer, W, H }.
async function rotateFull(inputBuf, deg) {
  if (!deg) {
    const meta = await sharp(inputBuf).metadata();
    return { buffer: inputBuf, W: meta.width, H: meta.height };
  }
  const buf = await sharp(inputBuf).rotate(deg).png().toBuffer();
  const meta = await sharp(buf).metadata();
  return { buffer: buf, W: meta.width, H: meta.height };
}

// Redact the name zone on ONE image. base64 in → { base64, redacted, words } out.
// FAIL CLOSED: throws on decode/OCR error or when OCR reads no text anywhere.
// positionalBand > 0: when OCR finds NO name but the page has text, black out the top
// `positionalBand` fraction of the page as a safety net (catches a handwritten name that
// OCR can't read — only Claude reads handwriting). Pass it only for a submission's first
// page (where names sit); 0 disables the net (page passes through unchanged).
async function redactImageServer(base64, { positionalBand = 0 } = {}) {
  const inputBuf = Buffer.from(stripDataUri(base64), 'base64');
  const meta0 = await sharp(inputBuf).metadata();
  if (!meta0.width || !meta0.height) throw new Error('image did not decode (no dimensions)');

  const worker = await getWorker();
  let maxWords = 0;     // high-confidence words (upright-readable signal)
  let maxAnyWords = 0;  // words at any confidence — 0 everywhere ⇒ OCR read nothing

  for (const deg of [0, 90, 270, 180]) {
    const { buffer: rotBuf, W, H } = await rotateFull(inputBuf, deg);
    const scale = Math.min(1, OCR_MAX_DIM / Math.max(W, H));
    const ocrW = Math.max(1, Math.round(W * scale));
    const ocrH = Math.max(1, Math.round(H * scale));
    const ocrBuf = await sharp(rotBuf).resize(ocrW, ocrH).grayscale().png().toBuffer();

    const { data } = await worker.recognize(ocrBuf, {}, { tsv: true });
    const words = wordsFromTsv(data.tsv);
    maxAnyWords = Math.max(maxAnyWords, words.length);
    const goodWords = words.reduce((a, w) => a + ((w.confidence ?? 0) >= 60 ? 1 : 0), 0);
    maxWords = Math.max(maxWords, goodWords);

    const bandCut = Math.round(ocrH * BAND_FRACTION);
    const found = mergeBoxes(findNameRegions(words, bandCut));

    if (found.length > 0) {
      const inv = 1 / scale;
      const composites = found.map((r) => {
        const left = Math.max(0, Math.round(r.x0 * inv));
        const top = Math.max(0, Math.round(r.y0 * inv));
        const right = Math.min(W, Math.round(r.x1 * inv));
        const bottom = Math.min(H, Math.round(r.y1 * inv));
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);
        return {
          input: { create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } },
          left, top,
        };
      });
      const outBuf = await sharp(rotBuf).composite(composites).jpeg({ quality: 85 }).toBuffer();
      return { base64: outBuf.toString('base64'), redacted: true, words: Math.max(maxWords, goodWords) };
    }

    // Only short-circuit when 0° is genuinely upright-readable (enough high-confidence
    // words AND a high good/total ratio) — otherwise fall through to the rotations.
    const upright = goodWords >= MIN_SCAN_WORDS && goodWords / Math.max(1, words.length) >= 0.5;
    if (deg === 0 && upright) break;
  }

  // FAIL CLOSED: OCR read no text anywhere ⇒ it did not actually process the page
  // (blank / decode issue) — we cannot claim there is no name.
  if (maxAnyWords === 0) throw new Error('OCR read no text from the page — cannot verify it contains no name');

  // POSITIONAL SAFETY NET: OCR read text but found no name. A handwritten name with no
  // printed label is unreadable to OCR (only Claude reads handwriting), so as a precaution
  // black out the top header strip where names sit. Imperfect on badly angled photos, but
  // it closes the handwritten-name leak. Only applied when the caller opts in (first page).
  if (positionalBand > 0) {
    const stripH = Math.max(1, Math.round(meta0.height * Math.min(0.5, positionalBand)));
    const out = await sharp(inputBuf)
      .composite([{ input: { create: { width: meta0.width, height: stripH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }, left: 0, top: 0 }])
      .jpeg({ quality: 85 })
      .toBuffer();
    return { base64: out.toString('base64'), redacted: true, positional: true, words: maxWords };
  }

  // OCR read text but found no name ⇒ a genuinely nameless page: return unchanged.
  return { base64: stripDataUri(base64), redacted: false, words: maxWords };
}

module.exports = { redactImageServer };
