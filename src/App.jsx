import { useState, useRef, useCallback } from "react";
import { PDFDocument } from "pdf-lib";

function extractJSON(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('extractJSON: received empty or non-string input');
  let cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`extractJSON: no valid JSON object found.\nRaw (first 300 chars): ${raw.slice(0, 300)}`);
  }
  const jsonStr = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`extractJSON: JSON.parse failed — ${e.message}\nExtracted: ${jsonStr.slice(0, 300)}`);
  }
}

// ── CONFIG ──────────────────────────────────────────────────────────────────
const AUTH_PASSWORD = "dmgof50c";

function PasswordGate({ children }) {
  const [input, setInput] = useState("");
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("dm3a_auth") === AUTH_PASSWORD);
  const [error, setError] = useState(false);
  if (authed) return children;
  return (
    <div style={{ minHeight:"100svh", display:"flex", alignItems:"center", justifyContent:"center", background:"#F7F6F3" }}>
      <div style={{ background:"#fff", borderRadius:16, padding:40, maxWidth:380, width:"100%", boxShadow:"0 4px 24px rgba(0,0,0,0.08)", textAlign:"center" }}>
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:2, color:"#0F6E56", marginBottom:8 }}>DM3A GRADER</div>
        <h2 style={{ fontSize:22, fontWeight:700, color:"#1A3A2A", margin:"0 0 8px" }}>Instructor Access</h2>
        <p style={{ fontSize:13, color:"#5F5E5A", margin:"0 0 24px" }}>Enter the access password to continue.</p>
        <input type="password" value={input} onChange={e=>{ setInput(e.target.value); setError(false); }} onKeyDown={e=>{ if(e.key==="Enter"){ if(input===AUTH_PASSWORD){ sessionStorage.setItem("dm3a_auth",AUTH_PASSWORD); setAuthed(true); } else setError(true); }}} placeholder="Password" style={{ width:"100%", padding:"10px 14px", borderRadius:8, border: error ? "1.5px solid #e53e3e" : "1.5px solid #D3D1C7", fontSize:14, boxSizing:"border-box", marginBottom:8, outline:"none" }} />
        {error && <p style={{ color:"#e53e3e", fontSize:12, margin:"0 0 8px" }}>Incorrect password. Try again.</p>}
        <button onClick={()=>{ if(input===AUTH_PASSWORD){ sessionStorage.setItem("dm3a_auth",AUTH_PASSWORD); setAuthed(true); } else setError(true); }} style={{ width:"100%", background:"#0F6E56", color:"#fff", border:"none", borderRadius:8, padding:"11px", fontSize:14, fontWeight:600, cursor:"pointer", marginTop:4 }}>Enter</button>
      </div>
    </div>
  );
}

const TIERS = [
  { id: "P4", label: "P4", desc: "Mastery",             color: "#0F6E56", bg: "#E1F5EE", pct: "90–100%" },
  { id: "P3", label: "P3", desc: "Approaching Mastery", color: "#185FA5", bg: "#E6F1FB", pct: "80–89%"  },
  { id: "P2", label: "P2", desc: "Developing",          color: "#854F0B", bg: "#FAEEDA", pct: "60–79%"  },
  { id: "P1", label: "P1", desc: "Beginning",           color: "#A32D2D", bg: "#FCEBEB", pct: "Below 60%" },
];
const SUBJECTS = ["Mathematics","Statistics","Algebra","Calculus","Science","English","History","Other"];
const ACCEPT = "application/pdf,image/jpeg,image/jpg,image/png,image/webp,image/gif";

// ── HELPERS ──────────────────────────────────────────────────────────────────
function tierColor(t) { return TIERS.find(x=>x.id===t)?.color || "#888"; }
function tierBg(t)    { return TIERS.find(x=>x.id===t)?.bg    || "#f5f5f5"; }

function Badge({ tier, size = 13 }) {
  const t = TIERS.find(x => x.id === tier);
  if (!t) return null;
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:5,
      background:t.bg, color:t.color,
      fontFamily:"'DM Mono',monospace", fontSize:size, fontWeight:600,
      padding:"3px 10px", borderRadius:20, letterSpacing:"0.04em",
      border:`1px solid ${t.color}33`, whiteSpace:"nowrap"
    }}>{t.label} · {t.desc}</span>
  );
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function isImage(file) { return file.type.startsWith("image/"); }
function isPDF(file)   { return file.type === "application/pdf"; }

async function splitPDF(file, pagesPerChunk) {
  const arrayBuffer = await file.arrayBuffer();
  const srcPdf = await PDFDocument.load(arrayBuffer);
  const totalPages = srcPdf.getPageCount();
  const chunks = [];
  for (let start = 0; start < totalPages; start += pagesPerChunk) {
    const end = Math.min(start + pagesPerChunk, totalPages);
    const chunkPdf = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copied = await chunkPdf.copyPages(srcPdf, indices);
    copied.forEach(p => chunkPdf.addPage(p));
    const bytes = await chunkPdf.save();
    const n = Math.floor(start / pagesPerChunk) + 1;
    chunks.push(new File([bytes], `${file.name}_student${n}.pdf`, { type: "application/pdf" }));
  }
  return chunks;
}

