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

const GOOGLE_FORM_URL = "https://forms.gle/bjDohfTU6FiGTGHs7";

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
      }}
    >
      <div style={{ background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: 4 }} />
      <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 4 }} />
      <div style={{ background: "#ffe4e6", border: "1px solid #fda4af", borderRadius: 4 }} />
      <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 4 }} />
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
      DM3A <span style={{ color: C.accent }}>Grader</span>™
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

export default function LandingPage({ onSignIn, onStudentStart }) {
  const [email, setEmail] = useState("");
  const [trialStatus, setTrialStatus] = useState("idle"); // idle | loading | success | error
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

  const handleTrialRequest = async () => {
    if (!email || !email.includes("@")) return;
    setTrialStatus("loading");
    try {
      const res = await fetch("https://dm3a-grader-production.up.railway.app/request-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.success) { setTrialStatus("success"); }
      else { setTrialStatus("error"); }
    } catch {
      setTrialStatus("error");
    }
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
          <Btn variant="outline" onClick={onStudentStart} style={{ padding: "8px 18px", fontSize: 14 }}>
            I'm a Student
          </Btn>
          <Btn variant="outline" onClick={onSignIn} style={{ padding: "8px 18px", fontSize: 14 }}>
            Sign In
          </Btn>
          <Btn onClick={scrollToWaitlist} style={{ padding: "8px 18px", fontSize: 14 }}>
            Start Free Trial
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
          You grade alone.{" "}
          <em style={{ color: C.accent, fontStyle: "italic" }}>Your students deserve better than a percentage.</em>
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
          DM3A Grader™ is the mastery-based grading tool built by a community college math professor — for instructors who grade alone, without institutional support.
        </p>

        {trialStatus === "success" ? (
          <div style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", borderRadius: 10, padding: "18px 28px", marginBottom: 32, color: "#065f46", fontSize: 16, fontWeight: 500 }}>
            ✓ Check your email for your trial password.
          </div>
        ) : (
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTrialRequest()}
                style={{ padding: "14px 18px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 15, fontFamily: "'DM Sans', sans-serif", minWidth: 220, outline: "none" }}
              />
              <Btn onClick={handleTrialRequest} style={{ padding: "14px 28px", fontSize: 15, whiteSpace: "nowrap" }}>
                {trialStatus === "loading" ? "Sending..." : "Start Free Trial →"}
              </Btn>
            </div>
            {trialStatus === "error" && (
              <p style={{ color: "#9f1239", fontSize: 13, margin: 0, textAlign: "center" }}>
                Something went wrong — email <a href="mailto:support@dm3agrader.com" style={{ color: "#9f1239" }}>support@dm3agrader.com</a>
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
              <Btn variant="outline" onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })} style={{ padding: "10px 22px", fontSize: 14 }}>
                See how it works
              </Btn>
              <Btn variant="outline" onClick={onStudentStart} style={{ padding: "10px 22px", fontSize: 14 }}>
                I'm a Student →
              </Btn>
            </div>
          </div>
        )}

        <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
          Validated across Elementary Statistics · Intermediate Algebra · Precalculus · 100+ student submissions graded
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
                  <th style={{ padding: "14px 20px", textAlign: "center", fontWeight: 700, color: C.accent, borderBottom: `1px solid ${C.border}` }}>DM3A Grader™</th>
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

      {/* ── FOUNDER SECTION ──────────────────────────────────────────── */}
      <section style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "80px 24px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 38,
              fontWeight: 400,
              margin: "0 0 24px",
              letterSpacing: "-0.01em",
              color: C.ink,
            }}
          >
            Built by a professor who still teaches your courses
          </h2>
          <p style={{ fontSize: 16, color: C.muted, lineHeight: 1.8, margin: "0 0 28px" }}>
            Dr. Ralph Minaya, Ed.D. is a mathematics professor at the University of Saint Joseph and Capital Community College. He built DM3A Grader™ because he needed it — grading Elementary Statistics and Intermediate Algebra sections alone, with no TA and no institutional grading support. He still teaches these courses every semester. When you send a feature request, you are talking directly to the person who will decide whether to build it — often by next semester.
          </p>
          <blockquote
            style={{
              margin: 0,
              padding: "20px 28px",
              borderLeft: `4px solid ${C.accent}`,
              background: "#eff6ff",
              borderRadius: "0 8px 8px 0",
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 18,
              fontStyle: "italic",
              color: C.ink,
              lineHeight: 1.7,
            }}
          >
            "Community college students — many of them first-generation, working full-time, balancing families — deserve individualized feedback. DM3A Grader™ gives instructors the time to provide it."
          </blockquote>
        </div>
      </section>

      {/* ── PRICING ──────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: C.surface }}>
        <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 38,
              fontWeight: 400,
              margin: "0 0 12px",
              letterSpacing: "-0.01em",
            }}
          >
            Founding Member Pricing
          </h2>
          <p style={{ color: C.muted, fontSize: 16, margin: "0 0 40px" }}>
            Simple, honest pricing. Your rate is locked permanently — no matter when you join.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
            <div
              style={{
                background: C.white,
                border: `2px solid ${C.accent}`,
                borderRadius: 16,
                padding: "32px 24px",
                textAlign: "center",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: -14,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: C.accent,
                  color: C.white,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "4px 14px",
                  borderRadius: 100,
                  whiteSpace: "nowrap",
                  letterSpacing: "0.04em",
                }}
              >
                FOUNDING 25 SPOTS
              </div>
              <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 52, fontWeight: 400, color: C.accent, lineHeight: 1 }}>$9</div>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 8 }}>/month</div>
              <div style={{ fontSize: 14, color: C.ink, fontWeight: 600 }}>First 25 subscribers</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Rate locked permanently</div>
            </div>
            <div
              style={{
                background: C.white,
                border: `1px solid ${C.border}`,
                borderRadius: 16,
                padding: "32px 24px",
                textAlign: "center",
              }}
            >
              <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 52, fontWeight: 400, color: C.muted, lineHeight: 1 }}>$12</div>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 8 }}>/month</div>
              <div style={{ fontSize: 14, color: C.ink, fontWeight: 600 }}>After 25 founding spots</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Rate locked permanently</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap", fontSize: 13, color: C.muted }}>
            {["No contract", "No institutional approval required", "Cancel anytime"].map(s => (
              <span key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: "#065f46", fontWeight: 700 }}>✓</span> {s}
              </span>
            ))}
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
          Your founding spot is waiting.
        </h2>
        <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 17, margin: "0 0 40px", maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>
          You are one of 25 founding members at $9/month. After 25 spots, the price becomes $12/month — but your rate is locked permanently either way.
        </p>

        {trialStatus === "success" ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: "20px 32px", color: C.white, fontSize: 17, fontWeight: 500 }}>
            ✓ Check your email for your trial password.
          </div>
        ) : (
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTrialRequest()}
                style={{ flex: 1, minWidth: 220, padding: "13px 18px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: C.white, fontSize: 15, fontFamily: "'DM Sans', sans-serif", outline: "none" }}
              />
              <Btn onClick={handleTrialRequest} style={{ padding: "13px 28px", fontSize: 15, whiteSpace: "nowrap" }}>
                {trialStatus === "loading" ? "Sending..." : "Start Free Trial"}
              </Btn>
            </div>
            {trialStatus === "error" && (
              <p style={{ color: "rgba(255,180,180,0.9)", fontSize: 13, marginTop: 10, textAlign: "center" }}>
                Something went wrong — email <a href="mailto:support@dm3agrader.com" style={{ color: "rgba(255,200,200,0.9)" }}>support@dm3agrader.com</a>
              </p>
            )}
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
        © 2026 DM3A Grader™ · support@dm3agrader.com · Built by Dr. Ralph Minaya, Ed.D.
        <div style={{ marginTop: 8, fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          DM3A Grader™ is a trademark of Ralph Minaya, Ed.D. Serial No. 99877914.
        </div>
      </footer>
    </div>
  );
}
