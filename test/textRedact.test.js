// Unit tests for the digital-submission redaction path (src/blind/textRedact.js).
// Node's built-in runner: `npm test`. No browser, no network — the module is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND_SCAN, KIND_TEXT_PDF, KIND_DOCX, KIND_BB_TEXT, KIND_BB_STUB, KIND_UNKNOWN,
  isDigitalKind, classifyByName, pdfKindFromProfile,
  stripDocxXmlToText, htmlToText, parseBBSubmissionTxt,
  findRosterNameHits, redactRosterNames, redactionPathFor, parseBBFilename,
  requireVault, requireExtractedText, assertNoRosterNames,
} from '../src/blind/textRedact.js';

// The MATH1010 roster this bug was reproduced against, shaped as the vault stores it.
const ROSTER = [
  { alias: 'MATH10-7F3K', studentName: 'Jane Doe', firstName: 'Jane', lastName: 'Doe', bbUsername: 'jdoe' },
  { alias: 'MATH10-QT92', studentName: 'Marcus Whitfield', firstName: 'Marcus', lastName: 'Whitfield', bbUsername: 'mwhitfield' },
  { alias: 'MATH10-4XBN', studentName: 'Chen, Li', firstName: 'Li', lastName: 'Chen', bbUsername: 'lchen' },
];

// ── TYPE 1: scan (unchanged path) ──────────────────────────────────────────
test('scan: images and image-only PDFs stay on the name-zone path', () => {
  assert.equal(classifyByName('quiz.jpg', 'image/jpeg'), KIND_SCAN);
  assert.equal(classifyByName('quiz.PNG', ''), KIND_SCAN);
  assert.equal(classifyByName('photo.heic', 'image/heic'), KIND_SCAN);
  // A PDF cannot be classified by name alone — it needs a content probe.
  assert.equal(classifyByName('scan.pdf', 'application/pdf'), null);
  // No text layer ⇒ scan.
  assert.equal(pdfKindFromProfile({ chars: 0, hasImages: true }), KIND_SCAN);
  assert.equal(isDigitalKind(KIND_SCAN), false, 'a scan must never be treated as digital');
});

test('scan: an OCR-layered photo is still a scan (the name is in the pixels)', () => {
  // Phone scanner apps add a text layer to a photographed page. Plenty of text AND a
  // page image ⇒ must stay on the image path, or the handwritten name leaks.
  assert.equal(pdfKindFromProfile({ chars: 5000, hasImages: true }), KIND_SCAN);
});

// ── TYPE 2: text-layer PDF ─────────────────────────────────────────────────
test('text PDF: a text layer with no page image is digital', () => {
  assert.equal(pdfKindFromProfile({ chars: 900, hasImages: false }), KIND_TEXT_PDF);
  assert.equal(isDigitalKind(KIND_TEXT_PDF), true);
});

test('text PDF: a short typed answer still counts as typed', () => {
  // "x = 3 or x = -5" is a complete open-response answer. Classifying it as a scan is
  // what sent typed submissions into the failing name-zone check.
  assert.equal(pdfKindFromProfile({ chars: 45, hasImages: false }), KIND_TEXT_PDF);
  // Below the floor there is nothing to grade as text — fall back to the scan path.
  assert.equal(pdfKindFromProfile({ chars: 5, hasImages: false }), KIND_SCAN);
});

