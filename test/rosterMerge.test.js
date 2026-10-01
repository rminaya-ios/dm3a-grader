// Unit tests for the roster/alias MERGE rules (src/blind/rosterMerge.js).
// These encode what went wrong on 2026-09-27: a restore that replaced the roster and
// dropped the Username / Student ID columns Confirm Students matches on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nameKey, isPreviewRow, isInstructorRow, filterRosterRows,
  detectAliasCsvColumns, readAliasCsvRow, mergeAliasRestore,
} from '../src/blind/rosterMerge.js';

// A vault as importBBRoster + secureCourse leave it: full columns, current aliases.
const VAULT = () => [
  { alias: 'MATH10-AAAA', studentName: 'Ayawa Fideline Amezouwoe', firstName: 'Ayawa Fideline', lastName: 'Amezouwoe', bbUsername: 'aamezouwoe', studentId: '03051898', studentEmail: 'a@ct.edu' },
  { alias: 'MATH10-BBBB', studentName: 'Yaileene Cordero Ruiz', firstName: 'Yaileene', lastName: 'Cordero Ruiz', bbUsername: 'ycordero', studentId: '03060042', studentEmail: 'y@ct.edu' },
  { alias: 'MATH10-CCCC', studentName: 'My-Asia Crooms', firstName: 'My-Asia', lastName: 'Crooms', bbUsername: 'mcrooms', studentId: '03060099', studentEmail: 'm@ct.edu' },
];

// ── Name keys: the same person written down several ways ───────────────────
test('name key ignores order, case, accents and punctuation', () => {
  assert.equal(nameKey('Yaileene Cordero Ruiz'), nameKey('Cordero Ruiz, Yaileene'),
    'an alias card prints "First Last"; a Blackboard CSV lists "Last, First"');
  assert.equal(nameKey('My-Asia Crooms'), nameKey('crooms   my asia'));
  assert.equal(nameKey('Amézouwoe, Ayawa'), nameKey('Ayawa Amezouwoe'), 'accents folded');
  assert.equal(nameKey('Ralph', 'Minaya'), nameKey('Minaya Ralph'));
  assert.notEqual(nameKey('Jane Doe'), nameKey('Jane Roe'));
  assert.equal(nameKey(''), '');
  assert.equal(nameKey(null, undefined), '');
});

// ── ITEM 1: the restore MERGES ─────────────────────────────────────────────
test('merge keeps Username, Student ID and email — only the alias changes', () => {
  // THE REGRESSION. A Last,First,Alias file (what the card script produces) must not
  // cost the vault the columns Blackboard submissions are matched on.
  const vault = VAULT();
  const rows = [
    { alias: 'MATH10-ZM7B', last: 'Amezouwoe', first: 'Ayawa Fideline', name: '', username: '', studentId: '' },
    { alias: 'MATH10-R5Z2', last: 'Ruiz', first: 'Yaileene Cordero', name: '', username: '', studentId: '' },
    { alias: 'MATH10-VTR3', last: 'Crooms', first: 'My-Asia', name: '', username: '', studentId: '' },
  ];
  const r = mergeAliasRestore(vault, rows);
  assert.equal(r.merged.length, 3);
  assert.equal(r.unmatched.length, 0, 'all three identified by name');
  assert.deepEqual(r.merged.map((s) => s.alias), ['MATH10-ZM7B', 'MATH10-R5Z2', 'MATH10-VTR3']);
  // Every other column survives, byte for byte.
  assert.deepEqual(r.merged.map((s) => s.bbUsername), ['aamezouwoe', 'ycordero', 'mcrooms']);
  assert.deepEqual(r.merged.map((s) => s.studentId), ['03051898', '03060042', '03060099']);
  assert.deepEqual(r.merged.map((s) => s.studentEmail), ['a@ct.edu', 'y@ct.edu', 'm@ct.edu']);
  assert.deepEqual(r.merged.map((s) => s.lastName), ['Amezouwoe', 'Cordero Ruiz', 'Crooms']);
  assert.equal(r.changed, 3);
});

