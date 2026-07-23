// src/blind/bbExport.js
// DM3A Grader — Blind Grading, Blackboard round-trip export (spec §4).
//
// All client-side. The instructor uploads their BB Grade Center working file; we
// match graded ALIASES → the decrypted mapping → the BB row (by Username, Student
// ID fallback), fill the chosen grade column, and hand back a CSV whose HEADER
// LINE is preserved byte-for-byte (BB grade columns carry internal IDs that must
// survive). Unmatched rows/results are surfaced, never silently dropped. The
// completed CSV is never uploaded anywhere.

import Papa from 'papaparse';

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Default P-tier → percentage midpoints (configurable per §4.2).
export const DEFAULT_TIER_PCT = { P4: 95, P3: 85, P2: 70, P1: 50 };

// Parse a BB CSV. Preserve the exact header line (with its internal IDs and any
// CR) so it can be re-emitted byte-for-byte; parse the remaining rows as arrays
// (column order + duplicate headers preserved).
export function parseBBFile(text) {
  const src = String(text || '');
  // Split off the first physical line exactly as written (keep trailing \r).
  const nlIdx = src.indexOf('\n');
  const headerLine = nlIdx === -1 ? src : src.slice(0, nlIdx);
  const parsed = Papa.parse(src, { skipEmptyLines: false });
  const rows = parsed.data.filter((r, i) => !(i === parsed.data.length - 1 && r.length === 1 && r[0] === ''));
  const headers = rows[0] || [];
  const dataRows = rows.slice(1);
  return { headerLine, headers, dataRows };
}

export function findCol(headers, candidates) {
  const map = new Map((headers || []).map((h, i) => [norm(h).replace(/["']/g, ''), i]));
  for (const c of candidates) {
    const hit = map.get(norm(c));
    if (hit !== undefined) return hit;
  }
  return -1;
}

// Grade columns: BB score columns carry a "|<id>" suffix or "[Total Pts ...]"/
// Points/Score/Grade, excluding the identity columns.
export function detectGradeColumns(headers) {
  const IDENTITY = /last name|first name|username|student id|availability|child course/i;
  return (headers || [])
    .map((h, index) => ({ index, header: h }))
    .filter((c) => c.header && !IDENTITY.test(c.header) &&
      /\|\s*\d|\[total pts|points|\bscore\b|\bgrade\b/i.test(c.header));
}

// Build the grade-value formatter. mode: 'numeric' (write the raw score) or
// 'percent' (P-tier → midpoint %). tierPct overrides the midpoints.
export function makeGradeFormatter(mode = 'numeric', tierPct = DEFAULT_TIER_PCT) {
  return (res) => {
    const tier = res.tier || res.pLabel || (res.pScore ? `P${res.pScore}` : (res.overallTier || ''));
    if (mode === 'percent') {
      const pct = tierPct[String(tier).toUpperCase()];
      return pct === undefined ? '' : String(pct);
    }
    // numeric: prefer an explicit score, else the P-number
    if (res.score !== undefined && res.score !== null && res.score !== '') return String(res.score);
    const m = /^P?\s*([1-4])$/i.exec(String(tier));
    return m ? m[1] : '';
  };
}

// Join graded results (alias-keyed) to BB rows via the decrypted mapping, fill the
// target column, and report reconciliation. Pure — no network, no mutation of inputs.
//   results: [{ alias, tier|pScore|overallTier|score }]
//   mapping: [{ alias, bbUsername, studentId }]
export function joinGrades({ headers, dataRows, results, mapping, columnIndex, formatGrade }) {
  const uCol = findCol(headers, ['Username', 'User Name', 'User Id', 'UserId']);
  const idCol = findCol(headers, ['Student ID', 'StudentID', 'Student Id']);
  const emailCol = findCol(headers, ['Email', 'Email Address', 'E-mail', 'EmailAddress']);
  const lastCol = findCol(headers, ['Last Name', 'LastName', 'Last']);
  const firstCol = findCol(headers, ['First Name', 'FirstName', 'First']);
  const aliasToStudent = new Map((mapping || []).map((s) => [s.alias, s]));

  // #9: match by Username → Student ID → email → Last|First name.
  const nameKey = (last, first) => `${norm(last)}|${norm(first)}`;
  const rowByUser = new Map(), rowById = new Map(), rowByEmail = new Map(), rowByName = new Map();
  dataRows.forEach((r, i) => {
    if (uCol >= 0 && r[uCol]) rowByUser.set(norm(r[uCol]), i);
    if (idCol >= 0 && r[idCol]) rowById.set(String(r[idCol]).trim(), i);
    if (emailCol >= 0 && r[emailCol]) rowByEmail.set(norm(r[emailCol]), i);
    if (lastCol >= 0 && r[lastCol]) rowByName.set(nameKey(r[lastCol], firstCol >= 0 ? r[firstCol] : ''), i);
  });

  const filled = dataRows.map((r) => r.slice());
  const matched = [];
  const unmatchedResults = [];
  const matchedRows = new Set();

  for (const res of results || []) {
    const stu = aliasToStudent.get(res.alias);
    if (!stu) { unmatchedResults.push({ alias: res.alias, reason: 'alias not in mapping' }); continue; }
    let ri;
    if (stu.bbUsername && rowByUser.has(norm(stu.bbUsername))) ri = rowByUser.get(norm(stu.bbUsername));
    else if (stu.studentId && rowById.has(String(stu.studentId).trim())) ri = rowById.get(String(stu.studentId).trim());
    else if (stu.studentEmail && rowByEmail.has(norm(stu.studentEmail))) ri = rowByEmail.get(norm(stu.studentEmail));
    else if (stu.lastName && rowByName.has(nameKey(stu.lastName, stu.firstName))) ri = rowByName.get(nameKey(stu.lastName, stu.firstName));
    if (ri === undefined) {
      unmatchedResults.push({ alias: res.alias, reason: 'no matching BB row (username/id/email/name)' });
      continue;
    }
    if (columnIndex >= 0) filled[ri][columnIndex] = formatGrade(res);
    matchedRows.add(ri);
    matched.push({ alias: res.alias, rowIndex: ri });
  }

  const unmatchedRows = dataRows
    .map((r, i) => i)
    .filter((i) => !matchedRows.has(i))
    .map((i) => ({
      rowIndex: i,
      username: uCol >= 0 ? dataRows[i][uCol] : '',
      studentId: idCol >= 0 ? dataRows[i][idCol] : '',
    }));

  return { filled, matched, unmatchedResults, unmatchedRows };
}

// Re-emit the CSV: header line VERBATIM + the (filled) data rows. Uses the file's
// detected newline so BB re-imports cleanly.
export function serializeBB(headerLine, filledRows) {
  const eol = /\r$/.test(headerLine) ? '\r\n' : '\n';
  const body = Papa.unparse(filledRows, { newline: eol });
  const header = headerLine.replace(/\r$/, '');
  return header + eol + body + (body ? eol : '');
}
