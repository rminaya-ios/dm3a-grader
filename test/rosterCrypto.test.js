// server/lib/rosterCrypto.js — envelope encryption for the roster.
// The property that matters most is in "rotation": rotating the master key must not be
// able to change a single alias, because an alias that changes silently is exactly the
// failure that cost MATH1010050 its printed cards.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const rc = require('../server/lib/rosterCrypto.js');

const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('base64');
const ROSTER = {
  courseId: 'MATH1010050',
  students: [
    { alias: 'MATH10-ZM7B', studentName: 'Ayawa Fideline Amezouwoe', bbUsername: 'aamez', studentId: '03051898' },
    { alias: 'MATH10-R5Z2', studentName: 'Yaileene Cordero Ruiz', bbUsername: 'ycord', studentId: '03060042' },
  ],
};

beforeEach(() => {
  delete process.env.ROSTER_KEK;
  delete process.env.ROSTER_KEK_VERSION;
  for (const k of Object.keys(process.env)) if (/^ROSTER_KEK_V\d+$/.test(k)) delete process.env[k];
});

test('seals and opens a roster', () => {
  process.env.ROSTER_KEK = KEY_A;
  const sealed = rc.seal(ROSTER);
  assert.equal(sealed.f, 'rv1');
  assert.equal(sealed.keyVersion, 1, 'version stamped on every record so the key can rotate later');
  assert.deepEqual(rc.open(sealed), ROSTER);
});

test('nothing readable survives in the sealed record', () => {
  process.env.ROSTER_KEK = KEY_A;
  const blob = JSON.stringify(rc.seal(ROSTER));
  for (const secret of ['Ayawa', 'Amezouwoe', 'Cordero', 'aamez', '03051898', 'MATH10-ZM7B']) {
    assert.equal(blob.includes(secret), false, `"${secret}" must not appear in the ciphertext`);
  }
});

test('a fresh data key per record — two seals of the same roster differ', () => {
  process.env.ROSTER_KEK = KEY_A;
  const a = rc.seal(ROSTER), b = rc.seal(ROSTER);
  assert.notEqual(a.data.ct, b.data.ct, 'identical input must not produce identical ciphertext');
  assert.notEqual(a.key.ct, b.key.ct, 'the wrapped data key differs too');
  assert.deepEqual(rc.open(a), rc.open(b));
});

test('fails closed with no key configured', () => {
  assert.equal(rc.configured(), false);
  assert.throws(() => rc.seal(ROSTER), /ROSTER_KEK is not configured/);
  process.env.ROSTER_KEK = KEY_A;
  const sealed = rc.seal(ROSTER);
  delete process.env.ROSTER_KEK;
  assert.throws(() => rc.open(sealed), /no master key/);
});

test('the wrong key cannot open a record, and tampering is detected', () => {
  process.env.ROSTER_KEK = KEY_A;
  const sealed = rc.seal(ROSTER);
  process.env.ROSTER_KEK = KEY_B;
  assert.throws(() => rc.open(sealed), /unable to authenticate|Unsupported state|bad decrypt/i);
  process.env.ROSTER_KEK = KEY_A;
  const flipped = { ...sealed, data: { ...sealed.data, ct: Buffer.from('tampered').toString('base64') } };
  assert.throws(() => rc.open(flipped), /unable to authenticate|Unsupported state|bad decrypt/i);
});

test('rejects anything that is not a sealed record', () => {
  process.env.ROSTER_KEK = KEY_A;
  for (const bad of [null, undefined, {}, { f: 'nope' }, { f: 'rv1' }, 'string']) {
    assert.throws(() => rc.open(bad), /not a sealed roster record/);
  }
});

// ── ROTATION ───────────────────────────────────────────────────────────────
test('rotation: a record rotates to the new key and still opens', () => {
  process.env.ROSTER_KEK = KEY_A;
  process.env.ROSTER_KEK_VERSION = '1';
  const sealed = rc.seal(ROSTER);

  // Rotate: the old key stays available as V1, the new key becomes current.
  process.env.ROSTER_KEK_V1 = KEY_A;
  process.env.ROSTER_KEK = KEY_B;
  process.env.ROSTER_KEK_VERSION = '2';

  assert.deepEqual(rc.open(sealed), ROSTER, 'an un-rotated record still opens via its old key');
  const rotated = rc.rewrap(sealed);
  assert.equal(rotated.keyVersion, 2);
  assert.deepEqual(rc.open(rotated), ROSTER);
});

test('rotation CANNOT change the roster — the payload ciphertext is untouched', () => {
  // The whole point of the envelope: rotation re-wraps 32 bytes and never touches the
  // roster itself, so no alias can be altered or lost by a key change.
  process.env.ROSTER_KEK = KEY_A;
  process.env.ROSTER_KEK_VERSION = '1';
  const sealed = rc.seal(ROSTER);
  process.env.ROSTER_KEK_V1 = KEY_A;
  process.env.ROSTER_KEK = KEY_B;
  process.env.ROSTER_KEK_VERSION = '2';
  const rotated = rc.rewrap(sealed);
  assert.deepEqual(rotated.data, sealed.data, 'payload ciphertext byte-for-byte identical');
  assert.deepEqual(rc.open(rotated).students.map((s) => s.alias), ROSTER.students.map((s) => s.alias));
});

test('rotation is a no-op on a record already current', () => {
  process.env.ROSTER_KEK = KEY_A;
  const sealed = rc.seal(ROSTER);
  assert.equal(rc.rewrap(sealed), sealed, 'same object back — nothing re-encrypted');
});

test('rotation refuses when the old key is gone, instead of destroying the record', () => {
  process.env.ROSTER_KEK = KEY_A;
  process.env.ROSTER_KEK_VERSION = '1';
  const sealed = rc.seal(ROSTER);
  process.env.ROSTER_KEK = KEY_B;
  process.env.ROSTER_KEK_VERSION = '2';
  // ROSTER_KEK_V1 deliberately NOT set — the old key was removed too early.
  assert.throws(() => rc.rewrap(sealed), /no master key for keyVersion 1/);
});

test('key material is accepted as base64 or hex, and bad lengths are refused', () => {
  process.env.ROSTER_KEK = crypto.randomBytes(32).toString('hex');
  assert.equal(rc.configured(), true, 'hex accepted');
  process.env.ROSTER_KEK = crypto.randomBytes(16).toString('base64');
  assert.equal(rc.configured(), false, 'a 16-byte key is not AES-256 and must be refused');
  process.env.ROSTER_KEK = 'not a key';
  assert.equal(rc.configured(), false);
});

test('generateKek produces a usable 32-byte key', () => {
  const k = rc.generateKek();
  assert.equal(Buffer.from(k, 'base64').length, 32);
  process.env.ROSTER_KEK = k;
  assert.deepEqual(rc.open(rc.seal(ROSTER)), ROSTER);
});
