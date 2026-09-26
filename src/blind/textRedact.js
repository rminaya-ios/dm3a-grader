// src/blind/textRedact.js
// DM3A Grader — Blind Grading Mode, redaction for DIGITAL (typed) submissions.
//
// The name-zone path in redact.js exists because a scanned page carries the student's
// handwritten name inside the pixels: the only way to find it is OCR, and the only way
// to remove it is to paint over it. A TYPED submission is the opposite case. There is
// no name box and no handwriting — the name, when it is there at all, is a string. So
// OCRing a rendering of that string is both unnecessary and unreliable: BB Batch Mode
// with typed submissions failed every run on the image check (2026-09-26, MATH1010
// "Quadratic Functions") for pages that never had a name zone to verify.
//
// For digital submissions we therefore redact the TEXT: pull the characters out of the
// source (PDF text layer, word/document.xml, Blackboard's editor text), replace every
// roster name with that student's DM3A alias, and send the text. Everything here is
// pure — no DOM, no network, no pdfjs — so it is unit-testable and so the browser
// adapters that feed it stay thin.
//
// STILL FAIL-CLOSED, on the conditions that actually apply to text:
//   • no vault loaded for the course  → we have no names to remove and no alias to
//     substitute, so we cannot claim the text is clean;
//   • extraction returned nothing     → we are not looking at the submission at all;
//   • a roster name survives redaction → assertNoRosterNames throws before the payload
//     is built (the grading model must never receive an un-aliased name).

// ── Submission kinds ────────────────────────────────────────────────────────
// 'scan' is the existing image path and keeps the existing behaviour exactly.
export const KIND_SCAN = 'scan';
export const KIND_TEXT_PDF = 'text-pdf';
export const KIND_DOCX = 'docx';
export const KIND_BB_TEXT = 'bb-text';
export const KIND_BB_STUB = 'bb-stub';   // the .txt when it holds only metadata headers
export const KIND_UNKNOWN = 'unknown';

const DIGITAL_KINDS = new Set([KIND_TEXT_PDF, KIND_DOCX, KIND_BB_TEXT]);
export const isDigitalKind = (kind) => DIGITAL_KINDS.has(kind);

// What the Review Student Groups list shows per file.
export const KIND_LABELS = {
  [KIND_SCAN]: { label: 'Scan', detail: 'image pages — name-zone check runs' },
  [KIND_TEXT_PDF]: { label: 'Typed PDF', detail: 'text layer — names removed by text' },
  [KIND_DOCX]: { label: 'Typed .docx', detail: 'Word text — names removed by text' },
  [KIND_BB_TEXT]: { label: 'Typed in Blackboard', detail: 'editor text — names removed by text' },
  [KIND_BB_STUB]: { label: 'Receipt only', detail: "Blackboard's metadata file — nothing to grade" },
  [KIND_UNKNOWN]: { label: 'Unrecognized', detail: 'cannot be graded — assign or remove' },
};

// The one decision this whole module exists to make. Pixels can hide a handwritten name
// and must be OCR'd and painted over; text cannot, and is redacted by replacement.
// Getting this wrong in either direction is a privacy bug, so it is a named function
// with a test per submission kind rather than an inline condition.
export function redactionPathFor(kind) {
  if (isDigitalKind(kind)) return 'text';
  if (kind === KIND_UNKNOWN || kind === KIND_BB_STUB) return 'none';
  return 'name-zone';
}

// ── Blackboard filename identity (requirement 4) ───────────────────────────
// "<assignment>_<username>_attempt_<timestamp>[_<original filename>]".
//
// The trailing original filename is OPTIONAL: Blackboard omits it on the per-submission
// .txt, which is named "...attempt_2026-09-26-14-31-05.txt". The old pattern required it,
// so every editor-typed submission failed to parse and was filed under UNRECOGNIZED —
// exactly the files that carry a typed submission. Returns null when the name is not a
// Blackboard export at all, which routes the file to manual assignment.
export function parseBBFilename(filename) {
  const m = String(filename || '').match(
    /^(.+?)_([a-zA-Z0-9_]{2,20})_attempt_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})(?:_(.+)|(\.[A-Za-z0-9]{1,8}))?$/
  );
  if (!m) return null;
  const [, , studentId, timestamp, originalName, ext] = m;
  return {
    studentId,
    timestamp,
    // Used to de-duplicate Blackboard's double-exports. With no original filename, a
    // per-submission synthetic key keeps the .txt from colliding with an attachment.
    originalName: originalName || `${studentId}_${timestamp}${ext || ''}`,
  };
}

// A PDF needs this much extractable text before we will treat it as typed rather than
// scanned. Deliberately low: a correct open-response answer can be one short line
// ("x = 3 or x = -5"), and misclassifying that as a scan is what broke the run.
export const DIGITAL_TEXT_MIN_CHARS = 40;