// ── PDF REPORT GENERATOR ─────────────────────────────────────────────────────
function generateStudentPDF(student, assignment, subject, instructor, overrideTier) {
  const displayTier = overrideTier || student.overallTier;
  const t = TIERS.find(x => x.id === displayTier) || TIERS[3];
  const date = new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});

  const problemRows = (student.problems || []).map(p => {
    const isCorrect = p.correct === true;
    const statusColor = isCorrect ? "#0F6E56" : "#A32D2D";
    const statusBg    = isCorrect ? "#E1F5EE" : "#FCEBEB";
    const statusLabel = isCorrect ? "Correct"  : "Wrong";
    return `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:'DM Mono',monospace;font-size:12px;color:#555;">${p.number||""}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;">${p.correctAnswer||""}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:'DM Mono',monospace;font-size:12px;color:#333;">${p.studentAnswer||"—"}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">
        <span style="background:${statusBg};color:${statusColor};font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;font-family:'DM Mono',monospace;">${statusLabel}</span>
      </td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px;color:#444;line-height:1.5;">${p.feedback||""}</td>
    </tr>
  `;
  }).join("");

  const patternItems = (student.patterns || []).map(p => `
    <div style="margin-bottom:12px;padding:10px 14px;background:#F9F8F5;border-left:3px solid #0F6E56;border-radius:4px;">
      <div style="font-weight:600;font-size:13px;color:#1a1a18;margin-bottom:4px;">${p.title||""}</div>
      <div style="font-size:12px;color:#444;line-height:1.6;">${p.detail||""}</div>
    </div>
  `).join("");

  const criteriaCards = (student.criteria || []).map(c => `
    <div style="background:${tierBg(c.tier)};border-radius:8px;padding:12px 14px;border:1px solid ${tierColor(c.tier)}22;">
      <div style="font-size:10px;color:${tierColor(c.tier)};text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">${c.name}</div>
      <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:600;color:${tierColor(c.tier)};">${c.tier}</div>
    </div>
  `).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>DM3A Report — ${student.studentName}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'DM Sans',sans-serif; color:#1a1a18; background:#fff; padding:48px; font-size:13px; }
  h1 { font-size:22px; font-weight:500; letter-spacing:-0.02em; }
  h2 { font-size:15px; font-weight:500; letter-spacing:-0.01em; margin:28px 0 12px; border-bottom:1px solid #E2E0D8; padding-bottom:8px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#888; padding:8px 10px; border-bottom:2px solid #E2E0D8; font-family:'DM Mono',monospace; }
  @media print { body { padding:24px; } }
</style>
</head>
<body>

<!-- HEADER -->
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #0F6E56;">
  <div>
    <div style="font-family:'DM Mono',monospace;font-size:10px;color:#0F6E56;letter-spacing:0.1em;margin-bottom:6px;">DM3A GRADER · MASTERY REPORT</div>
    <h1>${assignment}</h1>
    <div style="font-size:12px;color:#666;margin-top:4px;">${subject} · ${date}</div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:12px;color:#666;">${instructor || "Dr. Ralph Minaya, Ed.D."}</div>
    <div style="font-size:11px;color:#888;">University of Saint Joseph</div>
  </div>
</div>

<!-- STUDENT HEADER -->
<div style="display:flex;align-items:center;justify-content:space-between;background:#F9F8F5;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
  <div>
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">Student</div>
    <div style="font-size:20px;font-weight:500;">${student.studentName || "—"}</div>
  </div>
  <div style="text-align:center;">
    <div style="font-size:11px;color:#888;margin-bottom:4px;">OVERALL</div>
    <div style="background:${t.bg};color:${t.color};font-family:'DM Mono',monospace;font-size:28px;font-weight:600;padding:8px 20px;border-radius:10px;border:1px solid ${t.color}33;">${displayTier}</div>
    <div style="font-size:11px;color:${t.color};margin-top:4px;">${t.desc}</div>
  </div>
</div>

<!-- CRITERIA GRID -->
${student.criteria?.length ? `
<h2>Criteria Breakdown</h2>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px;">
  ${criteriaCards}
</div>` : ""}

<!-- MASTERY FEEDBACK -->
<h2>Mastery Feedback</h2>
<div style="background:#F0FAF5;border-left:3px solid #0F6E56;border-radius:4px;padding:14px 16px;margin-bottom:24px;font-size:13px;line-height:1.7;color:#1a1a18;">
  ${student.feedback || ""}
</div>

<!-- PROBLEM-BY-PROBLEM -->
${student.problems?.length ? `
<h2>Problem-by-Problem Results</h2>
<div style="margin-bottom:8px;display:flex;gap:16px;">
  <span style="font-size:12px;"><span style="font-family:'DM Mono',monospace;font-weight:600;color:#0F6E56;">Correct:</span> ${student.problems.filter(p=>p.correct===true).length}</span>
  <span style="font-size:12px;"><span style="font-family:'DM Mono',monospace;font-weight:600;color:#A32D2D;">Wrong:</span> ${student.problems.filter(p=>p.correct!==true).length}</span>
</div>
<table style="margin-bottom:24px;">
  <thead><tr>
    <th style="width:60px;">#</th>
    <th style="width:100px;">Correct Answer</th>
    <th style="width:100px;">Student Answer</th>
    <th style="width:80px;">Grade</th>
    <th>Feedback</th>
  </tr></thead>
  <tbody>${problemRows}</tbody>
</table>` : ""}

<!-- PATTERNS -->
${student.patterns?.length ? `
<h2>Patterns to Address</h2>
<div style="margin-bottom:24px;">${patternItems}</div>` : ""}

<!-- NEXT STEP -->
${student.growthNote ? `
<h2>Next Step</h2>
<div style="background:#E6F1FB;border-left:3px solid #185FA5;border-radius:4px;padding:14px 16px;margin-bottom:24px;font-size:13px;line-height:1.7;color:#1a1a18;">
  ${student.growthNote}
</div>` : ""}

<!-- REFLECTION -->
${student.reflectionPrompt ? `
<h2>Reflection Prompt</h2>
<div style="background:#FAEEDA;border-left:3px solid #854F0B;border-radius:4px;padding:14px 16px;margin-bottom:24px;font-size:13px;line-height:1.7;color:#1a1a18;font-style:italic;">
  ${student.reflectionPrompt}
</div>` : ""}

<!-- FOOTER -->
<div style="border-top:1px solid #E2E0D8;padding-top:16px;margin-top:32px;display:flex;justify-content:space-between;font-size:11px;color:#888;">
  <span>DM3A Mastery Scale · P4=Mastery · P3=Approaching Mastery · P2=Developing · P1=Beginning</span>
  <span>${instructor || "Dr. Ralph Minaya, Ed.D."}</span>
</div>

</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url, '_blank');
  if (win) {
    win.onload = () => { win.focus(); win.print(); };
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ── GRADING API CALL ──────────────────────────────────────────────────────────

const TIER_NUM = { P4: 4, P3: 3, P2: 2, P1: 1 };
const NUM_TIER = { 4: "P4", 3: "P3", 2: "P2", 1: "P1" };

function avgTier(tiersArr) {
  const nums = tiersArr.map(t => TIER_NUM[t] || 2);
  return NUM_TIER[Math.max(1, Math.min(4, Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)))];
}

