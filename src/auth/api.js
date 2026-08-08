// src/auth/api.js
// DM3A Grader — instructor account API helpers.
//
// Every call sends `credentials: 'include'` so the httpOnly session cookie rides
// along. In production the site (dm3agrader.com) and API (api.dm3agrader.com)
// share the dm3agrader.com parent domain, which makes that cookie first-party —
// the reason logins work in iOS Safari, which blocks third-party cookies.

export const SERVER_URL =
  (import.meta.env && import.meta.env.VITE_SERVER_URL) ||
  'https://api.dm3agrader.com';

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server — check your connection and try again.');
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const register = (email, password, name) =>
  call('/api/auth/register', { method: 'POST', body: { email, password, name } });

export const login = (email, password) =>
  call('/api/auth/login', { method: 'POST', body: { email, password } });

export const legacyLogin = (password) =>
  call('/api/auth/legacy-login', { method: 'POST', body: { password } });

export const logout = () => call('/api/auth/logout', { method: 'POST' });

// The pre-accounts 7-day trial password (index.js /validate-trial), unchanged and
// still the way prospective users try the app. It issues no session cookie — same
// as before accounts existed, a refresh returns to the sign-in screen.
export const validateTrial = (password) =>
  call('/validate-trial', { method: 'POST', body: { password } }).catch(() => ({ valid: false }));

// Never throws — a logged-out visitor is a normal state, not an error.
export const me = () =>
  call('/api/auth/me').catch(() => ({ user: null, legacy: false }));

export const requestReset = (email) =>
  call('/api/auth/request-reset', { method: 'POST', body: { email } });

export const resetPassword = (token, password) =>
  call('/api/auth/reset', { method: 'POST', body: { token, password } });

// ── Account-scoped courses ───────────────────────────────────────────────────
export const listCourses = () => call('/api/my/courses');

export const saveCourse = (courseCode, fields) =>
  call(`/api/my/courses/${encodeURIComponent(courseCode)}`, { method: 'PUT', body: fields });

export const deleteCourse = (courseCode) =>
  call(`/api/my/courses/${encodeURIComponent(courseCode)}`, { method: 'DELETE' });

export const importCourses = (courses) =>
  call('/api/my/courses/import', { method: 'POST', body: { courses } });

// Shared with the server (lib/auth.js). Kept in sync by hand — the server is
// authoritative and re-validates every password it is sent.
export const MIN_PASSWORD_LENGTH = 10;
