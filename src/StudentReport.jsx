// ─── STUDENT REPORT ─────────────────────────────────────────────────────────
// A second, student-facing rendering of a result the instructor has already
// reviewed. The instructor report (in App.jsx) is untouched; this one shows only
// what a student should see, so it can be screenshotted or attached in Blackboard.
//
// Deliberately absent: the "Note for instructor" box, the ⚑ Review badges and
// flag sentences (those address the instructor about cropping/legibility), the
// problem-inventory strip, the "Problems graded: N" line, and every edit control.
//
// FERPA: this file NEVER looks a name up. The caller resolves identity through
// the same reportIdentity() the instructor report uses and passes the finished
// string in `data.name` — there is no second name source in the app.
import { createPortal } from "react-dom";

// Same fonts and level colors as the instructor report — it has to read as the
// same product. Colors arrive in `data.colors` from App so there is one source.
const FONT = "'Georgia', 'Times New Roman', serif";

const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(#dm3a-sr-overlay) { display: none !important; }
  #dm3a-sr-overlay {
    position: static !important; inset: auto !important; display: block !important;
    background: #fff !important; padding: 0 !important; overflow: visible !important;
  }
  #dm3a-student-report {
    position: static !important; margin: 0 !important; width: auto !important;
    max-width: none !important; max-height: none !important; overflow: visible !important;
    box-shadow: none !important; border: 0 !important; border-radius: 0 !important;
    background: #fff !important; padding: 0 !important;
  }
  .dm3a-sr-noprint { display: none !important; }
  .dm3a-sr-avoid-break { break-inside: avoid; page-break-inside: avoid; }
}
`;

// ── The report itself (shared by the modal and the print view) ──────────────
export function StudentReportBody({ data }) {
  const { tierColor, tierBg, tierBorder } = data.colors;
  const badge = (t, big) => ({
    background: tierBg[t] || "#F5F5F0",
    color: tierColor[t] || "#333",
    border: `1px solid ${tierBorder[t] || "#DDD"}`,
    borderRadius: 4,
    padding: big ? "6px 20px" : "3px 10px",
    fontSize: big ? 26 : 13,
    fontWeight: 700,
    display: "inline-block",
  });

  return (
    <div id="dm3a-student-report" style={{
      fontFamily: FONT, color: "#1A1A18", background: "#fff",
      padding: "28px 32px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact",
    }}>
      {/* Header */}
      <div className="dm3a-sr-avoid-break" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, borderBottom: "2px solid #1A1A18", paddingBottom: 14, marginBottom: 20 }}>
        <div>
          <div style={{ background: "#1A1A18", color: "#F0EFE9", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 2, letterSpacing: "0.12em", textTransform: "uppercase", display: "inline-block" }}>
            DM3A Mastery Report
          </div>
          <h1 style={{ margin: "10px 0 4px", fontSize: 26, fontWeight: 400, letterSpacing: "-0.02em" }}>{data.name}</h1>
          <p style={{ margin: 0, fontSize: 13, color: "#5A5A55" }}>
            {data.assignment}
            {data.courseCode ? ` · ${data.courseCode}` : ""}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>Graded {data.dateGraded}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#888", marginBottom: 6, letterSpacing: "0.08em" }}>OVERALL</div>
          <span style={badge(data.overall, true)}>{data.overall}</span>
        </div>
      </div>

      {/* Dimensions — static text, no selectors */}
      {data.dimensions.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          {data.dimensions.map(d => (
            <div key={d.label} className="dm3a-sr-avoid-break" style={{ background: tierBg[d.level], border: `1px solid ${tierBorder[d.level]}`, borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, color: "#5A5A55", marginBottom: 4, fontWeight: 600 }}>{d.label.toUpperCase()}</div>
              <span style={{ color: tierColor[d.level], fontWeight: 700, fontSize: 18 }}>{d.level}</span>
            </div>
          ))}
        </div>
      )}

      {/* Problem breakdown — final (overridden) level, no flags, no dropdowns */}
      {data.problems.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5A5A55" }}>Problem Breakdown</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.problems.map((p, i) => (
              <div key={i} className="dm3a-sr-avoid-break" style={{ border: `1px solid ${tierBorder[p.level] || "#E8E6DE"}`, borderLeft: `4px solid ${tierColor[p.level] || "#888"}`, borderRadius: 6, padding: "10px 12px", background: "#FAFAF7" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 14, marginRight: 8 }}>Problem {p.id}</span>
                    <span style={{ fontSize: 12, color: "#5A5A55" }}>{p.description}</span>
                  </div>
                  <span style={badge(p.level)}>{p.level}</span>
                </div>
                {p.processAssessment && <div style={{ fontSize: 12, color: "#3A3A35", marginBottom: 4 }}><strong>Process:</strong> {p.processAssessment}</div>}
                {p.reasoning && <div style={{ fontSize: 12, color: "#5A5A55" }}>{p.reasoning}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Personalized feedback */}
      <div className="dm3a-sr-avoid-break" style={{ background: "#F5F4EF", borderRadius: 6, padding: "14px 16px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#5A5A55", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Personalized Feedback</div>
        {data.feedback && <p style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.6 }}>{data.feedback}</p>}
        {data.strengths.length > 0 && <div style={{ fontSize: 12, color: "#0F6E56" }}>✓ Strengths: {data.strengths.join(", ")}</div>}
        {data.growthAreas.length > 0 && <div style={{ fontSize: 12, color: "#185FA5", marginTop: 4 }}>→ Growth areas: {data.growthAreas.join(", ")}</div>}
      </div>
    </div>
  );
}

// ── Full-screen modal. Portalled to <body> so the print stylesheet can drop the
// rest of the app with `body > *:not(#dm3a-sr-overlay)` — visibility tricks leave
// the app's layout behind and print blank leading pages. ────────────────────────
export function StudentReportModal({ data, onClose, onDownload, downloading }) {
  if (!data) return null;
  return createPortal(
    <div id="dm3a-sr-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1500, overflowY: "auto", padding: 20 }}
      onClick={e => { if (e.target.id === "dm3a-sr-overlay") onClose(); }}>
      <style>{PRINT_CSS}</style>
      <div style={{ maxWidth: 780, margin: "0 auto", background: "#fff", borderRadius: 10, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden" }}>
        <div className="dm3a-sr-noprint" style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #E8E6DE", background: "#FAFAF7", fontFamily: FONT }}>
          <button type="button" onClick={onDownload} disabled={downloading}
            style={{ background: "#1A1A18", color: "#F0EFE9", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: downloading ? "default" : "pointer", opacity: downloading ? 0.6 : 1, fontFamily: FONT }}>
            {downloading ? "Building PDF…" : "⬇ Download PDF"}
          </button>
          <button type="button" onClick={() => window.print()}
            style={{ background: "transparent", color: "#1A1A18", border: "1px solid #1A1A18", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}>
            🖨 Print
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}
            style={{ background: "transparent", border: "1px solid #D8D6CE", borderRadius: 6, padding: "8px 14px", fontSize: 13, color: "#5A5A55", cursor: "pointer", fontFamily: FONT }}>
            ✕ Close
          </button>
        </div>
        <StudentReportBody data={data} />
      </div>
    </div>,
    document.body
  );
}
