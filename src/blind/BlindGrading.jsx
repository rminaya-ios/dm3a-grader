// BlindGrading.jsx
// DM3A Grader — Blind Grading Mode, Phase 1 UI (spec §2.1–2.4)
// Route: /blind
//
// Everything sensitive stays in the browser: the raw Blackboard CSV is parsed
// client-side (PapaParse) and NEVER uploaded; aliases are generated locally; the
// name↔alias mapping is encrypted client-side (AES-256-GCM / PBKDF2) and only the
// OPAQUE blob is optionally stored on the server. The passphrase never leaves the
// tab and is held in memory only.

import { useState, useMemo } from 'react';
import Papa from 'papaparse';
import { assignAliases, coursePrefix } from './alias.js';
import { encryptMapping, decryptMapping, MIN_PASSPHRASE_LEN } from './vault.js';
import { putVault, getVault } from './vaultApi.js';
import { buildAliasCardPdf } from './aliasCardPdf.js';

const BRAND = '#2860C8';
const TEAL = '#22C1C3';

// Case-insensitive, BOM/quote-tolerant header lookup.
function findHeader(fields, candidates) {
  const norm = (s) => String(s || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/["']/g, '');
  const map = new Map(fields.map((f) => [norm(f), f]));
  for (const c of candidates) {
    const hit = map.get(norm(c));
    if (hit) return hit;
  }
  return null;
}

function download(filename, data, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BlindGrading() {
  const [courseCode, setCourseCode] = useState('');
  const [students, setStudents] = useState([]); // { lastName, firstName, bbUsername, studentId, alias? }
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [storedAt, setStoredAt] = useState(null);
  const [decryptedPreview, setDecryptedPreview] = useState(null);

  const prefix = useMemo(() => coursePrefix(courseCode), [courseCode]);
  const withAliases = students.length > 0 && students[0].alias;

  const courseId = courseCode.trim();

  const parseCsv = (file) => {
    setError('');
    setStatus('Parsing roster in your browser (never uploaded)…');
    // PapaParse runs entirely client-side; the raw file object is never sent anywhere.
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          const fields = res.meta.fields || [];
          const hLast = findHeader(fields, ['Last Name', 'LastName', 'Last']);
          const hFirst = findHeader(fields, ['First Name', 'FirstName', 'First']);
          const hUser = findHeader(fields, ['Username', 'User Name', 'User Id', 'UserId']);
          const hId = findHeader(fields, ['Student ID', 'StudentID', 'Student Id', 'ID']);
          if (!hLast && !hUser) {
            throw new Error('Could not detect a "Last Name" or "Username" column in this CSV.');
          }
          const rows = res.data
            .map((r) => ({
              lastName: hLast ? String(r[hLast] || '').trim() : '',
              firstName: hFirst ? String(r[hFirst] || '').trim() : '',
              bbUsername: hUser ? String(r[hUser] || '').trim() : '',
              studentId: hId ? String(r[hId] || '').trim() : '',
            }))
            .filter((r) => r.lastName || r.bbUsername);
          setStudents(rows);
          setDecryptedPreview(null);
          setStoredAt(null);
          setStatus(`Parsed ${rows.length} students locally. Set a passphrase, then generate aliases.`);
        } catch (e) {
          setError(e.message);
          setStatus('');
        }
      },
      error: (e) => { setError(`CSV parse error: ${e.message}`); setStatus(''); },
    });
  };

  const generate = () => {
    setError('');
    if (!courseId) return setError('Enter a course code first.');
    if (students.length === 0) return setError('Import a roster CSV first.');
    setStudents(assignAliases(students, courseId));
    setStatus('Aliases generated locally. You can now encrypt + store, or print alias cards.');
  };

  const buildMapping = () => ({
    courseId,
    version: 1,
    createdAt: new Date().toISOString(),
    students: students.map((s) => ({
      alias: s.alias,
      lastName: s.lastName,
      firstName: s.firstName,
      bbUsername: s.bbUsername,
      studentId: s.studentId,
    })),
  });

  const guardPass = () => {
    if (!withAliases) { setError('Generate aliases first.'); return false; }
    if (!passphrase || passphrase.length < MIN_PASSPHRASE_LEN) {
      setError(`Passphrase must be at least ${MIN_PASSPHRASE_LEN} characters. There is no recovery — DM3A cannot reset it.`);
      return false;
    }
    return true;
  };

  const storeOnServer = async () => {
    setError('');
    if (!guardPass()) return;
    setBusy(true);
    try {
      // #19: never silently replace an existing vault's aliases.
      const existing = await getVault(courseId);
      if (existing) {
        const when = existing.updatedAt ? new Date(existing.updatedAt).toLocaleDateString() : 'earlier';
        const proceed = window.confirm(
          `⚠ ${courseId} already has aliases (secured ${when}).\n\n` +
          `Storing now REPLACES ALL of them — printed alias cards and labeled work in flight will stop matching.\n\n` +
          `To add or remove students while keeping existing aliases, use "Update roster" instead.\n\n` +
          `Replace ALL aliases anyway?`
        );
        if (!proceed) { setStatus('Store cancelled — existing aliases kept.'); setBusy(false); return; }
      }
      const blob = await encryptMapping(buildMapping(), passphrase);
      const res = await putVault(courseId, blob);
      setStoredAt(res.updatedAt || new Date().toISOString());
      setStatus('Encrypted mapping stored on the server (opaque — the server cannot decrypt it).');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadLocal = async () => {
    setError('');
    if (!guardPass()) return;
    setBusy(true);
    try {
      const blob = await encryptMapping(buildMapping(), passphrase);
      download(`${courseId || 'course'}-roster-key.dm3a`, JSON.stringify(blob, null, 2), 'application/json');
      setStatus('Encrypted key file downloaded. If you lose this file AND your passphrase, the mapping is unrecoverable.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const printCards = async () => {
    setError('');
    if (!withAliases) return setError('Generate aliases first.');
    setBusy(true);
    try {
      const bytes = await buildAliasCardPdf(courseId, students);
      download(`${courseId || 'course'}-alias-cards.pdf`, bytes, 'application/pdf');
      setStatus('Alias cards PDF generated locally.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const loadFromServer = async () => {
    setError('');
    if (!courseId) return setError('Enter a course code first.');
    if (!passphrase || passphrase.length < MIN_PASSPHRASE_LEN) return setError('Enter the passphrase to decrypt.');
    setBusy(true);
    try {
      const vault = await getVault(courseId);
      if (!vault) { setError('No server vault found for this course.'); return; }
      const mapping = await decryptMapping(vault.blob, passphrase);
      const loaded = mapping.students || [];
      setDecryptedPreview(loaded);
      // #21: populate students so the alias table renders and "Alias cards PDF"
      // is enabled after Load + decrypt (it was disabled → dead click before).
      setStudents(loaded);
      setStatus(`Decrypted ${loaded.length} students. You can now view the alias table below and print alias cards.`);
    } catch (e) {
      setError(e.message); // wrong passphrase surfaces here, cleanly
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.page}>
      <header style={S.header}>
        <h1 style={S.h1}>DM3A — Blind Grading</h1>
        <p style={S.sub}>Student names never leave this browser. The server sees course-scoped aliases only.</p>
      </header>

      {error ? <div style={S.err}>{error}</div> : null}
      {status ? <div style={S.status}>{status}</div> : null}

      <section style={S.card}>
        <h2 style={S.h2}>1 · Course + roster</h2>
        <label style={S.label}>Course code</label>
        <input style={S.input} value={courseCode} onChange={(e) => setCourseCode(e.target.value)} placeholder="e.g. MATH110-03" />
        {courseCode ? <div style={S.hint}>Alias prefix: <b>{prefix}</b> → e.g. <code>{prefix}-7F3K</code></div> : null}
        <label style={{ ...S.label, marginTop: 12 }}>Blackboard Grade Center CSV</label>
        <input style={S.file} type="file" accept=".csv,text/csv" onChange={(e) => e.target.files[0] && parseCsv(e.target.files[0])} />
        {students.length > 0 ? <div style={S.hint}>{students.length} students imported (parsed locally, never uploaded).</div> : null}
      </section>

      <section style={S.card}>
        <h2 style={S.h2}>2 · Passphrase</h2>
        <p style={S.warn}>Minimum {MIN_PASSPHRASE_LEN} characters. <b>No recovery</b> — DM3A cannot reset this; that's the point. Held in memory only, re-entered each session.</p>
        <input style={S.input} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Passphrase (≥10 chars)" autoComplete="new-password" />
      </section>

      <section style={S.card}>
        <h2 style={S.h2}>3 · Generate + store</h2>
        <div style={S.btnRow}>
          <button style={S.primary} onClick={generate} disabled={busy}>Generate aliases</button>
          <button style={S.btn} onClick={storeOnServer} disabled={busy || !withAliases}>Encrypt → store on server</button>
          <button style={S.btn} onClick={downloadLocal} disabled={busy || !withAliases}>Encrypt → download key file</button>
          <button style={S.btn} onClick={printCards} disabled={busy || !withAliases}>Alias cards PDF</button>
        </div>
        {storedAt ? <div style={S.hint}>Server vault updated {new Date(storedAt).toLocaleString()}.</div> : null}
        {withAliases ? (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr><th style={S.th}>Alias</th><th style={S.th}>Last</th><th style={S.th}>First</th><th style={S.th}>Username</th></tr></thead>
              <tbody>
                {students.slice(0, 8).map((s) => (
                  <tr key={s.alias}><td style={S.tdMono}>{s.alias}</td><td style={S.td}>{s.lastName}</td><td style={S.td}>{s.firstName}</td><td style={S.td}>{s.bbUsername}</td></tr>
                ))}
              </tbody>
            </table>
            {students.length > 8 ? <div style={S.hint}>…and {students.length - 8} more.</div> : null}
          </div>
        ) : null}
      </section>

      <section style={S.card}>
        <h2 style={S.h2}>Multi-device: load + decrypt from server</h2>
        <p style={S.hint}>Fetches the opaque blob and decrypts it locally with your passphrase.</p>
        <button style={S.btn} onClick={loadFromServer} disabled={busy}>Load + decrypt</button>
        {decryptedPreview ? <div style={S.hint}>Decrypted {decryptedPreview.length} students in memory ✓</div> : null}
      </section>
    </div>
  );
}

const S = {
  page: { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', maxWidth: 760, margin: '0 auto', padding: 16, color: '#1a2436' },
  header: { marginBottom: 12 },
  h1: { fontSize: 22, margin: 0, background: `linear-gradient(90deg, ${BRAND}, ${TEAL})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
  sub: { color: '#5b6b86', fontSize: 13.5, margin: '4px 0 0' },
  card: { border: '1px solid #e6eaf2', borderRadius: 12, padding: 16, marginBottom: 14, background: '#fff' },
  h2: { fontSize: 15, margin: '0 0 10px' },
  label: { display: 'block', fontSize: 12, color: '#5b6b86', marginBottom: 4 },
  input: { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #d7deea', fontSize: 14, boxSizing: 'border-box' },
  file: { display: 'block', fontSize: 13 },
  hint: { fontSize: 12, color: '#5b6b86', marginTop: 8 },
  warn: { fontSize: 12.5, color: '#8a5a00', background: '#fff7e6', border: '1px solid #ffe2a8', borderRadius: 8, padding: '8px 10px', margin: '0 0 10px' },
  btnRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  primary: { background: BRAND, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, cursor: 'pointer', fontWeight: 600 },
  btn: { background: '#fff', color: '#1a2436', border: '1px solid #d7deea', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, cursor: 'pointer' },
  err: { background: '#fdecea', color: '#a3352b', padding: '9px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 },
  status: { background: 'rgba(40,96,200,0.08)', color: '#1a2436', padding: '9px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 },
  tableWrap: { overflowX: 'auto', marginTop: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e6eaf2', color: '#5b6b86', fontWeight: 600 },
  td: { padding: '6px 8px', borderBottom: '1px solid #e6eaf2' },
  tdMono: { padding: '6px 8px', borderBottom: '1px solid #e6eaf2', fontFamily: 'ui-monospace, Menlo, monospace', color: BRAND, fontWeight: 700 },
};
