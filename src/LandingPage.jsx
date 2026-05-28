import { useState, useEffect, useRef } from "react";

const C = {
  ink: "#1a1a2e",
  accent: "#2563eb",
  accent2: "#1d4ed8",
  surface: "#f8f7f4",
  muted: "#6b7280",
  border: "#e5e3df",
  white: "#ffffff",
};

const GOOGLE_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSf5uZLB9OEIyx-8azAWug3w7kafmUFTmC6us_zh6UR0BCqt8Q/viewform";

const Logo = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 3,
        width: 44,
        height: 44,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div style={{ background: "#065f46", borderRadius: 4 }} />
      <div style={{ background: "#1e40af", borderRadius: 4 }} />
      <div style={{ background: "#9f1239", borderRadius: 4 }} />
      <div style={{ background: "#92400e", borderRadius: 4 }} />
    </div>
    <span
      style={{
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontSize: 22,
        fontWeight: 400,
        color: C.ink,
        letterSpacing: "-0.01em",
      }}
    >
      DM3A <span style={{ color: C.accent }}>Grader</span>
    </span>
  </div>
);

const Btn = ({ children, onClick, variant = "primary", style = {} }) => {
  const base = {
    border: "none",
    borderRadius: 8,
    padding: "12px 24px",
    fontSize: 15,
    fontFamily: "'DM Sans', sans-serif",
    fontWeight: 600,
    cursor: "pointer",
    transition: "opacity 0.15s",
    ...style,
  };
  const variants = {
    primary: { background: C.accent, color: C.white },
    outline: {
      background: "transparent",
      color: C.ink,
      border: `1.5px solid ${C.border}`,
    },
    ghost: { background: "transparent", color: C.white, border: "1.5px solid rgba(255,255,255,0.3)" },
  };
  return (
    <button
      onClick={onClick}
      style={{ ...base, ...variants[variant] }}
      onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
      onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
    >
      {children}
    </button>
  );
};

