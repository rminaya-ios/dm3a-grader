// src/makeup/api.js
// DM3A Make-up — API calls. The instructor calls carry the hub session cookie;
// the student pages' calls carry nothing but the token in the URL.

import { SERVER_URL } from '../auth/api.js';

async function call(path, { method = 'GET', body, auth = true } = {}) {
  let res;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method,
      credentials: auth ? 'include' : 'omit',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

// ── Student pages (public) ──────────────────────────────────────────────────
export const getRequestForm = (courseToken) => call(`/api/makeup/request/${enc(courseToken)}`, { auth: false });
export const sendRequest = (courseToken, body) => call(`/api/makeup/request/${enc(courseToken)}`, { method: 'POST', body, auth: false });
export const getLink = (token) => call(`/api/makeup/s/${enc(token)}`, { auth: false });
export const uploadPhoto = (token, assignmentId, images) =>
  call(`/api/makeup/s/${enc(token)}/photo`, { method: 'POST', body: { assignmentId, images }, auth: false });
export const sendExplanation = (token, assignmentId, loomUrl, transcript) =>
  call(`/api/makeup/s/${enc(token)}/explain`, { method: 'POST', body: { assignmentId, loomUrl, transcript }, auth: false });

// ── Instructor (signed in) ──────────────────────────────────────────────────
export const summary = () => call('/api/my/makeup/summary');
export const courses = () => call('/api/my/makeup/courses');
export const saveAssignments = (courseCode, assignments) =>
  call(`/api/my/makeup/courses/${enc(courseCode)}`, { method: 'PUT', body: { assignments } });
export const requests = (status) => call(`/api/my/makeup/requests${status ? `?status=${enc(status)}` : ''}`);
export const approve = (id, endDate) => call(`/api/my/makeup/requests/${enc(id)}/approve`, { method: 'POST', body: endDate ? { endDate } : {} });
export const deny = (id) => call(`/api/my/makeup/requests/${enc(id)}/deny`, { method: 'POST' });
export const newLink = (id) => call(`/api/my/makeup/requests/${enc(id)}/new-link`, { method: 'POST' });
export const revoke = (id) => call(`/api/my/makeup/requests/${enc(id)}/revoke`, { method: 'POST' });
export const removeRequest = (id) => call(`/api/my/makeup/requests/${enc(id)}`, { method: 'DELETE' });
export const submissions = () => call('/api/my/makeup/submissions');
export const submission = (id) => call(`/api/my/makeup/submissions/${enc(id)}`);
export const setException = (id, exception, reason) =>
  call(`/api/my/makeup/submissions/${enc(id)}/exception`, { method: 'POST', body: { exception, reason } });
export const confirm = (id, level) => call(`/api/my/makeup/submissions/${enc(id)}/confirm`, { method: 'POST', body: { level } });
export const rerunReview = (id) => call(`/api/my/makeup/submissions/${enc(id)}/review`, { method: 'POST' });
export const exportRows = (courseCode, onlyNew) =>
  call(`/api/my/makeup/export?courseCode=${enc(courseCode || '')}${onlyNew ? '&onlyNew=1' : ''}`);
export const markExported = (ids) => call('/api/my/makeup/export/mark', { method: 'POST', body: { ids } });

// Phone photos are large; shrink to ≤2000px JPEG before upload. Falls back to
// the original file when the browser can't decode it (the server converts).
export async function photoToBase64(file) {
  const raw = () =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('Could not read that photo.'));
      r.readAsDataURL(file);
    });
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } catch {
    return raw();
  }
}
