// src/blind/rosterDiff.js
// DM3A Grader — Blind Grading, roster update diff (Part A).
//
// Re-uploading a roster must DIFF against the existing decrypted mapping, never
// replace it: alias continuity is what keeps a student's grade history attached.
//   - existing student (matched) keeps their alias
//   - new student gets a fresh, collision-free alias
//   - dropped student (was present, now absent) is FLAGGED (dropped:true), never deleted
//
// Match precedence follows Blackboard's identity keys: Username → Student ID →
// email → normalized name (last resort).

import { coursePrefix, generateAlias } from './alias.js';

function keyOf(s) {
  if (!s) return null;
  if (s.bbUsername) return `u:${String(s.bbUsername).trim().toLowerCase()}`;
  if (s.studentId) return `i:${String(s.studentId).trim()}`;
  if (s.studentEmail) return `e:${String(s.studentEmail).trim().toLowerCase()}`;
  const name = s.studentName || `${s.firstName || ''} ${s.lastName || ''}`.trim();
  if (name) return `n:${name.trim().toLowerCase()}`;
  return null;
}

export function diffRoster(existing, incoming, courseCode) {
  const existingByKey = new Map();
  for (const s of existing || []) {
    const k = keyOf(s);
    if (k) existingByKey.set(k, s);
  }

  const usedAliases = new Set((existing || []).map((s) => s.alias).filter(Boolean));
  const prefix = coursePrefix(courseCode);
  const freshAlias = () => {
    let a;
    do { a = generateAlias(prefix); } while (usedAliases.has(a));
    usedAliases.add(a);
    return a;
  };

  const kept = [];
  const added = [];
  const merged = [];
  const incomingKeys = new Set();

  for (const inc of incoming || []) {
    const k = keyOf(inc);
    if (k) incomingKeys.add(k);
    const prior = k ? existingByKey.get(k) : null;
    if (prior) {
      // Keep prior fields (e.g. studentEmail, which a BB grade export omits)
      // unless the incoming row supplies a non-empty replacement.
      const overlay = {};
      for (const [k, v] of Object.entries(inc)) {
        if (v !== '' && v != null) overlay[k] = v;
      }
      const rec = { ...prior, ...overlay, alias: prior.alias, dropped: false };
      kept.push(rec);
      merged.push(rec);
    } else {
      const rec = { ...inc, alias: freshAlias(), dropped: false };
      added.push(rec);
      merged.push(rec);
    }
  }

  const dropped = [];
  for (const s of existing || []) {
    const k = keyOf(s);
    if (k && !incomingKeys.has(k)) {
      const rec = { ...s, dropped: true };
      dropped.push(rec);
      merged.push(rec); // retained + flagged, never removed
    }
  }

  return { merged, added, kept, dropped };
}
