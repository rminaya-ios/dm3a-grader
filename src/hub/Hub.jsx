// src/hub/Hub.jsx
// DM3A Hub — app.dm3agrader.com. One sign-in (the shared .dm3agrader.com session
// cookie), then every DM3A tool as a tile. Deliberately thin: the tools do the
// work; the hub only signs you in, lists your courses, and edits shared Settings.
//
// PRIVACY: the course list shows course codes only. Student names live in the
// encrypted roster vault and are never fetched here.

import { useEffect, useState } from 'react';
import { S } from '../auth/styles.js';
import * as api from '../auth/api.js';
import AuthGate from '../auth/AuthGate.jsx';
import SettingsPanel from './SettingsPanel.jsx';

// The Grader lives on the bare domain; app.dm3agrader.com → dm3agrader.com. In
// local dev the hub is served at /hub, so the Grader is just "/".
function graderUrl() {
  const h = window.location.hostname;
  return h.startsWith('app.') ? `${window.location.protocol}//${h.slice(4)}/` : '/';
}

const TOOLS = [
  { key: 'grader', name: 'Grader', blurb: 'Scan, grade and post a class set.', href: graderUrl(), status: 'live' },
  { key: 'makeup', name: 'Make-up', blurb: 'Absences, video explanations, late work.', status: 'next' },
  { key: 'checkpoint', name: 'CheckPoint', blurb: 'In-class checks.', href: 'https://checkpoint.dm3agrader.com', status: 'link' },
  { key: 'attendance', name: 'Attendance', blurb: 'Attendance and Blackboard sync.', href: 'https://dm3a-attendance.vercel.app', status: 'link' },
  { key: 'calc', name: 'Grade Calculator', blurb: 'Course grade calculator.', href: 'https://dm3a-grade-calculator.vercel.app', status: 'link' },
];

const page = { ...S.page, justifyContent: 'flex-start' };
const shell = { width: '100%', maxWidth: 760 };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 24 };
const tile = {
  ...S.card, marginBottom: 0, display: 'block', textDecoration: 'none', color: '#1A1A18',
  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', fontSize: 'inherit', width: '100%',
};
const tileName = { fontSize: 18, margin: '0 0 6px' };
const tileBlurb = { fontSize: 13, color: '#5A5A55', margin: 0 };
const pill = (bg, fg) => ({
  display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  background: bg, color: fg, padding: '2px 8px', borderRadius: 10, marginBottom: 10,
});

function Tile({ t }) {
  const label = t.status === 'live' ? pill('#E1F5EE', '#0F6E56') : t.status === 'next' ? pill('#F3EBD3', '#7A5A10') : pill('#EEEDE7', '#5A5A55');
  const text = t.status === 'live' ? 'Live' : t.status === 'next' ? 'Coming next' : 'Link';
  const body = (
    <>
      <span style={label}>{text}</span>
      <h3 style={tileName}>{t.name}</h3>
      <p style={tileBlurb}>{t.blurb}</p>
    </>
  );
  if (!t.href) return <div style={{ ...tile, cursor: 'default', opacity: 0.75 }}>{body}</div>;
  return <a style={tile} href={t.href}>{body}</a>;
}

export default function Hub() {
  const [state, setState] = useState({ loading: true, user: null });
  const [courses, setCourses] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    api.me().then(({ user }) => setState({ loading: false, user }));
  }, []);

  useEffect(() => {
    if (!state.user) return;
    api.listCourses().then((d) => setCourses(d.courses || [])).catch(() => setCourses([]));
  }, [state.user]);

  if (state.loading) return <div style={S.page}>Loading…</div>;

  if (!state.user) {
    // A legacy shared-password session has no account, so the hub (which is all
    // account data) treats it as signed out.
    return <AuthGate onAuthed={({ user }) => setState({ loading: false, user })} onBack={() => { window.location.href = graderUrl(); }} />;
  }

  async function signOut() {
    await api.logout().catch(() => {});
    setState({ loading: false, user: null });
    setCourses(null);
  }

  return (
    <div style={page}>
      <div style={shell}>
        <div style={{ ...S.header, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <span style={S.badge}>DM3A Hub</span>
            <h1 style={S.h1}>Welcome{state.user.name ? `, ${state.user.name}` : ''}</h1>
            <p style={S.sub}>{state.user.email}</p>
          </div>
          <button style={S.quietBtn} onClick={signOut}>Sign out</button>
        </div>

        <div style={grid}>
          {TOOLS.map((t) => <Tile key={t.key} t={t} />)}
          <button style={tile} onClick={() => setShowSettings((v) => !v)}>
            <span style={pill('#E6ECF7', '#24467A')}>Shared</span>
            <h3 style={tileName}>Settings</h3>
            <p style={tileBlurb}>Bands, Blackboard points, late policy.</p>
          </button>
        </div>

        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

        <div style={S.card}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px' }}>Your courses</h2>
          {courses === null ? (
            <p style={tileBlurb}>Loading…</p>
          ) : courses.length === 0 ? (
            <p style={tileBlurb}>No courses yet. Add them in the Grader.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {courses.map((c) => (
                <li key={c.courseCode} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #EEEDE7' }}>
                  <span>{c.courseCode}</span>
                  <span style={{ fontSize: 12, color: '#5A5A55' }}>{c.vaulted ? 'Roster in vault (aliases only)' : 'No roster vault'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