// ── TYPE 3: .docx ──────────────────────────────────────────────────────────
test('docx: classified by name and MIME', () => {
  assert.equal(classifyByName('answers.docx', ''), KIND_DOCX);
  assert.equal(classifyByName('x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), KIND_DOCX);
  assert.equal(isDigitalKind(KIND_DOCX), true);
});

test('docx: word/document.xml becomes readable text with paragraphs kept', () => {
  const xml = `<?xml version="1.0"?><w:document><w:body>
    <w:p><w:r><w:t>Name: Jane Doe</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. The vertex is at </w:t></w:r><w:r><w:t>(2, &#8722;3)</w:t></w:r></w:p>
    <w:p><w:r><w:t>2. x &lt; 5 and x &gt; &#45;1</w:t></w:r></w:p>
  </w:body></w:document>`;
  const text = stripDocxXmlToText(xml);
  assert.match(text, /^Name: Jane Doe$/m, 'the header line survives extraction so redaction can strip it');
  assert.match(text, /1\. The vertex is at \(2, −3\)/, 'runs inside a paragraph join without a newline');
  assert.match(text, /2\. x < 5 and x > -1/, 'XML entities are decoded');
  assert.equal(text.includes('<w:'), false, 'no markup survives');
});

// ── TYPE 4: unparseable filename / unknown type ────────────────────────────
test('unparseable: an unsupported type is flagged, never silently graded', () => {
  assert.equal(classifyByName('submission.pages', 'application/x-iwork-pages-sffpages'), KIND_UNKNOWN);
  assert.equal(classifyByName('notes.rtf', 'application/rtf'), KIND_UNKNOWN);
  assert.equal(classifyByName('', ''), KIND_UNKNOWN);
  assert.equal(isDigitalKind(KIND_UNKNOWN), false);
});

// ── Blackboard editor text (the .txt every submission carries) ─────────────
const BB_TXT = `Name: Doe, Jane (jdoe)
Assignment: Quadratic Functions
Date Submitted: Friday, September 26, 2026 2:31:05 PM EDT
Current Grade: Needs Grading

Submission Field:
<p>Jane Doe &mdash; Prep Task</p><p>To find the vertex I completed the square:</p><p>y = (x - 2)^2 - 3, so the vertex is (2, -3).</p>

Comments:
None

Files:
	Original filename: none
`;

test('bb-text: the editor submission is pulled out and the headers are not', () => {
  assert.equal(classifyByName('Quadratic Functions_jdoe_attempt_2026-09-26-14-31-05.txt', 'text/plain'), KIND_BB_TEXT);
  const parsed = parseBBSubmissionTxt(BB_TXT);
  assert.equal(parsed.hasSubmission, true);
  assert.match(parsed.submissionText, /completed the square/);
  assert.equal(parsed.submissionText.includes('Needs Grading'), false, 'metadata headers are excluded');
  assert.equal(parsed.submissionText.includes('Comments'), false, 'the next section is excluded');
  assert.equal(parsed.submissionText.includes('<p>'), false, 'rich text is flattened');
  assert.equal(parsed.nameHeader, 'Doe, Jane (jdoe)', 'the header is reported so the caller can see it existed');
});

test('bb-text: a metadata-only .txt is a stub, not a submission', () => {
  const stub = `Name: Doe, Jane (jdoe)\nAssignment: Quadratic Functions\n\nFiles:\n\tOriginal filename: work.pdf\n`;
  assert.equal(parseBBSubmissionTxt(stub).hasSubmission, false, 'attachment-only submissions keep the existing stub handling');
  assert.equal(parseBBSubmissionTxt('').hasSubmission, false);
});

// ── Name redaction ─────────────────────────────────────────────────────────
test('redaction: full names, reversed names and bare surnames all become the alias', () => {
  const src = [
    'Name: Jane Doe',
    'Submitted by Jane Doe for MATH1010.',
    'Doe, Jane — Prep Task',
    'Jane R. Doe checked her work.',
    'Whitfield helped me set up the equation.',
    'The vertex of y = (x-2)^2 - 3 is (2, -3).',
  ].join('\n');
  const { text, replacements } = redactRosterNames(src, ROSTER, { ownAlias: 'MATH10-7F3K' });
  assert.equal(/\bJane\b/.test(text), false, 'no given name survives');
  assert.equal(/\bDoe\b/.test(text), false, 'no family name survives');
  assert.equal(/\bWhitfield\b/.test(text), false, "a classmate's name is removed too");
  assert.match(text, /^Name: MATH10-7F3K$/m, 'the header value is replaced with the alias');
  assert.match(text, /MATH10-QT92/, "a classmate is replaced with THEIR OWN alias, not this student's");
  assert.match(text, /\(x-2\)\^2 - 3 is \(2, -3\)/, 'the mathematics is untouched');
  assert.ok(replacements >= 5, `expected several replacements, got ${replacements}`);
});

test('redaction: "First Last" is replaced as one unit, not twice', () => {
  const { text } = redactRosterNames('Jane Doe', ROSTER, { ownAlias: 'A' });
  assert.equal(text, 'MATH10-7F3K');
});

test('redaction: case-insensitive for ordinary names, case-sensitive for very short ones', () => {
  const lower = redactRosterNames('submitted by jane doe', ROSTER, { ownAlias: 'A' });
  assert.equal(/jane|doe/i.test(lower.text), false, 'a lowercase name is still caught');
  // "Li" (2 chars) is matched case-sensitively on purpose: matching it case-insensitively
  // would rewrite every English "li"-like word and destroy the work being graded.
  const kept = redactRosterNames('The coefficients split nicely.', ROSTER, { ownAlias: 'A' });
  assert.equal(kept.text, 'The coefficients split nicely.', 'ordinary prose is not mangled by a 2-letter surname');
  const caught = redactRosterNames('Li solved it first.', ROSTER, { ownAlias: 'A' });
  assert.match(caught.text, /MATH10-4XBN solved it first\./);
});

test('redaction: a "Name:" header with an unexpected value is still blanked', () => {
  // A nickname or a typo is not on the roster but still identifies the student.
  const { text } = redactRosterNames('Student Name: Janey D.\n\nWork below.', ROSTER, { ownAlias: 'MATH10-7F3K' });
  assert.match(text, /Student Name: MATH10-7F3K/);
  assert.equal(text.includes('Janey'), false);
});

test('redaction: an empty "Name:" label line is left alone', () => {
  const { text, replacements } = redactRosterNames('Name:\nWork below.', ROSTER, { ownAlias: 'A' });
  assert.equal(text, 'Name:\nWork below.');
  assert.equal(replacements, 0);
});

test('redaction: nothing to do on clean text', () => {
  const src = 'Completing the square gives y = (x - 4)^2 + 1.';
  const { text, replacements } = redactRosterNames(src, ROSTER, { ownAlias: 'A' });
  assert.equal(text, src);
  assert.equal(replacements, 0);
});

// ── The pre-send assertion (requirement: the model only ever sees redacted text) ──
test('assertion: a surviving roster name blocks the payload', () => {
  assert.throws(
    () => assertNoRosterNames(['Submitted by Jane Doe'], ROSTER, 'Student_jdoe'),
    (e) => e.isRedaction === true && /still present in the grading payload/.test(e.message)
      && !/Jane|Doe/.test(e.message), // the name must not appear in the error or the logs
  );
});

test('assertion: passes on exactly what the redactor produces', () => {
  const { text } = redactRosterNames(parseBBSubmissionTxt(BB_TXT).submissionText, ROSTER, { ownAlias: 'MATH10-7F3K' });
  assert.equal(assertNoRosterNames([text], ROSTER, 'Student_jdoe'), true);
});

test('assertion: checks every text block, including instructor-typed fields', () => {
  assert.throws(() => assertNoRosterNames(['clean', 'remind Whitfield to show work'], ROSTER), (e) => e.isRedaction === true);
  assert.equal(assertNoRosterNames(['clean', 'also clean'], ROSTER), true);
});

// ── Fail-closed gates ──────────────────────────────────────────────────────
test('fail closed: no vault loaded for the course', () => {
  assert.throws(() => requireVault([], 'MATH1010'),
    (e) => e.isRedaction === true && /Roster vault not loaded for MATH1010/.test(e.message));
  assert.throws(() => requireVault(undefined, 'MATH1010'), (e) => e.isRedaction === true);
  assert.deepEqual(requireVault(ROSTER, 'MATH1010'), ROSTER);
});

test('fail closed: extraction returned nothing', () => {
  assert.throws(() => requireExtractedText('   ', 'submission 3'),
    (e) => e.isRedaction === true && /No text layer found in submission 3 — treat as scan\?/.test(e.message));
  assert.equal(requireExtractedText('some work', 'submission 3'), 'some work');
});

// ── Supporting helpers ─────────────────────────────────────────────────────
test('html flattening keeps list items and drops scripts', () => {
  assert.equal(htmlToText('<ul><li>first</li><li>second</li></ul>'), '• first\n• second');
  assert.equal(htmlToText('<p>keep</p><script>bad()</script>'), 'keep');
});

test('hit finder reports positions in order', () => {
  const hits = findRosterNameHits('Doe and Whitfield', ROSTER);
  assert.ok(hits.length >= 2);
  assert.ok(hits[0].index < hits[1].index);
  assert.equal(hits[0].alias, 'MATH10-7F3K');
});

// ── The routing decision, one assertion per submission kind ────────────────
// This is the guarantee requirement 2 rests on: typed submissions must not reach the
// image name-zone check, and scans must never leave it.
test('routing: each kind takes the right redaction path', () => {
  assert.equal(redactionPathFor(KIND_SCAN), 'name-zone', 'scans keep the existing image check');
  assert.equal(redactionPathFor(KIND_TEXT_PDF), 'text');
  assert.equal(redactionPathFor(KIND_DOCX), 'text');
  assert.equal(redactionPathFor(KIND_BB_TEXT), 'text');
  assert.equal(redactionPathFor(KIND_BB_STUB), 'none', 'a metadata receipt is not graded');
  assert.equal(redactionPathFor(KIND_UNKNOWN), 'none');
  assert.equal(redactionPathFor(undefined), 'name-zone', 'an unresolved kind falls back to the stricter path');
});

// ── Blackboard filename identity (requirement 4) ───────────────────────────
test('filename: an attachment yields the username and the original name', () => {
  const p = parseBBFilename('Quadratic Functions_jdoe_attempt_2026-09-26-14-31-05_quadratics.pdf');
  assert.equal(p.studentId, 'jdoe');
  assert.equal(p.timestamp, '2026-09-26-14-31-05');
  assert.equal(p.originalName, 'quadratics.pdf');
});

test('filename: the editor .txt parses even with no original filename', () => {
  // THE regression: Blackboard omits the trailing name on the .txt, so the old pattern
  // returned null and every editor-typed submission was filed under UNRECOGNIZED.
  const p = parseBBFilename('Quadratic Functions_jdoe_attempt_2026-09-26-14-31-05.txt');
  assert.notEqual(p, null, 'must not be unparseable');
  assert.equal(p.studentId, 'jdoe', 'identity still comes from the filename');
  assert.equal(p.originalName, 'jdoe_2026-09-26-14-31-05.txt', 'synthetic key: it cannot collide with an attachment');
});

test('filename: a numeric student id also parses', () => {
  assert.equal(parseBBFilename('Task_01560658_attempt_2026-09-26-14-31-05_work.pdf').studentId, '01560658');
});

test('filename: unparseable names go to manual assignment', () => {
  // These become the UNRECOGNIZED group, which the Confirm Students step assigns by hand
  // under the existing duplicate-alias guard.
  assert.equal(parseBBFilename('holiday-photo.jpg'), null);
  assert.equal(parseBBFilename('Quadratic Functions_jdoe_2026-09-26_work.pdf'), null, 'no _attempt_ marker');
  assert.equal(parseBBFilename('_attempt_2026-09-26-14-31-05_work.pdf'), null, 'no username');
  assert.equal(parseBBFilename(''), null);
  assert.equal(parseBBFilename(undefined), null);
});

test('identity: a username maps to exactly one alias, or to none', () => {
  // The join the grading path makes before stamping an alias into the text.
  const aliasFor = (u) => (ROSTER.find((r) => r.bbUsername === String(u).toLowerCase()) || {}).alias || '';
  assert.equal(aliasFor('jdoe'), 'MATH10-7F3K');
  assert.equal(aliasFor('JDOE'), 'MATH10-7F3K', 'case-insensitive');
  assert.equal(aliasFor('nobody'), '', 'a student not in the vault falls to manual assignment');
});

// ── End to end on the reproduction case ───────────────────────────────────
test('end to end: the MATH1010 typed submission reaches grading redacted and verified', () => {
  const kind = classifyByName('Quadratic Functions_jdoe_attempt_2026-09-26-14-31-05.txt', 'text/plain');
  assert.equal(redactionPathFor(kind), 'text', 'no image name-zone check for this file');
  const { studentId } = parseBBFilename('Quadratic Functions_jdoe_attempt_2026-09-26-14-31-05.txt');
  const own = ROSTER.find((r) => r.bbUsername === studentId).alias;
  const extracted = parseBBSubmissionTxt(BB_TXT).submissionText;
  const { text, replacements } = redactRosterNames(requireExtractedText(extracted, 'f'), requireVault(ROSTER, 'MATH1010'), { ownAlias: own });
  assert.ok(replacements > 0);
  assert.match(text, /MATH10-7F3K/, "the student's own alias replaces their name");
  assert.match(text, /completed the square/, 'the work itself is intact and gradable');
  assert.equal(assertNoRosterNames([text], ROSTER, 'Student_jdoe'), true, 'payload passes the pre-send gate');
});