test('merge never deletes a student the CSV does not mention', () => {
  const vault = VAULT();
  const rows = [{ alias: 'MATH10-ZM7B', last: 'Amezouwoe', first: 'Ayawa Fideline', name: '', username: '', studentId: '' }];
  const r = mergeAliasRestore(vault, rows);
  assert.equal(r.merged.length, 3, 'nobody is dropped');
  assert.equal(r.untouched.length, 2);
  assert.equal(r.merged[1].alias, 'MATH10-BBBB', 'an unmentioned student keeps their current alias');
  assert.equal(r.merged[2].alias, 'MATH10-CCCC');
});

test('merge never invents a student', () => {
  const vault = VAULT();
  const rows = [{ alias: 'MATH10-NEW1', last: 'Nobody', first: 'New', name: '', username: '', studentId: '' }];
  const r = mergeAliasRestore(vault, rows);
  assert.equal(r.merged.length, 3, 'no new entry created');
  assert.equal(r.unmatched.length, 1);
  assert.match(r.unmatched[0].reason, /no student in the vault/);
  assert.equal(r.unmatched[0].row.last, 'Nobody', 'the row is handed back so it can be listed');
});

test('merge prefers Username, then Student ID, over the name', () => {
  const vault = VAULT();
  // Name deliberately wrong: the Username must still win.
  const r = mergeAliasRestore(vault, [
    { alias: 'MATH10-U111', username: 'mcrooms', studentId: '', last: 'Wrong', first: 'Totally', name: '' },
    { alias: 'MATH10-I222', username: '', studentId: '03060042', last: '', first: '', name: '' },
  ]);
  assert.equal(r.unmatched.length, 0);
  assert.equal(r.matched[0].via, 'Username');
  assert.equal(r.matched[1].via, 'Student ID');
  assert.equal(r.merged[2].alias, 'MATH10-U111', 'matched by Username');
  assert.equal(r.merged[1].alias, 'MATH10-I222', 'matched by Student ID');
});

test('merge matches a Student ID that lost its leading zeros in Excel', () => {
  const r = mergeAliasRestore(VAULT(), [{ alias: 'MATH10-Z999', studentId: '3051898', username: '', last: '', first: '', name: '' }]);
  assert.equal(r.unmatched.length, 0);
  assert.match(r.matched[0].via, /leading zeros/);
  assert.equal(r.merged[0].alias, 'MATH10-Z999');
});

test('merge reports two CSV rows pointing at one student instead of overwriting twice', () => {
  const r = mergeAliasRestore(VAULT(), [
    { alias: 'MATH10-FIRST', username: 'mcrooms', studentId: '', last: '', first: '', name: '' },
    { alias: 'MATH10-SECND', username: 'mcrooms', studentId: '', last: '', first: '', name: '' },
  ]);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0].reason, /same student/);
  assert.equal(r.merged[2].alias, 'MATH10-FIRST', 'the first claim stands; the second is reported');
});

test('merge refuses an alias that would belong to two students', () => {
  // Restoring an alias that an unmentioned student still holds would attach two
  // people's work to one code.
  const r = mergeAliasRestore(VAULT(), [{ alias: 'MATH10-CCCC', username: 'aamezouwoe', studentId: '', last: '', first: '', name: '' }]);
  assert.ok(r.conflicts.some((c) => /two students/.test(c.reason)), 'the collision is reported');
});

test('merge will not guess between two students with the same name words', () => {
  const twins = [
    { alias: 'A1', studentName: 'Alex Kim', bbUsername: 'akim1', studentId: '1' },
    { alias: 'A2', studentName: 'Kim Alex', bbUsername: 'akim2', studentId: '2' },
  ];
  const r = mergeAliasRestore(twins, [{ alias: 'NEW', name: 'Alex Kim', username: '', studentId: '', last: '', first: '' }]);
  assert.equal(r.unmatched.length, 1);
  assert.match(r.unmatched[0].reason, /share this name/);
  assert.deepEqual(r.merged.map((s) => s.alias), ['A1', 'A2'], 'neither is touched');
});

test('merge handles a row with no alias, and an empty vault', () => {
  const r = mergeAliasRestore(VAULT(), [{ alias: '', name: 'My-Asia Crooms', username: '', studentId: '', last: '', first: '' }]);
  assert.equal(r.unmatched.length, 1);
  assert.match(r.unmatched[0].reason, /no alias/);
  const empty = mergeAliasRestore([], [{ alias: 'X', name: 'Someone', username: '', studentId: '', last: '', first: '' }]);
  assert.deepEqual(empty.merged, []);
  assert.equal(empty.unmatched.length, 1);
});

