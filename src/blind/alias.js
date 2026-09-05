// src/blind/alias.js
// DM3A Grader — Blind Grading Mode, course-scoped alias generation (spec §2.2)
//
// Isomorphic: uses WebCrypto (crypto.getRandomValues), available in the browser
// and in Node 20+. Aliases are RANDOM (never derived from usernames/ids — hashes
// of low-entropy identifiers are dictionary-reversible), from a Crockford-style
// base32 alphabet with no ambiguous glyphs (excludes 0 O 1 I L), because students
// handwrite these on their work.

export const ALIAS_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 chars, no 0/O/1/I/L

// Normalize an alias for matching. OCR of a handwritten ID adds spaces and mangles
// punctuation — "MATH 11 - JAMZ", "MATH11 - DB YP", and a hyphen read as an en-dash
// all mean MATH11-JAMZ / MATH11-DBYP. Uppercase and drop EVERY non-alphanumeric
// character, so only the letters and digits are compared. (Stripping whitespace
// alone left a mangled separator in place and failed an otherwise perfect match.)
export function normalizeAlias(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The alias alphabet already excludes 0/O/1/I/L because students handwrite these,
// but OCR still confuses these pairs, all of which the alphabet contains:
//   5/S   2/Z   8/B   6/G
// Folding each pair to one representative lets a mis-read ID find its student.
// Folding is LOSSY, so it is only ever used to propose a candidate — never to
// decide one on its own (see matchAlias).
const OCR_FOLD = { '5': 'S', '2': 'Z', '8': 'B', '6': 'G' };
export function foldConfusables(s) {
  return String(s || '').replace(/[5286]/g, (c) => OCR_FOLD[c]);
}

// The random suffix is what actually identifies a student; the course prefix is
// shared by everyone and is the part OCR mangles most ("Mauh11", "mchn", "Mathill").
export function aliasSuffix(s, len = 4) {
  const n = normalizeAlias(s);
  return n.length >= len ? n.slice(-len) : '';
}

// Match a detected ID against the course's aliases.
//   exact      — normalized strings are identical; safe to assign silently.
//   candidates — confusable-tolerant suffix matches; the caller must refuse to
//                assign when there is more than one, and should ask the
//                instructor to verify even when there is exactly one.
export function matchAlias(detected, aliases, len = 4) {
  const d = normalizeAlias(detected);
  const list = aliases || [];
  if (!d) return { exact: null, candidates: [] };
  const exact = list.find((a) => normalizeAlias(a) === d) || null;
  if (exact) return { exact, candidates: [exact] };
  const ds = foldConfusables(aliasSuffix(detected, len));
  if (!ds) return { exact: null, candidates: [] };
  return { exact: null, candidates: list.filter((a) => foldConfusables(aliasSuffix(a, len)) === ds) };
}

// Default course prefix: course code uppercased, alnum-only, ≤6 chars.
export function coursePrefix(courseCode) {
  const cleaned = String(courseCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.slice(0, 6) || 'CRS';
}

// n unbiased random chars from ALIAS_ALPHABET (rejection sampling avoids modulo bias).
function randomChars(n) {
  const alpha = ALIAS_ALPHABET;
  const limit = 256 - (256 % alpha.length); // reject bytes at/above this to stay unbiased
  const out = [];
  const buf = new Uint8Array(n * 2);
  while (out.length < n) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < n; i++) {
      if (buf[i] < limit) out.push(alpha[buf[i] % alpha.length]);
    }
  }
  return out.join('');
}

// One alias, e.g. "M110-7F3K".
export function generateAlias(prefix, len = 4) {
  return `${prefix}-${randomChars(len)}`;
}

// Assign a unique alias to each student. Collisions within the course roster are
// detected and regenerated (spec §2.2). Returns a new array; inputs untouched.
export function assignAliases(students, courseCode, len = 4) {
  const prefix = coursePrefix(courseCode);
  const used = new Set();
  return (students || []).map((s) => {
    let alias;
    do {
      alias = generateAlias(prefix, len);
    } while (used.has(alias));
    used.add(alias);
    return { ...s, alias };
  });
}
