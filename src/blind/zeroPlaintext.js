// src/blind/zeroPlaintext.js
// DM3A Grader — Blind Grading, zero-plaintext network assertion (Part B / §6).
//
// Recursively scans a JSON-serializable payload (an API request body OR response)
// for any plaintext student identifier — names or emails from the decrypted
// roster. Returns the violations found. A blind-correct payload yields [].
//
// Intended use: wrap fetch in a test/dev harness, run this on every request body
// (and response), and assert the result is empty for all grading-view traffic.

export function findPlaintext(payload, forbidden) {
  const needles = (forbidden || [])
    .map((s) => String(s || '').trim().toLowerCase())
    .filter((s) => s.length >= 2); // ignore trivially-short tokens
  if (needles.length === 0) return [];

  const hits = [];
  const seen = new Set();
  const walk = (val, path) => {
    if (val == null) return;
    if (typeof val === 'string') {
      const hay = val.toLowerCase();
      for (const n of needles) {
        if (hay.includes(n)) hits.push({ path, needle: n, value: val.slice(0, 80) });
      }
      return;
    }
    if (typeof val === 'object') {
      if (seen.has(val)) return; // guard cycles
      seen.add(val);
      for (const k of Object.keys(val)) {
        walk(val[k], path ? `${path}.${k}` : k);
      }
    }
  };
  walk(payload, '');
  return hits;
}

// Convenience: true if the payload is free of every forbidden identifier.
export function isBlindClean(payload, forbidden) {
  return findPlaintext(payload, forbidden).length === 0;
}
