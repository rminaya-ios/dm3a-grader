// src/blind/vaultApi.js
// DM3A Grader — Blind Grading Mode, client for the server-held encrypted vault.
// Only ever transmits the OPAQUE encrypted blob — never the passphrase, never
// plaintext PII, never the raw roster CSV.

const API_BASE =
  (import.meta.env && import.meta.env.VITE_SERVER_URL) ||
  'https://dm3a-grader-production.up.railway.app';

export async function putVault(courseId, blob) {
  const res = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(courseId)}/roster-vault`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blob }),
  });
  if (!res.ok) throw new Error(`vault store failed (${res.status})`);
  return res.json(); // { success, courseId, updatedAt }
}

export async function getVault(courseId) {
  const res = await fetch(`${API_BASE}/api/courses/${encodeURIComponent(courseId)}/roster-vault`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`vault fetch failed (${res.status})`);
  return res.json(); // { courseId, blob, updatedAt }
}
