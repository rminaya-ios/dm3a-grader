// AdminDashboard.jsx
// DM3A Grader — founder-facing internal admin dashboard (Phase 3)
// Route: /admin  (not linked from any public navigation)
//
// Read-only. Password-gated (x-admin-key stored in sessionStorage only).
// Talks to the backend aggregation API at /api/admin/* on Railway.
//
// This file is entirely self-contained and does NOT touch App.jsx / the grading
// flow. main.jsx renders it only when the path is /admin.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, PieChart, Pie, Cell, BarChart,
} from 'recharts';

// Same backend origin the main app uses (Railway).
const API_BASE =
  (import.meta.env && import.meta.env.VITE_SERVER_URL) ||
  'https://dm3a-grader-production.up.railway.app';

const SESSION_KEY = 'dm3a_admin_key';

// ── DM3A brand ────────────────────────────────────────────────────────────────
const BRAND = '#2860C8';      // royal blue
const TEAL = '#22C1C3';       // teal accent (gradient partner)
const P_COLORS = { P1: '#E4572E', P2: '#F2A541', P3: '#4A90D9', P4: '#2E9E5B' };
const VIA_COLORS = { auto: BRAND, gatekeeper: TEAL, instructor: '#7C5CFC', '': '#B0B7C3' };
const VIA_LABELS = { auto: 'Grading', gatekeeper: 'Student Mode gatekeeper', instructor: 'Instructor-recorded', '': 'Unattributed' };

// ── Formatting helpers ────────────────────────────────────────────────────────
const fmtInt = (n) => Number(n || 0).toLocaleString();
const fmtUSD = (n) => {
  const v = Number(n || 0);
  if (v === 0) return '$0.00';
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
};
// Dash for genuinely-absent cost (per-user/per-course attribution is dormant).
const fmtUSDorDash = (n) => (!n ? '—' : fmtUSD(n));
const fmtDuration = (ms) => {
  const v = Number(ms || 0);
  if (!v) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
};
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const fmtPct = (x) => `${Math.round((Number(x) || 0) * 100)}%`;
const shortDay = (d) => (d ? d.slice(5) : d); // 'MM-DD' from 'YYYY-MM-DD'

