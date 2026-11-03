// src/makeup/StudentPage.jsx
// A student's private make-up page: app.dm3agrader.com/makeup/<token>.
// No account — the link is the key. Works on a phone or a laptop.
//   1. pick the assignment  2. upload a photo of the work
//   3. one question appears (24 hours from now)  4. later: Loom link + transcript

import { useEffect, useState } from 'react';
import { S } from '../auth/styles.js';
import * as api from './api.js';

const when = (d) =>
  new Date(d).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const step = { fontSize: 15, fontWeight: 700, margin: '0 0 10px' };

export default function StudentPage({ token }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState('');
  const [loomUrl, setLoomUrl] = useState('');
  const [transcript, setTranscript] = useState('');

  function load() {
    return api.getLink(token).then((d) => {
      setState(d);
      setAssignmentId((cur) => cur || d.requestedAssignmentId);
    });
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!state) {
    return (
      <div style={S.page}>
        <div style={S.shell}>{error ? <p style={S.error}>{error}</p> : 'Loading…'}</div>
      </div>
    );
  }

  const sub = state.submissions.find((s) => s && s.assignmentId === assignmentId) || null;
  const assignment = state.assignments.find((a) => a.id === assignmentId);

  function merge(s) {
    setState((p) => ({ ...p, submissions: [...p.submissions.filter((x) => x.assignmentId !== s.assignmentId), s] }));
  }

  async function upload(e) {
    e.preventDefault();
    if (!files.length) return setError('Choose a photo of your work first.');
    setBusy('photo');
    setError('');
    try {
      const images = [];
      for (const f of files) images.push(await api.photoToBase64(f));
      const d = await api.uploadPhoto(token, assignmentId, images);
      merge(d.submission);
      setFiles([]);
    } catch (err) {
      if (err.data && err.data.submission) merge(err.data.submission);
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function explain(e) {
    e.preventDefault();
    setBusy('explain');
    setError('');
    try {
      const d = await api.sendExplanation(token, assignmentId, loomUrl, transcript);
      merge(d.submission);
    } catch (err) {
      if (err.data && err.data.submission) merge(err.data.submission);
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const expired = sub && sub.expiresAt && new Date(sub.expiresAt) < new Date();

  return (
    <div style={S.page}>
      <div style={{ ...S.shell, maxWidth: 560 }}>
        <div style={S.header}>
          <span style={S.badge}>DM3A Make-up</span>
          <h1 style={S.h1}>Your video make-up</h1>
          <p style={S.sub}>{state.courseCode} · this link works until {when(state.linkExpiresAt)}</p>
        </div>

        <div style={S.card}>
          <h2 style={step}>1. Assignment</h2>
          <select style={{ ...S.input, marginBottom: 0 }} value={assignmentId} onChange={(e) => { setAssignmentId(e.target.value); setError(''); }}>
            {state.assignments.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        {(!sub || !sub.question) && (
          <form style={S.card} onSubmit={upload}>
            <h2 style={step}>2. Photo of your completed work</h2>
            {sub && sub.needsBetterPhoto && (
              <p style={S.error}>We couldn't read your work clearly. Please take a new photo: flat, in good light, the whole page showing.</p>
            )}
            <p style={{ fontSize: 14, marginTop: 0 }}>
              Take a clear photo of your written work for <strong>{assignment ? assignment.name : 'this assignment'}</strong> (up to 4 pages).
              As soon as it uploads you'll get <strong>one question about your own work</strong>, and you'll have <strong>24 hours</strong> to answer it.
            </p>
            <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files].slice(0, 4))} style={{ marginBottom: 16 }} />
            {error && <p style={S.error}>{error}</p>}
            <button style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }} disabled={!!busy}>
              {busy === 'photo' ? 'Checking your photo and preparing your question… (up to a minute)' : 'Upload and show my question'}
            </button>
          </form>
        )}

        {sub && sub.question && (
          <div style={{ ...S.card, borderColor: '#1A1A18' }}>
            <h2 style={step}>3. Your question</h2>
            <p style={{ fontSize: 18, lineHeight: 1.4, margin: '0 0 12px' }}>{sub.question}</p>
            <p style={{ fontSize: 13, color: expired ? '#A32D2D' : '#5A5A55', margin: 0 }}>
              {expired ? 'The 24 hours ended ' : 'Answer by '}<strong>{when(sub.expiresAt)}</strong>. We also emailed you this question.
            </p>
          </div>
        )}

        {sub && sub.question && !sub.explained && (
          <form style={S.card} onSubmit={explain}>
            <h2 style={step}>4. Your Loom video</h2>
            <ol style={{ fontSize: 14, paddingLeft: 20, marginTop: 0 }}>
              <li>Record a Loom. Point at your paper and explain <strong>each step, in order</strong>, in your own words.</li>
              <li><strong>At the end, answer the question above.</strong></li>
              <li>In Loom, copy the share link and the transcript, and paste them here.</li>
            </ol>
            <label style={S.label} htmlFor="mu-loom">Loom share link</label>
            <input id="mu-loom" style={S.input} value={loomUrl} onChange={(e) => setLoomUrl(e.target.value)} placeholder="https://www.loom.com/share/…" required />
            <label style={S.label} htmlFor="mu-transcript">Loom transcript</label>
            <textarea id="mu-transcript" style={{ ...S.input, minHeight: 160 }} value={transcript} onChange={(e) => setTranscript(e.target.value)} required />
            {error && <p style={S.error}>{error}</p>}
            <button style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }} disabled={!!busy}>{busy === 'explain' ? 'Sending…' : 'Send my video'}</button>
          </form>
        )}

        {sub && sub.explained && (
          <div style={S.card}>
            <p style={S.success}>Received. Dr. Minaya will watch your video and post your grade.</p>
          </div>
        )}
      </div>
    </div>
  );
}
