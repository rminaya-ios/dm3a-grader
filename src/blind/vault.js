// src/blind/vault.js
// DM3A Grader — Blind Grading Mode, encrypted mapping vault (spec §2.3)
//
// Isomorphic: uses WebCrypto (crypto.subtle) — browser and Node 20+.
//
// Cipher: AES-256-GCM. Random 16-byte salt per mapping, random 12-byte IV per
// encryption. Key derivation: PBKDF2-SHA256 @ 600,000 iterations via WebCrypto
// (the spec's WASM-free fallback to Argon2id — chosen to avoid an argon2-browser
// WASM bundle; kdf/kdfParams are recorded in the blob so Argon2id can be added
// later without breaking existing vaults).
//
// The passphrase and derived key NEVER leave the client. The server only ever
// stores/returns the opaque `blob` below.

const KDF = 'pbkdf2';
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_HASH = 'SHA-256';
export const MIN_PASSPHRASE_LEN = 10;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function fromB64(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function deriveKey(passphrase, salt, iterations) {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt a plaintext mapping object → opaque blob { salt, iv, ciphertext, kdf, kdfParams }.
export async function encryptMapping(mapping, passphrase) {
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LEN) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LEN} characters`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(mapping))
  );
  return {
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
    kdf: KDF,
    kdfParams: { iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
  };
}

// Decrypt an opaque blob back to the plaintext mapping. Throws cleanly on a wrong
// passphrase (AES-GCM auth tag mismatch) — no partial/garbage output.
export async function decryptMapping(blob, passphrase) {
  if (!blob || !blob.salt || !blob.iv || !blob.ciphertext) {
    throw new Error('invalid vault blob');
  }
  const iterations = (blob.kdfParams && blob.kdfParams.iterations) || PBKDF2_ITERATIONS;
  const key = await deriveKey(passphrase, fromB64(blob.salt), iterations);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ciphertext));
  } catch {
    throw new Error('decryption failed — wrong passphrase or corrupted vault');
  }
  return JSON.parse(dec.decode(plaintext));
}