function mergeStudentChunks(chunks) {
  if (chunks.length === 0) return { studentName: "Unknown", overallTier: "P1", feedback: "Grading incomplete." };
  if (chunks.length === 1) return chunks[0];

  const studentName = chunks.find(c => c.studentName?.trim())?.studentName || "Unknown";
  const overallTier = avgTier(chunks.map(c => c.overallTier).filter(Boolean));

  const criteriaMap = {};
  chunks.forEach(c => (c.criteria || []).forEach(cr => {
    (criteriaMap[cr.name] = criteriaMap[cr.name] || []).push(cr.tier);
  }));
  const criteria = Object.entries(criteriaMap).map(([name, tiers]) => ({ name, tier: avgTier(tiers) }));

  const problems = chunks.flatMap(c => c.problems || []);

  const seenPatterns = new Set();
  const patterns = chunks.flatMap(c => c.patterns || []).filter(p => {
    if (seenPatterns.has(p.title)) return false;
    seenPatterns.add(p.title);
    return true;
  });

  const feedback = chunks.map(c => c.feedback).filter(Boolean).join(" ");
  const growthNote = chunks.map(c => c.growthNote).filter(Boolean).join(" ");
  const reflectionPrompt = chunks.find(c => c.reflectionPrompt)?.reflectionPrompt || "";

  return { studentName, overallTier, criteria, problems, patterns, feedback, growthNote, reflectionPrompt };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function compressImage(file) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX_DIM = 1024;
      let { width, height } = img;
      if (width > height && width > MAX_DIM) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM; }
      else if (height > MAX_DIM) { width = Math.round(width * MAX_DIM / height); height = MAX_DIM; }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.65);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function gradeFile(file, { subject, assignment, rubric, criteria, pagesPerStudent, gradingMode }, extraFiles = []) {
  const isImg = isImage(file);
  let b64, finalMimeType, pageCount = null;

  if (!isImg) {
    const arrayBuffer = await file.arrayBuffer();
    try {
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      pageCount = pdfDoc.getPageCount();
    } catch (e) { /* non-critical */ }
    b64 = arrayBufferToBase64(arrayBuffer);
    finalMimeType = 'application/pdf';
  } else {
    const compressed = await compressImage(file);
    b64 = await fileToBase64(compressed);
    finalMimeType = 'image/jpeg';
  }
  // Prepare extra pages for combined grading
  const extraBlocks = await Promise.all(extraFiles.map(async (ef) => {
    if (isImage(ef)) {
      const efGrade = await compressImage(ef);
      const efB64 = await fileToBase64(efGrade);
      return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: efB64 } };
    } else {
      const efBuffer = await ef.arrayBuffer();
      const efB64 = arrayBufferToBase64(efBuffer);
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: efB64 } };
    }
  }));

  const isSummative = gradingMode === "summative";

  const systemPrompt = `START YOUR RESPONSE WITH { AND NOTHING ELSE. NO PREAMBLE, NO COMMENTARY, NO MARKDOWN. ONLY RAW JSON.

CRITICAL: Output ONLY the JSON object. Zero text before {. Zero text after }. No 'Looking at', no 'Here is', no markdown. Just raw JSON.

CRITICAL: Your response must contain ONLY a JSON object. Do not write ANY text before or after the JSON. Do not say 'Looking at', 'Here is', 'Based on', or any other preamble. Start your response with { and end with }.

You are DM3A Grader — an expert AI grading assistant developed by Dr. Ralph Minaya, Ed.D. You grade student work strictly against the provided answer key using the DM3A Mastery Scale.

DM3A MASTERY SCALE:
- P4 = Mastery: All or nearly all answers correct; complete, accurate work shown.
- P3 = Approaching Mastery: Strong work with minor gaps that do not compromise overall understanding.
- P2 = Developing: Partial understanding; key concepts present but work is incomplete or inconsistent.
- P1 = Beginning: Significant gaps; foundational reteaching needed.

GRADING MODE: ${isSummative ? "SUMMATIVE (STRICT)" : "FORMATIVE (SUPPORTIVE)"}

ANSWER-KEY GRADING RULES — apply to every problem:
1. Compare each student answer EXACTLY against the answer key provided in the rubric or assignment instructions.
2. For multiple choice: the selected letter must match the correct letter exactly — no exceptions.
3. For open-ended: the final answer must be mathematically equivalent to the answer key. Equivalent forms (e.g., 1/2 and 0.5) count as correct.
4. Do NOT give credit for "showing understanding" if the final answer is wrong.
5. Do NOT infer intent or give benefit of the doubt on wrong answers.
6. Partial credit is ONLY allowed when (a) the rubric explicitly states partial credit is available AND (b) the student shows correct work steps with only a minor arithmetic error on the final step.
7. If no answer key is provided in the rubric, state this clearly in the overall feedback and do NOT assign scores above P2 for any criterion.
8. In each problem's feedback, explicitly state what was expected vs. what was written for every wrong answer (e.g., "Expected: B · Student wrote: C").
9. The feedback for a WRONG answer must NEVER begin with the word "Correct". Start directly with the error (e.g., "Expected: 3/4 · Student wrote: 4/3. The numerator and denominator were flipped.").

MULTIPLE CHOICE LETTER READING — handwriting accuracy rules:
- Identify the selected answer by its POSITION in the answer list, not by reading the shape of the circled or bubbled letter.
- A = first option listed, B = second option, C = third option, D = fourth option.
- The circle or bubble may be imperfect, bleed into adjacent letters, or look ambiguous — always use position as the primary signal, not letter shape.
- POSITION IS ABSOLUTE: if the student marks the second option listed, that is B — even if the circled letter looks like an A, C, or any other shape. Never override position with letter-shape recognition.
- CRITICAL — DO NOT assume first = A by default: Never assume that a mark placed near the top of the answer list, or near the printed label "A", automatically means the student chose A. Count position from the top of the answer list every time. If the mark is on the second option, that is B — regardless of how the letter label looks or what letter shape appears to be circled.
- B vs C DISAMBIGUATION (extremely common error): The letters B and C look very similar when handwritten or circled. DO NOT rely on letter shape to distinguish them. COUNT THE POSITION from the top: if the mark is on the 2nd option = B. If the mark is on the 3rd option = C. Re-verify your answer by counting options from the top before recording B or C in your response.
- MANDATORY POSITION-COUNT PROTOCOL: For EVERY multiple choice answer you record, follow this 3-step verification:
  1. Locate the circled/marked option in the vertical list of choices
  2. Count down from the top: 1st option = A, 2nd = B, 3rd = C, 4th = D
  3. Record the letter that matches that position number (ignore what the handwritten letter "looks like")
- Never guess: if the selected option is truly ambiguous even by position, report the student's answer as "unclear" in the feedback.

HANDWRITTEN MATH EXPRESSION READING — accuracy rules:
- Read condensed mathematical expressions carefully, character by character. Do not skim or pattern-match loosely.
- Small superscripts written next to a variable are exponents, not separate multiplied numbers (e.g., x² means x-squared, not x times 2).
- COEFFICIENT vs EXPONENT: a digit written before a variable is a coefficient; a digit written as a superscript after the variable is an exponent. Never merge them. "3x²" = 3 · x² (three times x-squared), NOT 32 · x or 3x² read as "thirty-two x". The coefficient and the exponent are always separate values.
- For logarithm expressions, read base, argument, exponents, and coefficients exactly as written. log₄(3x²/y) is a valid condensed form — the 3 is the coefficient of x² inside the argument, not part of the exponent. Do not misread the base, exponent, or coefficient.
- If a student's final answer is mathematically equivalent to the answer key (e.g., same expression in a different but valid form), mark it correct even if intermediate notation differs slightly.
- When in doubt about a character, consider the mathematical context (e.g., a small raised mark next to a variable is almost certainly an exponent).

FINAL ANSWER vs INTERMEDIATE WORK — open-ended grading rules:
- Always grade the FINAL answer, not intermediate steps.
- The final answer is the last clearly written result — look for it at the end of the work, after the last equals sign in the solution chain, or wherever the student wrote the concluding value (e.g., "x = 14").
- A boxed, circled, or underlined value is a strong signal that it is the intended final answer.
- If a student writes intermediate steps (e.g., "2x - 1 = 27") and then concludes with a final answer (e.g., "x = 14"), grade the final answer only — do NOT penalize based on an intermediate expression.
- SOLVE-FOR-X RULE: For any problem that asks the student to solve for a variable, the ONLY valid final answer form is "x = [number]" (or the relevant variable = value). An algebraic equation such as "2x - 1 = 27" or "2x = 28" is an intermediate step in the solving process — it is NEVER a final answer. Do not record an equation form as the student's final answer for a solve-for-x problem; keep reading until you find the "x = …" conclusion.
- Only reference intermediate steps in feedback when explaining how the student arrived at a wrong final answer.

${isSummative
  ? `SUMMATIVE MODE — zero tolerance:
- Wrong final answers receive NO partial credit, regardless of work shown.
- Sign errors, transcription errors, and arithmetic mistakes all count as wrong answers.
- Mark a problem correct: false whenever the final answer does not match the key exactly.
- The overall tier must reflect the exact proportion of problems answered correctly.`
  : `FORMATIVE MODE — growth-oriented:
- Acknowledge correct reasoning steps even when the final answer is wrong.
- Provide specific, encouraging feedback that identifies what the student understood.
- Partial credit may be awarded for well-supported work with minor errors if the rubric allows.
- Focus feedback on what to study next.`}

SCAN QUALITY: Even if the scan is light, faded, or low contrast — do your best to read and grade the work. Never refuse due to image quality. If a problem is truly unreadable, note it in feedback and score P1.

STUDENT IDENTIFICATION: ${pagesPerStudent === "all" ? "The ENTIRE file is ONE single student's submission — treat every page as belonging to one student. Return a JSON array with exactly ONE student object." : `Each student submission is ${pagesPerStudent} page(s). Identify each student by name if visible.`}

FULL COVERAGE REQUIREMENT: When this submission spans multiple sections (e.g., Section I, Section II, Section III), you MUST grade EVERY section on EVERY page without exception. Never stop after completing one section — continue reading and grading through to the very last page. The "problems" array must include a result entry for every numbered problem that appears on any page of this submission. Stopping early or omitting the final section is a grading error.

For each student provide:
- Overall tier (P4/P3/P2/P1) based strictly on answer accuracy
- Criteria breakdown (one tier per criterion from the rubric)
- Problem-by-problem results: for each problem set correct: true or correct: false (never a tier label), with explicit right/wrong notation in feedback
- Pattern analysis (recurring error types observed)
- 2–3 sentences of individualized narrative feedback
- One specific growth next step
- A reflection prompt the student should answer before the next class

Respond ONLY with a valid JSON array. Your ENTIRE response must be ONLY the JSON array — starting with [ and ending with ]. No commentary before or after. No markdown code blocks. No "Looking at" or "Here is" or any other preamble. JUST THE JSON ARRAY.

Each student object must follow this schema exactly:
{
  "studentName": string,
  "overallTier": "P4"|"P3"|"P2"|"P1",
  "criteria": [{"name": string, "tier": "P4"|"P3"|"P2"|"P1"}],
  "problems": [{"number": string, "correctAnswer": string, "studentAnswer": string, "correct": boolean, "feedback": string}],
  "patterns": [{"title": string, "detail": string}],
  "feedback": string,
  "growthNote": string,
  "reflectionPrompt": string
}

CRITICAL — "studentAnswer" field requirement:
- For multiple choice questions, the "studentAnswer" field must contain the letter that corresponds to the POSITION the student marked, not the letter shape you perceive.
- Before recording "studentAnswer" for any MC question, mentally re-count: 1st option = A, 2nd = B, 3rd = C, 4th = D.
- If you find yourself recording "B" or "C" as the studentAnswer, STOP and re-verify by counting position from the top. B and C are commonly confused due to similar letter shapes.

If problems are not individually numbered, leave "problems" as an empty array [].
Always return an array even for a single student.

CRITICAL: Output ONLY the JSON object. Zero text before {. Zero text after }. No 'Looking at', no 'Here is', no markdown. Just raw JSON.`;

  const userPrompt = extraFiles && extraFiles.length > 0
    ? `Subject: ${subject}\nAssignment: ${assignment}\nGrading Criteria: ${criteria.join(", ")}\nRubric: ${rubric}\n\nAll ${extraFiles.length + 1} files belong to ONE single student. Treat them as pages of the same submission. Return a JSON array with exactly ONE student object.`
    : pagesPerStudent === "all"
    ? `Subject: ${subject}\nAssignment: ${assignment}\nGrading Criteria: ${criteria.join(", ")}\nRubric: ${rubric}\n\nThis entire file is ONE single student's submission. Return a JSON array with exactly ONE student object.`
    : `Subject: ${subject}\nAssignment: ${assignment}\nGrading Criteria: ${criteria.join(", ")}\nRubric: ${rubric}\n\nGrade every student submission in this ${isImg ? "image" : "PDF"}. Be comprehensive — include problem-level detail where visible.`;

  console.log("[DM3A] → API request", {
    fileName: file.name,
    fileSizeMB: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
    pageCount,
    estimatedPayloadKB: `~${Math.round(b64.length * 0.75 / 1024)} KB`,
    mimeType: finalMimeType,
    pagesPerStudent,
    subject,
    assignment,
  });

  const contentBlock = isImg
    ? { type: "image", source: { type: "base64", media_type: finalMimeType, data: b64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: [contentBlock, ...extraBlocks, { type: "text", text: userPrompt }] }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `API error ${res.status}`;
    console.error("[DM3A] ← API error", res.status, msg);
    throw new Error(msg);
  }

  const data = await res.json();
  const responseText = data.content?.find(b => b.type === "text")?.text || "";

  console.log("[DM3A] ← API response (first 400 chars):", responseText.slice(0, 400));

  const parsed = extractJSON(responseText);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ── FILE CARD ─────────────────────────────────────────────────────────────────