// Classify by filename/MIME alone. A PDF is UNDECIDED here — only its contents say
// whether it is typed or scanned (see pdfKindFromProfile).
export function classifyByName(name, mime = '') {
  const n = String(name || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (n.endsWith('.docx') || m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return KIND_DOCX;
  if (n.endsWith('.txt') || m === 'text/plain') return KIND_BB_TEXT;
  if (n.endsWith('.pdf') || m === 'application/pdf') return null; // needs a content probe
  if (m.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(n)) return KIND_SCAN;
  return KIND_UNKNOWN;
}

// Decide a PDF's kind from a text-layer probe.
//
// Text alone is NOT enough to skip the name-zone check: phone scanner apps add an OCR
// text layer to a photographed page, so such a file has both readable text AND a
// handwritten name in the pixels. Treating it as typed would skip the image check and
// leak the name. So a PDF counts as typed only when it has text AND no page-covering
// image; anything ambiguous falls back to 'scan', which is the stricter path.
export function pdfKindFromProfile(profile) {
  const chars = (profile && profile.chars) || 0;
  const hasImages = !!(profile && profile.hasImages);
  if (hasImages) return KIND_SCAN;
  return chars >= DIGITAL_TEXT_MIN_CHARS ? KIND_TEXT_PDF : KIND_SCAN;
}

// ── Text extraction: the pure halves ───────────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, e) => (ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m));
}

const tidy = (s) => String(s || '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

// word/document.xml → plain text. Paragraph and break elements become newlines before
// tags are stripped, so sentences don't run together into one unreadable line.
export function stripDocxXmlToText(xml) {
  const withBreaks = String(xml || '')
    .replace(/<w:tab\b[^>]*\/?>/gi, '\t')
    .replace(/<w:br\b[^>]*\/?>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/w:tr>/gi, '\n')
    .replace(/<\/w:tc>/gi, '\t');
  return tidy(decodeEntities(withBreaks.replace(/<[^>]*>/g, '')));
}

// Blackboard's editor text arrives as rich text.
export function htmlToText(html) {
  const withBreaks = String(html || '')
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\b[^>]*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '• ');
  return tidy(decodeEntities(withBreaks.replace(/<[^>]*>/g, '')));
}

// Blackboard writes one .txt per submission holding the metadata headers AND, when the
// student typed into the editor rather than attaching a file, the submission itself.
// Returns the submission text only — the headers (which carry "Name: Doe, Jane (jdoe)")
// are never part of what gets graded.
const BB_SECTIONS = ['Submission Field', 'Comments', 'Files', 'Current Grade', 'Date Submitted', 'Assignment', 'Name'];
export function parseBBSubmissionTxt(raw) {
  const text = String(raw || '').replace(/\r\n?/g, '\n');
  const nameHeader = (text.match(/^[ \t]*Name[ \t]*:[ \t]*(.+)$/im) || [])[1] || '';
  const start = text.search(/^[ \t]*Submission Field[ \t]*:[ \t]*$/im);
  if (start < 0) return { nameHeader, submissionText: '', hasSubmission: false };
  const afterLabel = text.indexOf('\n', start);
  if (afterLabel < 0) return { nameHeader, submissionText: '', hasSubmission: false };
  const rest = text.slice(afterLabel + 1);
  // Stop at the next top-level section header so "Comments:" / "Files:" never leak in.
  const others = BB_SECTIONS.filter((s) => s !== 'Submission Field');
  const stop = rest.search(new RegExp(`^[ \\t]*(?:${others.join('|')})[ \\t]*:`, 'im'));
  const body = htmlToText(stop < 0 ? rest : rest.slice(0, stop));
  return { nameHeader, submissionText: body, hasSubmission: body.length > 0 };
}

// ── Roster name matching ───────────────────────────────────────────────────
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A standalone given/family name shorter than this is matched case-SENSITIVELY. A
// two-letter surname like "An" or "Li" matched case-insensitively would rewrite the
// English word "an" throughout the submission and destroy the work being graded. Full
// names and "Name:" headers are always matched regardless of length, so the common
// leak is covered; a lone lowercase "li" in prose is the acknowledged residual gap.
const SHORT_NAME_MAX = 3;

const parts = (entry) => {
  const first = String((entry && entry.firstName) || '').trim();
  const last = String((entry && entry.lastName) || '').trim();
  if (first || last) return { first, last };
  // BB CSV import fills firstName/lastName, but a legacy roster line is "Full Name".
  const whole = String((entry && entry.studentName) || '').trim().replace(/\s+/g, ' ');
  if (!whole) return { first: '', last: '' };
  if (whole.includes(',')) {
    const [l, f] = whole.split(',');
    return { first: String(f || '').trim(), last: String(l || '').trim() };
  }
  const bits = whole.split(' ');
  return bits.length === 1 ? { first: bits[0], last: '' } : { first: bits[0], last: bits[bits.length - 1] };
};

// Every way one roster entry's name can appear, longest first so "Jane Doe" is replaced
// as a unit instead of becoming "ALIAS ALIAS".
function entryPatterns(entry) {
  const { first, last } = parts(entry);
  const out = [];
  if (first && last) {
    const f = escapeRe(first), l = escapeRe(last);
    // "First Last", "First M. Last", "Last, First", "Last,First"
    out.push(new RegExp(`\\b${f}(?:\\s+[A-Z]\\.?)?\\s+${l}\\b`, 'gi'));
    out.push(new RegExp(`\\b${l}\\s*,\\s*${f}\\b`, 'gi'));
  }
  for (const solo of [last, first]) {
    if (!solo) continue;
    const flags = solo.length <= SHORT_NAME_MAX ? 'g' : 'gi';
    out.push(new RegExp(`\\b${escapeRe(solo)}\\b`, flags));
  }
  return out;
}

// One shared matcher for the redactor and the assertion, so a name the redactor would
// replace can never be a name the assertion flags (and vice versa).
export function findRosterNameHits(text, roster) {
  const hay = String(text || '');
  const hits = [];
  if (!hay) return hits;
  for (const entry of roster || []) {
    for (const re of entryPatterns(entry)) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(hay)) !== null) {
        hits.push({ index: m.index, length: m[0].length, alias: (entry && entry.alias) || '' });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }
  return hits.sort((a, b) => a.index - b.index || b.length - a.length);
}

