// src/blind/aliasVerify.js — the gate that runs before a roster is switched over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAliasMatchReport, renderAliasMatchReport, assertAliasesPreserved } from '../src/blind/aliasVerify.js';

const CARDS = [
  { printedName: 'Ayawa Fideline Amezouwoe', alias: 'MATH10-ZM7B' },
  { printedName: 'Yaileene Cordero Ruiz', alias: 'MATH10-R5Z2' },
  { printedName: 'My-Asia Crooms', alias: 'MATH10-VTR3' },
];
const vaultOf = (aliases) => [
  { alias: aliases[0], studentName: 'Ayawa Fideline Amezouwoe', firstName: 'Ayawa Fideline', lastName: 'Amezouwoe', bbUsername: 'aamez', studentId: '03051898' },
  { alias: aliases[1], studentName: 'Cordero Ruiz, Yaileene', firstName: 'Yaileene', lastName: 'Cordero Ruiz', bbUsername: 'ycord', studentId: '03060042' },
  { alias: aliases[2], studentName: 'My-Asia Crooms', firstName: 'My-Asia', lastName: 'Crooms', bbUsername: 'mcrooms', studentId: '03060099' },
];

test('a roster that matches the cards is SAFE to switch', () => {
  const r = buildAliasMatchReport(vaultOf(['MATH10-ZM7B', 'MATH10-R5Z2', 'MATH10-VTR3']), CARDS, { course: 'MATH1010050' });
  assert.equal(r.safe, true);
  assert.equal(r.totals.agree, 3);
  assert.equal(r.totals.differ, 0);
  // Name order differs between the card ("First Last") and the vault ("Last, First").
  assert.equal(r.totals.cardsNotInRoster, 0, 'the name join must survive a reversed name');
  assert.match(renderAliasMatchReport(r), /SAFE TO SWITCH/);
});

test('the wrong card generation is caught — every alias differs', () => {
  // The real MATH1010050 situation: two card files, completely different aliases.
  const r = buildAliasMatchReport(vaultOf(['MATH10-BUQQ', 'MATH10-A88H', 'MATH10-U3YU']), CARDS, { course: 'MATH1010050' });
  assert.equal(r.safe, false, 'this must never switch automatically');
  assert.equal(r.totals.differ, 3);
  assert.equal(r.totals.agree, 0);
  const text = renderAliasMatchReport(r);
  assert.match(text, /DO NOT SWITCH YET/);
  assert.match(text, /card MATH10-ZM7B -> roster MATH10-BUQQ/, 'the report names both aliases so the instructor can tell which set is live');
});

test('one changed alias in an otherwise clean roster still blocks the switch', () => {
  const r = buildAliasMatchReport(vaultOf(['MATH10-ZM7B', 'MATH10-WRONG', 'MATH10-VTR3']), CARDS);
  assert.equal(r.safe, false);
  assert.equal(r.totals.agree, 2);
  assert.deepEqual(r.differ.map((d) => d.student), ['Cordero Ruiz, Yaileene']);
});

test('a new student with no card is reported but does not block', () => {
  const roster = vaultOf(['MATH10-ZM7B', 'MATH10-R5Z2', 'MATH10-VTR3']).concat(
    [{ alias: 'MATH10-NEW1', studentName: 'Late Enroller', firstName: 'Late', lastName: 'Enroller', bbUsername: 'lenroll' }]
  );
  const r = buildAliasMatchReport(roster, CARDS);
  assert.equal(r.totals.rosterNotOnCards, 1);
  assert.equal(r.safe, true, 'a student who enrolled after the cards were printed is normal');
  assert.match(renderAliasMatchReport(r), /no printed card/);
});

test('a card for somebody not in the roster DOES block', () => {
  // Either the wrong roster or the wrong card file — never guess which.
  const r = buildAliasMatchReport(vaultOf(['MATH10-ZM7B', 'MATH10-R5Z2', 'MATH10-VTR3']).slice(0, 2), CARDS);
  assert.equal(r.totals.cardsNotInRoster, 1);
  assert.equal(r.safe, false);
});

