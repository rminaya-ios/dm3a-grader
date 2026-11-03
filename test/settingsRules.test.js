// Unit tests for Settings validation (server/lib/settingsRules.js). No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules from '../server/lib/settingsRules.js';
import SettingsModel from '../server/models/Settings.js';

const { validateSettings } = rules;
const { DEFAULT_SETTINGS } = SettingsModel;

test('the defaults themselves pass validation', () => {
  const r = validateSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
  assert.equal(r.ok, true, r.error);
});

test('defaults match the DM3A plan', () => {
  assert.deepEqual(DEFAULT_SETTINGS.bands, { p4Min: 90, p3Min: 80, p2Min: 60 });
  assert.deepEqual(DEFAULT_SETTINGS.bbPoints, { P4: 90, P3: 80, P2: 60, P1: 50, talkToStudent: 26 });
  assert.deepEqual(DEFAULT_SETTINGS.latePolicy.windows, [{ maxDaysLate: 7, capLevel: 'P3' }, { maxDaysLate: 14, capLevel: 'P2' }]);
  assert.equal(DEFAULT_SETTINGS.latePolicy.beyond, 'instructor_review');
});

test('bands must descend', () => {
  assert.equal(validateSettings({ bands: { p4Min: 80, p3Min: 80, p2Min: 60 } }).ok, false);
  assert.equal(validateSettings({ bands: { p4Min: 101, p3Min: 80, p2Min: 60 } }).ok, false);
  assert.equal(validateSettings({ bands: { p4Min: 'x', p3Min: 80, p2Min: 60 } }).ok, false);
});

test('BB points need every level', () => {
  assert.equal(validateSettings({ bbPoints: { P4: 90, P3: 80, P2: 60, P1: 50 } }).ok, false);
});

test('late windows must be whole days, ordered, with a real level', () => {
  assert.equal(validateSettings({ latePolicy: { windows: [{ maxDaysLate: 14, capLevel: 'P2' }, { maxDaysLate: 7, capLevel: 'P3' }] } }).ok, false);
  assert.equal(validateSettings({ latePolicy: { windows: [{ maxDaysLate: 7.5, capLevel: 'P3' }] } }).ok, false);
  assert.equal(validateSettings({ latePolicy: { windows: [{ maxDaysLate: 7, capLevel: 'P5' }] } }).ok, false);
  assert.equal(validateSettings({ latePolicy: { windows: [], beyond: 'nope' } }).ok, false);
});

test('unknown fields are dropped, not stored', () => {
  const r = validateSettings({ ownerId: 'someone-else', bands: { p4Min: 90, p3Min: 80, p2Min: 60 } });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value), ['bands']);
});
