// src/blind/rosterMerge.js
// DM3A Grader — Blind Grading, roster/alias MERGE rules.
//
// WHY THIS EXISTS. "Restore aliases (CSV)" used to treat the CSV as the whole truth: it
// rebuilt the vault from the file and dropped every student the file did not mention.
// On 2026-09-27 that cost a real course (MATH1010050) its Username and Student ID
// columns, and Confirm Students then matched 0 of 10 submissions, because those columns
// are the keys Blackboard downloads are matched on. The file in use also had Last/First
// columns that the old column detection did not recognise, so it fell back to reading
// column 1 as the alias and column 2 as the name — which matched nobody.
//
// The rule now: a restore MERGES. It overwrites exactly one field — the alias — on
// students it can positively identify, keeps every other column byte-for-byte, never
// deletes anyone, and never invents anyone. Anything it cannot identify is reported
// back to the instructor rather than guessed at.
//
// Pure module: no DOM, no network, no crypto. Unit-tested in test/rosterMerge.test.js.

// ── Identity keys ──────────────────────────────────────────────────────────
// A name key that survives the ways the same person gets written down. Accents are
// folded ("Améz" = "Amez"), punctuation becomes space ("My-Asia" = "My Asia"), case is
// dropped, and the words are SORTED — so "Cordero Ruiz, Yaileene" and "Yaileene Cordero
// Ruiz" produce the same key. Sorting matters because an alias card prints
// "<first> <last>" while a Blackboard CSV lists "Last, First", and a compound Spanish
// surname makes it impossible to tell which word is the surname.
export function nameKey(...parts) {
  return parts
    .filter((p) => p != null && p !== '')
    .join(' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

const idKey = (v) => String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase();
const noZeros = (v) => idKey(v).replace(/^0+/, '');

// The name a roster entry is known by, however it was stored.
const entryName = (s) =>
  nameKey(s && s.studentName) ||
  nameKey(s && s.firstName, s && s.lastName) ||
  '';

// ── Rows that are not students ─────────────────────────────────────────────
// Blackboard seeds every course with a hidden "preview user" so the instructor can see
// the course as a student. It arrives in the Grade Center CSV looking exactly like a
// student, so it was being secured into the vault and printed an alias card of its own.
const PREVIEW_RE = /preview\s*user|_preview(?:user)?\b/i;

export function isPreviewRow(row) {
  if (!row) return false;
  const haystack = [row.username, row.studentId, row.last, row.first, row.name, row.studentName, row.bbUsername]
    .filter(Boolean).join(' ');
  return PREVIEW_RE.test(haystack);
}

// The instructor's own enrolment. Matched on the name words only, so "Ralph Minaya" and
// "Minaya, Ralph" both count, and a student who merely shares a surname does not.
export function isInstructorRow(row, instructorNames = []) {
  if (!row) return false;
  const key = nameKey(row.name || row.studentName) || nameKey(row.first, row.last);
  if (!key) return false;
  return instructorNames.map((n) => nameKey(n)).filter(Boolean).includes(key);
}

// Split incoming roster rows into the ones to keep and the ones to skip, with a reason
// for each skip. Nothing is dropped silently — the caller logs and shows the list.
export function filterRosterRows(rows, { instructorNames = [] } = {}) {
  const kept = [], skipped = [];
  for (const row of rows || []) {
    if (isPreviewRow(row)) { skipped.push({ row, reason: "Blackboard preview user" }); continue; }
    if (isInstructorRow(row, instructorNames)) { skipped.push({ row, reason: "matches your own name (instructor enrolment)" }); continue; }
    kept.push(row);
  }
  return { kept, skipped };
}

// ── Column detection for an alias-restore CSV ──────────────────────────────
const headerKey = (s) => String(s || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const COLUMNS = {
  alias: ['alias', 'aliasid', 'code', 'studentcode', 'dm3aid', 'dm3a'],
  username: ['username', 'usename', 'userid', 'bbusername', 'user'],
  studentId: ['studentid', 'id', 'studentnumber'],
  last: ['lastname', 'last', 'surname', 'familyname'],
  first: ['firstname', 'first', 'givenname'],
  name: ['printedname', 'studentname', 'name', 'fullname', 'student'],
};

// Map a parsed CSV's headers onto the fields we understand. Returns null for a header
// set with no alias column, which the caller turns into a clear error rather than
// guessing at column positions — guessing is what corrupted the vault.
export function detectAliasCsvColumns(fields) {
  const byKey = new Map((fields || []).map((f) => [headerKey(f), f]));
  const found = {};
  for (const [field, candidates] of Object.entries(COLUMNS)) {
    for (const c of candidates) {
      if (byKey.has(c)) { found[field] = byKey.get(c); break; }
    }
  }
  if (!found.alias) return null;
  if (!found.name && !found.last && !found.username && !found.studentId) return null;
  return found;
}

// Normalise one CSV row into the shape the merge understands.
export function readAliasCsvRow(raw, cols) {
  const get = (f) => (cols[f] ? String(raw[cols[f]] == null ? '' : raw[cols[f]]).trim() : '');
  return {
    alias: get('alias'),
    username: get('username'),
    studentId: get('studentId'),
    last: get('last'),
    first: get('first'),
    name: get('name'),
  };
}

// ── The merge ──────────────────────────────────────────────────────────────
// Returns:
//   merged     — the full roster to re-encrypt: same students, same order, same columns,
//                with only the alias changed on rows the CSV identified
//   matched    — [{ row, student, via }]  how each CSV row was identified
//   unmatched  — [{ row, reason }]        CSV rows that identify nobody (reported, never added)
//   untouched  — students the CSV never mentioned (kept exactly as they were)
//   conflicts  — two CSV rows claiming one student, or an alias that would end up shared
export function mergeAliasRestore(existing, rows) {
  const roster = Array.isArray(existing) ? existing : [];
  const byUser = new Map(), byId = new Map(), byIdNoZeros = new Map(), byName = new Map();
  roster.forEach((s, i) => {
    if (s && s.bbUsername) byUser.set(idKey(s.bbUsername), i);
    if (s && s.studentId) { byId.set(idKey(s.studentId), i); byIdNoZeros.set(noZeros(s.studentId), i); }
    const nk = entryName(s);
    // A duplicated name key is recorded as ambiguous (null) rather than resolving to
    // whichever entry came first — two students with the same name words must be
    // matched by Username or Student ID, not by name.
    if (nk) byName.set(nk, byName.has(nk) ? null : i);
  });

  const merged = roster.map((s) => ({ ...s }));
  const matched = [], unmatched = [], conflicts = [];
  const claimedBy = new Map(); // roster index -> the CSV row that claimed it

  for (const row of rows || []) {
    if (!row || !row.alias) {
      unmatched.push({ row, reason: 'no alias in this row' });
      continue;
    }
    // Username and Student ID are the primary keys: they are what Blackboard identifies
    // a submission by, and unlike a name they cannot be spelled two ways.
    let idx, via;
    if (row.username && byUser.has(idKey(row.username))) { idx = byUser.get(idKey(row.username)); via = 'Username'; }
    else if (row.studentId && byId.has(idKey(row.studentId))) { idx = byId.get(idKey(row.studentId)); via = 'Student ID'; }
    else if (row.studentId && byIdNoZeros.has(noZeros(row.studentId))) { idx = byIdNoZeros.get(noZeros(row.studentId)); via = 'Student ID (leading zeros ignored)'; }
    else {
      const nk = nameKey(row.name) || nameKey(row.first, row.last);
      if (nk && byName.get(nk) === null) { unmatched.push({ row, reason: 'two students in the vault share this name — match by Username or Student ID' }); continue; }
      if (nk && byName.has(nk)) { idx = byName.get(nk); via = 'name'; }
    }

    if (idx === undefined) { unmatched.push({ row, reason: 'no student in the vault with this name, Username or Student ID' }); continue; }
    if (claimedBy.has(idx)) {
      conflicts.push({ row, other: claimedBy.get(idx), student: roster[idx], reason: 'two CSV rows point at the same student' });
      continue;
    }
    claimedBy.set(idx, row);
    // THE ONLY FIELD THAT CHANGES. Username, Student ID, email, drop flag and anything
    // else the vault holds are carried through untouched.
    merged[idx] = { ...merged[idx], alias: row.alias };
    matched.push({ row, student: roster[idx], via });
  }

  // An alias must identify exactly one student. A restored alias can collide with one
  // still held by a student the CSV never mentioned, which would silently attach two
  // people's work together — so it is reported and the caller refuses the file.
  const seen = new Map();
  merged.forEach((s, i) => {
    const a = idKey(s && s.alias);
    if (!a) return;
    if (seen.has(a)) conflicts.push({ reason: 'this alias would belong to two students', alias: s.alias, student: s, other: merged[seen.get(a)] });
    else seen.set(a, i);
  });

  return {
    merged,
    matched,
    unmatched,
    untouched: roster.filter((_s, i) => !claimedBy.has(i)),
    conflicts,
    changed: matched.filter((m) => idKey(m.student && m.student.alias) !== idKey(m.row.alias)).length,
  };
}
