// src/auth/AuthGate.jsx
// DM3A Grader — the sign-in doorway: Sign in, Create account, and Forgot password.
//
// Replaces the old shared-password screen in App.jsx. The shared password still
// works while the server's ALLOW_LEGACY_LOGIN flag is on, behind a deliberately
// understated "Use the shared access password" link — it is the fallback, not the
// front door. When the flag is switched off, the server answers with retired:true
// and this explains that in plain language instead of just failing.
//
// onAuthed({ user, legacy }) fires once a session exists. A legacy session has
// user:null — it is account-less by design, so it keeps the old browser-local
// course behavior instead of opening somebody's account.

import { useState } from 'react';
import { S } from './styles.js';
import Header from './Header.jsx';
import * as api from './api.js';

function PasswordField({ label, value, onChange, autoComplete, placeholder, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label style={S.label}>{label}</label>
      <div style={S.revealWrap}>
        <input
          style={{ ...S.input, paddingRight: 56 }}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        <button type="button" style={S.reveal} onClick={() => setShow((p) => !p)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </>
  );
}

export default function AuthGate({ onAuthed, onBack, initialView = 'login' }) {
  const [view, setView] = useState(initialView); // login | signup | forgot | legacy
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function go(next) {
    setView(next);
    setError('');
    setNotice('');
    setPassword('');
  }

  async function submit(e, action) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const submitBtn = (text) => (
    <button type="submit" disabled={busy} style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }}>
      {busy ? 'Working…' : text}
    </button>
  );

  // ── Create account ─────────────────────────────────────────────────────────
  if (view === 'signup') {
    return (
      <div style={S.page}>
        <div style={S.shell}>
          <Header title="Create your account" sub="Your courses stay private to you." />
          <div style={S.card}>
            <form onSubmit={(e) => submit(e, async () => {
              const { user } = await api.register(email, password, name);
              onAuthed({ user, legacy: false });
            })}>
              <label style={S.label}>Name</label>
              <input style={S.input} value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Dr. Jane Doe" autoComplete="name" autoFocus />

              <label style={S.label}>Email</label>
              <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@college.edu" autoComplete="email" required />

              <PasswordField label="Password" value={password} onChange={setPassword}
                autoComplete="new-password" placeholder={`At least ${api.MIN_PASSWORD_LENGTH} characters`} />
              <p style={S.hint}>
                At least {api.MIN_PASSWORD_LENGTH} characters. A short phrase you'll remember beats a
                short scramble you won't.
              </p>

              {error && <p style={S.error}>{error}</p>}
              {submitBtn('Create account →')}
            </form>
          </div>
          <p style={S.footer}>
            Already have an account?{' '}
            <button style={S.linkBtn} onClick={() => go('login')}>Sign in</button>
          </p>
          <p style={{ ...S.footer, marginTop: 14 }}>
            <button style={S.quietBtn} onClick={onBack}>← Back</button>
          </p>
        </div>
      </div>
    );
  }

  // ── Forgot password ────────────────────────────────────────────────────────
  if (view === 'forgot') {
    return (
      <div style={S.page}>
        <div style={S.shell}>
          <Header title="Reset your password" sub="We'll email you a link." />
          <div style={S.card}>
            {notice ? (
              <p style={S.success}>{notice}</p>
            ) : (
              <form onSubmit={(e) => submit(e, async () => {
                await api.requestReset(email);
                setNotice(
                  `If an account exists for ${email}, a reset link is on its way. ` +
                  'The link works once and expires in 60 minutes.'
                );
              })}>
                <label style={S.label}>Email</label>
                <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@college.edu" autoComplete="email" autoFocus required />
                {error && <p style={S.error}>{error}</p>}
                {submitBtn('Email me a reset link')}
              </form>
            )}
          </div>
          <p style={S.footer}>
            <button style={S.linkBtn} onClick={() => go('login')}>← Back to sign in</button>
          </p>
        </div>
      </div>
    );
  }

  // ── Shared access password (fallback) ──────────────────────────────────────
  if (view === 'legacy') {
    return (
      <div style={S.page}>
        <div style={S.shell}>
          <Header title="Access password" sub="The older way in — being retired." />
          <div style={S.card}>
            <form onSubmit={(e) => submit(e, async () => {
              try {
                await api.legacyLogin(password);
                onAuthed({ user: null, legacy: true });
                return;
              } catch (err) {
                // Not the shared password — it may still be a 7-day trial
                // password, which worked on this same box before accounts and
                // must keep working. Unchanged endpoint, unchanged behavior.
                if (err.status !== 401 && err.status !== 403) throw err;
                const trial = await api.validateTrial(password);
                if (trial.valid) { onAuthed({ user: null, legacy: true }); return; }
                if (trial.reason === 'expired') {
                  throw new Error('That trial password has expired. Contact support@dm3agrader.com to renew.');
                }
                throw err; // surface the original message (wrong password, or retired)
              }
            })}>
              <PasswordField label="Access password" value={password} onChange={setPassword}
                autoComplete="current-password" placeholder="Enter the shared password" autoFocus />
              {error && <p style={S.error}>{error}</p>}
              <p style={S.hint}>
                Use the shared password or a 7-day trial password. Signing in this way doesn't
                create an account, so your courses stay on this device only — create an
                account to keep them with you.
              </p>
              {submitBtn('Enter DM3A Grader™ →')}
            </form>
          </div>
          <p style={S.footer}>
            <button style={S.linkBtn} onClick={() => go('login')}>← Back to sign in</button>
          </p>
        </div>
      </div>
    );
  }

  // ── Sign in ────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <div style={S.shell}>
        <Header title="Sign in" sub="Mastery-Based AI Grading · Dr. Ralph Minaya, Ed.D." />
        <div style={S.card}>
          <form onSubmit={(e) => submit(e, async () => {
            const { user } = await api.login(email, password);
            onAuthed({ user, legacy: false });
          })}>
            <label style={S.label}>Email</label>
            <input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@college.edu" autoComplete="email" autoFocus required />

            <PasswordField label="Password" value={password} onChange={setPassword}
              autoComplete="current-password" placeholder="Enter your password" />

            {error && <p style={S.error}>{error}</p>}
            {submitBtn('Sign in →')}
          </form>

          <p style={{ ...S.footer, marginTop: 16, marginBottom: 0 }}>
            <button style={S.linkBtn} onClick={() => go('forgot')}>Forgot your password?</button>
          </p>
        </div>

        {/* Creating an account is REQUIRED for new instructors now, so it gets
            equal billing with signing in — not a grey link in the footer. */}
        <div style={S.card}>
          <p style={{ margin: '0 0 12px', fontSize: 14, textAlign: 'center' }}>
            Don&rsquo;t have an account yet?
          </p>
          <button style={S.btnSecondary} onClick={() => go('signup')}>
            Create an account
          </button>
        </div>

        <p style={S.footer}>
          <button style={S.quietBtn} onClick={() => go('legacy')}>Use the shared access password</button>
        </p>
        <p style={{ ...S.footer, marginTop: 14 }}>
          <button style={S.quietBtn} onClick={onBack}>← Back</button>
        </p>
      </div>
    </div>
  );
}
