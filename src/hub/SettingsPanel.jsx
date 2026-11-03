// src/hub/SettingsPanel.jsx
// DM3A Hub — edit the signed-in instructor's Settings (server/models/Settings.js):
// DM3A bands, Blackboard points per level, and the late-policy windows. The
// server validates everything (lib/settingsRules.js); this just collects numbers.

import { useEffect, useState } from 'react';
import { S } from '../auth/styles.js';
import * as api from '../auth/api.js';

const LEVELS = ['P4', 'P3', 'P2', 'P1'];
const row = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 };
const small = { ...S.input, marginBottom: 0, width: 90 };
const sectionTitle = { fontSize: 15, fontWeight: 700, margin: '0 0 12px' };

function NumberInput({ value, onChange, ...rest }) {
  return (
    <input
      style={small}
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      {...rest}
    />
  );
}

export default function SettingsPanel({ onClose }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getSettings().then((d) => setS(d.settings)).catch((e) => setError(e.message));
  }, []);

  if (!s) return <div style={S.card}>{error ? <p style={S.error}>{error}</p> : 'Loading settings…'}</div>;

  const set = (section, key, v) => { setSaved(''); setS((p) => ({ ...p, [section]: { ...p[section], [key]: v } })); };
  const setWindow = (i, key, v) => {
    setSaved('');
    setS((p) => ({ ...p, latePolicy: { ...p.latePolicy, windows: p.latePolicy.windows.map((w, j) => (j === i ? { ...w, [key]: v } : w)) } }));
  };

  async function save() {
    setBusy(true); setError(''); setSaved('');
    try {
      const d = await api.saveSettings({ bands: s.bands, bbPoints: s.bbPoints, latePolicy: s.latePolicy });
      setS(d.settings);
      setSaved('Saved. Every DM3A tool uses these settings.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={S.card}>
      <h2 style={{ ...sectionTitle, fontSize: 18 }}>Settings</h2>

      <h3 style={sectionTitle}>DM3A bands (minimum %)</h3>
      <div style={row}><span style={{ width: 40 }}>P4</span><NumberInput value={s.bands.p4Min} onChange={(v) => set('bands', 'p4Min', v)} /> and up</div>
      <div style={row}><span style={{ width: 40 }}>P3</span><NumberInput value={s.bands.p3Min} onChange={(v) => set('bands', 'p3Min', v)} /> to below P4</div>
      <div style={row}><span style={{ width: 40 }}>P2</span><NumberInput value={s.bands.p2Min} onChange={(v) => set('bands', 'p2Min', v)} /> to below P3</div>
      <p style={{ ...S.hint, margin: '0 0 20px' }}>P1 is anything below P2.</p>

      <h3 style={sectionTitle}>Blackboard points</h3>
      {LEVELS.map((l) => (
        <div key={l} style={row}><span style={{ width: 40 }}>{l}</span><NumberInput value={s.bbPoints[l]} onChange={(v) => set('bbPoints', l, v)} /> points</div>
      ))}
      <div style={row}>
        <span style={{ width: 40 }}>Talk</span>
        <NumberInput value={s.bbPoints.talkToStudent} onChange={(v) => set('bbPoints', 'talkToStudent', v)} />
        placeholder = &ldquo;talk to student&rdquo;
      </div>

      <h3 style={{ ...sectionTitle, marginTop: 20 }}>Late policy</h3>
      {s.latePolicy.windows.map((w, i) => (
        <div key={i} style={row}>
          Up to <NumberInput value={w.maxDaysLate} onChange={(v) => setWindow(i, 'maxDaysLate', v)} min={0} /> days late → cap at
          <select style={{ ...small, width: 70 }} value={w.capLevel} onChange={(e) => setWindow(i, 'capLevel', e.target.value)}>
            {LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
      ))}
      <div style={row}>
        Later than that →
        <select
          style={{ ...small, width: 190 }}
          value={s.latePolicy.beyond}
          onChange={(e) => set('latePolicy', 'beyond', e.target.value)}
        >
          <option value="instructor_review">Instructor review</option>
          {LEVELS.map((l) => <option key={l} value={l}>Cap at {l}</option>)}
        </select>
      </div>

      {error && <p style={{ ...S.error, marginTop: 12 }}>{error}</p>}
      {saved && <p style={{ ...S.success, marginTop: 12 }}>{saved}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button style={{ ...S.btn, ...(busy ? S.btnDisabled : {}) }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>
        <button style={S.btnSecondary} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
