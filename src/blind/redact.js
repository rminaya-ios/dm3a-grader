// src/blind/redact.js
// DM3A Grader — Blind Grading Mode, automatic name-zone redaction (spec §3.3).
//
// Real student work carries a handwritten name inside the scanned pixels — the
// vault can't protect that. This OCRs the whole first image (downscaled for speed)
// and, if it finds a name-field label ("Name:" / "Student Name:" / "Nombre:")
// anywhere in the frame, or a bare First-Last pair in the top band, paints a black
// box over it (stamping the alias) BEFORE the image is sent to grading or storage.
// Whole-frame label detection is deliberate: a paper photographed at an angle can
// put the name line well below any fixed top-band (#26). Everything runs in the
// browser, so the server and Claude never see the handwritten name.
//
// tesseract.js is lazy-loaded (heavy WASM) so it only downloads when redaction
// actually runs. Never throws to the caller — on any failure the original image
// is returned so grading is never blocked (redaction is fail-open by design; the
// per-course toggle + count surface let the instructor see coverage honestly).

const BAND_FRACTION = 0.30; // top ~30% of the frame: where form name-labels live + the zone the pair heuristic is confined to
const OCR_MAX_DIM = 1600;   // OCR at ≤ this longest-edge (downscaled for speed); boxes scale back to full res
const MIN_SCAN_WORDS = 6;   // ≥ this many words at 0° ⇒ page is upright-readable; don't bother trying rotations

let _workerPromise = null;
async function getWorker() {
  if (!_workerPromise) {
    _workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng');
    })();
  }
  return _workerPromise;
}

export async function terminateRedactor() {
  if (_workerPromise) {
    try { (await _workerPromise).terminate(); } catch { /* ignore */ }
    _workerPromise = null;
  }
}

// NOTE: an adaptive-threshold OCR pre-pass was tried here and REMOVED — on real phone
// photos (large blank paper + wood-grain background) it binarized clean text into noise,
// producing garbage words and false regions. Tesseract's own internal Otsu binarization
// handles these images better, so we OCR the plain downscaled pixels.

