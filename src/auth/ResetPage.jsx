// src/auth/ResetPage.jsx
// DM3A Grader — the page the emailed reset link opens: /reset?token=…
//
// Standalone (routed in main.jsx) because the link in the email has to be a real
// URL. On success it does NOT sign the user in — it sends them to the front door
// to confirm the new password works, and so a forwarded link can't hand over a
// live session.

import { useState } from 'react';
import { S } from './styles.js';
import Header from './Header.jsx';
import * as api from './api.js';

function readToken() {
  try {
    return new URLSearchParams(window.location.search).get('token') || '';
  } catch {
    return '';
  }
}

export default function ResetPage() {
  const [token] = useState(readToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const goToApp = () => { window.location.href = '/'; };

  // No token in the URL — usually a truncated link from an email client.
  if (!token) {
    return (
      <div style={S.page}>
        <div style={S.shell}>
          <Header title="Reset link incomplete" />
          <div style={S.card}>
            <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>
              This page needs the full link from your reset email. Some email apps cut long
              links in half — try copying the whole address, or request a new link.
            </p>
          </div>
          <p style={S.footer}><button style={S.linkBtn} onClick={goToApp}>← Back to sign in</button></p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={S.page}>
        <div style={S.shell}>
          <Header title="Password updated" />
          <div style={S.card}>
            <p style={S.success}>Your password has been changed. Sign in with the new one.</p>
            <button style={S.btn} onClick={goToApp}>Go to sign in →</button>
          </div>
        </div>
      </div>
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (password !== confirm) { setError("Those two passwords don't match."); return; }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message || 'Could not reset the password. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.page}>
      <div style={S.shell}>
        <Header title="Choose a new password" sub="This link works once." />
        <div style={S.card}>
          <form onSubmit={onSubmit}>
            <label style={S.label}>New password</label>
            <div style={S.revealWrap}>
              <input style={{ ...S.input, paddingRight: 56 }} type={show ? 'text' : 'password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${api.MIN_PASSWORD_LENGTH} characters`}
                autoComplete="new-password" autoFocus required />
              <button type="button" style={S.reveal} onClick={() => setShow((p) => !p)}>
                {show ? 'Hide' : 'Show'}
              </button>
            </div>

            <label style={S.label}>Confirm new password</label>
            <input style={S.input} type={show ? 'text' : 'password'} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />

            {error && <p style={S.error}>{error}</p>}
            <button type="submit" disabled={busy} style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }}>
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        </div>
        <p style={S.footer}><button style={S.linkBtn} onClick={goToApp}>← Back to sign in</button></p>
      </div>
    </div>
  );
}