// ── Column detection: the shape that corrupted the vault ──────────────────
test('column detection reads Last,First,Alias — the card-script output', () => {
  const cols = detectAliasCsvColumns(['Last', 'First', 'Alias', 'PrintedName']);
  assert.notEqual(cols, null, 'this is the file shape that used to fall through to column guessing');
  const row = readAliasCsvRow({ Last: 'Crooms', First: 'My-Asia', Alias: 'MATH10-VTR3', PrintedName: 'My-Asia Crooms' }, cols);
  assert.equal(row.alias, 'MATH10-VTR3');
  assert.equal(row.name, 'My-Asia Crooms');
  assert.equal(row.last, 'Crooms');
});

test('column detection handles Blackboard and alias-vocabulary headers', () => {
  assert.notEqual(detectAliasCsvColumns(['Username', 'Student ID', 'Alias']), null);
  assert.notEqual(detectAliasCsvColumns(['alias', 'studentName']), null);
  assert.notEqual(detectAliasCsvColumns(['Student Code', 'Full Name']), null);
  assert.notEqual(detectAliasCsvColumns(['﻿Alias', 'Last Name', 'First Name']), null, 'BOM tolerated');
});

test('column detection refuses a file it cannot read, instead of guessing columns', () => {
  assert.equal(detectAliasCsvColumns(['Last', 'First']), null, 'no alias column');
  assert.equal(detectAliasCsvColumns(['Alias']), null, 'alias but nothing to identify the student by');
  assert.equal(detectAliasCsvColumns([]), null);
  assert.equal(detectAliasCsvColumns(undefined), null);
});

// ── ITEM 2: rows that are not students ────────────────────────────────────
test('the Blackboard preview user is skipped', () => {
  // This row was in the real vault and printed an alias card of its own (card 17 of 26).
  assert.equal(isPreviewRow({ last: 'Minaya_PreviewUser', first: 'Ralph' }), true);
  assert.equal(isPreviewRow({ name: 'Ralph Minaya_PreviewUser' }), true);
  assert.equal(isPreviewRow({ username: 'rminaya_previewuser' }), true);
  assert.equal(isPreviewRow({ name: 'Preview User' }), true);
  assert.equal(isPreviewRow({ last: 'Crooms', first: 'My-Asia' }), false);
  assert.equal(isPreviewRow(null), false);
});

test("the instructor's own enrolment is skipped, a shared surname is not", () => {
  const me = ['Ralph Minaya'];
  assert.equal(isInstructorRow({ name: 'Ralph Minaya' }, me), true);
  assert.equal(isInstructorRow({ last: 'Minaya', first: 'Ralph' }, me), true, 'either column order');
  assert.equal(isInstructorRow({ name: 'minaya,  ralph' }, me), true);
  assert.equal(isInstructorRow({ last: 'Minaya', first: 'Sofia' }, me), false, 'a student sharing the surname stays');
  assert.equal(isInstructorRow({ name: 'Ralph Minaya' }, []), false, 'no instructor name known ⇒ skip nobody');
});

test('filterRosterRows reports every skip with a reason and drops nobody silently', () => {
  const rows = [
    { last: 'Crooms', first: 'My-Asia' },
    { last: 'Minaya_PreviewUser', first: 'Ralph' },
    { last: 'Minaya', first: 'Ralph' },
    { last: 'Cordero Ruiz', first: 'Yaileene' },
  ];
  const { kept, skipped } = filterRosterRows(rows, { instructorNames: ['Ralph Minaya'] });
  assert.equal(kept.length, 2);
  assert.deepEqual(kept.map((r) => r.last), ['Crooms', 'Cordero Ruiz']);
  assert.equal(skipped.length, 2);
  assert.match(skipped[0].reason, /preview user/i);
  assert.match(skipped[1].reason, /your own name/i);
  assert.ok(skipped.every((s) => s.row), 'the skipped rows come back so they can be listed');
  // Nothing is skipped when there is nothing to skip.
  assert.equal(filterRosterRows(rows.slice(0, 1), {}).skipped.length, 0);
  assert.equal(filterRosterRows(undefined, {}).kept.length, 0);
});