test('duplicate aliases block on either side', () => {
  const dupRoster = buildAliasMatchReport(vaultOf(['MATH10-ZM7B', 'MATH10-ZM7B', 'MATH10-VTR3']), CARDS);
  assert.deepEqual(dupRoster.duplicateRosterAliases, ['MATH10-ZM7B']);
  assert.equal(dupRoster.safe, false);
  const dupCards = buildAliasMatchReport(vaultOf(['MATH10-ZM7B', 'MATH10-R5Z2', 'MATH10-VTR3']),
    CARDS.map((c, i) => (i === 1 ? { ...c, alias: 'MATH10-ZM7B' } : c)));
  assert.deepEqual(dupCards.duplicateCardAliases, ['MATH10-ZM7B']);
  assert.equal(dupCards.safe, false);
});

test('two roster students with the same name are ambiguous, never guessed', () => {
  const twins = [
    { alias: 'A1', studentName: 'Alex Kim', bbUsername: 'akim1' },
    { alias: 'A2', studentName: 'Kim Alex', bbUsername: 'akim2' },
  ];
  const r = buildAliasMatchReport(twins, [{ printedName: 'Alex Kim', alias: 'A1' }]);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.safe, false);
});

test('an empty roster or empty card set is never SAFE', () => {
  assert.equal(buildAliasMatchReport([], CARDS).safe, false);
  assert.equal(buildAliasMatchReport(vaultOf(['a', 'b', 'c']), []).safe, false, 'nothing verified is not the same as verified');
  assert.equal(buildAliasMatchReport(undefined, undefined).safe, false);
});

// ── The invariant: an issued alias is permanent ───────────────────────────
test('changing an existing alias is a violation', () => {
  const before = vaultOf(['MATH10-ZM7B', 'MATH10-R5Z2', 'MATH10-VTR3']);
  const after = vaultOf(['MATH10-ZM7B', 'MATH10-CHANGED', 'MATH10-VTR3']);
  const v = assertAliasesPreserved(before, after);
  assert.equal(v.ok, false);
  assert.equal(v.violations.length, 1);
  assert.deepEqual(v.violations[0], { student: 'Cordero Ruiz, Yaileene', from: 'MATH10-R5Z2', to: 'MATH10-CHANGED' });
});

test('removing an alias is a violation too', () => {
  const before = vaultOf(['A1', 'A2', 'A3']);
  const after = vaultOf(['A1', '', 'A3']);
  const v = assertAliasesPreserved(before, after);
  assert.equal(v.ok, false);
  assert.equal(v.violations[0].to, '(removed)');
});

test('a new student getting a new alias is NOT a violation', () => {
  const before = vaultOf(['A1', 'A2', 'A3']);
  const after = before.concat([{ alias: 'A4', studentName: 'New Person', bbUsername: 'nperson' }]);
  assert.equal(assertAliasesPreserved(before, after).ok, true);
});

test('a student who leaves is reported as dropped, not as a violation', () => {
  const before = vaultOf(['A1', 'A2', 'A3']);
  const after = before.slice(0, 2);
  const v = assertAliasesPreserved(before, after);
  assert.equal(v.ok, true, 'leaving is allowed; silently changing an alias is not');
  assert.equal(v.dropped.length, 1);
  assert.equal(v.dropped[0].alias, 'A3');
});

test('the invariant identifies students by Username and Student ID, not just name', () => {
  // A married name or a corrected spelling must not read as "new student, new alias".
  const before = [{ alias: 'A1', studentName: 'Jane Doe', bbUsername: 'jdoe', studentId: '03051898' }];
  const after = [{ alias: 'A9', studentName: 'Jane Smith', bbUsername: 'jdoe', studentId: '03051898' }];
  const v = assertAliasesPreserved(before, after);
  assert.equal(v.ok, false, 'same person by Username — the alias must not change');
  assert.equal(v.violations[0].from, 'A1');
});

test('an unchanged roster passes, and empty inputs are safe', () => {
  const r = vaultOf(['A1', 'A2', 'A3']);
  assert.equal(assertAliasesPreserved(r, r).ok, true);
  assert.equal(assertAliasesPreserved([], []).ok, true);
  assert.equal(assertAliasesPreserved(undefined, undefined).ok, true);
});
