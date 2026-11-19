// lib/aliasGuard.js
// DM3A — the server-side rule that an issued alias is permanent.
//
// Aliases are a promise made on paper: students write their code on work that is
// already handed in, and a code that changes underneath them cannot be matched back to
// anyone. Twice in September a roster operation silently rewrote a live alias set.
//
// The client has the same check (src/blind/aliasVerify.js) so it can warn before
// asking, but the client is not where a rule like this can live — a bad request, an old
// browser tab or another tool must not be able to rewrite an alias. So the write route
// enforces it here, server-side, and refuses.
//
// DELIBERATE DUPLICATION. `nameKey` is implemented twice: here for the server (CommonJS)
// and in src/blind/rosterMerge.js for the browser (ESM). They must agree, and
// test/aliasGuard.test.js cross-checks both implementations against one corpus of cases
// so a drift between them fails the suite rather than mismatching students in silence.

// Order-independent, accent-folded, punctuation-stripped set of name words. An alias
// card prints "First Last" while a Blackboard CSV lists "Last, First", and a compound
// surname makes it impossible to say which word is the surname — so the words are
// sorted and compared as a set.
function nameKey(...parts) {
  return parts
    .filter((p) => p != null && p !== '')
    .join(' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    // An apostrophe sits INSIDE a name word ("O'Brien"), so it is removed rather than
    // treated as a separator — otherwise it would not match a roster that spells it
    // "OBrien". Straight and curly both. Mirrored in the other copy; cross-checked by
    // test/aliasGuard.test.js.
    .replace(/['\u2019\u02BC]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

const aliasKey = (v) => String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const idKey = (v) => String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase();
const noZeros = (v) => idKey(v).replace(/^0+/, '');

const entryName = (s) => nameKey(s && s.studentName) || nameKey(s && s.firstName, s && s.lastName) || '';
const entryLabel = (s) =>
  (s && (s.studentName || `${s.firstName || ''} ${s.lastName || ''}`.trim())) || (s && s.alias) || '(unnamed)';

function indexRoster(roster) {
  const byName = new Map(), byUser = new Map(), byId = new Map();
  (roster || []).forEach((s, i) => {
    const nk = entryName(s);
    // A duplicated name key resolves to nothing: two students with the same words must
    // be matched by Username or Student ID, never by name.
    if (nk) byName.set(nk, byName.has(nk) ? null : i);
    if (s && s.bbUsername) byUser.set(idKey(s.bbUsername), i);
    if (s && s.studentId) { byId.set(idKey(s.studentId), i); byId.set(noZeros(s.studentId), i); }
  });
  return { byName, byUser, byId };
}

// Match a student in `after` back to who they were in `before`. Username and Student ID
// come first: a corrected spelling or a married name must not read as "new student,
// new alias".
function findPrior(before, idx, s) {
  if (s && s.bbUsername && idx.byUser.has(idKey(s.bbUsername))) return before[idx.byUser.get(idKey(s.bbUsername))];
  if (s && s.studentId && idx.byId.has(idKey(s.studentId))) return before[idx.byId.get(idKey(s.studentId))];
  const nk = entryName(s);
  if (nk && idx.byName.get(nk) != null) return before[idx.byName.get(nk)];
  return null;
}

// { ok, violations: [{student, from, to}], dropped: [{student, alias}], added: n }
//
// A violation is: an existing alias changed, or an existing alias removed. NOT a
// violation: a new student receiving a new alias, or a student leaving (reported as
// dropped so the caller can mark them inactive rather than delete them mid-term).
function checkAliasesPreserved(before, after) {
  const prior = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const idx = indexRoster(prior);
  const violations = [];
  const seen = new Set();
  let added = 0;

  for (const s of next) {
    const was = findPrior(prior, idx, s);
    if (!was) { added++; continue; }
    seen.add(was);
    const from = was.alias, to = s.alias;
    if (from && to && aliasKey(from) !== aliasKey(to)) violations.push({ student: entryLabel(s), from, to });
    else if (from && !to) violations.push({ student: entryLabel(s), from, to: '(removed)' });
  }

  const dropped = prior.filter((was) => !seen.has(was)).map((was) => ({ student: entryLabel(was), alias: was.alias || '' }));
  return { ok: violations.length === 0, violations, dropped, added };
}

// An alias must identify exactly one student, or two people's work collapses onto one
// code. Returns the offending aliases.
function duplicateAliases(roster) {
  const seen = new Set(), dupes = new Set();
  for (const s of roster || []) {
    const k = aliasKey(s && s.alias);
    if (!k) continue;
    if (seen.has(k)) dupes.add(s.alias); else seen.add(k);
  }
  return [...dupes];
}

module.exports = { nameKey, checkAliasesPreserved, duplicateAliases, aliasKey };
