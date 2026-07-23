// src/blind/alias.js
// DM3A Grader — Blind Grading Mode, course-scoped alias generation (spec §2.2)
//
// Isomorphic: uses WebCrypto (crypto.getRandomValues), available in the browser
// and in Node 20+. Aliases are RANDOM (never derived from usernames/ids — hashes
// of low-entropy identifiers are dictionary-reversible), from a Crockford-style
// base32 alphabet with no ambiguous glyphs (excludes 0 O 1 I L), because students
// handwrite these on their work.

export const ALIAS_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 chars, no 0/O/1/I/L

// Normalize an alias for matching. OCR of a handwritten ID often adds spaces
// ("TEST 11 - UEGR"); the vault stores the clean form ("TEST11-UEGR"). Uppercase
// + strip ALL whitespace so detected IDs key/match the vault reliably.
export function normalizeAlias(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '');
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
