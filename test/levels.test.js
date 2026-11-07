// The overall mastery level is derived from the dimension levels (src/levels.js).
// Node's built-in runner: `npm test`. Pure — no browser, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOverall, applyLevelRule, effectiveOverall, LEVEL_VERSION } from '../src/levels.js';

const LEVELS = ['P1', 'P2', 'P3', 'P4'];
const n = (p) => LEVELS.indexOf(p) + 1;

test('P2/P2 is P2 and P3/P3 is P3', () => {
  assert.equal(deriveOverall({ conceptualUnderstanding: 'P2', problemSolving: 'P2' }), 'P2');
  assert.equal(deriveOverall({ conceptualUnderstanding: 'P3', problemSolving: 'P3' }), 'P3');
});

test('mixed levels round to the nearest level; an exact half rounds down', () => {
  assert.equal(deriveOverall({ a: 'P2', b: 'P4' }), 'P3');
  assert.equal(deriveOverall({ a: 'P3', b: 'P4' }), 'P3'); // half — down
  assert.equal(deriveOverall({ a: 'P1', b: 'P2' }), 'P1'); // half — down
  assert.equal(deriveOverall({ a: 'P2', b: 'P3', c: 'P3' }), 'P3');
  assert.equal(deriveOverall({ a: 'P3', b: 'P4', c: 'P4' }), 'P4');
  assert.equal(deriveOverall({ a: 'P1', b: 'P4', c: 'P4', d: 'P4' }), 'P3');
  assert.equal(deriveOverall({ a: 'P1', b: 'P1', c: 'P1', d: 'P4' }), 'P2');
});

test('never below the lowest dimension or above the highest — every combination', () => {
  for (const a of LEVELS) for (const b of LEVELS) for (const c of LEVELS) for (const d of LEVELS) {
    const dims = { a, b, c, d };
    const o = n(deriveOverall(dims));
    const vals = Object.values(dims).map(n);
    assert.ok(o >= Math.min(...vals) && o <= Math.max(...vals), JSON.stringify(dims));
  }
});

test('only the dimensions present count; non-levels are ignored', () => {
  assert.equal(deriveOverall({ accuracy: 'P4' }), 'P4');
  assert.equal(deriveOverall({ accuracy: 'P2', workShown: 'N/A' }), 'P2');
  assert.equal(deriveOverall({}), null);
  assert.equal(deriveOverall({ a: 'P0', b: 'P0' }), 'P1'); // self-check "no attempt" floors at P1
});

// The two cases seen in production: the model's overall contradicted its dimensions.
test("the model's overall is ignored: P1 beside P2/P2 becomes P2, P4 beside P3/P3 becomes P3", () => {
  const p1 = applyLevelRule({ overallTier: 'P1', dimensions: { conceptualUnderstanding: 'P2', problemSolving: 'P2' }, problems: [] });
  assert.equal(p1.overallTier, 'P2');
  assert.equal(p1.modelTier, 'P1');
  assert.equal(p1.levelVersion, LEVEL_VERSION);

  const p4 = applyLevelRule({ overallTier: 'P4', dimensions: { conceptualUnderstanding: 'P3', workShown: 'P3' }, problems: [] });
  assert.equal(p4.overallTier, 'P3');
});

test('accuracy is the problem band, and it feeds the overall', () => {
  // 9 of 10 problems at mastery = 90% = P4 accuracy; with P3/P3/P3 the overall is P3.
  const problems = [...Array(9).fill({ tier: 'P3' }), { tier: 'P1' }];
  const r = applyLevelRule({
    overallTier: 'P4',
    dimensions: { conceptualUnderstanding: 'P3', problemSolving: 'P3', workShown: 'P3', accuracy: 'P2' },
    problems,
  });
  assert.equal(r.dimensions.accuracy, 'P4');
  assert.equal(r.dimensionsModel.accuracy, 'P2');
  assert.equal(r.overallTier, 'P3');
});

test('no dimensions: falls back to the problem band, never the model', () => {
  const r = applyLevelRule({ overallTier: 'P4', problems: [{ tier: 'P2' }, { tier: 'P3' }] }); // 50% = P1
  assert.equal(r.overallTier, 'P1');
});

test('what is shown follows dimension overrides; an overall override wins', () => {
  const row = applyLevelRule({ overallTier: 'P1', dimensions: { conceptualUnderstanding: 'P2', problemSolving: 'P2' }, problems: [] });
  assert.equal(effectiveOverall(row), 'P2');
  assert.equal(effectiveOverall(row, { conceptual: 'P4', problemSolving: 'P4' }), 'P4');
  assert.equal(effectiveOverall(row, { conceptual: 'P4', overall: 'P1' }), 'P1');
});

test('rows saved before this rule keep their saved overall', () => {
  const old = { overallTier: 'P1', dimensions: { conceptualUnderstanding: 'P2', problemSolving: 'P2' } };
  assert.equal(effectiveOverall(old), 'P1');
  assert.equal(effectiveOverall({ overallTier: 'ERROR', dimensions: {} }), 'ERROR');
});