// ─────────────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(SESSION_KEY) || '');
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [gateError, setGateError] = useState('');
  const [days, setDays] = useState(30);

  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const apiGet = useCallback(
    async (path, key = adminKey) => {
      const res = await fetch(`${API_BASE}/api/admin${path}`, {
        headers: { 'x-admin-key': key },
      });
      if (res.status === 401) {
        const err = new Error('unauthorized');
        err.unauthorized = true;
        throw err;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    },
    [adminKey]
  );

  // Load every panel. Reused by the initial load and the 60s auto-refresh.
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [overview, activity, byCourse, byUser, cost, risk, mastery] = await Promise.all([
        apiGet('/stats/overview'),
        apiGet(`/stats/activity?days=${days}`),
        apiGet('/stats/by-course'),
        apiGet('/stats/by-user'),
        apiGet(`/stats/cost?days=${days}`),
        apiGet(`/stats/risk?days=${days}`),
        apiGet('/stats/mastery'),
      ]);
      setData({ overview, activity, byCourse, byUser, cost, risk, mastery });
      setLastUpdated(new Date());
    } catch (e) {
      if (e.unauthorized) {
        // Key went stale / was wrong — bounce back to the gate.
        sessionStorage.removeItem(SESSION_KEY);
        setAuthed(false);
        setGateError('Session expired or key rejected. Enter the admin key again.');
      } else {
        setError(e.message || 'Failed to load dashboard data.');
      }
    } finally {
      setLoading(false);
    }
  }, [apiGet, days]);

  // Try to auth using a stored key on first mount.
  useEffect(() => {
    if (!adminKey || authed) return;
    let cancelled = false;
    (async () => {
      setChecking(true);
      try {
        await apiGet('/stats/overview', adminKey);
        if (!cancelled) setAuthed(true);
      } catch (e) {
        if (!cancelled && e.unauthorized) {
          sessionStorage.removeItem(SESSION_KEY);
          setAdminKey('');
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load + auto-refresh once authed (and whenever the day range changes).
  useEffect(() => {
    if (!authed) return;
    loadAll();
    const id = setInterval(loadAll, 60000);
    return () => clearInterval(id);
  }, [authed, loadAll]);

  const submitGate = async (e) => {
    e.preventDefault();
    const key = (e.target.elements.adminKey.value || '').trim();
    if (!key) return;
    setChecking(true);
    setGateError('');
    try {
      await apiGet('/stats/overview', key);
      sessionStorage.setItem(SESSION_KEY, key);
      setAdminKey(key);
      setAuthed(true);
    } catch (err) {
      setGateError(err.unauthorized ? 'Incorrect admin key.' : (err.message || 'Could not verify key.'));
    } finally {
      setChecking(false);
    }
  };

  if (!authed) {
    return <Gate onSubmit={submitGate} checking={checking} error={gateError} />;
  }

  return (
    <Dashboard
      data={data}
      loading={loading}
      error={error}
      lastUpdated={lastUpdated}
      days={days}
      setDays={setDays}
      onRefresh={loadAll}
      onSignOut={() => {
        sessionStorage.removeItem(SESSION_KEY);
        setAdminKey('');
        setAuthed(false);
        setData({});
      }}
    />
  );
}

// ── Gate screen ───────────────────────────────────────────────────────────────
function Gate({ onSubmit, checking, error }) {
  return (
    <div style={S.gateWrap}>
      <Style />
      <form onSubmit={onSubmit} style={S.gateCard}>
        <div style={S.brandDot} />
        <h1 style={S.gateTitle}>DM3A Grader</h1>
        <p style={S.gateSub}>Admin Dashboard — restricted</p>
        <input
          name="adminKey"
          type="password"
          autoFocus
          autoComplete="off"
          placeholder="Admin key"
          style={S.gateInput}
        />
        {error ? <div style={S.gateErr}>{error}</div> : null}
        <button type="submit" disabled={checking} style={S.gateBtn}>
          {checking ? 'Verifying…' : 'Enter'}
        </button>
        <p style={S.gateHint}>Key is held in this browser tab only (sessionStorage).</p>
      </form>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
function Dashboard({ data, loading, error, lastUpdated, days, setDays, onRefresh, onSignOut }) {
  const { overview, activity, byCourse, byUser, cost, risk, mastery } = data;
  const isEmpty = overview && overview.submissions && overview.submissions.allTime === 0;

  return (
    <div style={S.page}>
      <Style />
      <header style={S.header}>
        <div>
          <h1 style={S.h1}>DM3A Grader — Admin</h1>
          <div style={S.updated}>
            {loading ? 'Refreshing…' : lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : ''}
          </div>
        </div>
        <div style={S.headerRight}>
          <RangeToggle days={days} setDays={setDays} />
          <button onClick={onRefresh} style={S.ghostBtn}>Refresh</button>
          <button onClick={onSignOut} style={S.ghostBtn}>Sign out</button>
        </div>
      </header>

      {error ? <div style={S.errorBar}>{error}</div> : null}

      {isEmpty ? (
        <div style={S.emptyBanner}>
          No submissions recorded yet. This dashboard starts near zero pre-launch —
          grade one submission and it will show up here within a minute.
        </div>
      ) : null}

      {/* Row 1 — summary cards */}
      <section style={S.cardRow}>
        <Card label="Submissions" value={overview ? fmtInt(overview.submissions.allTime) : '—'}
          sub={overview ? `${fmtInt(overview.submissions.last7d)} · 7d   ${fmtInt(overview.submissions.last30d)} · 30d` : ''} />
        <Card label="Active professors (7d)" value={overview ? fmtInt(overview.activeProfessors7d) : '—'}
          sub={overview ? `${fmtInt(overview.distinctProfessors)} all-time` : ''} />
        <Card label="Est. API cost (30d)" value={overview ? fmtUSD(overview.estimatedCost.last30d) : '—'}
          sub={overview ? `${fmtUSD(overview.estimatedCost.allTime)} all-time` : ''} accent />
        <Card label="Avg cost / submission" value={overview ? fmtUSD(overview.avgCostPerSubmission) : '—'}
          sub="estimated" />
        <Card label="Avg grading duration" value={overview ? fmtDuration(overview.avgGradingDurationMs) : '—'}
          sub="main grading call" />
      </section>

      {/* Row 2 — activity chart */}
      <Panel title="Activity" subtitle={`Daily submissions + estimated cost · last ${days} days`}>
        <ActivityChart series={activity ? activity.series : []} />
      </Panel>

      {/* Row 3 — two tables side by side */}
      <div style={S.twoCol}>
        <Panel title="By course">
          <ByCourseTable rows={byCourse ? byCourse.courses : []} />
        </Panel>
        <Panel title="By user" subtitle="Professors — sorted by est. cost">
          <ByUserTable rows={byUser ? byUser.professors : []} />
        </Panel>
      </div>

      {/* Row 4 — cost breakdown */}
      <Panel title="Cost breakdown" subtitle="Estimated — see Anthropic Console for billed amounts">
        <CostBreakdown cost={cost} />
      </Panel>

      {/* Row 5 — at-risk */}
      <Panel title="At-Risk alerts" subtitle={`R1–R6 volume · last ${days} days for the trend`}>
        <RiskPanel risk={risk} />
      </Panel>

      {/* Mastery (future marketing stat) */}
      <Panel title="Mastery distribution" subtitle="P1–P4 overall">
        <MasteryPanel mastery={mastery} />
      </Panel>

      <footer style={S.footer}>
        Read-only internal tool · DM3A Grader · Math Consulting Services, LLC
      </footer>
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────
function RangeToggle({ days, setDays }) {
  return (
    <div style={S.toggle}>
      {[7, 30, 90].map((d) => (
        <button key={d} onClick={() => setDays(d)}
          style={{ ...S.toggleBtn, ...(days === d ? S.toggleBtnActive : {}) }}>
          {d}d
        </button>
      ))}
    </div>
  );
}

function Card({ label, value, sub, accent }) {
  return (
    <div style={{ ...S.card, ...(accent ? S.cardAccent : {}) }}>
      <div style={S.cardLabel}>{label}</div>
      <div style={{ ...S.cardValue, ...(accent ? { color: '#fff' } : {}) }}>{value}</div>
      {sub ? <div style={{ ...S.cardSub, ...(accent ? { color: 'rgba(255,255,255,0.85)' } : {}) }}>{sub}</div> : null}
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <section style={S.panel}>
      <div style={S.panelHead}>
        <h2 style={S.panelTitle}>{title}</h2>
        {subtitle ? <span style={S.panelSub}>{subtitle}</span> : null}
      </div>
      {children}
    </section>
  );
}

function EmptyNote({ children }) {
  return <div style={S.empty}>{children}</div>;
}

function ActivityChart({ series }) {
  if (!series || series.length === 0) return <EmptyNote>No activity in this window yet.</EmptyNote>;
  const hasAny = series.some((d) => d.submissions > 0 || d.estimatedCostUSD > 0);
  return (
    <>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND} />
              <stop offset="100%" stopColor={TEAL} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11, fill: 'var(--muted)' }} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'var(--muted)' }} allowDecimals={false} />
          <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `$${v.toFixed(2)}`} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <Tooltip content={<ChartTip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="left" dataKey="submissions" name="Submissions" fill="url(#barGrad)" radius={[3, 3, 0, 0]} maxBarSize={38} />
          <Line yAxisId="right" type="monotone" dataKey="estimatedCostUSD" name="Est. cost" stroke="#E4572E" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {!hasAny ? <EmptyNote>Window is quiet — all zeros so far.</EmptyNote> : null}
    </>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={S.tip}>
      <div style={S.tipDate}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.dataKey === 'estimatedCostUSD' ? fmtUSD(p.value) : fmtInt(p.value)}
        </div>
      ))}
    </div>
  );
}

