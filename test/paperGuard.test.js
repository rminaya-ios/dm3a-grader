// One paper per student per assignment: the Confirm Students guard
// (src/blind/paperGuard.js) and the server's recording backstop
// (server/lib/duplicatePapers.js). Pure — no browser, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignPaper, holdAutoConflicts, duplicateAssignments, ALREADY_HAS_PAPER } from '../src/blind/paperGuard.js';
import duplicatePapers from '../server/lib/duplicatePapers.js';

const { splitDuplicateAliases } = duplicatePapers;

test('manual: a student who already has a paper is refused with the message', () => {
  const mapping = { 0: 'MATH-7F3K', 1: '' };
  const r = assignPaper(mapping, 1, 'MATH-7F3K');
  assert.equal(r.ok, false);
  assert.equal(r.message, ALREADY_HAS_PAPER);
  assert.equal(r.message, 'This student already has a paper for this assignment');
  assert.deepEqual(r.conflictWith, [0]);
  assert.deepEqual(mapping, { 0: 'MATH-7F3K', 1: '' }, 'a refusal changes nothing');
});

test('manual: Replace moves the student to this paper and skips the other', () => {
  const r = assignPaper({ 0: 'MATH-7F3K', 1: 'MATH-2ZQ8' }, 1, 'MATH-7F3K', { replace: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.mapping, { 0: '', 1: 'MATH-7F3K' });
  assert.deepEqual(r.cleared, [0]);
  assert.deepEqual(duplicateAssignments(r.mapping), []);
});

test('manual: a free student, re-picking the same student, and Skip all go through', () => {
  assert.deepEqual(assignPaper({ 0: 'A', 1: '' }, 1, 'B').mapping, { 0: 'A', 1: 'B' });
  assert.deepEqual(assignPaper({ 0: 'A' }, 0, 'A').mapping, { 0: 'A' });
  assert.deepEqual(assignPaper({ 0: 'A', 1: 'A' }, 1, '').mapping, { 0: 'A', 1: '' });
});

test('auto-matching: two papers matching one student are held for review, not merged', () => {
  const { mapping, conflicts } = holdAutoConflicts({ 0: 'A', 1: 'B', 2: 'A', 3: '' });
  assert.deepEqual(mapping, { 0: '', 1: 'B', 2: '', 3: '' });
  assert.deepEqual(conflicts, { 0: 'A', 2: 'A' });
});

test('auto-matching: three papers on one student are all held; distinct matches are untouched', () => {
  assert.deepEqual(holdAutoConflicts({ 0: 'A', 1: 'A', 2: 'A' }).conflicts, { 0: 'A', 1: 'A', 2: 'A' });
  const clean = holdAutoConflicts({ 0: 'A', 1: 'B' });
  assert.deepEqual(clean, { mapping: { 0: 'A', 1: 'B' }, conflicts: {} });
});

test('confirm step: duplicates are listed so they can be blocked', () => {
  assert.deepEqual(duplicateAssignments({ 0: 'A', 1: 'B', 2: 'A' }), [['A', [0, 2]]]);
  assert.deepEqual(duplicateAssignments({ 0: 'A', 1: '' }), []);
});

test('server: a batch with one alias twice records neither of those rows', () => {
  const rows = [
    { alias: 'MATH-7F3K', overallTier: 'P3' },
    { alias: 'MATH-2ZQ8', overallTier: 'P2' },
    { alias: ' math-7f3k ', overallTier: 'P1' }, // same alias, OCR spacing/case
  ];
  const { keep, duplicates } = splitDuplicateAliases(rows);
  assert.deepEqual(keep.map((r) => r.alias), ['MATH-2ZQ8']);
  assert.equal(duplicates.length, 2);
});

test('server: a clean batch is untouched', () => {
  const rows = [{ alias: 'A' }, { alias: 'B' }];
  assert.deepEqual(splitDuplicateAliases(rows), { keep: rows, duplicates: [] });
});
