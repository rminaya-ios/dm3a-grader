// src/makeup/MakeupPanel.jsx
// DM3A Make-up — the instructor's side, opened from the hub's Make-up tile.
//   Requests     approve (optional end date) or deny, one click each
//   Review       the AI review card beside the Loom; confirm or change the level
//   Assignments  per course: make-up assignments, due dates, the request link
//   Blackboard   put confirmed levels into the Blackboard upload file
//
// Student names appear here (the owner's own view) and nowhere else: they are
// never logged and never sent to the AI. The Loom link is opened only by the
// instructor's click; code never fetches or embeds it.

import { useEffect, useState } from 'react';
import { S } from '../auth/styles.js';
import * as api from './api.js';
import { parseBBFile, detectGradeColumns, joinGrades, serializeBB } from '../blind/bbExport.js';

const LEVELS = ['P4', 'P3', 'P2', 'P1'];
const REASON = { schedule_conflict: 'Schedule conflict', medical: 'Medical', other: 'Other' };
const FLAG = {
  possible_script_reading: 'Possible script reading',
  question_not_answered: 'Question not answered',
  unclear_answer: 'Answer unclear',
  expired_answer: 'Answered after the 24 hours',
  missing_answer: 'No video 48 hours after the question expired',
  late_beyond_policy: 'Beyond the late windows: your call',
  unreadable_work: 'Photo could not be read',
};
const SIGN = {
  polished_wording: 'Overly polished or textbook wording that doesn’t match the written work',
  no_hesitation: 'No hesitation or self-correction anywhere',
  order_mismatch: 'Doesn’t follow the order of the steps on the paper',
};