function FileCard({ file, status, result, onRemove }) {
  const icon = isImage(file) ? "🖼" : "📄";
  const statusColor = { pending:"#888", processing:"#185FA5", done:"#0F6E56", error:"#A32D2D" }[status];
  const statusLabel = { pending:"Queued", processing:"Grading…", done:"Done", error:"Failed" }[status];

  return (
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"space-between",
      background:"#F9F8F5", borderRadius:10, padding:"10px 14px",
      border:"0.5px solid #D3D1C7"
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:18 }}>{icon}</span>
        <div>
          <div style={{ fontSize:13, fontWeight:500, color:"#2C2C2A" }}>{file.name}</div>
          <div style={{ fontSize:11, color:"#888" }}>
            {(file.size/1024/1024).toFixed(1)} MB
            {result ? ` · ${result.length} student${result.length!==1?"s":""}` : ""}
          </div>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:11, fontWeight:600, color:statusColor, fontFamily:"'DM Mono',monospace" }}>
          {status==="processing" ? "⏳ " : ""}{statusLabel}
        </span>
        {status==="pending" && (
          <button onClick={onRemove} style={{ background:"none", border:"none", cursor:"pointer", color:"#B4B2A9", fontSize:16 }}>×</button>
        )}
      </div>
    </div>

  );
}
function StudentCard({ student, assignment, subject, instructor, idx, onViewReport, overrideTier }) {
  const displayLevel = overrideTier || student.overallTier;
  const tier = TIERS.find(t => t.id === displayLevel) || TIERS[3];
  return (
    <div style={{ background:"#fff", border:"1px solid #E8E6E1", borderRadius:12, padding:20, textAlign:"left" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:"#1A3A2A" }}>{student.studentName || `Student ${idx+1}`}</div>
          <div style={{ fontSize:12, color:"#5F5E5A" }}>{subject} · {assignment}</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {overrideTier && <span style={{ fontSize:11, color:"#854F0B" }}>✎</span>}
          <div style={{ background:tier.bg, color:tier.color, fontWeight:700, fontSize:18, borderRadius:8, padding:"6px 14px" }}>{tier.id}</div>
        </div>
      </div>
      {student.feedback && <p style={{ fontSize:13, color:"#444", margin:"0 0 10px" }}>{student.feedback}</p>}
      {student.growthNote && <p style={{ fontSize:12, color:"#666", fontStyle:"italic", margin:"0 0 12px" }}>Next step: {student.growthNote}</p>}
      <div style={{ textAlign:"right" }}>
        <button
          onClick={onViewReport}
          style={{ background:"none", border:"1px solid #D3D1C7", borderRadius:6, padding:"5px 12px", fontSize:12, color:"#5F5E5A", cursor:"pointer", fontWeight:500 }}
        >
          View Report →
        </button>
      </div>
    </div>
  );
}