// P1–P4 mini stacked bar.
function PBars({ dist }) {
  const total = ['P1', 'P2', 'P3', 'P4'].reduce((s, k) => s + (dist[k] || 0), 0);
  if (!total) return <span style={S.muted}>—</span>;
  return (
    <div style={S.pbarWrap} title={['P1', 'P2', 'P3', 'P4'].map((k) => `${k}:${dist[k] || 0}`).join('  ')}>
      {['P1', 'P2', 'P3', 'P4'].map((k) => {
        const w = ((dist[k] || 0) / total) * 100;
        if (!w) return null;
        return <div key={k} style={{ width: `${w}%`, background: P_COLORS[k], height: '100%' }} />;
      })}
    </div>
  );
}

function ByCourseTable({ rows }) {
  if (!rows || rows.length === 0) return <EmptyNote>No course activity yet.</EmptyNote>;
  return (
    <div style={S.tableScroll}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Course</th>
            <th style={S.thR}>Subs</th>
            <th style={S.thR}>Students</th>
            <th style={S.th}>P1–P4</th>
            <th style={S.thR}>Resub %</th>
            <th style={S.thR}>Est. cost</th>
            <th style={S.thR}>Last active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.courseCode}>
              <td style={S.tdMono}>{r.courseCode}</td>
              <td style={S.tdR}>{fmtInt(r.submissions)}</td>
              <td style={S.tdR}>{fmtInt(r.distinctStudents)}</td>
              <td style={S.td}><PBars dist={r.pDistribution || {}} /></td>
              <td style={S.tdR}>{fmtPct(r.resubmissionRate)}</td>
              <td style={S.tdR}>{fmtUSDorDash(r.estimatedCostUSD)}</td>
              <td style={S.tdR}>{fmtDate(r.lastActivity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ByUserTable({ rows }) {
  const [sortByCost, setSortByCost] = useState(true);
  const sorted = useMemo(() => {
    const copy = [...(rows || [])];
    copy.sort((a, b) =>
      sortByCost
        ? (b.estimatedCostUSD || 0) - (a.estimatedCostUSD || 0) || b.submissions - a.submissions
        : b.submissions - a.submissions
    );
    return copy;
  }, [rows, sortByCost]);

  if (!rows || rows.length === 0) return <EmptyNote>No professor activity yet.</EmptyNote>;
  return (
    <div style={S.tableScroll}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Professor</th>
            <th style={S.thR} onClick={() => setSortByCost(false)} className="dm3a-sortable">Subs</th>
            <th style={S.thR}>Last active</th>
            <th style={S.thR} onClick={() => setSortByCost(true)} className="dm3a-sortable">
              Est. cost {sortByCost ? '▾' : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.professorEmail || '(none)'}>
              <td style={S.tdMono}>{r.professorEmail || '—'}</td>
              <td style={S.tdR}>{fmtInt(r.submissions)}</td>
              <td style={S.tdR}>{fmtDate(r.lastActive)}</td>
              <td style={S.tdR}>{fmtUSDorDash(r.estimatedCostUSD)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostBreakdown({ cost }) {
  if (!cost) return <EmptyNote>Loading…</EmptyNote>;
  const t = cost.totals || {};
  const via = (cost.byRecordedVia || []).filter((v) => v.estimatedCostUSD > 0);
  const noCost = !cost.totals || cost.totals.estimatedCostUSD === 0;

  return (
    <div style={S.costGrid}>
      <div>
        <div style={S.kv}><span>Input tokens</span><b>{fmtInt(t.inputTokens)}</b></div>
        <div style={S.kv}><span>Output tokens</span><b>{fmtInt(t.outputTokens)}</b></div>
        <div style={S.kv}><span>Cache write tokens</span><b>{fmtInt(t.cacheCreationTokens)}</b></div>
        <div style={S.kv}><span>Cache read tokens</span><b>{fmtInt(t.cacheReadTokens)}</b></div>
        <div style={{ ...S.kv, ...S.kvTotal }}><span>Total estimated cost</span><b>{fmtUSD(t.estimatedCostUSD)}</b></div>
        <div style={S.kv}><span>Avg cost / submission</span><b>{fmtUSD(cost.avgCostPerSubmission)}</b></div>
      </div>
      <div>
        {noCost ? (
          <EmptyNote>No cost recorded yet — grade a submission to populate this.</EmptyNote>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={via} dataKey="estimatedCostUSD" nameKey="recordedVia" innerRadius={45} outerRadius={80} paddingAngle={2}>
                {via.map((v) => <Cell key={v.recordedVia} fill={VIA_COLORS[v.recordedVia] || '#B0B7C3'} />)}
              </Pie>
              <Tooltip formatter={(val, name) => [fmtUSD(val), VIA_LABELS[name] || name]} />
              <Legend formatter={(name) => VIA_LABELS[name] || name} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
        {cost.pricing ? (
          <div style={S.pricingNote}>
            Pricing assumptions ($/Mtok): in {cost.pricing.inputPerMTok} · out {cost.pricing.outputPerMTok} ·
            cache-write {cost.pricing.cacheWritePerMTok} · cache-read {cost.pricing.cacheReadPerMTok}.<br />
            {cost.note}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RiskPanel({ risk }) {
  if (!risk) return <EmptyNote>Loading…</EmptyNote>;
  const byRule = risk.byRule || [];
  const anyAlerts = (risk.total || 0) > 0;
  if (!anyAlerts) return <EmptyNote>No At-Risk alerts have fired yet.</EmptyNote>;
  return (
    <div style={S.twoCol}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={byRule} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="rule" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="count" name="Alerts" fill={BRAND} radius={[3, 3, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={risk.overTime || []} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="count" name="Alerts/day" fill={TEAL} radius={[3, 3, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MasteryPanel({ mastery }) {
  if (!mastery) return <EmptyNote>Loading…</EmptyNote>;
  const o = mastery.overall || { P1: 0, P2: 0, P3: 0, P4: 0 };
  const total = o.P1 + o.P2 + o.P3 + o.P4;
  if (!total) return <EmptyNote>No graded submissions yet.</EmptyNote>;
  return (
    <div>
      <PBars dist={o} />
      <div style={S.masteryLegend}>
        {['P1', 'P2', 'P3', 'P4'].map((k) => (
          <span key={k} style={S.masteryItem}>
            <span style={{ ...S.swatch, background: P_COLORS[k] }} />
            {k}: {fmtInt(o[k])} ({fmtPct(o[k] / total)})
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Styles (inline; scoped + theme-aware via <Style/>) ────────────────────────
function Style() {
  return (
    <style>{`
      :root { --bg:#f4f6fb; --panel:#fff; --text:#1a2436; --muted:#5b6b86; --grid:#e6eaf2; --border:#e6eaf2; }
      @media (prefers-color-scheme: dark) {
        :root { --bg:#0f1420; --panel:#171e2e; --text:#e8ecf4; --muted:#8b97ad; --grid:#232c40; --border:#232c40; }
      }
      body { margin:0; background:var(--bg); }
      .dm3a-sortable { cursor:pointer; user-select:none; }
      .dm3a-admin-tr:hover { background:rgba(40,96,200,0.04); }
    `}</style>
  );
}

const S = {
  page: { fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: 'var(--text)', background: 'var(--bg)', minHeight: '100vh', padding: '16px', maxWidth: 1200, margin: '0 auto', boxSizing: 'border-box' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 },
  headerRight: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  h1: { fontSize: 20, margin: 0, background: `linear-gradient(90deg, ${BRAND}, ${TEAL})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' },
  updated: { fontSize: 12, color: 'var(--muted)', marginTop: 2 },
  ghostBtn: { background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' },
  toggle: { display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  toggleBtn: { background: 'transparent', border: 'none', color: 'var(--muted)', padding: '6px 10px', fontSize: 13, cursor: 'pointer' },
  toggleBtnActive: { background: BRAND, color: '#fff' },

  errorBar: { background: '#fdecea', color: '#a3352b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 },
  emptyBanner: { background: 'rgba(40,96,200,0.08)', color: 'var(--text)', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13.5, lineHeight: 1.5 },

  cardRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 },
  card: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' },
  cardAccent: { background: `linear-gradient(135deg, ${BRAND}, ${TEAL})`, border: 'none' },
  cardLabel: { fontSize: 12, color: 'var(--muted)', marginBottom: 6 },
  cardValue: { fontSize: 24, fontWeight: 700, lineHeight: 1.1 },
  cardSub: { fontSize: 11.5, color: 'var(--muted)', marginTop: 4 },

  panel: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 },
  panelHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  panelTitle: { fontSize: 15, margin: 0, fontWeight: 700 },
  panelSub: { fontSize: 12, color: 'var(--muted)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 },

  empty: { color: 'var(--muted)', fontSize: 13, padding: '18px 4px', textAlign: 'center' },
  muted: { color: 'var(--muted)' },

  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '8px 10px', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid var(--border)' },
  tdR: { padding: '8px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap' },
  tdMono: { padding: '8px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 },

  pbarWrap: { display: 'flex', width: 110, height: 12, borderRadius: 6, overflow: 'hidden', background: 'var(--grid)' },

  costGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 },
  kv: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13.5, borderBottom: '1px dashed var(--border)' },
  kvTotal: { borderBottom: 'none', marginTop: 4, fontSize: 15 },
  pricingNote: { fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 },

  tip: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 14px rgba(0,0,0,0.12)' },
  tipDate: { color: 'var(--muted)', marginBottom: 4 },

  masteryLegend: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, fontSize: 13 },
  masteryItem: { display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text)' },
  swatch: { width: 12, height: 12, borderRadius: 3, display: 'inline-block' },

  footer: { textAlign: 'center', color: 'var(--muted)', fontSize: 12, padding: '16px 0 8px' },

  // Gate
  gateWrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(135deg, ${BRAND}, ${TEAL})`, fontFamily: 'system-ui, sans-serif', padding: 16 },
  gateCard: { background: '#fff', borderRadius: 16, padding: '32px 28px', width: 320, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', textAlign: 'center', boxSizing: 'border-box' },
  brandDot: { width: 44, height: 44, borderRadius: 12, margin: '0 auto 14px', background: `linear-gradient(135deg, ${BRAND}, ${TEAL})` },
  gateTitle: { margin: '0 0 2px', fontSize: 20, color: '#1a2436' },
  gateSub: { margin: '0 0 20px', fontSize: 13, color: '#5b6b86' },
  gateInput: { width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid #d7deea', fontSize: 15, boxSizing: 'border-box', marginBottom: 10 },
  gateErr: { color: '#a3352b', fontSize: 12.5, marginBottom: 10 },
  gateBtn: { width: '100%', padding: '11px 12px', borderRadius: 10, border: 'none', background: BRAND, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  gateHint: { fontSize: 11, color: '#8b97ad', marginTop: 14, marginBottom: 0 },
};
