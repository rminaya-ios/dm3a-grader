// src/blind/rosterApi.js
// DM3A — client for the Hub roster API (roster v2, server-managed encryption).
//
// Unlike vaultApi.js, which only ever moved an OPAQUE blob the server could not read,
// this carries the roster in clear over TLS and the SERVER seals it with ROSTER_KEK. The
// instructor never types a passphrase. The trade is deliberate and recorded in
// docs/roster-vault-v2.md: a passphrase nobody can recover cost a real course its
// printed alias cards in September.
//
// Every call sends the session cookie, because the API returns names only to the
// account that owns the course and writes every read to the audit log.

export const SERVER_URL =
  (import.meta.env && import.meta.env.VITE_SERVER_URL) ||
  'https://api.dm3agrader.com';

async function call(path, { method = 'GET', body, via } = {}) {
  const url = `${SERVER_URL}/api/my/roster${path}${via ? `${path.includes('?') ? '&' : '?'}via=${encodeURIComponent(via)}` : ''}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server — check your connection and try again.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty or non-JSON */ }
  if (!res.ok) {
    const err = new Error(data.error || `Roster request failed (${res.status}).`);
    err.status = res.status;
    err.data = data;          // carries `violations` / `duplicateAliases` on a 409
    throw err;
  }
  return data;
}

// The decrypted roster for a course, or null when none is stored yet. Every successful
// call is one line in that course's audit log.
export async function getRoster(courseId, { via } = {}) {
  try {
    return await call(`/${encodeURIComponent(courseId)}`, { via });
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// Replace the roster. The server REFUSES (409) if this would change or remove an alias
// that has already been issued, and the error carries the offending students.
export function putRoster(courseId, students, { migratedFrom, verified, acknowledgedAliases, skippedCount, via } = {}) {
  return call(`/${encodeURIComponent(courseId)}`, {
    method: 'PUT',
    body: {
      students,
      ...(migratedFrom ? { migratedFrom } : {}),
      ...(verified ? { verified: true } : {}),
      // Aliases and counts only, never prose: the server writes the audit sentence
      // itself, so no student name can reach the log even by accident.
      ...((acknowledgedAliases || []).length ? { acknowledgedAliases } : {}),
      ...(skippedCount ? { skippedCount } : {}),
    },
    via,
  });
}

export function getRosterAudit(courseId) {
  return call(`/${encodeURIComponent(courseId)}/audit`);
}

export function rotateRoster(courseId) {
  return call(`/${encodeURIComponent(courseId)}/rotate`, { method: 'POST' });
}
