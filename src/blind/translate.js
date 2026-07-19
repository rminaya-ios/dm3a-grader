// src/blind/translate.js
// DM3A Grader — Blind Grading, client-side name overlay (Part B).
//
// The server/DB/Claude only ever see aliases; the instructor sees real names.
// This builds a fast alias↔name index from the DECRYPTED mapping (held in memory
// after session unlock) so views can translate for display only. Nothing here
// ever touches the network.

// students: [{ alias, studentName?, firstName?, lastName?, studentEmail? }]
export function buildNameIndex(students) {
  const aliasToName = new Map();
  const nameToAlias = new Map();
  for (const s of students || []) {
    if (!s || !s.alias) continue;
    const name = s.studentName || `${s.firstName || ''} ${s.lastName || ''}`.trim();
    aliasToName.set(s.alias.toLowerCase(), name || s.alias);
    if (name) nameToAlias.set(name.toLowerCase(), s.alias);
  }
  return {
    // alias → real name (falls back to the input if not a known alias)
    toName: (v) => aliasToName.get(String(v || '').toLowerCase()) ?? v,
    // real name → alias (falls back to the input if not a known name)
    toAlias: (v) => nameToAlias.get(String(v || '').toLowerCase()) ?? v,
    isAlias: (v) => aliasToName.has(String(v || '').toLowerCase()),
    size: aliasToName.size,
  };
}
