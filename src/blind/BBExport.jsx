// src/blind/BBExport.jsx
// DM3A Grader — Blind Grading, "Export to Blackboard" (spec §4). Client-side only:
// the uploaded BB file is parsed in-browser, joined to graded aliases via the
// decrypted mapping, and the completed CSV is downloaded — NEVER uploaded.

import { useState } from 'react';
import {
  parseBBFile, detectGradeColumns, makeGradeFormatter, joinGrades, serializeBB, DEFAULT_TIER_PCT,
} from './bbExport.js';

const BRAND = '#2860C8';

export default function BBExport({ results, studentMapping, overrides, mapping, courseCode }) {
  const [parsed, setParsed] = useState(null);
  const [gradeCols, setGradeCols] = useState([]);
  const [colIndex, setColIndex] = useState(-1);
  const [mode, setMode] = useState('numeric');
  const [recon, setRecon] = useState(null);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const onFile = (file) => {
    setError(''); setRecon(null); setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = parseBBFile(reader.result);
        const cols = detectGradeColumns(p.headers);
        setParsed(p);
        setGradeCols(cols);
        setColIndex(-1); // #31: require an explicit column choice — never auto-pick (esp. a calculated Total)
        if (!cols.length) setError('No fillable grade columns detected in this file (calculated Total/Weighted Total columns are excluded — Blackboard ignores uploads to them).');
      } catch (e) { setError(e.message); }
    };
    reader.readAsText(file); // stays in the browser
  };

  // Alias-keyed results for the join: the confirmed alias (or the AI-read one) + tier.
  const exportResults = () => (results || []).map((s, i) => ({
    alias: studentMapping[i] || s.studentName,
    tier: (overrides[s.studentName] && overrides[s.studentName].overall) || s.overallTier,
  })).filter((r) => r.alias);

  const fillAndDownload = () => {
    setError('');
    if (!parsed || colIndex < 0) { setError('Upload a Blackboard file and select a grade column first.'); return; }
    const fmt = makeGradeFormatter(mode, DEFAULT_TIER_PCT);
    const j = joinGrades({
      headers: parsed.headers, dataRows: parsed.dataRows,
      results: exportResults(), mapping, columnIndex: colIndex, formatGrade: fmt,
    });
    const out = serializeBB(parsed.headerLine, j.filled);
    const blob = new Blob([out], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${courseCode || 'course'}-blackboard.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setRecon({ matched: j.matched.length, unmatchedRows: j.unmatchedRows, unmatchedResults: j.unmatchedResults });
  };

  return (
    <div style={S.card}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>Export to Blackboard</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888' }}>
        Upload your BB Grade Center working file. Grades fill in your browser using the unlocked mapping — the completed file is downloaded, never uploaded. Headers are preserved exactly.
      </p>

      <label style={S.fileBtn}>
        {fileName ? `📄 ${fileName}` : 'Upload BB Grade Center CSV'}
        <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onFile(f); }} />
      </label>

      {error ? <div style={S.err}>{error}</div> : null}

      {parsed && gradeCols.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <label style={S.label}>Grade column to fill</label>
          <select style={S.input} value={colIndex} onChange={(e) => setColIndex(Number(e.target.value))}>
            <option value={-1}>— Select a grade column —</option>
            {gradeCols.map((c) => <option key={c.index} value={c.index}>{c.header}</option>)}
          </select>

          <label style={{ ...S.label, marginTop: 10 }}>Grade value</label>
          <div style={{ display: 'flex', gap: 12, fontSize: 13, marginBottom: 12 }}>
            <label><input type="radio" checked={mode === 'numeric'} onChange={() => setMode('numeric')} /> Numeric P-score (1–4)</label>
            <label><input type="radio" checked={mode === 'percent'} onChange={() => setMode('percent')} /> Percentage midpoint (P4=95 · P3=85 · P2=70 · P1=50)</label>
          </div>

          <button type="button" style={S.primary} onClick={fillAndDownload}>Fill &amp; download completed CSV</button>
        </div>
      )}

      {recon && (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          <div style={{ color: '#0F6E56', fontWeight: 600 }}>✓ Filled {recon.matched} grade{recon.matched === 1 ? '' : 's'} · downloaded.</div>
          {recon.unmatchedResults.length > 0 && (
            <div style={S.warn}>
              {recon.unmatchedResults.length} graded student(s) had no BB row (alias not in mapping, or username/ID not found): {recon.unmatchedResults.map((u) => u.alias).join(', ')}
            </div>
          )}
          {recon.unmatchedRows.length > 0 && (
            <div style={S.warn}>
              {recon.unmatchedRows.length} BB row(s) received no grade (no matching submission): {recon.unmatchedRows.slice(0, 8).map((r) => r.username || r.studentId || `row ${r.rowIndex + 1}`).join(', ')}{recon.unmatchedRows.length > 8 ? '…' : ''}
            </div>
          )}
          {recon.unmatchedResults.length === 0 && recon.unmatchedRows.length === 0 && (
            <div style={{ color: '#0F6E56' }}>Every graded student matched a BB row.</div>
          )}
        </div>
      )}
    </div>
  );
}

const S = {
  card: { background: '#fff', border: `1px solid #D8D6CE`, borderRadius: 8, padding: 16, marginBottom: 16 },
  fileBtn: { display: 'inline-block', border: `1px dashed ${BRAND}`, color: BRAND, borderRadius: 8, padding: '10px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 },
  label: { display: 'block', fontSize: 12, color: '#5A5A55', marginBottom: 4 },
  input: { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #D8D6CE', fontSize: 13, boxSizing: 'border-box' },
  primary: { background: BRAND, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  err: { background: '#fdecea', color: '#a3352b', padding: '8px 10px', borderRadius: 6, marginTop: 10, fontSize: 12.5 },
  warn: { background: '#fff7e6', border: '1px solid #ffe2a8', color: '#8a5a00', padding: '8px 10px', borderRadius: 6, marginTop: 8, fontSize: 12.5 },
};