export default function LandingPage({ onSignIn }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const waitlistRef = useRef(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch {} };
  }, []);

  const scrollToWaitlist = () =>
    waitlistRef.current?.scrollIntoView({ behavior: "smooth" });

  const handleWaitlist = () => {
    setSubmitted(true);
    window.open(GOOGLE_FORM_URL, "_blank");
  };

  const body = {
    fontFamily: "'DM Sans', sans-serif",
    background: C.surface,
    color: C.ink,
    margin: 0,
    padding: 0,
  };

  return (
    <div style={body}>
      {/* ── NAVBAR ───────────────────────────────────────────────────── */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: "rgba(248,247,244,0.92)",
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${C.border}`,
          padding: "0 32px",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Logo />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Btn variant="outline" onClick={onSignIn} style={{ padding: "8px 18px", fontSize: 14 }}>
            Sign In
          </Btn>
          <Btn onClick={scrollToWaitlist} style={{ padding: "8px 18px", fontSize: 14 }}>
            Join Waitlist
          </Btn>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section
        style={{
          paddingTop: 130,
          paddingBottom: 80,
          textAlign: "center",
          maxWidth: 760,
          margin: "0 auto",
          padding: "130px 24px 80px",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#dbeafe",
            color: C.accent2,
            borderRadius: 100,
            padding: "5px 14px",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 28,
            letterSpacing: "0.02em",
          }}
        >
          ✦ AI-Powered Mastery Grading
        </div>

        <h1
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: "clamp(42px, 7vw, 68px)",
            fontWeight: 400,
            lineHeight: 1.1,
            margin: "0 0 24px",
            color: C.ink,
            letterSpacing: "-0.02em",
          }}
        >
          Grade smarter.{" "}
          <em style={{ color: C.accent, fontStyle: "italic" }}>Not harder.</em>
        </h1>

        <p
          style={{
            fontSize: 19,
            color: C.muted,
            maxWidth: 560,
            margin: "0 auto 36px",
            lineHeight: 1.6,
            fontWeight: 400,
          }}
        >
          Upload your students' handwritten work — JPEGs, HEICs, PDFs — and get
          full P1–P4 mastery scores with personalized feedback in minutes.
        </p>

        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 32 }}>
          <Btn onClick={scrollToWaitlist} style={{ padding: "14px 32px", fontSize: 16 }}>
            Join Waitlist →
          </Btn>
          <Btn
            variant="outline"
            onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
            style={{ padding: "14px 28px", fontSize: 16 }}
          >
            See how it works
          </Btn>
        </div>

        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
          Tested across 3 college courses · 100+ student submissions graded
        </p>
      </section>

      {/* ── STATS ROW ────────────────────────────────────────────────── */}
      <section style={{ background: C.white, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            padding: "36px 24px",
            gap: 16,
          }}
        >
          {[
            { stat: "15×", label: "faster than manual grading" },
            { stat: "42", label: "problems graded in one run" },
            { stat: "P1–P4", label: "mastery scale, not just scores" },
            { stat: "JPEG · PDF", label: "any format students use" },
          ].map(({ stat, label }) => (
            <div key={stat} style={{ textAlign: "center", padding: "8px 0" }}>
              <div
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontSize: 36,
                  fontWeight: 400,
                  color: C.accent,
                  lineHeight: 1,
                  marginBottom: 6,
                }}
              >
                {stat}
              </div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.4 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────── */}
      <section id="how-it-works" style={{ padding: "80px 24px", maxWidth: 900, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 38,
            fontWeight: 400,
            textAlign: "center",
            margin: "0 0 12px",
            letterSpacing: "-0.01em",
          }}
        >
          How it works
        </h2>
        <p style={{ textAlign: "center", color: C.muted, fontSize: 16, margin: "0 0 48px" }}>
          From Blackboard download to graded feedback in four steps.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 20 }}>
          {[
            {
              n: "01",
              title: "Upload student work",
              desc: "Drag in JPEGs, HEICs, or PDFs directly from your Blackboard batch download.",
            },
            {
              n: "02",
              title: "Add your answer key",
              desc: "Upload your answer key PDF. The AI uses it to evaluate each student's responses.",
            },
            {
              n: "03",
              title: "Get mastery feedback",
              desc: "Each student gets P1–P4 scores per problem, with reasoning and growth feedback.",
            },
            {
              n: "04",
              title: "Grade the whole class",
              desc: "Grade 15–30 students in parallel in about 6 minutes. Download or export results.",
            },
          ].map(({ n, title, desc }) => (
            <div
              key={n}
              style={{
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 24,
              }}
            >
              <div
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontSize: 28,
                  color: C.accent,
                  marginBottom: 12,
                  lineHeight: 1,
                }}
              >
                {n}
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── MASTERY SCALE ────────────────────────────────────────────── */}
      <section style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "80px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 38,
              fontWeight: 400,
              textAlign: "center",
              margin: "0 0 12px",
              letterSpacing: "-0.01em",
            }}
          >
            The P1–P4 mastery scale
          </h2>
          <p style={{ textAlign: "center", color: C.muted, fontSize: 16, margin: "0 0 48px" }}>
            Every problem is graded on process, not just the final answer.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            {[
              { tier: "P4", pct: "90%+", label: "Mastery", desc: "Correct method, clear process, accurate answer.", bg: "#ecfdf5", border: "#a7f3d0", color: "#065f46" },
              { tier: "P3", pct: "80–89%", label: "Approaching", desc: "Sound reasoning with minor errors or gaps.", bg: "#eff6ff", border: "#bfdbfe", color: "#1e40af" },
              { tier: "P2", pct: "60–79%", label: "Developing", desc: "Partial understanding, significant gaps remain.", bg: "#fffbeb", border: "#fde68a", color: "#92400e" },
              { tier: "P1", pct: "Below 60%", label: "Beginning", desc: "Attempted but little correct reasoning shown.", bg: "#fff1f2", border: "#fecdd3", color: "#9f1239" },
            ].map(({ tier, pct, label, desc, bg, border, color }) => (
              <div
                key={tier}
                style={{
                  background: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 12,
                  padding: "24px 20px",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'Instrument Serif', Georgia, serif" }}>{tier}</span>
                  <span style={{ fontSize: 13, color, fontWeight: 600 }}>{pct}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 13, color, opacity: 0.8, lineHeight: 1.5 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARISON TABLE ─────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 38,
              fontWeight: 400,
              textAlign: "center",
              margin: "0 0 12px",
              letterSpacing: "-0.01em",
            }}
          >
            DM3A vs. the alternatives
          </h2>
          <p style={{ textAlign: "center", color: C.muted, fontSize: 16, margin: "0 0 40px" }}>
            Built for real classroom submissions, not ideal ones.
          </p>
          <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: C.surface }}>
                  <th style={{ padding: "14px 20px", textAlign: "left", fontWeight: 600, color: C.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}` }}>Feature</th>
                  <th style={{ padding: "14px 20px", textAlign: "center", fontWeight: 700, color: C.accent, borderBottom: `1px solid ${C.border}` }}>DM3A Grader</th>
                  <th style={{ padding: "14px 20px", textAlign: "center", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>Gradescope</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Accepts JPEGs & HEICs", "✓", "✗"],
                  ["No student formatting required", "✓", "✗"],
                  ["P1–P4 mastery scale", "✓", "✗"],
                  ["Reads handwriting on printed forms", "✓", "Partial"],
                  ["AI-powered partial credit reasoning", "✓", "Partial"],
                  ["Batch upload from Blackboard", "✓", "✗"],
                  ["Works without pre-defined regions", "✓", "✗"],
                ].map(([feature, dm3a, gs], i) => (
                  <tr key={i} style={{ borderBottom: i < 6 ? `1px solid ${C.border}` : "none" }}>
                    <td style={{ padding: "14px 20px", color: C.ink }}>{feature}</td>
                    <td style={{ padding: "14px 20px", textAlign: "center", color: "#065f46", fontWeight: 700 }}>{dm3a}</td>
                    <td style={{ padding: "14px 20px", textAlign: "center", color: dm3a === gs ? C.muted : "#9f1239", fontWeight: 500 }}>{gs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── WAITLIST ─────────────────────────────────────────────────── */}
      <section
        ref={waitlistRef}
        style={{
          background: C.ink,
          padding: "80px 24px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 42,
            fontWeight: 400,
            color: C.white,
            margin: "0 0 16px",
            letterSpacing: "-0.01em",
          }}
        >
          Ready to grade smarter?
        </h2>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 17, margin: "0 0 40px", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
          Join the waitlist and be first to access DM3A Grader when it opens to new instructors.
        </p>

        {submitted ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 12,
              padding: "20px 32px",
              color: C.white,
              fontSize: 17,
              fontWeight: 500,
            }}
          >
            ✓ You're on the list! We'll be in touch soon.
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "center",
              flexWrap: "wrap",
              maxWidth: 480,
              margin: "0 auto",
            }}
          >
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleWaitlist()}
              style={{
                flex: 1,
                minWidth: 220,
                padding: "13px 18px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.08)",
                color: C.white,
                fontSize: 15,
                fontFamily: "'DM Sans', sans-serif",
                outline: "none",
              }}
            />
            <Btn onClick={handleWaitlist} style={{ padding: "13px 28px", fontSize: 15, whiteSpace: "nowrap" }}>
              Join Waitlist
            </Btn>
          </div>
        )}
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────── */}
      <footer
        style={{
          background: C.ink,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "24px",
          textAlign: "center",
          fontSize: 13,
          color: "rgba(255,255,255,0.4)",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        © 2026 DM3A Grader · support@dm3agrader.com · Built by Dr. Ralph Minaya, Ed.D.
      </footer>
    </div>
  );
}