const NAME_LABEL_LINE = /^([ \t]*(?:student[ \t]+)?(?:name|nombre)s?[ \t]*:[ \t]*)(.*)$/gim;

// Replace every roster name in `text` with that student's alias, and blank the value of
// any "Name: …" header line. Returns the redacted text and a count — never the names,
// which must not reach a log.
export function redactRosterNames(text, roster, { ownAlias = '' } = {}) {
  let out = String(text || '');
  let replacements = 0;

  // 1. "Name: …" / "Student Name: …" / "Nombre: …" header lines. Done first and by
  //    position, not by roster match: a misspelled or nickname value still identifies
  //    the student, and a roster lookup would miss it.
  out = out.replace(NAME_LABEL_LINE, (whole, label, value) => {
    if (!String(value).trim()) return whole;
    replacements++;
    return `${label}${ownAlias || '[REDACTED]'}`;
  });

  // 2. Roster names anywhere in the body. Matches are collected across the whole roster
  //    and applied right-to-left so earlier offsets stay valid; each name becomes ITS
  //    OWN student's alias, so a classmate mentioned by name is not relabelled as this
  //    student.
  const hits = findRosterNameHits(out, roster);
  const kept = [];
  let cursor = -1;
  for (const h of hits) {
    if (h.index < cursor) continue; // already inside a longer match
    kept.push(h);
    cursor = h.index + h.length;
  }
  for (let i = kept.length - 1; i >= 0; i--) {
    const h = kept[i];
    out = out.slice(0, h.index) + (h.alias || ownAlias || '[REDACTED]') + out.slice(h.index + h.length);
    replacements++;
  }
  return { text: out, replacements };
}

// ── Fail-closed gates ──────────────────────────────────────────────────────
// Tagged isRedaction so the existing grading-path aborts pick these up unchanged.
export function redactionError(message) {
  const err = new Error(message);
  err.isRedaction = true;
  return err;
}

// The vault holds the names to remove and the alias to put in their place. Without it
// there is nothing to redact against, so a digital submission cannot be cleared.
export function requireVault(roster, courseCode) {
  if (!Array.isArray(roster) || roster.length === 0) {
    throw redactionError(`Roster vault not loaded for ${courseCode || 'this course'} — unlock the course to redact typed submissions.`);
  }
  return roster;
}

export function requireExtractedText(text, fileLabel) {
  if (!String(text || '').trim()) {
    throw redactionError(`No text layer found in ${fileLabel} — treat as scan? Remove the file or re-upload it as a scan/image.`);
  }
  return text;
}

// REQUIREMENT: the grading model must only ever receive redacted text. Called on the
// assembled payload, immediately before the request — the last gate, after which
// nothing else touches the text.
export function assertNoRosterNames(textBlocks, roster, ctx = '') {
  const blocks = Array.isArray(textBlocks) ? textBlocks : [textBlocks];
  for (let i = 0; i < blocks.length; i++) {
    const hits = findRosterNameHits(blocks[i], roster);
    if (hits.length > 0) {
      // The name itself is deliberately absent from the message and the logs.
      throw redactionError(
        `Blocked before sending: ${hits.length} roster name${hits.length === 1 ? '' : 's'} still present in the grading payload` +
        `${ctx ? ` for ${ctx}` : ''} (text block ${i + 1}). Grading was stopped to protect privacy.`
      );
    }
  }
  return true;
}