const tabBtn = (on) => ({
  ...S.linkBtn, textDecoration: 'none', fontWeight: on ? 700 : 400, borderBottom: on ? '2px solid #1A1A18' : '2px solid transparent',
  padding: '4px 0', marginRight: 18, fontSize: 14,
});
const smallBtn = { ...S.btn, width: 'auto', padding: '8px 14px', fontSize: 13 };
const smallBtn2 = { ...S.btnSecondary, width: 'auto', padding: '7px 14px', fontSize: 13 };
const muted = { fontSize: 12, color: '#5A5A55' };
const flagPill = { display: 'inline-block', fontSize: 11, background: '#FBEAEA', color: '#8A2323', borderRadius: 10, padding: '2px 8px', margin: '0 6px 6px 0' };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const dayTime = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function copy(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

// ── Requests ────────────────────────────────────────────────────────────────
function Requests({ onChange }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [endDates, setEndDates] = useState({});
  const [links, setLinks] = useState({}); // id → link just issued (shown once)
  const [busy, setBusy] = useState('');

  const load = () => api.requests().then((d) => setList(d.requests)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function act(id, fn) {
    setBusy(id); setError('');
    try {
      const d = await fn();
      if (d.link) setLinks((p) => ({ ...p, [id]: { link: d.link, emailSent: d.emailSent } }));
      await load();
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (!list) return error ? <p style={S.error}>{error}</p> : <p>Loading…</p>;
  const pending = list.filter((r) => r.status === 'pending');
  const decided = list.filter((r) => r.status !== 'pending');

  return (
    <div>
      {error && <p style={S.error}>{error}</p>}
      {pending.length === 0 && <p style={muted}>No new requests.</p>}
      {pending.map((r) => (
        <div key={r.id} style={{ borderTop: '1px solid #EEEDE7', padding: '12px 0' }}>
          <div style={{ fontSize: 15 }}><strong>{r.name}</strong> · {r.courseCode} · {r.assignmentName}</div>
          <div style={muted}>{REASON[r.reasonCategory]} · {r.email} · asked {dayTime(r.createdAt)}</div>
          {r.note && <div style={{ fontSize: 13, margin: '6px 0' }}>“{r.note}”</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button style={smallBtn} disabled={busy === r.id} onClick={() => act(r.id, () => api.approve(r.id, endDates[r.id]))}>Approve</button>
            <label style={muted}>
              ends (optional){' '}
              <input type="date" value={endDates[r.id] || ''} onChange={(e) => setEndDates((p) => ({ ...p, [r.id]: e.target.value }))} />
            </label>
            <button style={smallBtn2} disabled={busy === r.id} onClick={() => act(r.id, () => api.deny(r.id))}>Deny</button>
          </div>
        </div>
      ))}

      {decided.length > 0 && <h3 style={{ fontSize: 13, margin: '20px 0 4px', color: '#5A5A55' }}>Decided</h3>}
      {decided.map((r) => {
        const issued = links[r.id];
        const lastEmail = [...r.emails].reverse().find((e) => e.kind === (r.status === 'approved' ? 'approved' : 'denied'));
        return (
          <div key={r.id} style={{ borderTop: '1px solid #EEEDE7', padding: '10px 0', fontSize: 14 }}>
            <div>
              {r.name} · {r.courseCode} · {r.assignmentName} — <strong>{r.status}</strong>
              {r.status === 'approved' && <span style={muted}> · link {r.linkLive ? `works until ${day(r.linkExpiresAt)}` : 'stopped'}</span>}
            </div>
            <div style={muted}>Email to student: {lastEmail && lastEmail.ok ? 'sent' : 'NOT sent'}</div>
            {issued && (
              <div style={{ ...S.success, marginTop: 6, wordBreak: 'break-all' }}>
                {issued.emailSent ? 'Emailed. ' : 'Not emailed. Copy this link to the student: '}
                <code>{issued.link}</code>{' '}
                <button style={S.linkBtn} onClick={() => copy(issued.link)}>Copy</button>
              </div>
            )}
            {r.status === 'approved' && (
              <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                <button style={S.quietBtn} onClick={() => act(r.id, () => api.newLink(r.id))}>New link (old one stops)</button>
                {r.linkLive && <button style={S.quietBtn} onClick={() => act(r.id, () => api.revoke(r.id))}>Stop link</button>}
              </div>
            )}
            <button
              style={{ ...S.quietBtn, marginTop: 4 }}
              disabled={busy === r.id}
              onClick={() => window.confirm(`Remove this record for ${r.name}? The request and anything the student sent are deleted for good.`) && act(r.id, () => api.removeRequest(r.id))}
            >
              Remove record
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────
function ReviewCard({ id, onBack, onChange }) {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [level, setLevel] = useState('');
  const [exReason, setExReason] = useState('');
  const [exError, setExError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    api.submission(id).then((d) => { setS(d.submission); setLevel(d.submission.confirmedLevel || d.submission.recommendedLevel || ''); })
      .catch((e) => setError(e.message));
  }, [id]);

  if (!s) return error ? <p style={S.error}>{error}</p> : <p>Loading…</p>;

  async function run(fn) {
    setBusy(true); setError('');
    try {
      const d = await fn();
      setS((p) => ({ ...p, ...d.submission }));
      onChange();
      return d;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function liftCap() {
    if (!exReason.trim()) {
      setExError('A documented exception needs a short reason.');
      return;
    }
    setExError('');
    run(() => api.setException(s.id, true, exReason));
  }

  async function removeRecord() {
    if (!window.confirm(`Remove this record for ${s.name || 'this student'}? The request, photo, question and video link are deleted for good, and it won't appear in the Blackboard file.`)) return;
    setBusy(true); setError('');
    try {
      await api.removeRequest(s.requestId);
      onChange();
      onBack();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  // Put the Loom in a window on the left half of the screen, beside this card.
  function openLoom() {
    const w = Math.round(window.screen.availWidth / 2);
    const h = window.screen.availHeight;
    const win = window.open(s.loomUrl, 'dm3a-loom', `width=${w},height=${h},left=0,top=0`);
    if (win) win.opener = null; // the Loom page gets no handle back to the hub
  }

  const card = s.review || {};
  return (
    <div>
      <button style={S.quietBtn} onClick={onBack}>← All submissions</button>
      <h3 style={{ fontSize: 18, margin: '8px 0 2px' }}>{s.name}</h3>
      <div style={muted}>{s.courseCode} · {s.assignmentName} · due {day(s.dueAt)} · photo {dayTime(s.photoReceivedAt)}</div>

      <div style={{ margin: '14px 0' }}>
        {s.loomUrl ? <button style={smallBtn} onClick={openLoom}>Open Loom beside this card</button> : <span style={muted}>No video yet.</span>}
      </div>

      <div style={{ ...S.card, background: '#FAFAF7' }}>
        <div style={{ marginBottom: 10 }}>{s.flags.map((f) => <span key={f} style={flagPill}>{FLAG[f] || f}</span>)}</div>
        <p style={{ margin: '0 0 8px' }}><strong>Late:</strong> {s.capReason || 'On time.'}</p>
        <p style={{ margin: '0 0 8px' }}>
          <strong>Draft level:</strong> {s.recommendedLevel || '—'}
          {card.aiLevel && card.aiLevel !== s.recommendedLevel && <span style={muted}> (work alone: {card.aiLevel}; capped)</span>}
          {card.levelReason && <span> — {card.levelReason}</span>}
        </p>
        <p style={{ margin: '0 0 8px' }}><strong>Question:</strong> {s.question}</p>
        <p style={{ margin: '0 0 8px' }}>
          <strong>Answered?</strong> {card.status === 'ready' ? ({ answered: 'Yes', not_answered: 'No', unclear: 'Unclear' }[card.answerStatus]) : card.status === 'pending' ? 'Checking…' : '—'}
          {card.answerNote && <span> — {card.answerNote}</span>}
          {s.transcriptReceivedAt && <span style={muted}> · sent {dayTime(s.transcriptReceivedAt)} (deadline {dayTime(s.expiresAt)})</span>}
        </p>
        {card.scriptSigns && card.scriptSigns.length > 0 && (
          <div style={{ margin: '0 0 8px' }}>
            <strong>Possible script reading:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 14 }}>{card.scriptSigns.map((k) => <li key={k}>{SIGN[k] || k}</li>)}</ul>
          </div>
        )}
        {card.status === 'failed' && (
          <p style={S.error}>The AI review didn't finish. <button style={S.linkBtn} disabled={busy} onClick={() => run(() => api.rerunReview(s.id))}>Try again</button></p>
        )}
        <p style={{ ...muted, margin: 0 }}>Flags are for you to weigh. None of them changes the level.</p>
      </div>

      <div style={S.card}>
        <span style={S.label}>Your level</span>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {LEVELS.map((l) => (
            <button key={l} style={l === level ? smallBtn : smallBtn2} onClick={() => setLevel(l)}>
              {l}{l === s.recommendedLevel ? ' (draft)' : ''}
            </button>
          ))}
        </div>
        {s.confirmedLevel && level === s.confirmedLevel ? (
          <button style={{ ...S.btn, ...S.btnDisabled }} disabled>Confirmed {s.confirmedLevel}</button>
        ) : (
          <button style={{ ...S.btn, ...(busy || !level ? S.btnDisabled : {}) }} disabled={busy || !level} onClick={() => run(() => api.confirm(s.id, level))}>
            {s.confirmedLevel ? `Change to ${level}` : `Confirm ${level || ''}`}
          </button>
        )}
        {s.confirmedLevel && <p style={{ ...S.success, marginTop: 10 }}>Confirmed {s.confirmedLevel}. It goes into your next Blackboard file (Blackboard tab).</p>}
        {error && <p style={S.error}>{error}</p>}
      </div>

      <div style={S.card}>
        <span style={S.label}>Documented exception (lifts the late cap)</span>
        {s.exception ? (
          <p style={{ margin: 0 }}>On: {s.exceptionReason} <button style={S.linkBtn} disabled={busy} onClick={() => { setExError(''); run(() => api.setException(s.id, false, '')); }}>Remove</button></p>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...S.input, marginBottom: 0 }} placeholder="Reason, e.g. note on file" value={exReason} onChange={(e) => { setExReason(e.target.value); setExError(''); }} />
            <button style={smallBtn2} disabled={busy} onClick={liftCap}>Lift cap</button>
          </div>
        )}
        {exError && <p style={S.error}>{exError}</p>}
      </div>

      <div style={S.card}>
        <span style={S.label}>Written work (name blacked out)</span>
        {s.pages.map((p, i) => <img key={i} alt={`Page ${i + 1}`} src={`data:image/jpeg;base64,${p}`} style={{ width: '100%', border: '1px solid #EEE', marginBottom: 8 }} />)}
        {s.transcript && (
          <>
            <button style={S.linkBtn} onClick={() => setShowTranscript((v) => !v)}>{showTranscript ? 'Hide' : 'Show'} transcript</button>
            {showTranscript && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14 }}>{s.transcript}</pre>}
          </>
        )}
      </div>

      <div style={{ margin: '4px 0 12px' }}>
        <button style={S.quietBtn} disabled={busy} onClick={removeRecord}>Remove this record (e.g. your own test)</button>
      </div>
    </div>
  );
}

function Review({ onChange }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.submissions().then((d) => setList(d.submissions)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (open) return <ReviewCard id={open} onBack={() => { setOpen(null); load(); }} onChange={onChange} />;
  if (!list) return error ? <p style={S.error}>{error}</p> : <p>Loading…</p>;
  if (!list.length) return <p style={muted}>Nothing yet. Submissions appear here once a student uploads a photo.</p>;

  const status = (s) =>
    s.confirmedLevel ? `Confirmed ${s.confirmedLevel}` : s.transcriptReceivedAt ? 'Ready to review' : s.question ? 'Waiting for the video' : 'Waiting for a readable photo';
  const order = (s) => (s.confirmedLevel ? 2 : s.transcriptReceivedAt || s.flags.length ? 0 : 1);
  return (
    <div>
      {[...list].sort((a, b) => order(a) - order(b)).map((s) => (
        <button key={s.id} onClick={() => setOpen(s.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid #EEEDE7', padding: '10px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
          <strong>{s.name}</strong> · {s.courseCode} · {s.assignmentName}
          <div style={muted}>{status(s)}{s.recommendedLevel && !s.confirmedLevel ? ` · draft ${s.recommendedLevel}` : ''}</div>
          <div>{s.flags.map((f) => <span key={f} style={flagPill}>{FLAG[f] || f}</span>)}</div>
        </button>
      ))}
    </div>
  );
}

// ── Assignments ─────────────────────────────────────────────────────────────
const toLocalInput = (d) => {
  const t = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
};

function CourseAssignments({ course, onSaved }) {
  const [rows, setRows] = useState(course.assignments.map((a) => ({ id: a.id, name: a.name, dueAt: toLocalInput(a.dueAt) })));
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const set = (i, k, v) => setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  async function save() {
    setMsg(''); setError('');
    try {
      await api.saveAssignments(course.courseCode, rows.map((r) => ({ id: r.id, name: r.name, dueAt: new Date(r.dueAt).toISOString() })));
      setMsg('Saved.');
      onSaved();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{ borderTop: '1px solid #EEEDE7', padding: '12px 0' }}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{course.courseCode}</div>
      {course.requestUrl ? (
        <div style={{ ...muted, margin: '4px 0 8px', wordBreak: 'break-all' }}>
          Request link for Blackboard: <code>{course.requestUrl}</code> <button style={S.linkBtn} onClick={() => copy(course.requestUrl)}>Copy</button>
        </div>
      ) : (
        <div style={{ ...muted, margin: '4px 0 8px' }}>Save at least one assignment to get this course’s request link.</div>
      )}
      {rows.map((r, i) => (
        <div key={r.id || `new-${i}`} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input style={{ ...S.input, marginBottom: 0 }} placeholder="Assignment name" value={r.name} onChange={(e) => set(i, 'name', e.target.value)} />
          <input style={{ ...S.input, marginBottom: 0, width: 230 }} type="datetime-local" value={r.dueAt} onChange={(e) => set(i, 'dueAt', e.target.value)} />
          <button style={S.quietBtn} onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
        <button style={S.linkBtn} onClick={() => setRows((p) => [...p, { name: '', dueAt: '' }])}>+ Add assignment</button>
        <button style={smallBtn} onClick={save}>Save</button>
        {msg && <span style={{ color: '#0F6E56', fontSize: 13 }}>{msg}</span>}
      </div>
      {error && <p style={S.error}>{error}</p>}
    </div>
  );
}

function Assignments() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.courses().then((d) => setList(d.courses)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (!list) return error ? <p style={S.error}>{error}</p> : <p>Loading…</p>;
  if (!list.length) return <p style={muted}>No courses yet. Add them in the Grader.</p>;
  return (
    <div>
      <p style={muted}>Students pick from this list, and the due date is what “days late” is counted from.</p>
      {list.map((c) => <CourseAssignments key={c.courseCode} course={c} onSaved={load} />)}
    </div>
  );
}

// ── Blackboard file ─────────────────────────────────────────────────────────
// Same round trip as the Grader's blind export: upload the Grade Center working
// file, choose the column, download the filled file. Everything happens in this
// browser; the file is never uploaded anywhere.
function Blackboard() {
  const [courses, setCourses] = useState([]);
  const [courseCode, setCourseCode] = useState('');
  const [rows, setRows] = useState(null);
  const [onlyNew, setOnlyNew] = useState(true);
  const [file, setFile] = useState(null); // { name, parsed, cols }
  const [col, setCol] = useState(-1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api.courses().then((d) => setCourses(d.courses)).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    api.exportRows(courseCode, onlyNew).then((d) => setRows(d.rows)).catch((e) => setError(e.message));
  }, [courseCode, onlyNew]);

  async function pick(e) {
    const f = e.target.files[0];
    if (!f) return;
    const parsed = parseBBFile(await f.text());
    const cols = detectGradeColumns(parsed.headers);
    setFile({ name: f.name, parsed, cols });
    setCol(cols.length === 1 ? cols[0].index : -1);
    setResult(null);
  }

  async function build() {
    setError('');
    const { parsed } = file;
    const joined = joinGrades({
      headers: parsed.headers,
      dataRows: parsed.dataRows,
      results: rows.map((r) => ({ alias: r.alias, score: r.points })),
      mapping: rows.map((r) => ({ alias: r.alias, studentEmail: r.studentEmail, firstName: r.firstName, lastName: r.lastName })),
      columnIndex: col,
      formatGrade: (res) => String(res.score),
    });
    const csv = serializeBB(parsed.headerLine, joined.filled);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.replace(/(\.csv)?$/i, '-makeup.csv');
    a.click();
    URL.revokeObjectURL(url);
    const matchedIds = joined.matched.map((m) => rows.find((r) => r.alias === m.alias).id);
    if (matchedIds.length) await api.markExported(matchedIds).catch(() => {});
    setResult({ matched: matchedIds.length, unmatched: joined.unmatchedResults.map((u) => rows.find((r) => r.alias === u.alias)) });
  }

  return (
    <div>
      <p style={muted}>Confirmed make-up levels go into your Blackboard upload file as points from Settings (P4 90, P3 80…). Nothing posts until you upload the file to Blackboard.</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select style={{ ...S.input, marginBottom: 0, width: 200 }} value={courseCode} onChange={(e) => { setCourseCode(e.target.value); setResult(null); }}>
          <option value="">All courses</option>
          {courses.map((c) => <option key={c.courseCode} value={c.courseCode}>{c.courseCode}</option>)}
        </select>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={onlyNew} onChange={(e) => { setOnlyNew(e.target.checked); setResult(null); }} /> Only levels not yet added to a file</label>
      </div>
      {rows && rows.length === 0 && <p style={muted}>No confirmed levels to add.</p>}
      {rows && rows.length > 0 && (
        <>
          <ul style={{ fontSize: 14, paddingLeft: 20 }}>
            {rows.map((r) => <li key={r.id}>{r.name} · {r.courseCode} · {r.assignmentName}: {r.level} ({r.points} pts)</li>)}
          </ul>
          <span style={S.label}>Blackboard Grade Center file (Work Offline → Download)</span>
          <input type="file" accept=".csv,.xls,text/csv" onChange={pick} style={{ marginBottom: 12 }} />
          {file && (
            <>
              <select style={S.input} value={col} onChange={(e) => setCol(Number(e.target.value))}>
                <option value={-1}>Choose the grade column…</option>
                {file.cols.map((c) => <option key={c.index} value={c.index}>{c.header}</option>)}
              </select>
              <button style={{ ...S.btn, ...(col < 0 ? S.btnDisabled : {}) }} disabled={col < 0} onClick={build}>Fill and download the file</button>
            </>
          )}
        </>
      )}
      {result && (
        <div style={{ ...S.success, marginTop: 12 }}>
          Filled {result.matched} student(s). Upload the downloaded file in Blackboard (Grade Center → Work Offline → Upload).
          {result.unmatched.length > 0 && (
            <div style={{ color: '#A32D2D', marginTop: 6 }}>
              Not found in the file (enter by hand): {result.unmatched.map((r) => `${r.name} (${r.level})`).join(', ')}
            </div>
          )}
        </div>
      )}
      {error && <p style={S.error}>{error}</p>}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────
export default function MakeupPanel({ onClose, onChange }) {
  const [tab, setTab] = useState('requests');
  const tabs = [['requests', 'Requests'], ['review', 'Review'], ['assignments', 'Assignments'], ['blackboard', 'Blackboard']];
  return (
    <div style={{ ...S.card, textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Make-up (video, by approval)</h2>
        <button style={S.quietBtn} onClick={onClose}>Close</button>
      </div>
      <div style={{ marginBottom: 14 }}>
        {tabs.map(([k, label]) => <button key={k} style={tabBtn(tab === k)} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'requests' && <Requests onChange={onChange} />}
      {tab === 'review' && <Review onChange={onChange} />}
      {tab === 'assignments' && <Assignments />}
      {tab === 'blackboard' && <Blackboard />}
    </div>
  );
}
