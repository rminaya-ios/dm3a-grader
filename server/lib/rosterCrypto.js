// lib/rosterCrypto.js
// DM3A — envelope encryption for the roster, so instructors stop handling passphrases.
//
// THE PROBLEM THIS REPLACES. Until now a course roster was encrypted in the browser
// with a passphrase only the instructor held. That is strong, but it has no recovery:
// on 2026-09-27 a lost passphrase for MATH1010050 forced a re-secure, which minted a
// fresh alias set and orphaned every printed alias card. The instructor should never be
// the single point of failure for their own students' data.
//
// THE SCHEME. Two layers, so the master key can be rotated without re-encrypting or
// even reading any roster:
//
//   roster JSON --AES-256-GCM--> ciphertext        (with a random 32-byte DATA KEY,
//                                                   fresh for every sealed record)
//   data key    --AES-256-GCM--> wrapped data key  (with the MASTER KEY, ROSTER_KEK)
//
// Rotating ROSTER_KEK means unwrapping and re-wrapping 32 bytes per course — the roster
// ciphertext is never touched, so a rotation cannot corrupt or lose a single alias.
// Every record carries the keyVersion it was wrapped under, so old and new live side by
// side during a rotation and nothing has to happen atomically.
//
// KEYS come from the environment, like lib/piiBox.js:
//   ROSTER_KEK            the current master key, 32 bytes as base64 or hex
//   ROSTER_KEK_VERSION    integer, default 1 — stamped onto everything sealed now
//   ROSTER_KEK_V<n>       a previous master key, kept only until its records are rotated
//
// FAIL CLOSED. No key configured means seal() and open() throw. Callers answer 503
// rather than storing or returning anything in clear text — the same rule piiBox
// follows. A wrong key fails the GCM auth tag and throws; there is no partial output.
//
// This module is pure crypto over buffers and JSON: no database, no Express, no PII
// knowledge. Unit-tested in test/rosterCrypto.test.js, including rotation.

const crypto = require('crypto');

const FORMAT = 'rv1';          // bump only on a breaking envelope-format change
const KEY_BYTES = 32;          // AES-256
const IV_BYTES = 12;           // GCM standard nonce

function parseKeyMaterial(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  const buf = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
  return buf.length === KEY_BYTES ? buf : null;
}

// The version stamped onto anything sealed from now on.
function currentKeyVersion() {
  const n = parseInt(String(process.env.ROSTER_KEK_VERSION || '1'), 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// The master key for a given version. The CURRENT version lives in ROSTER_KEK; older
// ones in ROSTER_KEK_V<n>, so a rotation can still open records it has not re-wrapped.
function masterKey(version) {
  const v = version == null ? currentKeyVersion() : version;
  if (v === currentKeyVersion()) {
    const k = parseKeyMaterial(process.env.ROSTER_KEK);
    if (k) return k;
  }
  return parseKeyMaterial(process.env[`ROSTER_KEK_V${v}`]);
}

// Is the service able to seal and open at all? Routes check this and answer 503 rather
// than silently falling back to storing clear text.
function configured() {
  return !!masterKey(currentKeyVersion());
}

function gcmEncrypt(key, plaintextBuf) {
  const iv = crypto.randomBytes(IV_BYTES);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintextBuf), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function gcmDecrypt(key, { iv, tag, ct }) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(iv), 'base64'));
  d.setAuthTag(Buffer.from(String(tag), 'base64'));
  return Buffer.concat([d.update(Buffer.from(String(ct), 'base64')), d.final()]);
}

// value (any JSON) -> a sealed record safe to store at rest.
//
//   { f: 'rv1', keyVersion, key: {iv,tag,ct}, data: {iv,tag,ct} }
//
// `key` is the data key wrapped under the master key; `data` is the payload under the
// data key. Nothing in here is readable without ROSTER_KEK.
function seal(value) {
  const version = currentKeyVersion();
  const kek = masterKey(version);
  if (!kek) throw new Error('ROSTER_KEK is not configured');
  const dataKey = crypto.randomBytes(KEY_BYTES);
  try {
    return {
      f: FORMAT,
      keyVersion: version,
      key: gcmEncrypt(kek, dataKey),
      data: gcmEncrypt(dataKey, Buffer.from(JSON.stringify(value), 'utf8')),
    };
  } finally {
    dataKey.fill(0); // don't leave the plaintext data key sitting in the heap
  }
}

function open(sealed) {
  if (!sealed || sealed.f !== FORMAT || !sealed.key || !sealed.data) {
    throw new Error('not a sealed roster record');
  }
  const kek = masterKey(sealed.keyVersion);
  if (!kek) throw new Error(`no master key for keyVersion ${sealed.keyVersion} (set ROSTER_KEK_V${sealed.keyVersion})`);
  const dataKey = gcmDecrypt(kek, sealed.key);
  try {
    return JSON.parse(gcmDecrypt(dataKey, sealed.data).toString('utf8'));
  } finally {
    dataKey.fill(0);
  }
}

// ROTATION. Re-wrap the data key under the CURRENT master key. The payload ciphertext is
// returned byte-for-byte unchanged, so rotating cannot alter a roster — which matters
// because an alias that changes silently is the failure this whole system exists to
// avoid. Returns the record unchanged when it is already on the current version.
function rewrap(sealed) {
  if (!sealed || sealed.f !== FORMAT) throw new Error('not a sealed roster record');
  const target = currentKeyVersion();
  if (sealed.keyVersion === target) return sealed;
  const oldKek = masterKey(sealed.keyVersion);
  if (!oldKek) throw new Error(`no master key for keyVersion ${sealed.keyVersion} (set ROSTER_KEK_V${sealed.keyVersion})`);
  const newKek = masterKey(target);
  if (!newKek) throw new Error('ROSTER_KEK is not configured');
  const dataKey = gcmDecrypt(oldKek, sealed.key);
  try {
    return { f: FORMAT, keyVersion: target, key: gcmEncrypt(newKek, dataKey), data: sealed.data };
  } finally {
    dataKey.fill(0);
  }
}

// Generate a master key, for `node -e` when setting ROSTER_KEK up the first time.
function generateKek() {
  return crypto.randomBytes(KEY_BYTES).toString('base64');
}

module.exports = { configured, seal, open, rewrap, generateKek, currentKeyVersion, FORMAT };
