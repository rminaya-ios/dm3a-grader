// src/blind/deviceTrust.js
// DM3A Grader — "Trust this device" for unattended grading runs.
//
// THE PROBLEM. The roster vault is unlocked by typing the course passphrase, and
// the unlocked names live only in this tab's memory — a reload relocks it. That
// is right for a person, and it blocks a grading run on the instructor's Mac
// Mini that has nobody at the keyboard.
//
// WHAT THIS DOES. After a normal passphrase unlock in the AUTOMATION browser, the
// instructor may tick "Trust this device". This module then:
//   1. generates a fresh AES-256-GCM key with extractable = false, so no page
//      script can ever read the key bytes out — it can only ask the browser to
//      decrypt with it;
//   2. encrypts a copy of the unlocked mapping with that key;
//   3. keeps key + ciphertext in this browser profile's IndexedDB (never sent
//      anywhere; IndexedDB does not sync between devices).
// On a later page load, unlockTrusted() decrypts that copy and the course opens
// without the passphrase. The passphrase itself is never stored.
//
// THE FOUR CONDITIONS (approved 2026-10-24):
//   • Automation browser only. Offered and honoured only when the browser is
//     driven by automation (navigator.webdriver). Not a security boundary — it
//     keeps trust from being switched on by accident in an everyday browser.
//   • FileVault on the Mac Mini (checked by hand; Chrome writes this key to disk
//     inside the profile, so disk encryption is what protects it at rest).
//   • Expires at the end of 2026-12-31 (Eastern). Expired entries are deleted.
//   • Stops if the roster changed. Each copy remembers the fingerprint of the
//     vault it came from; if the server's vault is different, the copy is NOT
//     used and the course stays locked — so a run stops on the existing
//     "roster vault not loaded" gate instead of grading against stale names.
//
// Revoke = delete the entry (course card button). Nothing else needs undoing.
//
// PRIVACY. Only the browser ever sees the decrypted names, exactly as after a
// passphrase unlock. Redaction and the fail-closed gates are untouched.

const DB_NAME = 'dm3a-device-trust';
const STORE = 'courses';

// End of Dec 31, 2026 in Eastern time (EST, UTC-5).
export const TRUST_EXPIRES_AT = '2027-01-01T05:00:00.000Z';
export const TRUST_EXPIRES_LABEL = 'Dec 31, 2026';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── Environment checks ─────────────────────────────────────────────────────

export function isAutomationBrowser() {
  return typeof navigator !== 'undefined' && navigator.webdriver === true;
}

export function trustExpired(now = new Date()) {
  return now.getTime() >= new Date(TRUST_EXPIRES_AT).getTime();
}

// Trust can be offered: automation browser, before the expiry date, and with
// IndexedDB + WebCrypto available.
export function canOfferTrust(now = new Date()) {
  return (
    isAutomationBrowser() &&
    !trustExpired(now) &&
    typeof indexedDB !== 'undefined' &&
    !!(globalThis.crypto && crypto.subtle)
  );
}

// ── Vault fingerprint ──────────────────────────────────────────────────────
// SHA-256 over the blob with keys in a fixed order, so the same vault always
// gives the same fingerprint whatever order the server returns its fields in.

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((o, k) => ((o[k] = stable(value[k])), o), {});
  }
  return value;
}

export async function vaultFingerprint(blob) {
  const bytes = enc.encode(JSON.stringify(stable(blob)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── IndexedDB (tiny promise wrapper) ───────────────────────────────────────

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'courseCode' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const getEntry = (courseCode) => withStore('readonly', (s) => s.get(courseCode));
const putEntry = (entry) => withStore('readwrite', (s) => s.put(entry));
const deleteEntry = (courseCode) => withStore('readwrite', (s) => s.delete(courseCode));
const allEntries = () => withStore('readonly', (s) => s.getAll());

// ── Public API ─────────────────────────────────────────────────────────────

// Save a trusted copy of an unlocked mapping. `blob` is the server vault it was
// decrypted from (for the fingerprint). Throws if trust cannot be offered here.
export async function trustDevice(courseCode, mapping, blob, now = new Date()) {
  if (!canOfferTrust(now)) throw new Error('Trust this device is only available in the automation browser, before the expiry date.');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(mapping)));
  await putEntry({
    courseCode,
    key, // a non-extractable CryptoKey; IndexedDB stores it without exposing the bytes
    iv,
    ciphertext,
    vaultFingerprint: await vaultFingerprint(blob),
    trustedAt: now.toISOString(),
    expiresAt: TRUST_EXPIRES_AT,
  });
}

// After this browser writes a new vault (roster update, alias restore), refresh
// the trusted copy so it matches — but only if the course was already trusted.
export async function refreshTrustIfPresent(courseCode, mapping, blob) {
  if (!canOfferTrust()) return false;
  if (!(await getEntry(courseCode).catch(() => null))) return false;
  await trustDevice(courseCode, mapping, blob);
  return true;
}

export async function revokeTrust(courseCode) {
  await deleteEntry(courseCode);
}

// Course codes trusted on this device (expired entries removed first).
export async function trustedCourses(now = new Date()) {
  if (typeof indexedDB === 'undefined') return [];
  const entries = await allEntries().catch(() => []);
  const live = [];
  for (const e of entries || []) {
    if (now.getTime() >= new Date(e.expiresAt).getTime()) await deleteEntry(e.courseCode).catch(() => {});
    else live.push(e.courseCode);
  }
  return live;
}

// Try to open a course from its trusted copy.
//   currentBlob: the vault blob the server has NOW (caller fetches it).
// Returns { ok: true, mapping } or { ok: false, reason } — never throws for an
// ordinary refusal, so the caller can leave the course locked and say why.
export async function unlockTrusted(courseCode, currentBlob, now = new Date()) {
  if (!isAutomationBrowser()) return { ok: false, reason: 'not-automation-browser' };
  const entry = await getEntry(courseCode).catch(() => null);
  if (!entry) return { ok: false, reason: 'not-trusted' };
  if (now.getTime() >= new Date(entry.expiresAt).getTime()) {
    await deleteEntry(courseCode).catch(() => {});
    return { ok: false, reason: 'expired' };
  }
  if (!currentBlob) return { ok: false, reason: 'no-vault' };
  if ((await vaultFingerprint(currentBlob)) !== entry.vaultFingerprint) {
    // The roster changed since this device was trusted. Do not use the copy.
    return { ok: false, reason: 'roster-changed' };
  }
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: entry.iv }, entry.key, entry.ciphertext);
    return { ok: true, mapping: JSON.parse(dec.decode(plain)) };
  } catch {
    return { ok: false, reason: 'decrypt-failed' };
  }
}

// Plain-English reason for the course card / run log. No names, ever.
export function trustReasonText(reason) {
  return (
    {
      'not-automation-browser': 'Trusted unlock only works in the automation browser.',
      'not-trusted': 'This device is not trusted for this course.',
      expired: `Device trust expired on ${TRUST_EXPIRES_LABEL}. Unlock with your passphrase.`,
      'no-vault': 'No secured roster found on the server.',
      'roster-changed': 'The roster changed since this device was trusted. Unlock once with your passphrase to re-trust it.',
      'decrypt-failed': 'The trusted copy could not be opened. Revoke and re-trust this device.',
    }[reason] || 'Trusted unlock did not run.'
  );
}
