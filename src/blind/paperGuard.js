// src/blind/paperGuard.js
// DM3A Grader — one paper per student per assignment, on the Confirm Students step.
//
// A grading run is ONE assignment, so a roster student (alias, or email on a
// non-blind course) can have at most one paper in it. Two papers on one student
// means one of them belongs to somebody else: recording both files a stranger's
// grade in that student's history, and the real author gets nothing.
//
//   - Manual: assigning a student who already has a paper is refused with
//     ALREADY_HAS_PAPER, unless the instructor explicitly chooses Replace — which
//     moves the student to this paper and sets the other paper back to Skip.
//   - Auto-matching: when two or more papers match one student, NONE of them is
//     assigned. They are flagged for the instructor to review instead of merged.
//
// `mapping` is { [paperIndex]: value }, where "" means Skip. Pure, no React:
// unit-tested in test/paperGuard.test.js.

export const ALREADY_HAS_PAPER = "This student already has a paper for this assignment";

// Papers other than `self` assigned to `val`.
export function papersAssignedTo(mapping, val, self) {
  if (!val) return [];
  return Object.keys(mapping || {})
    .map(Number)
    .filter((j) => j !== self && mapping[j] === val)
    .sort((a, b) => a - b);
}

// Assign paper `i` to `val`. Returns { ok: true, mapping, cleared } — `cleared` are
// the papers Replace set back to Skip — or { ok: false, message, conflictWith }.
export function assignPaper(mapping, i, val, { replace = false } = {}) {
  const others = papersAssignedTo(mapping, val, i);
  if (others.length && !replace) {
    return { ok: false, message: ALREADY_HAS_PAPER, conflictWith: others };
  }
  const next = { ...mapping, [i]: val || "" };
  for (const j of others) next[j] = "";
  return { ok: true, mapping: next, cleared: others };
}

// After auto-matching: unassign every student matched by more than one paper.
// Returns { mapping, conflicts } where conflicts is { [paperIndex]: value }.
export function holdAutoConflicts(mapping) {
  const byVal = {};
  for (const [k, v] of Object.entries(mapping || {})) {
    if (v) (byVal[v] = byVal[v] || []).push(Number(k));
  }
  const next = { ...mapping };
  const conflicts = {};
  for (const [v, idxs] of Object.entries(byVal)) {
    if (idxs.length < 2) continue;
    for (const i of idxs) { next[i] = ""; conflicts[i] = v; }
  }
  return { mapping: next, conflicts };
}

// Students assigned to more than one paper: [[value, [paperIndex, …]], …].
export function duplicateAssignments(mapping) {
  const byVal = {};
  for (const [k, v] of Object.entries(mapping || {})) {
    if (v) (byVal[v] = byVal[v] || []).push(Number(k));
  }
  return Object.entries(byVal).filter(([, idxs]) => idxs.length > 1);
}
