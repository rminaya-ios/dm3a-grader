// src/blind/vaultApi.js
// DM3A Grader — Blind Grading Mode, client for the server-held encrypted vault.
// Only ever transmits the OPAQUE encrypted blob — never the passphrase, never
// plaintext PII, never the raw roster CSV.
//
// The vault routes require a signed-in account and only answer to the vault's
// owner (server/lib/vaultAccess.js). So these calls go to the same server as the
// sign-in (auth/api.js SERVER_URL) and send the session cookie with
// `credentials: 'include'`. Pointing them anywhere else would drop the cookie
// and every unlock would fail with "Not signed in."

import { SERVER_URL as API_BASE } from '../auth/api.js';

async function vaultError(res, action) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) return new Error('Sign in to your DM3A account to use the roster vault.');
  return new Error(body.error ? `${action}: ${body.error}` : `${action} (${res.status})`);
}

export async function putVault(courseId, blob) {
  const res = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(courseId)}/roster-vault`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob }),
  });
  if (!res.ok) throw await vaultError(res, 'vault store failed');
  return res.json(); // { success, courseId, updatedAt }
}

export async function getVault(courseId) {
  const res = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(courseId)}/roster-vault`, {
    credentials: 'include',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await vaultError(res, 'vault fetch failed');
  return res.json(); // { courseId, blob, updatedAt }
}

export async function deleteVault(courseId) {
  const res = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(courseId)}/roster-vault`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) throw await vaultError(res, 'vault purge failed');
  return res.json(); // { success, courseId, deleted }
}
