// src/makeup/RequestPage.jsx
// Public "Request video make-up" form: app.dm3agrader.com/makeup/request/<courseToken>.
// No sign-in. One link per course, posted by the instructor in Blackboard.

import { useEffect, useState } from 'react';
import { S } from '../auth/styles.js';
import * as api from './api.js';

const REASONS = [
  ['schedule_conflict', 'Schedule conflict'],
  ['medical', 'Medical'],
  ['other', 'Other'],
];

export default function RequestPage({ courseToken }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ name: '', email: '', assignmentId: '', reasonCategory: '', note: '' });

  useEffect(() => {
    api.getRequestForm(courseToken).then(setForm).catch((e) => setError(e.message));
  }, [courseToken]);

  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.sendRequest(courseToken, v);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={{ ...S.shell, maxWidth: 480 }}>
        <div style={S.header}>
          <span style={S.badge}>DM3A Make-up</span>
          <h1 style={S.h1}>Request a video make-up</h1>
          <p style={S.sub}>{form ? form.courseCode : ' '}</p>
        </div>

        <div style={{ ...S.card, background: '#F7F5EE' }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            The usual way to make up work is <strong>office hours: Monday, Wednesday and Friday, 11:00 AM–12:00 PM</strong>.
            Use this form only if you can't make office hours.
          </p>
        </div>

        {!form && !error && <p>Loading…</p>}
        {!form && error && <p style={S.error}>{error}</p>}

        {form && done && (
          <div style={S.card}>
            <p style={S.success}>Your request was sent.</p>
            <p style={{ fontSize: 14, margin: 0 }}>You'll get an email at your school address once it's reviewed.</p>
          </div>
        )}

        {form && !done && (
          <form style={S.card} onSubmit={submit}>
            <label style={S.label} htmlFor="mu-name">Your full name</label>
            <input id="mu-name" style={S.input} value={v.name} onChange={set('name')} autoComplete="name" required />

            <label style={S.label} htmlFor="mu-email">School email</label>
            <input id="mu-email" style={S.input} type="email" value={v.email} onChange={set('email')} autoComplete="email" required />
            <p style={S.hint}>Must end in @ctstate.edu or @usj.edu.</p>

            <label style={S.label} htmlFor="mu-assignment">Assignment</label>
            <select id="mu-assignment" style={S.input} value={v.assignmentId} onChange={set('assignmentId')} required>
              <option value="">Choose…</option>
              {form.assignments.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>

            <span style={S.label}>Reason</span>
            <div style={{ marginBottom: 16 }}>
              {REASONS.map(([key, label]) => (
                <label key={key} style={{ display: 'block', fontSize: 14, marginBottom: 6 }}>
                  <input type="radio" name="reason" value={key} checked={v.reasonCategory === key} onChange={set('reasonCategory')} required /> {label}
                </label>
              ))}
            </div>

            <label style={S.label} htmlFor="mu-note">Short note (optional)</label>
            <textarea id="mu-note" style={{ ...S.input, minHeight: 70 }} maxLength={300} value={v.note} onChange={set('note')} />
            <p style={S.hint}><strong>Do not include medical details.</strong> Choosing "Medical" is enough.</p>

            {error && <p style={S.error}>{error}</p>}
            <button style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }} disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