function StudentDetailView({ student, assignment, subject, instructor, gradeOverrides, setGradeOverrides, setSelectedStudent }) {
  const override = gradeOverrides[student.studentName];
  const displayLevel = override || student.overallTier;
  const t = TIERS.find(x => x.id === displayLevel) || TIERS[3];
  const date = new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });

  function setOverride(level) {
    setGradeOverrides(prev => ({ ...prev, [student.studentName]: level }));
  }

  const correctCount = (student.problems || []).filter(p => p.correct === true).length;
  const wrongCount   = (student.problems || []).filter(p => p.correct !== true).length;

  return (
    <div>
      <button
        onClick={() => setSelectedStudent(null)}
        style={{ background:"none", border:"none", cursor:"pointer", color:"#0F6E56", fontSize:13, fontWeight:600, padding:"0 0 20px", display:"flex", alignItems:"center", gap:6 }}
      >
        ← Back to Summary
      </button>

      <div style={{ background:"#F9F8F5", borderRadius:12, padding:"20px 24px", marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:22, fontWeight:700, color:"#1A3A2A", marginBottom:4 }}>{student.studentName || "Unknown"}</div>
          <div style={{ fontSize:13, color:"#5F5E5A" }}>{subject} · {assignment} · {date}</div>
        </div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:11, color:"#888", marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em" }}>Overall</div>
          <div style={{ background:t.bg, color:t.color, fontFamily:"'DM Mono',monospace", fontSize:26, fontWeight:700, padding:"8px 20px", borderRadius:10, border:`1px solid ${t.color}33` }}>{displayLevel}</div>
          <div style={{ fontSize:11, color:t.color, marginTop:4 }}>{t.desc}</div>
        </div>
      </div>

      <div style={{ marginBottom:20, padding:"16px 20px", background:"#fff", border:"1px solid #E8E6E1", borderRadius:10 }}>
        <div style={{ fontSize:11, fontWeight:600, color:"#5F5E5A", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:10 }}>Override Grade</div>
        <div style={{ display:"flex", gap:8, marginBottom: override ? 10 : 0 }}>
          {[...TIERS].reverse().map(tier => (
            <button
              key={tier.id}
              onClick={() => setOverride(tier.id)}
              style={{
                flex:1, padding:"8px 4px", borderRadius:8, cursor:"pointer",
                fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:600,
                background: displayLevel === tier.id ? tier.bg : "#F9F8F5",
                color: displayLevel === tier.id ? tier.color : "#888",
                border: displayLevel === tier.id ? `1.5px solid ${tier.color}` : "1px solid #D3D1C7",
              }}
            >
              {tier.id}
            </button>
          ))}
        </div>
        {override && (
          <div style={{ fontSize:12, color:t.color, fontWeight:500 }}>
            Override: {override} ({t.desc})
          </div>
        )}
      </div>

      {student.criteria?.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:600, color:"#1A3A2A", marginBottom:10, paddingBottom:6, borderBottom:"1px solid #E2E0D8" }}>Criteria Breakdown</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10 }}>
            {student.criteria.map((c, i) => {
              const ct = TIERS.find(x => x.id === c.tier) || TIERS[3];
              return (
                <div key={i} style={{ background:ct.bg, borderRadius:8, padding:"12px 14px", border:`1px solid ${ct.color}22` }}>
                  <div style={{ fontSize:10, color:ct.color, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6 }}>{c.name}</div>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:20, fontWeight:700, color:ct.color }}>{c.tier}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {student.feedback && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:600, color:"#1A3A2A", marginBottom:10, paddingBottom:6, borderBottom:"1px solid #E2E0D8" }}>Mastery Feedback</div>
          <div style={{ background:"#F0FAF5", borderLeft:"3px solid #0F6E56", borderRadius:4, padding:"14px 16px", fontSize:13, lineHeight:1.7, color:"#1a1a18" }}>
            {student.feedback}
          </div>
        </div>
      )}

      {student.problems?.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:600, color:"#1A3A2A", marginBottom:6, paddingBottom:6, borderBottom:"1px solid #E2E0D8" }}>Problem-by-Problem Results</div>
          <div style={{ display:"flex", gap:16, marginBottom:10 }}>
            <span style={{ fontSize:12 }}><span style={{ fontFamily:"'DM Mono',monospace", fontWeight:600, color:"#0F6E56" }}>Correct:</span> {correctCount}</span>
            <span style={{ fontSize:12 }}><span style={{ fontFamily:"'DM Mono',monospace", fontWeight:600, color:"#A32D2D" }}>Wrong:</span> {wrongCount}</span>
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr>
                  {["#","Correct Answer","Student Answer","Grade","Feedback"].map(h => (
                    <th key={h} style={{ textAlign:"left", fontSize:11, textTransform:"uppercase", letterSpacing:"0.05em", color:"#888", padding:"8px 10px", borderBottom:"2px solid #E2E0D8", fontFamily:"'DM Mono',monospace", whiteSpace:"nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {student.problems.map((p, i) => (
                  <tr key={i} style={{ borderBottom:"1px solid #F0EEE8" }}>
                    <td style={{ padding:"8px 10px", fontFamily:"'DM Mono',monospace", color:"#555" }}>{p.number || i+1}</td>
                    <td style={{ padding:"8px 10px" }}>{p.correctAnswer || ""}</td>
                    <td style={{ padding:"8px 10px", fontFamily:"'DM Mono',monospace", color:"#333" }}>{p.studentAnswer || "—"}</td>
                    <td style={{ padding:"8px 10px" }}>
                      <span style={{
                        background: p.correct ? "#E1F5EE" : "#FCEBEB",
                        color: p.correct ? "#0F6E56" : "#A32D2D",
                        fontSize:11, fontWeight:600, padding:"2px 8px", borderRadius:10,
                        fontFamily:"'DM Mono',monospace", whiteSpace:"nowrap"
                      }}>
                        {p.correct ? "Correct" : "Wrong"}
                      </span>
                    </td>
                    <td style={{ padding:"8px 10px", color:"#444", lineHeight:1.5 }}>{p.feedback || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop:8 }}>
        <button
          onClick={() => generateStudentPDF(student, assignment, subject, instructor, override)}
          style={{ padding:"10px 20px", borderRadius:8, border:"none", background:"#0F6E56", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer" }}
        >
          ↓ Download PDF
        </button>
      </div>
    </div>
  );
}


// ── MAIN APP ──────────────────────────────────────────────────────────────────
function DM3AApp() {
  const [files, setFiles]           = useState([]);
  const [fileStatuses, setFileStatuses] = useState({});
  const [fileResults, setFileResults]   = useState({});
  const [subject, setSubject]       = useState("Statistics");
  const [assignment, setAssignment] = useState("");
  const [rubric, setRubric]         = useState("");
  const [instructor, setInstructor] = useState("Dr. Ralph Minaya, Ed.D.");
  const [criteria, setCriteria]     = useState(["Conceptual Understanding","Problem Solving","Work Shown","Accuracy"]);
  const [newCrit, setNewCrit]       = useState("");
  const [pagesPerStudent, setPagesPerStudent] = useState(2);
  const [step, setStep]             = useState("setup"); // setup | grading | results
  const [error, setError]           = useState("");
  const [gradingProgress, setGradingProgress] = useState("");
  const [gradingErrors, setGradingErrors]     = useState([]);
  const [drag, setDrag]             = useState(false);
  const [combineImages, setCombineImages] = useState(false);
  const [gradingMode, setGradingMode] = useState("formative");
  const gradingModeManualRef = useRef(false);
  const [showDM3AModal, setShowDM3AModal] = useState(() => {
    return !localStorage.getItem('dm3a_modal_seen');
  });
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(() => {
    return !sessionStorage.getItem('dm3a_disclaimer_accepted');
  });
  const fileRef = useRef();
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [gradeOverrides, setGradeOverrides]   = useState({});

  const allStudents = Object.values(fileResults).flat();
  const tierCounts  = TIERS.map(t => ({ ...t, count: allStudents.filter(s => s.overallTier === t.id).length }));

  function handleAssignmentChange(val) {
    setAssignment(val);
    if (!gradingModeManualRef.current) {
      setGradingMode(/quiz|exam|test/i.test(val) ? "summative" : "formative");
    }
  }

  function addFiles(newFiles) {
    const valid = Array.from(newFiles).filter(f => isImage(f) || isPDF(f));
    if (valid.length === 0) { setError("Only PDF and image files (JPG, PNG) are accepted."); return; }
    setError("");
    setFiles(prev => {
      const existingNames = new Set(prev.map(f=>f.name));
      return [...prev, ...valid.filter(f=>!existingNames.has(f.name))];
    });
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_,i) => i !== idx));
  }

  function addCriteria() {
    if (newCrit.trim() && criteria.length < 6) {
      setCriteria(prev => [...prev, newCrit.trim()]);
      setNewCrit("");
    }
  }

  async function startGrading() {
    if (files.length === 0) { setError("Please upload at least one file."); return; }
    const oversized = files.filter(f => f.size > 25 * 1024 * 1024);
    if (oversized.length > 0) {
      setError(`File too large: ${oversized.map(f => f.name).join(", ")}. Exceeds the 25 MB limit — split it or use images instead.`);
      return;
    }
    if (!assignment.trim())  { setError("Please enter an assignment name."); return; }
    if (!rubric.trim())      { setError("Please describe your rubric."); return; }

    setError("");
    setGradingErrors([]);
    setGradingProgress("");
    setStep("grading");
    setFileStatuses({});
    setFileResults({});

    const params = { subject, assignment, rubric, criteria, pagesPerStudent, gradingMode };
    let globalStudentCount = 1;

    if (combineImages && files.length > 1) {
      // All files = one student's multi-page submission
      files.forEach(f => setFileStatuses(prev => ({ ...prev, [f.name]: "processing" })));
      setGradingProgress("Grading combined submission…");
      try {
        console.log("[DM3A] Combining files as one student:", files.map(f => f.name));
        const results = await gradeFile(files[0], params, files.slice(1));
        setFileResults(prev => ({ ...prev, [files[0].name]: results }));
        files.forEach(f => setFileStatuses(prev => ({ ...prev, [f.name]: "done" })));
      } catch (e) {
        files.forEach(f => setFileStatuses(prev => ({ ...prev, [f.name]: "error" })));
        setGradingErrors(prev => [...prev, `Failed to grade combined submission: ${e.message}`]);
        console.error("[DM3A] Combined grading error:", e);
      }

    } else {
      for (const file of files) {
        if (isPDF(file) && pagesPerStudent !== "all") {
          // ── BULK PDF MODE: split PDF into per-student chunks ──
          setFileStatuses(prev => ({ ...prev, [file.name]: "processing" }));
          setGradingProgress(`Splitting ${file.name}…`);

          let chunks;
          try {
            chunks = await splitPDF(file, Number(pagesPerStudent));
            console.log(`[DM3A] Split ${file.name} into ${chunks.length} chunk(s) of ${pagesPerStudent} page(s) each`);
          } catch (e) {
            setFileStatuses(prev => ({ ...prev, [file.name]: "error" }));
            setGradingErrors(prev => [...prev, `Failed to split "${file.name}": ${e.message}`]);
            console.error("[DM3A] PDF split error:", e);
            continue;
          }

          const fileResults = [];
          for (let i = 0; i < chunks.length; i++) {
            const studentLabel = `Student ${globalStudentCount}`;
            setGradingProgress(`Grading ${studentLabel} of ${chunks.length} from "${file.name}"… (${i + 1}/${chunks.length})`);
            console.log(`[DM3A] Grading chunk ${i + 1}/${chunks.length} from ${file.name}`);

            try {
              const chunkResults = await gradeFile(chunks[i], { ...params, pagesPerStudent: "all" });
              const named = chunkResults.map(s => ({
                ...s,
                studentName: (s.studentName && s.studentName.trim()) ? s.studentName : studentLabel,
              }));
              globalStudentCount += named.length;
              fileResults.push(...named);
            } catch (e) {
              setGradingErrors(prev => [...prev, `Failed to grade ${studentLabel} (chunk ${i + 1}/${chunks.length} of "${file.name}"): ${e.message}`]);
              console.error(`[DM3A] Chunk ${i + 1} error:`, e);
              globalStudentCount++;
            }
          }

          setFileResults(prev => ({ ...prev, [file.name]: fileResults }));
          setFileStatuses(prev => ({ ...prev, [file.name]: fileResults.length > 0 ? "done" : "error" }));

        } else {
          // ── SINGLE-FILE MODE (image, or PDF with pagesPerStudent="all") ──
          setFileStatuses(prev => ({ ...prev, [file.name]: "processing" }));

          if (isPDF(file) && pagesPerStudent === "all") {
            // Check page count — chunk large PDFs to avoid token-limit 500s
            let pageCount = 0;
            try {
              const ab = await file.arrayBuffer();
              const pdfDoc = await PDFDocument.load(ab);
              pageCount = pdfDoc.getPageCount();
            } catch (e) { /* non-critical, fall through to normal grading */ }

            if (pageCount > 6) {
              setGradingProgress(`"${file.name}" has ${pageCount} pages — splitting into chunks to avoid token limits…`);
              console.log(`[DM3A] Large PDF (${pageCount} pages) — splitting into 5-page chunks`);

              let chunks;
              try {
                chunks = await splitPDF(file, 5);
              } catch (e) {
                setFileStatuses(prev => ({ ...prev, [file.name]: "error" }));
                setGradingErrors(prev => [...prev, `Failed to split "${file.name}": ${e.message}`]);
                console.error("[DM3A] PDF split error:", e);
                continue;
              }

              const chunkResults = [];
              for (let i = 0; i < chunks.length; i++) {
                setGradingProgress(`Grading "${file.name}" — chunk ${i + 1} of ${chunks.length}…`);
                try {
                  const partResults = await gradeFile(chunks[i], { ...params, pagesPerStudent: "all" });
                  chunkResults.push(...partResults);
                } catch (e) {
                  setGradingErrors(prev => [...prev, `Failed to grade chunk ${i + 1} of "${file.name}": ${e.message}`]);
                  console.error(`[DM3A] Chunk ${i + 1}/${chunks.length} error for ${file.name}:`, e);
                }
              }

              const merged = mergeStudentChunks(chunkResults);
              setFileResults(prev => ({ ...prev, [file.name]: [merged] }));
              setFileStatuses(prev => ({ ...prev, [file.name]: chunkResults.length > 0 ? "done" : "error" }));
              globalStudentCount++;
            } else {
              setGradingProgress(`Grading entire file "${file.name}"…`);
              try {
                const results = await gradeFile(file, params);
                setFileResults(prev => ({ ...prev, [file.name]: results }));
                setFileStatuses(prev => ({ ...prev, [file.name]: "done" }));
                globalStudentCount += results.length;
              } catch (e) {
                setFileStatuses(prev => ({ ...prev, [file.name]: "error" }));
                setGradingErrors(prev => [...prev, `Failed to grade "${file.name}": ${e.message}`]);
                console.error(`[DM3A] Grading error for ${file.name}:`, e);
              }
            }
          } else {
            setGradingProgress(`Grading "${file.name}"…`);
            try {
              const results = await gradeFile(file, params);
              setFileResults(prev => ({ ...prev, [file.name]: results }));
              setFileStatuses(prev => ({ ...prev, [file.name]: "done" }));
              globalStudentCount += results.length;
            } catch (e) {
              setFileStatuses(prev => ({ ...prev, [file.name]: "error" }));
              setGradingErrors(prev => [...prev, `Failed to grade "${file.name}": ${e.message}`]);
              console.error(`[DM3A] Grading error for ${file.name}:`, e);
            }
          }
        }
      }
    }

    setGradingProgress("");
    setStep("results");
  }

  function exportAllCSV() {
    const snapshot = fileResults;
    const rows = [["Student","File","Overall Tier",...criteria,"Feedback","Next Step","Reflection Prompt"]];
    Object.entries(snapshot).forEach(([fname, students]) => {
      students.forEach(s => {
        const critTiers = criteria.map(c => s.criteria?.find(x=>x.name===c)?.tier || "");
        rows.push([s.studentName||"—", fname, gradeOverrides[s.studentName] ?? s.overallTier, ...critTiers, s.feedback||"", s.growthNote||"", s.reflectionPrompt||""]);
      });
    });
    const csv  = rows.map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `dm3a_grades_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function downloadAllPDFs() {
    allStudents.forEach((s, i) => {
      setTimeout(() => generateStudentPDF(s, assignment, subject, instructor, gradeOverrides[s.studentName]), i * 400);
    });
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'DM Sans',system-ui,sans-serif", maxWidth:760, margin:"0 auto", padding:"0 20px 60px", color:"#2C2C2A" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>

      {/* HEADER */}
      <div style={{ padding:"28px 0 20px", borderBottom:"0.5px solid #D3D1C7", marginBottom:28 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:500, background:"#E1F5EE", color:"#0F6E56", padding:"3px 10px", borderRadius:20, letterSpacing:"0.06em" }}>DM3A GRADER</div>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#B4B2A9" }}>v2.0 · beta</div>
        </div>
        <h1 style={{ margin:"0 0 4px", fontSize:24, fontWeight:500, letterSpacing:"-0.025em" }}>Mastery-Based Grading</h1>
        <p style={{ margin:0, fontSize:13, color:"#5F5E5A" }}>Upload PDFs or images · get comprehensive P1–P4 reports · download individual PDFs</p>
      </div>

      {/* DM3A INFO BANNER */}
      <div style={{ background:"#E8F5EE", border:"1px solid #A8D5BA", borderRadius:8, padding:"10px 16px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
        <div style={{ fontSize:12, color:"#1A5C38", lineHeight:1.6 }}>
          <strong>ℹ️ This app uses the DM3A Mastery Scale</strong> — not traditional letter grades.
          Student work is scored as <strong>P1 (Beginning)</strong>, <strong>P2 (Developing)</strong>, <strong>P3 (Approaching Mastery)</strong>, or <strong>P4 (Mastery)</strong> based on demonstrated understanding, not just correct answers.
        </div>
        <button
          onClick={() => setShowDM3AModal(true)}
          style={{ flexShrink:0, background:"#0F6E56", color:"white", border:"none", borderRadius:6, padding:"6px 12px", fontSize:11, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}
        >
          Learn More
        </button>
      </div>

      {/* SETUP */}
      {step === "setup" && (
        <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

          {/* DROP ZONE */}
          <div>
            <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#5F5E5A", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.05em" }}>
              Student submissions — PDF or Image (JPG, PNG) · multiple files supported
            </label>
            <div
              onDragOver={e=>{e.preventDefault();setDrag(true);}}
              onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);addFiles(e.dataTransfer.files);}}
              onClick={()=>fileRef.current.click()}
              style={{
                border:`1.5px dashed ${drag?"#1D9E75":"#B4B2A9"}`,
                borderRadius:12, padding:"32px 20px", textAlign:"center",
                cursor:"pointer", background:drag?"#E1F5EE":"transparent", transition:"all 0.2s"
              }}>
              <input ref={fileRef} type="file" accept={ACCEPT} multiple style={{display:"none"}} onChange={e=>addFiles(e.target.files)}/>
              <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
              <p style={{ margin:"0 0 4px", fontSize:13, fontWeight:500, color:"#3d3d3a" }}>Drop PDFs or images here</p>
              <p style={{ margin:0, fontSize:12, color:"#888" }}>or click to browse · PDF, JPG, PNG · multiple files at once</p>
            </div>

            {files.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:10 }}>
                {files.map((f,i) => (
                  <FileCard key={f.name} file={f} status={fileStatuses[f.name]||"pending"} result={fileResults[f.name]} onRemove={()=>removeFile(i)}/>
                ))}
              </div>
            )}
          </div>

          {/* FIELDS */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#5F5E5A", marginBottom:6, textTransform:"uppercase" }}>Subject</label>
              <select value={subject} onChange={e=>setSubject(e.target.value)} style={{ width:"100%", padding:"9px 12px", borderRadius:8, border:"0.5px solid #D3D1C7", fontSize:13, background:"#fff" }}>
                {SUBJECTS.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#5F5E5A", marginBottom:6, textTransform:"uppercase" }}>Assignment name</label>
              <input value={assignment} onChange={e=>handleAssignmentChange(e.target.value)} placeholder="e.g. HW 5.1 — Properties of Exponents"
                style={{ width:"100%", padding:"9px 12px", borderRadius:8, border:"0.5px solid #D3D1C7", fontSize:13, boxSizing:"border-box" }}/>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div>
              <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#5F5E5A", marginBottom:6, textTransform:"uppercase" }}>Instructor name</label>
              <input value={instructor} onChange={e=>setInstructor(e.target.value)}
                style={{ width:"100%", padding:"9px 12px", borderRadius:8, border:"0.5px solid #D3D1C7", fontSize:13, boxSizing:"border-box" }}/>
            </div>
            <div>
              <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#5F5E5A", marginBottom:6, textTransform:"uppercase" }}>Pages per student</label>
              <select value={pagesPerStudent} onChange={e=>{ const v=e.target.value; setPagesPerStudent(v==="all"?"all":Number(v)); }} style={{ width:"100%", padding:"9px 12px", borderRadius:8, border:"0.5px solid #D3D1C7", fontSize:13, background:"#fff" }}>
                <option value={1}>1 page per student</option>
                <option value={2}>2 pages (double-sided)</option>
                <option value={3}>3 pages</option>
                <option value={4}>4 pages</option>
                <option value={5}>5 pages</option>
                <option value={6}>6 pages</option>
                <option value={8}>8 pages</option>
                <option value={10}>10 pages</option>
                <option value={15}>15 pages</option>
                <option value="all">Entire file (all pages)</option>
              </select>
            </div>
          </div>

          {/* CRITERIA */}
          <div>
            <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#5F5E5A", marginBottom:6, textTransform:"uppercase" }}>Grading criteria <span style={{ color:"#B4B2A9", textTransform:"none", fontWeight:400 }}>(max 6)</span></label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10 }}>
              {criteria.map((c,i) => (
                <span key={i} style={{ display:"flex", alignItems:"center", gap:6, background:"#F1EFE8", color:"#3d3d3a", fontSize:12, padding:"5px 12px", borderRadius:20, border:"0.5px solid #D3D1C7" }}>
                  {c}
                  <span onClick={()=>setCriteria(criteria.filter((_,j)=>j!==i))} style={{ cursor:"pointer", color:"#B4B2A9", fontSize:14 }}>×</span>
                </span>
              ))}
            </div>
            {criteria.length < 6 && (
              <div style={{ display:"flex", gap:8 }}>
                <input value={newCrit} onChange={e=>setNewCrit(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCriteria()} placeholder="Add a criterion…"
                  style={{ flex:1, padding:"8px 12px", borderRadius:8, border:"0.5px solid #D3D1C7", fontSize:13 }}/>
                <button onClick={addCriteria} style={{ padding:"8px 16px", borderRadius:8, border:"0.5px solid #D3D1C7", background:"#F1EFE8", fontSize:13, cursor:"pointer" }}>Add</button>
              </div>
            )}
          </div>

          {/* GRADING MODE */}
          <div>
            <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#5F5E5A", marginBottom:6, textTransform:"uppercase" }}>
              Grading Mode
              {/quiz|exam|test/i.test(assignment) && gradingMode === "summative" && (
                <span style={{ fontWeight:400, color:"#185FA5", marginLeft:8, textTransform:"none", fontSize:10 }}>Auto-detected from assignment name</span>
              )}
            </label>
            <div style={{ display:"flex", gap:8 }}>
              {[
                { value:"formative", label:"Formative (supportive)", desc:"Growth-oriented · acknowledges partial understanding" },
                { value:"summative", label:"Summative (strict)", desc:"Zero tolerance on wrong final answers · for quizzes & exams" }
              ].map(m => (
                <button key={m.value}
                  onClick={() => { gradingModeManualRef.current = true; setGradingMode(m.value); }}
                  style={{
                    flex:1, padding:"10px 14px", borderRadius:8, cursor:"pointer", textAlign:"left",
                    border: gradingMode === m.value
                      ? `1.5px solid ${m.value === "summative" ? "#A32D2D" : "#0F6E56"}`
                      : "0.5px solid #D3D1C7",
                    background: gradingMode === m.value
                      ? (m.value === "summative" ? "#FCEBEB" : "#E1F5EE")
                      : "#F9F8F5",
                    color: gradingMode === m.value
                      ? (m.value === "summative" ? "#A32D2D" : "#0F6E56")
                      : "#5F5E5A",
                  }}>
                  <div style={{ fontSize:13, fontWeight:600 }}>{m.label}</div>
                  <div style={{ fontSize:11, opacity:0.8, marginTop:2 }}>{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* RUBRIC */}
          <div>
            <label style={{ display:"block", fontSize:11, fontWeight:600, color:"#5F5E5A", marginBottom:6, textTransform:"uppercase" }}>Rubric / grading instructions</label>
            <textarea value={rubric} onChange={e=>setRubric(e.target.value)} rows={5}
              placeholder="P4 = All problems correct with full steps shown. P3 = Mostly correct, minor errors. P2 = Partial understanding, several errors. P1 = Few problems attempted, significant gaps."
              style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:"0.5px solid #D3D1C7", fontSize:13, lineHeight:1.6, resize:"vertical", boxSizing:"border-box", fontFamily:"inherit" }}/>
          </div>

          {error && <div style={{ background:"#FCEBEB", color:"#A32D2D", padding:"10px 14px", borderRadius:8, fontSize:13 }}>{error}</div>}

          <div style={{ display:"flex", alignItems:"center", gap:10, justifyContent:"center", marginBottom:12 }}>
    <input type="checkbox" id="combineCheck" checked={combineImages} onChange={e => setCombineImages(e.target.checked)} style={{ width:16, height:16, cursor:"pointer" }} />
    <label htmlFor="combineCheck" style={{ fontSize:13, color:"#5F5E5A", cursor:"pointer" }}>
      Combine all files as one student (multi-page submission)
    </label>
  </div>
  <button onClick={startGrading} style={{ padding:"14px 24px", borderRadius:10, border:"none", background:"#0F6E56", color:"#fff", fontSize:14, fontWeight:500, cursor:"pointer" }}>
            Grade with DM3A →
          </button>
        </div>
      )}

      {/* GRADING */}
      {step === "grading" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

          {gradingProgress && (
            <div style={{ background:"#E6F1FB", border:"1px solid #185FA5", borderRadius:8, padding:"12px 16px", fontSize:13, color:"#185FA5", display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ display:"inline-block", animation:"spin 1.2s linear infinite", fontSize:16 }}>⏳</span>
              {gradingProgress}
            </div>
          )}

          {gradingErrors.length > 0 && (
            <div style={{ background:"#FCEBEB", border:"1px solid #A32D2D", borderRadius:8, padding:"10px 14px" }}>
              {gradingErrors.map((e, i) => (
                <div key={i} style={{ fontSize:12, color:"#A32D2D" }}>• {e}</div>
              ))}
            </div>
          )}

          {files.map(f => (
            <FileCard key={f.name} file={f} status={fileStatuses[f.name]||"pending"} result={fileResults[f.name]} onRemove={()=>{}}/>
          ))}
        </div>
      )}

      {/* RESULTS */}
      {step === "results" && (
        selectedStudent ? (
          <StudentDetailView
            student={selectedStudent}
            assignment={assignment}
            subject={subject}
            instructor={instructor}
            gradeOverrides={gradeOverrides}
            setGradeOverrides={setGradeOverrides}
            setSelectedStudent={setSelectedStudent}
          />
        ) : (
        <div>
          {gradingErrors.length > 0 && (
            <div style={{ background:"#FCEBEB", border:"1px solid #A32D2D", borderRadius:8, padding:"12px 16px", marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:600, color:"#A32D2D", marginBottom:6 }}>
                {gradingErrors.length === 1 ? "1 grading error occurred:" : `${gradingErrors.length} grading errors occurred:`}
              </div>
              {gradingErrors.map((e, i) => (
                <div key={i} style={{ fontSize:12, color:"#A32D2D" }}>• {e}</div>
              ))}
            </div>
          )}

          {/* Summary */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
            {tierCounts.map(t => (
              <div key={t.id} style={{ background:t.bg, borderRadius:10, padding:"12px 14px", border:`0.5px solid ${t.color}33` }}>
                <p style={{ margin:"0 0 2px", fontFamily:"'DM Mono',monospace", fontSize:11, color:t.color, fontWeight:600 }}>{t.id}</p>
                <p style={{ margin:0, fontSize:22, fontWeight:500, color:t.color }}>{t.count}</p>
                <p style={{ margin:0, fontSize:11, color:t.color, opacity:0.75 }}>{t.desc}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display:"flex", gap:10, marginBottom:24, flexWrap:"wrap" }}>
            <button onClick={downloadAllPDFs} style={{ padding:"9px 18px", borderRadius:8, border:"0.5px solid #0F6E56", background:"#E1F5EE", color:"#0F6E56", fontSize:13, cursor:"pointer", fontWeight:500 }}>
              ↓ All PDF Reports ({allStudents.length})
            </button>
            <button onClick={exportAllCSV} style={{ padding:"9px 18px", borderRadius:8, border:"0.5px solid #D3D1C7", background:"#F1EFE8", color:"#2C2C2A", fontSize:13, cursor:"pointer" }}>
              Export CSV
            </button>
            <button onClick={()=>{setStep("setup");setFiles([]);setFileStatuses({});setFileResults({});}} style={{ padding:"9px 18px", borderRadius:8, border:"0.5px solid #D3D1C7", background:"transparent", color:"#5F5E5A", fontSize:13, cursor:"pointer" }}>
              Grade another batch
            </button>
          </div>

          {/* Student cards */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {allStudents.map((s,i) => (
              <StudentCard key={i} student={s} assignment={assignment} subject={subject} instructor={instructor} idx={i}
                onViewReport={() => setSelectedStudent(s)}
                overrideTier={gradeOverrides[s.studentName]}
              />
            ))}
          </div>

          <p style={{ marginTop:16, fontSize:12, color:"#B4B2A9", textAlign:"center" }}>
            {allStudents.length} student{allStudents.length!==1?"s":""} graded · DM3A Mastery Scale · {instructor}
          </p>
        </div>
        )
      )}

      {showDisclaimerModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"white", borderRadius:16, padding:36, maxWidth:580, width:"100%", boxShadow:"0 24px 72px rgba(0,0,0,0.35)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <div style={{ background:"#E1F5EE", color:"#0F6E56", fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20, letterSpacing:"0.06em", whiteSpace:"nowrap" }}>DM3A GRADER</div>
            </div>
            <h2 style={{ margin:"0 0 16px", fontSize:20, fontWeight:700, color:"#1A3A2A", letterSpacing:"-0.02em" }}>AI-Assisted Grading — Important Notice</h2>
            <p style={{ fontSize:13, color:"#444", lineHeight:1.75, margin:"0 0 12px" }}>
              The DM3A Grader uses artificial intelligence to evaluate student work. While designed to support mastery-based grading, AI has known limitations in reading handwritten work, including:
            </p>
            <ul style={{ margin:"0 0 14px", paddingLeft:20, fontSize:13, color:"#444", lineHeight:2 }}>
              <li><strong>Optical Character Recognition (OCR) errors</strong> — handwritten letters, numbers, and symbols may be misread, particularly in multiple choice selections and mathematical expressions</li>
              <li><strong>Contextual interpretation</strong> — AI may misidentify final answers vs. intermediate steps in multi-step problems</li>
              <li><strong>Rounding and precision</strong> — minor numerical differences may not always be evaluated consistently</li>
            </ul>
            <p style={{ fontSize:13, color:"#444", lineHeight:1.75, margin:"0 0 14px" }}>
              Research consistently shows that AI-assisted grading works best as a first-pass tool, not a final authority. Instructors should review all results before releasing grades to students.
            </p>
            <div style={{ background:"#E1F5EE", border:"1px solid #A8D5BA", borderRadius:8, padding:"12px 16px", marginBottom:24 }}>
              <p style={{ margin:0, fontSize:13, color:"#1A5C38", lineHeight:1.7, fontWeight:500 }}>
                By proceeding, you acknowledge that you will review AI-generated grades before distributing them to students.
              </p>
            </div>
            <button
              onClick={() => { sessionStorage.setItem('dm3a_disclaimer_accepted', 'true'); setShowDisclaimerModal(false); }}
              style={{ width:"100%", background:"#0F6E56", color:"white", border:"none", borderRadius:8, padding:"13px", fontSize:14, fontWeight:600, cursor:"pointer", letterSpacing:"-0.01em" }}
            >
              I Understand — Proceed to Grading
            </button>
          </div>
        </div>
      )}

      {showDM3AModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"white", borderRadius:16, padding:32, maxWidth:520, width:"100%", boxShadow:"0 20px 60px rgba(0,0,0,0.3)", position:"relative" }}>
            <button onClick={() => { setShowDM3AModal(false); localStorage.setItem("dm3a_modal_seen","1"); }} style={{ position:"absolute", top:16, right:16, background:"none", border:"none", fontSize:20, cursor:"pointer", color:"#888" }}>X</button>
            <h2 style={{ margin:"0 0 8px", fontSize:20, fontWeight:700, color:"#1A3A2A" }}>What is the DM3A Mastery Scale?</h2>
            <p style={{ fontSize:13, color:"#555", lineHeight:1.7, margin:"0 0 16px" }}>DM3A replaces traditional percentage grades with P1 through P4 mastery levels based on what students actually understand and demonstrate.</p>
            <div style={{ display:"grid", gap:8, marginBottom:20 }}>
              {[{tier:"P4",label:"Mastery",color:"#0F6E56",bg:"#E1F5EE"},{tier:"P3",label:"Approaching Mastery",color:"#185FA5",bg:"#E6F1FB"},{tier:"P2",label:"Developing",color:"#854F0B",bg:"#FAEEDA"},{tier:"P1",label:"Beginning",color:"#A32D2D",bg:"#FCEBEB"}].map(t => (
                <div key={t.tier} style={{ background:t.bg, borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", gap:12 }}>
                  <span style={{ fontFamily:"monospace", fontWeight:700, fontSize:16, color:t.color, minWidth:28 }}>{t.tier}</span>
                  <div style={{ fontSize:12, fontWeight:600, color:t.color }}>{t.label}</div>
                </div>
              ))}
            </div>
            <button onClick={() => { setShowDM3AModal(false); localStorage.setItem("dm3a_modal_seen","1"); }} style={{ width:"100%", background:"#0F6E56", color:"white", border:"none", borderRadius:8, padding:"12px", fontSize:14, fontWeight:600, cursor:"pointer" }}>Got it, lets grade!</button>
          </div>
        </div>
      )}

    </div>
  );
}


export default function App() {
  return <PasswordGate><DM3AApp /></PasswordGate>;
}