function loadImage(base64) {
  const src = String(base64).startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

const clean = (t) => String(t || '').replace(/[^A-Za-z:']/g, '');
// Common academic/header words that are Title-Case but NOT names — without this the
// bare First-Last pair rule fires on "Problem Set", "Exam Two", "Answer Key", etc.,
// over-redacting headers and inflating the redaction count on nameless sheets.
const NAME_STOPWORDS = new Set([
  'problem', 'set', 'exam', 'test', 'quiz', 'chapter', 'section', 'unit', 'lesson', 'page',
  'part', 'answer', 'answers', 'key', 'name', 'date', 'score', 'total', 'math', 'algebra',
  'calculus', 'geometry', 'statistics', 'trigonometry', 'homework', 'assignment', 'activity',
  'worksheet', 'solution', 'solutions', 'class', 'period', 'due', 'points', 'point', 'grade',
  'student', 'spring', 'fall', 'summer', 'winter', 'final', 'midterm', 'review', 'practice',
  'mean', 'value', 'theorem', 'derivative', 'question', 'questions', 'instructions', 'directions',
  'show', 'work', 'solve', 'find', 'evaluate', 'simplify', 'graph', 'number', 'course', 'form',
  // titles + subjects — keep the instructor's own header line ("Dr. Minaya", "Precalculus")
  // from tripping the bare-pair rule on every sheet of a class template.
  'dr', 'mr', 'mrs', 'ms', 'mx', 'prof', 'professor', 'instructor', 'teacher', 'precalculus', 'precalc',
  // assignment-title words — a title like "Radio Players - Performance Task" reads as a
  // First-Last pair otherwise (#29).
  'performance', 'task', 'project', 'presentation', 'essay', 'lab', 'report', 'portfolio',
  'players', 'radio', 'satellite', 'portable', 'average', 'title', 'topic', 'due', 'name',
]);
const isNameTok = (t) => {
  const c = clean(t);
  return /^[A-Z][a-z]{1,}$/.test(c) && !NAME_STOPWORDS.has(c.toLowerCase());
};
// Name-field labels — "Name:", "Student Name:", "Nombre:" (English/Spanish). Inside
// the top band a bare "Name" (no colon) is almost certainly a label; OUTSIDE the band
// we require the trailing colon so body prose ("name the theorem") can't trip it.
const isNameLabelLoose = (t) => /^(student)?(name|nombre)s?:?$/i.test(clean(t));
const isNameLabelStrict = (t) => /^(student)?(name|nombre)s?:$/i.test(clean(t));

// tesseract.js v7 returns word-level boxes in the TSV output (data.tsv), not
// data.words. Parse level-5 (word) rows into {text, confidence, bbox}.
export function wordsFromTsv(tsv) {
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

// Merge overlapping/near-touching boxes into one, so a name matched by BOTH the
// "Name:" label rule and the First-Last rule paints a single clean box + one alias
// stamp instead of overlapping stamps.
export function mergeBoxes(regions) {
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

// Return the name-like regions (bboxes) among OCR words. `pairMaxY` is the bottom of
// the top band; the First/Last-pair heuristic is confined there, while the label rule
// runs across the WHOLE frame (a label can sit anywhere on an angled phone-photo).
export function findNameRegions(words, pairMaxY = Infinity) {
  const regions = [];
  const list = (words || []).filter((w) => w && w.bbox);

  // 1. Name-field label → redact the label and everything to its right on the line
  //    (the handwritten name follows the label). Whole-frame; strict (colon required)
  //    outside the band, loose (colon optional) inside it.
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

  // 2. Two+ consecutive Capitalized alphabetic tokens (First Last) — a bare name with no
  //    label to anchor it. ONLY as a fallback when the (precise) label rule found nothing:
  //    a form with a "Name:" field is common and reliable, whereas this heuristic readily
  //    fires on header text ("Average Cost", an instructor's own name). Confined to the top
  //    band, non-stopword tokens only.
  if (regions.length === 0) {
    for (let i = 0; i < list.length - 1; i++) {
      if ((list[i].confidence ?? 100) < 30) continue;
      if (list[i].bbox.y1 > pairMaxY) continue;
      if (isNameTok(list[i].text) && isNameTok(list[i + 1].text)) {
        // #29: a bare name line is JUST the name. If the pair sits on a line crowded
        // with other Title-Case words it's a title/header ("Radio Players Performance
        // Task"), not a name — skip it.
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

// Draw the image (scaled to w×h) rotated by `deg` into a fresh canvas, then reset the
// transform so box fills afterward use plain canvas coordinates. Returns { canvas, ctx }.
function rotatedCanvas(img, w, h, deg) {
  const rot = ((deg % 360) + 360) % 360;
  const canvas = document.createElement('canvas');
  if (rot === 90 || rot === 270) { canvas.width = h; canvas.height = w; } else { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, ctx };
}

function paintBox(ctx, r, W, H, alias) {
  const pad = Math.round((r.y1 - r.y0) * 0.5) + 5;
  const x = Math.max(0, r.x0 - pad);
  const y = Math.max(0, r.y0 - pad);
  const w = Math.min(W - x, (r.x1 - r.x0) + pad * 2);
  const h = Math.min(H - y, (r.y1 - r.y0) + pad * 2);
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  if (alias) {
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(12, Math.round(h * 0.55))}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(String(alias), x + 8, y + h / 2);
  }
}

// Redact the name zone of a base64 image. Returns { base64, redacted, words }.
// `words` = how many words OCR read in the best orientation (0 ≈ unscannable) — lets the
// caller distinguish a scanned-clean sheet from a real miss. alias (optional) is stamped.
//
// ORIENTATION TRIAL (#26): phone photos frequently arrive rotated — either via an EXIF
// flag the browser applies, or with rotation baked into the pixels and no flag at all.
// Tesseract only reads horizontal text, so a 90°/270° sheet reads as noise and the name
// is missed (while Claude reads it fine → a real leak). We OCR at 0° first; if the page
// is upright-readable we stop, otherwise we try 90°/270° (and 180°) and redact in the
// orientation that actually finds the name — returning that upright image.
export async function redactNameZone(base64, alias) {
  try {
    const img = await loadImage(base64);
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    if (!W || !H) return { base64, redacted: false, words: 0 };

    const scale = Math.min(1, OCR_MAX_DIM / Math.max(W, H));
    const sw = Math.max(1, Math.round(W * scale));
    const sh = Math.max(1, Math.round(H * scale));
    const worker = await getWorker();
    let maxWords = 0;

    for (const deg of [0, 90, 270, 180]) {
      // OCR the whole frame (downscaled, rotated by deg) so a name label is caught
      // wherever it sits; the First/Last-pair heuristic stays confined to the top band.
      const { canvas: ocrCanvas } = rotatedCanvas(img, sw, sh, deg);
      const { data } = await worker.recognize(ocrCanvas, {}, { tsv: true });
      const words = wordsFromTsv(data.tsv);
      // HIGH-confidence words only — rotated text still yields lots of low-confidence
      // garbage, so raw word count can't tell "upright & readable" from "sideways noise".
      const goodWords = words.reduce((a, w) => a + ((w.confidence ?? 0) >= 60 ? 1 : 0), 0);
      maxWords = Math.max(maxWords, goodWords);
      const upright = goodWords >= MIN_SCAN_WORDS && goodWords / Math.max(1, words.length) >= 0.5;
      const bandCut = Math.round(ocrCanvas.height * BAND_FRACTION);
      const found = mergeBoxes(findNameRegions(words, bandCut));

      if (found.length > 0) {
        // Redact in THIS orientation and return the upright image.
        const inv = 1 / scale;
        const { canvas: outCanvas, ctx } = rotatedCanvas(img, W, H, deg);
        for (const r of found) {
          paintBox(ctx, { x0: r.x0 * inv, y0: r.y0 * inv, x1: r.x1 * inv, y1: r.y1 * inv }, outCanvas.width, outCanvas.height, alias);
        }
        const out = outCanvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        return { base64: out, redacted: true, words: Math.max(maxWords, goodWords) };
      }
      // Only short-circuit when 0° is genuinely upright-readable: enough HIGH-confidence
      // words AND a high good/total ratio. Rotated pages yield many LOW-confidence garbage
      // words (low ratio), so they fall through to the 90/270/180 trials.
      if (deg === 0 && upright) break;
    }
    return { base64, redacted: false, words: maxWords };
  } catch (e) {
    // FAIL CLOSED (was fail-open): a genuine OCR/canvas/decode error must NOT let the
    // image through unredacted. Re-throw so the caller aborts grading and asks the user
    // to retry. (A clean page with no detected name returns normally above — not an error.)
    if (typeof console !== 'undefined') console.warn('[redact] OCR/redaction error — aborting:', e && e.message);
    throw e;
  }
}
