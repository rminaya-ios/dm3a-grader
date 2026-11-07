// lib/duplicatePapers.js
// DM3A Grader — the server's half of "one paper per student per assignment".
//
// The Confirm Students step (src/blind/paperGuard.js) refuses to put two papers
// on one student. This is the backstop for a payload that still does: when a
// results batch carries the same alias more than once, NONE of those rows is
// recorded — guessing which paper is theirs would file a stranger's grade in the
// student's history. They are reported as skipped, and the rest record normally.
//
// Pure: unit-tested in test/paperGuard.test.js.

function aliasKey(s) {
  return s && s.alias ? String(s.alias).trim().toLowerCase() : '';
}

// Returns { keep, duplicates }: rows whose alias appears once (or that have no
// alias — the legacy path matches those on its own), and the rows held back.
function splitDuplicateAliases(students) {
  const list = Array.isArray(students) ? students : [];
  const count = new Map();
  for (const s of list) {
    const k = aliasKey(s);
    if (k) count.set(k, (count.get(k) || 0) + 1);
  }
  const keep = [];
  const duplicates = [];
  for (const s of list) {
    const k = aliasKey(s);
    (k && count.get(k) > 1 ? duplicates : keep).push(s);
  }
  return { keep, duplicates };
}

module.exports = { splitDuplicateAliases };
