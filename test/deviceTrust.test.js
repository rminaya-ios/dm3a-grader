// Unit tests for the pure parts of "Trust this device" (src/blind/deviceTrust.js).
// Node's built-in runner: `npm test`. The IndexedDB parts need a real browser and
// are exercised there; these cover the expiry and the roster-changed fingerprint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRUST_EXPIRES_AT, trustExpired, vaultFingerprint, canOfferTrust, unlockTrusted } from '../src/blind/deviceTrust.js';

test('trust expires at the end of Dec 31, 2026, Eastern', () => {
  assert.equal(TRUST_EXPIRES_AT, '2027-01-01T05:00:00.000Z');
  assert.equal(trustExpired(new Date('2026-12-31T23:59:59-05:00')), false);
  assert.equal(trustExpired(new Date('2027-01-01T00:00:00-05:00')), true);
});

test('the fingerprint ignores field order but not content', async () => {
  const a = { salt: 's', iv: 'i', ciphertext: 'c', kdfParams: { iterations: 600000, hash: 'SHA-256' } };
  const reordered = { kdfParams: { hash: 'SHA-256', iterations: 600000 }, ciphertext: 'c', iv: 'i', salt: 's' };
  assert.equal(await vaultFingerprint(a), await vaultFingerprint(reordered));
  assert.notEqual(await vaultFingerprint(a), await vaultFingerprint({ ...a, ciphertext: 'c2' }));
});

test('outside an automation browser trust is never offered or used', async () => {
  assert.equal(canOfferTrust(), false);
  assert.equal((await unlockTrusted('MATH11003', {})).reason, 'not-automation-browser');
});
