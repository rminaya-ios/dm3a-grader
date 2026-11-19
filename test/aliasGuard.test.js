// server/lib/aliasGuard.js — the server-side alias-permanence rule.
//
// `nameKey` and the permanence check exist TWICE: here for the server (CommonJS) and in
// src/blind/* for the browser (ESM). The browser copy warns before asking; the server
// copy is the one that refuses. They must agree, so this file runs BOTH against one
// corpus — a drift between them fails the suite instead of mismatching students in
// silence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { nameKey as clientNameKey } from '../src/blind/rosterMerge.js';
import { assertAliasesPreserved as clientCheck } from '../src/blind/aliasVerify.js';

const require = createRequire(import.meta.url);
const guard = require('../server/lib/aliasGuard.js');

const NAME_CASES = [
  ['Yaileene Cordero Ruiz', 'Cordero Ruiz, Yaileene'],
  ['My-Asia Crooms', 'crooms   my asia'],
  ['Amézouwoe, Ayawa', 'Ayawa Amezouwoe'],
  ['Ralph Minaya_PreviewUser', 'previewuser minaya ralph'],
  ['O’Brien, Sean', 'Sean OBrien'],
  ['', ''],
];

test('nameKey: server and browser agree on every case', () => {
  for (const [a, b] of NAME_CASES) {
    assert.equal(guard.nameKey(a), clientNameKey(a), `server/browser disagree on "${a}"`);
    assert.equal(guard.nameKey(a), guard.nameKey(b), `"${a}" and "${b}" must key the same`);
    assert.equal(clientNameKey(a), clientNameKey(b));
  }
});

test('nameKey: different people still key differently', () => {
  assert.notEqual(guard.nameKey('Jane Doe'), guard.nameKey('Jane Roe'));
  assert.notEqual(guard.nameKey('Minaya, Ralph'), guard.nameKey('Minaya, Sofia'));
});

const BEFORE = [
  { alias: 'A1', studentName: 'Ada Testwell', firstName: 'Ada', lastName: 'Testwell', bbUsername: 'atestwell', studentId: '09000001' },
  { alias: 'A2', studentName: 'Bruno Sample', firstName: 'Bruno', lastName: 'Sample', bbUsername: 'bsample', studentId: '09000002' },
];

const SCENARIOS = [
  ['unchanged', BEFORE, true],
  ['alias changed', [{ ...BEFORE[0], alias: 'ZZ' }, BEFORE[1]], false],
  ['alias removed', [{ ...BEFORE[0], alias: '' }, BEFORE[1]], false],
  ['new student added', BEFORE.concat([{ alias: 'A3', studentName: 'Cara New', bbUsername: 'cnew' }]), true],
  ['student left', [BEFORE[0]], true],
  ['renamed, same username', [{ ...BEFORE[0], studentName: 'Ada Marriedwell', lastName: 'Marriedwell' }, BEFORE[1]], true],
  ['renamed AND alias changed', [{ ...BEFORE[0], studentName: 'Ada Marriedwell', alias: 'ZZ' }, BEFORE[1]], false],
];

test('permanence: server and browser reach the same verdict on every scenario', () => {
  for (const [label, after, expectOk] of SCENARIOS) {
    const s = guard.checkAliasesPreserved(BEFORE, after);
    const c = clientCheck(BEFORE, after);
    assert.equal(s.ok, expectOk, `server verdict wrong for "${label}"`);
    assert.equal(c.ok, expectOk, `browser verdict wrong for "${label}"`);
    assert.equal(s.violations.length, c.violations.length, `violation count differs for "${label}"`);
  }
});

test('permanence: a leaver is reported as dropped, and a joiner is counted', () => {
  const left = guard.checkAliasesPreserved(BEFORE, [BEFORE[0]]);
  assert.equal(left.dropped.length, 1);
  assert.equal(left.dropped[0].alias, 'A2');
  const joined = guard.checkAliasesPreserved(BEFORE, BEFORE.concat([{ alias: 'A3', studentName: 'Cara New' }]));
  assert.equal(joined.added, 1);
});

test('permanence: two students with the same name are never matched by name', () => {
  const twins = [{ alias: 'T1', studentName: 'Alex Kim', bbUsername: 'k1' }, { alias: 'T2', studentName: 'Kim Alex', bbUsername: 'k2' }];
  // No Username on the incoming row, so the ambiguous name must match nobody — which
  // reads as "new student", never as "silently rewrite one of the twins".
  const r = guard.checkAliasesPreserved(twins, [{ alias: 'T9', studentName: 'Alex Kim' }]);
  assert.equal(r.ok, true);
  assert.equal(r.added, 1);
});

test('duplicateAliases finds a shared code, ignoring case and punctuation', () => {
  assert.deepEqual(guard.duplicateAliases([{ alias: 'A1' }, { alias: 'a-1' }]), ['a-1']);
  assert.deepEqual(guard.duplicateAliases(BEFORE), []);
  assert.deepEqual(guard.duplicateAliases([{ alias: '' }, { alias: '' }]), [], 'blank is not a duplicate');
  assert.deepEqual(guard.duplicateAliases(undefined), []);
});

test('empty and malformed input is safe on both sides', () => {
  for (const args of [[[], []], [undefined, undefined], [BEFORE, []]]) {
    assert.equal(guard.checkAliasesPreserved(...args).ok, true);
    assert.equal(clientCheck(...args).ok, true);
  }
});
