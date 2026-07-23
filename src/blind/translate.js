// src/blind/translate.js
// DM3A Grader — Blind Grading, client-side name overlay (Part B).
//
// The server/DB/Claude only ever see aliases; the instructor sees real names.
// This builds a fast alias↔name index from the DECRYPTED mapping (held in memory
// after session unlock) so views can translate for display only. Nothing here
// ever touches the network.

import { normalizeAlias } from './alias.js';

// students: [{ alias, studentName?, firstName?, lastName?, studentEmail? }]
// Aliases are keyed by normalizeAlias so an OCR-detected ID with stray spaces
// ("TEST 11 - UEGR") still matches the clean vault form ("TEST11-UEGR").
export function buildNameIndex(students) {
  const aliasToName = new Map();
  const nameToAlias = new Map();
  for (const s of students || []) {
    if (!s || !s.alias) continue;
    const name = s.studentName || `${s.firstName || ''} ${s.lastName || ''}`.trim();
    aliasToName.set(normalizeAlias(s.alias), name || s.alias);
    if (name) nameToAlias.set(name.toLowerCase(), s.alias);
  }
  return {
    // alias → real name (falls back to the input if not a known alias)
    toName: (v) => aliasToName.get(normalizeAlias(v)) ?? v,
    // real name → alias (falls back to the input if not a known name)
    toAlias: (v) => nameToAlias.get(String(v || '').toLowerCase()) ?? v,
    isAlias: (v) => aliasToName.has(normalizeAlias(v)),
    size: aliasToName.size,
  };
}
