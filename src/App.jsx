import { useState, useRef, useEffect, useMemo, lazy, Suspense } from "react";
// Blackboard export (Blind Grading, Part D). Lazy so PapaParse loads only when used.
const BBExport = lazy(() => import("./blind/BBExport.jsx"));
// Blind Grading (Parts A/B). Only the tiny WebCrypto helpers are static-imported;
// PapaParse and pdf-lib are dynamic-imported inside handlers so the grading
// bundle stays lean.
import { assignAliases, normalizeAlias } from "./blind/alias.js";
import { encryptMapping, decryptMapping, MIN_PASSPHRASE_LEN } from "./blind/vault.js";
import { putVault, getVault, deleteVault } from "./blind/vaultApi.js";
import { diffRoster } from "./blind/rosterDiff.js";
import { buildNameIndex } from "./blind/translate.js";
import { findPlaintext } from "./blind/zeroPlaintext.js";
import { redactNameZone, terminateRedactor } from "./blind/redact.js";
import LandingPage from "./LandingPage";
// Instructor accounts. AuthGate replaces the old shared-password screen; authApi
// also carries the account-scoped course endpoints used by persistCourses().
import AuthGate from "./auth/AuthGate.jsx";
import * as authApi from "./auth/api.js";

// ── At-Risk Predictor (Phase 3) — input-layer constants ──
// localStorage key for persisted course profiles.
const DM3A_COURSES_KEY = "dm3a-courses";
// Active grading session snapshot (Finding #16 resume). ONLY alias-keyed data is
// ever written here (persistence is gated on a vaulted course + a plaintext scan);
// never the unlocked mapping or activeRoster (those hold real names).
const DM3A_SESSION_KEY = "dm3a-session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // offer resume for 24h
// Assignment weight options: visible label -> stored lowercase value.
// The backend treats quiz/midterm/exam as high-weight (R4) — values must be exact.
const ASSIGNMENT_WEIGHTS = [
  { value: "performance", label: "Performance Task" },
  { value: "practice",    label: "Practice Task" },
  { value: "preparation", label: "Preparation" },
  { value: "homework",    label: "Homework" },
  { value: "quiz",        label: "Quiz" },
  { value: "midterm",     label: "Midterm" },
  { value: "exam",        label: "Exam" },
];

// ─── COURSE KNOWLEDGE CONFIGS ────────────────────────────────────────────────

const COURSE_CONFIGS = {
  "Elementary Statistics": {
    tier: "optimized",
    label: "Elementary Statistics",
    description: "Descriptive stats, probability, hypothesis testing, confidence intervals",
    problemTypes: ["descriptive statistics", "probability", "hypothesis testing", "confidence intervals", "regression", "sampling distributions"],
    keyDefinitions: [
      "Mean, median, mode are distinct measures of center",
      "Standard deviation measures spread around the mean",
      "p-value is the probability of observing results at least as extreme as the sample, assuming H0 is true",
      "Confidence interval does NOT mean there is a X% chance the parameter is in the interval",
      "Type I error: rejecting a true null. Type II error: failing to reject a false null",
      "Correlation does not imply causation"
    ],
    partialCreditRules: [
      "Correct formula with arithmetic error: process is P3/P4, accuracy drops one level",
      "Correct hypothesis setup with wrong conclusion: split credit between setup and conclusion",
      "Correct interpretation with minor wording issues: P3 minimum",
      "Showing all steps even with wrong final answer can earn P3"
    ],
    p4Descriptor: "All work shown, correct setup, correct execution, correct interpretation with statistical language",
    p3Descriptor: "Essentially correct with minor computational or notation errors; interpretation is sound",
    p2Descriptor: "Correct approach but significant computational gaps or incomplete interpretation",
    p1Descriptor: "No meaningful attempt or fundamentally incorrect approach"
  },

  "Intermediate Algebra": {
    tier: "optimized",
    label: "Intermediate Algebra / College Algebra",
    description: "Equations, inequalities, functions, polynomials, rational expressions",
    problemTypes: ["linear equations", "quadratic equations", "systems of equations", "inequalities", "functions", "polynomials", "rational expressions", "radicals", "exponentials", "logarithms"],
    keyDefinitions: [
      "Solving an equation means finding all values that satisfy it",
      "A function maps each input to exactly one output",
      "Factoring and the quadratic formula are equivalent methods",
      "Domain restrictions apply when denominator equals zero or radicand is negative",
      "Logarithm and exponential are inverse operations"
    ],
    partialCreditRules: [
      "Correct method with arithmetic error: P3 minimum",
      "Correct factoring with sign error: P3",
      "Missing one solution in a multi-solution problem: P3",
      "Correct setup of equation with wrong solving steps: P2"
    ],
    p4Descriptor: "All steps shown, correct method, correct answer, no errors",
    p3Descriptor: "Correct method with minor arithmetic or sign errors; answer may be off but approach is solid",
    p2Descriptor: "Partially correct setup; significant gaps in execution or missing steps",
    p1Descriptor: "No meaningful attempt or completely incorrect method"
  },

  "Linear Algebra": {
    tier: "beta",
    label: "Linear Algebra",
    description: "Matrices, vectors, systems, eigenvalues, transformations — applied/computational focus",
    problemTypes: [
      "row reduction / Gaussian elimination",
      "matrix operations (addition, multiplication, transpose)",
      "determinants",
      "systems of linear equations",
      "vector spaces and subspaces",
      "linear independence and span",
      "basis and dimension",
      "linear transformations",
      "eigenvalues and eigenvectors",
      "orthogonality and projections",
      "least squares",
      "LU decomposition",
      "matrix inverses"
    ],
    keyDefinitions: [
      "CRITICAL: Echelon form ≠ Reduced Row Echelon Form (RREF). Echelon form requires leading 1s with zeros below; RREF also requires zeros above. A matrix in echelon form is NOT required to be in RREF.",
      "A system is consistent if it has at least one solution",
      "Free variables correspond to non-pivot columns",
      "A set of vectors is linearly independent if the only solution to the homogeneous system is the trivial solution",
      "The null space of A is the solution set of Ax=0",
      "Rank = number of pivot positions = dimension of column space",
      "Rank-Nullity Theorem: rank(A) + nullity(A) = number of columns",
      "An eigenvalue λ satisfies det(A - λI) = 0",
      "Eigenvectors corresponding to distinct eigenvalues are linearly independent",
      "A square matrix is invertible if and only if its determinant is nonzero",
      "Similar matrices have the same eigenvalues",
      "Orthogonal matrices satisfy Q^T Q = I"
    ],
    partialCreditRules: [
      "CRITICAL: If a student uses the correct row operations but makes a single arithmetic error, this is at most a P3 — the process demonstrates mastery",
      "If a student achieves the correct echelon form (not RREF) when only echelon form was asked: this is P4 — do not penalize for not going further",
      "If a student sets up the characteristic polynomial correctly but makes an arithmetic error in solving: P3 minimum",
      "If a student correctly identifies free variables and pivot columns but writes the solution set imprecisely: P3",
      "If a student shows correct row operations on all but one step: P3",
      "For multi-part problems: grade each part independently; a wrong answer in part (a) that is correctly carried into part (b) should not penalize part (b)",
      "TRUE/FALSE with correct answer AND correct explanation = P4, even if the explanation uses informal language",
      "TRUE/FALSE with correct answer but weak explanation = P3",
      "TRUE/FALSE with wrong answer but strong reasoning about a related concept = P2"
    ],
    p4Descriptor: "Correct method, correct execution, correct conclusion; minor arithmetic slips do not prevent P4 if process is fully demonstrated",
    p3Descriptor: "Sound mathematical reasoning with computational errors; student clearly understands the procedure even if the final answer is off",
    p2Descriptor: "Partial understanding: correct setup but significant gaps in execution, or correct answer with no supporting work",
    p1Descriptor: "No meaningful attempt, or approach shows fundamental misunderstanding of the concept"
  },

  "Calculus I": {
    tier: "beta",
    label: "Calculus I",
    description: "Limits, derivatives, applications of differentiation — process-heavy grading",
    problemTypes: [
      "limits (algebraic, graphical, one-sided)",
      "continuity",
      "definition of the derivative",
      "basic differentiation rules (power, product, quotient, chain)",
      "implicit differentiation",
      "derivatives of trigonometric functions",
      "derivatives of exponential and logarithmic functions",
      "related rates",
      "curve sketching (increasing/decreasing, concavity, inflection points)",
      "optimization (absolute and local extrema)",
      "Mean Value Theorem",
      "linearization / differentials",
      "introduction to antiderivatives"
    ],
    keyDefinitions: [
      "A limit describes behavior as x approaches a value, NOT the value at that point",
      "A function is continuous at x=a if: f(a) exists, lim f(x) exists, and they are equal",
      "The derivative f'(a) = lim[h→0] (f(a+h)-f(a))/h — this is the definition, not just a formula",
      "Differentiability implies continuity, but continuity does NOT imply differentiability",
      "Chain rule: d/dx[f(g(x))] = f'(g(x)) · g'(x) — the outer derivative times the inner derivative",
      "Product rule: (uv)' = u'v + uv'",
      "Quotient rule: (u/v)' = (u'v - uv') / v²",
      "A critical number is where f'(x)=0 OR f'(x) is undefined",
      "First Derivative Test: sign change of f' determines local max/min",
      "Second Derivative Test: f''(c)>0 means local min, f''(c)<0 means local max",
      "Mean Value Theorem requires f to be continuous on [a,b] and differentiable on (a,b)",
      "Related rates problems require implicit differentiation with respect to time"
    ],
    partialCreditRules: [
      "PROCESS IS PARAMOUNT in Calculus I: a student who sets up the chain rule correctly but makes an arithmetic error in simplification earns P3 minimum",
      "Correct differentiation rule applied with wrong simplification: P3",
      "Correct limit setup with wrong algebra: P3",
      "Setting up a related rates diagram and equation correctly but differentiating wrong: P2-P3 depending on where the error occurs",
      "Finding critical numbers correctly but wrong conclusion in First/Second Derivative Test: P3",
      "Correct method for optimization but wrong final answer due to arithmetic: P3",
      "For definition-of-derivative problems: correct limit setup earns significant partial credit even if algebra fails",
      "Implicit differentiation: correctly differentiating both sides earns P3 even if solving for dy/dx has errors",
      "If a student skips steps, penalize 'work shown' criterion but not necessarily 'problem solving'"
    ],
    p4Descriptor: "Correct method, all steps shown, correct answer; notation is mathematically sound; minor simplification errors do not prevent P4",
    p3Descriptor: "Correct calculus reasoning with algebraic or arithmetic errors; student demonstrates they know which rule to apply and how",
    p2Descriptor: "Partial setup: student attempts the right approach but significant execution gaps; or correct answer with insufficient supporting work",
    p1Descriptor: "No meaningful attempt, wrong rule applied entirely, or answer with no connection to calculus concepts"
  },

  "Precalculus": {
    tier: "optimized",
    label: "Precalculus",
    description: "Functions, trigonometry, conics, sequences — bridges Algebra to Calculus",
    problemTypes: ["functions and transformations", "polynomial functions", "rational functions", "exponential and logarithmic functions", "trigonometric functions", "inverse trig", "analytic trigonometry", "conic sections", "sequences and series", "polar coordinates"],
    keyDefinitions: [
      "A function has exactly one output per input",
      "Inverse functions satisfy f(f⁻¹(x)) = x and f⁻¹(f(x)) = x",
      "sin²θ + cos²θ = 1 is the Pythagorean identity",
      "Amplitude, period, phase shift, and vertical shift are four distinct transformations of trig functions",
      "log_b(x) = y means b^y = x",
      "Natural log ln(x) = log_e(x)"
    ],
    partialCreditRules: [
      "Correct transformation setup with wrong graph: P3",
      "Correct identity used with algebra error: P3",
      "Correct log/exponential conversion with wrong solving: P2-P3"
    ],
    p4Descriptor: "All work shown, correct method, correct answer with proper notation",
    p3Descriptor: "Correct approach with minor errors; mathematical reasoning is sound",
    p2Descriptor: "Partial understanding; significant gaps in execution",
    p1Descriptor: "No meaningful attempt or fundamentally wrong approach"
  },

  "Calculus II": {
    tier: "beta",
    label: "Calculus II",
    description: "Integration techniques, series, parametric and polar curves",
    problemTypes: ["substitution", "integration by parts", "partial fractions", "trigonometric integrals", "trigonometric substitution", "improper integrals", "sequences", "series convergence tests", "power series", "Taylor and Maclaurin series", "parametric curves", "polar curves", "arc length", "surface area"],
    keyDefinitions: [
      "Integration by parts: ∫u dv = uv - ∫v du",
      "A series converges if its sequence of partial sums converges",
      "Ratio test, root test, integral test, comparison tests are distinct convergence tools",
      "A Taylor series centered at a: Σ f⁽ⁿ⁾(a)/n! · (x-a)ⁿ",
      "Improper integrals require a limit definition"
    ],
    partialCreditRules: [
      "Correct integration technique chosen but wrong execution: P3",
      "Correct convergence test chosen but wrong conclusion: P3",
      "Correct Taylor series setup with arithmetic error in coefficients: P3"
    ],
    p4Descriptor: "Correct technique, complete execution, correct answer with all steps",
    p3Descriptor: "Correct technique with computational errors; student knows the method",
    p2Descriptor: "Partial technique or incomplete execution with significant gaps",
    p1Descriptor: "No meaningful attempt or completely wrong technique"
  }
};

// ─── TIER METADATA ────────────────────────────────────────────────────────────

const TIER_META = {
  optimized: {
    label: "Fully Supported",
    color: "#0F6E56",
    bg: "#E1F5EE",
    border: "#A3D9C8",
    icon: "✓",
    description: "Trained and validated on real student work. Highest grading accuracy."
  },
  beta: {
    label: "Beta",
    color: "#185FA5",
    bg: "#E6F1FB",
    border: "#A3C4E8",
    icon: "β",
    description: "Strong capability with subject knowledge built in. Review AI scores before finalizing."
  },
  experimental: {
    label: "Experimental",
    color: "#854F0B",
    bg: "#FAEEDA",
    border: "#E8C98A",
    icon: "⚗",
    description: "Early stage. Use for exploration only — not recommended for official grading."
  }
};

// ─── SYSTEM PROMPT BUILDER ────────────────────────────────────────────────────

// ── DM3A scoring dimensions ──────────────────────────────────────────────────
// The instructor chooses which dimensions an assignment actually evidences. A
// true/false quiz evidences Accuracy and nothing else; asking the model to score
// Work Shown from a page with no work produces an invented number that differs
// from run to run. Scoring only what is evidenced is what makes runs reproducible.
const DIM_META = [
  ["conceptualUnderstanding", "Conceptual Understanding", "does the student show they know the relevant concept or definition?"],
  ["problemSolving",          "Problem Solving",          "did they choose and apply an appropriate method or strategy?"],
  ["workShown",               "Work Shown",               "is their reasoning and process documented clearly enough to follow?"],
  ["accuracy",                "Accuracy",                 "are their computations and final answers correct?"],
];
const ALL_DIMS = { conceptualUnderstanding: true, problemSolving: true, workShown: true, accuracy: true };
const DIM_PREF_KEY = "dm3a.activeDims";
const dimsOn  = (dims) => DIM_META.filter(([k]) => (dims || ALL_DIMS)[k]);
const dimsOff = (dims) => DIM_META.filter(([k]) => !(dims || ALL_DIMS)[k]);
const dimListPrompt = (dims) => dimsOn(dims).map(([, label, q], i) => `${i + 1}. ${label} — ${q}`).join("\n");
const dimJson = (dims, scale, indent) => dimsOn(dims).map(([k]) => `${indent}"${k}": "${scale}"`).join(",\n");
const DIM_FB_NOTE = {
  conceptualUnderstanding: "1–3 sentences: what concept knowledge was demonstrated or missing",
  problemSolving: "1–3 sentences: what the approach showed; what strategy to revisit",
  workShown: "1–3 sentences: how clearly the process is documented",
  accuracy: "1–3 sentences: where errors appear; ONE hint if wrong — never the answer",
};
const dimFeedbackJson = (dims) => dimsOn(dims).map(([k]) => `    "${k}": "${DIM_FB_NOTE[k]}"`).join(",\n");
// Dimensions switched off must not be invented, and must not appear in the JSON.
const dimScopeRule = (dims) => {
  const off = dimsOff(dims);
  if (!off.length) return "";
  return `
## DIMENSION SCOPE — the instructor has limited what this assignment measures
Score ONLY these dimensions: ${dimsOn(dims).map(([, l]) => l).join(", ")}.
Do NOT score, infer, mention or return: ${off.map(([, l]) => l).join(", ")}. This assignment provides no evidence for them, and a guess is worse than an omission.
The "dimensions" object must contain the listed keys ONLY.
`;
};
// Strip anything the model returned for a dimension the instructor switched off.
const applyDimScope = (list, dims) => (Array.isArray(list) ? list : [list]).map((r) => {
  if (!r || !r.dimensions) return r;
  const d = {}, fb = {};
  for (const [k] of DIM_META) {
    if (!(dims || ALL_DIMS)[k]) continue;
    if (r.dimensions[k] != null) d[k] = r.dimensions[k];
    if (r.dimensionFeedback && r.dimensionFeedback[k] != null) fb[k] = r.dimensionFeedback[k];
  }
  return { ...r, dimensions: d, ...(r.dimensionFeedback ? { dimensionFeedback: fb } : {}) };
});

function buildSystemPrompt(courseConfig, dims = ALL_DIMS) {
  return `CRITICAL: You must ALWAYS respond with valid JSON only. Never respond with narrative text, analysis, or markdown. Your entire response must be a single JSON array starting with [ and ending with ]. If you cannot grade, still return the JSON structure with P1 scores and explanation in the feedback field.

You are an expert mathematics grader using the DM3A mastery-based assessment framework developed by Dr. Ralph Minaya, Ed.D.

## CORE DM3A PHILOSOPHY
You NEVER use binary "correct" or "wrong" labels. Every problem is graded on the P1–P4 mastery scale.
PROCESS IS MORE IMPORTANT THAN THE FINAL ANSWER. A student who demonstrates correct mathematical reasoning with a computational error is NOT a failing student.

## P1–P4 MASTERY SCALE
- P4 (Mastery, 90%+): ${courseConfig.p4Descriptor}
- P3 (Approaching Mastery, 80–89%): ${courseConfig.p3Descriptor}
- P2 (Developing, 60–79%): ${courseConfig.p2Descriptor}
- P1 (Beginning, below 60%): ${courseConfig.p1Descriptor}

## CRITICAL RULES FOR TRUE/FALSE AND PROOF-BASED PROBLEMS
- For any True/False problem, you MUST verify your own mathematical reasoning before assigning a score. Do not rely on surface-level pattern matching. Work through the logic step by step before deciding if the statement is true or false.
${(dims || ALL_DIMS).workShown ? "- If a student's answer on a True/False problem is correct but their explanation is incomplete or missing, assign P3 — not P4. A correct answer without a valid justification does not demonstrate mastery." : "- Written explanations are NOT expected on this assignment. Judge each True/False problem solely on whether the answer is correct. A correct answer earns P4; never withhold P4 for a missing justification."}
- If a student's answer is incorrect, verify that YOUR explanation of why it is incorrect is mathematically sound before including it in feedback. If you are not certain, flag the problem with: "Instructor review recommended — proof-based problem."
- For proof-based problems, a correct example does NOT constitute a proof. A student who provides only an example where a general argument is required should receive P2 at most.
- When in doubt on any True/False or proof-based problem, append this note to the problem feedback: "Note: This problem requires instructor verification before finalizing the score."

${(dims || ALL_DIMS).workShown ? `## CRITICAL RULES FOR EXPLANATION DEPTH VS. CORRECT ANSWER
- A correct final answer alone does NOT earn P4. The student must demonstrate clear, complete mathematical reasoning to earn P4.
- Distinguish explicitly between these two cases:
  1. Correct answer WITH complete argument or generalization → P4
  2. Correct answer WITH only a specific example, incomplete steps, or missing justification → P3 at most
- In Linear Algebra and higher-level courses: a student who verifies a property using a specific numerical example when a general proof is required earns P2, not P3 or P4. Generalization is a required skill at this level.
- When assigning P4, you must be able to identify specific evidence in the student's work that demonstrates complete reasoning — not just a correct answer.
- In your feedback, always name the specific reasoning element that was present (earning P4) or missing (limiting the score to P3 or below). Never say only "correct" or "incorrect" — explain what the student did or did not demonstrate.` : `## SCORING THIS ASSIGNMENT
- Written explanations are NOT expected. Judge each problem solely on whether the student's answer is correct.
- A correct answer earns P4. Never reduce a score for a missing, brief, or absent justification.`}

## CRITICAL RULES FOR READING HANDWRITTEN STUDENT WORK
- Before penalizing any student calculation, re-examine the handwriting carefully. Handwritten numbers and symbols can be ambiguous — what looks like an error may be a legibility issue, not a mathematical mistake.
- If you are not fully confident in your reading of a handwritten expression, do NOT penalize the student. Instead, note in the feedback: "Handwriting unclear on this step — instructor verification recommended before finalizing score."
- Never reduce a student's score based on ambiguous handwriting alone. When in doubt, give the student the benefit of the doubt and flag for instructor review.
- Pay special attention to: the difference between 0 and 6, 1 and 7, x and multiplication signs, negative signs and subtraction, exponents written close to the base, and fractions where numerator and denominator are hard to distinguish.
- If a student's final answer is correct, work backwards to verify their process before concluding that intermediate steps are wrong. A correct answer is strong evidence that the process was also correct.

## SUBJECT: ${courseConfig.label}
Problem types you will encounter: ${courseConfig.problemTypes.join(", ")}.

## CRITICAL DEFINITIONS YOU MUST KNOW
${courseConfig.keyDefinitions.map((d, i) => `${i + 1}. ${d}`).join("\n")}

## PARTIAL CREDIT RULES
${courseConfig.partialCreditRules.map((r, i) => `${i + 1}. ${r}`).join("\n")}

## GRADING RULES
1. Read ALL problems before grading. Do not skip any sub-parts (a, b, c, d, etc.). If a problem has parts, grade EVERY part.
2. For multi-part problems: grade each part INDEPENDENTLY. A wrong answer in part (a) carried correctly into part (b) does NOT penalize part (b).
3. Compare student work against the answer key/model solution if provided. If no answer key is provided, use your subject expertise.
4. When handwriting is ambiguous, assume the most mathematically charitable interpretation.
5. NEVER penalize a student for not reducing further than the problem asked.
6. Flag any problem where you have LOW CONFIDENCE in your grading with "flagged: true".
${dimScopeRule(dims)}
## OUTPUT FORMAT
Return ONLY a valid JSON array. No preamble, no markdown fences, no explanation outside the JSON.

Each student object:
{
  "studentName": "string",
  "overallTier": "P1|P2|P3|P4",
  "dimensions": {
${dimJson(dims, "P1|P2|P3|P4", "    ")}
  },
  "problems": [
    {
      "id": "1a",
      "description": "brief description of what the problem asked",
      "tier": "P1|P2|P3|P4",
      "reasoning": "specific explanation of why this tier was assigned, referencing student's actual work",
      "processAssessment": "description of student's mathematical process/reasoning",
      "answerCorrect": true|false,
      "processCorrect": true|false,
      "flagged": false,
      "flagReason": null
    }
  ],
  "strengths": ["string"],
  "growthAreas": ["string"],
  "feedback": "2-3 sentence personalized, growth-oriented feedback",
  "instructorNote": "any concerns or observations for the instructor"
}

You MUST grade ALL problems visible in the student work across ALL submitted images. Do not stop after the first image. Examine every image carefully and grade every problem the student attempted. Do not stop early. Complete the full JSON array before stopping.

Student work may appear as handwritten answers written directly onto a printed assignment sheet. In these cases, the printed sheet serves as both the assignment and the submission. Look carefully for handwritten numbers, expressions, or work written next to or between the printed problems. Any handwriting visible on the page is student work and must be graded. Do not conclude that no work was submitted simply because the page appears to be a printed form.`;
}

// ─── STUDENT SYSTEM PROMPT BUILDER ───────────────────────────────────────────
// SEPARATE from buildSystemPrompt — do not merge or modify that function.
// Called exclusively by handleStudentGrade(). The instructor flow never calls this.
//
// Returns a coaching-oriented system prompt whose output shape is:
//
// {
//   "studentName": "Student",            // "Student" if no name visible
//   "overallTier": "P1|P2|P3|P4",        // unofficial practice estimate
//   "unofficial": true,                  // always true — signals non-record score
//   "dimensions": {
//     "conceptualUnderstanding": "P0|P1|P2|P3|P4",
//     "problemSolving":          "P0|P1|P2|P3|P4",
//     "workShown":               "P0|P1|P2|P3|P4",
//     "accuracy":                "P0|P1|P2|P3|P4"
//   },
//   "dimensionFeedback": {               // new — per-dimension coaching notes
//     "conceptualUnderstanding": "1–3 sentences",
//     "problemSolving":          "1–3 sentences",
//     "workShown":               "1–3 sentences",
//     "accuracy":                "1–3 sentences — hint only, never the answer"
//   },
//   "problems": [
//     {
//       "id": "1",
//       "description": "what the problem asked",
//       "tier": "P0|P1|P2|P3|P4",
//       "reasoning": "what the student did and why this tier",
//       "hint": "one nudge — never the answer or full solution",
//       "processCorrect": true|false,
//       "answerCorrect":  true|false
//     }
//   ],
//   "strengths": ["specific strength"],
//   "whatToWorkOnNext": "one sentence — tied to lowest dimension",
//   "feedback": "2–3 sentence warm summary"
// }
//
// "dimensions" uses the same field names as the instructor JSON so the existing
// results screen renders without modification; "dimensionFeedback" and
// "whatToWorkOnNext" are additive fields for a future student-specific screen.

function buildStudentSystemPrompt(courseConfig, dims = ALL_DIMS) {
  const hasCfg = courseConfig && courseConfig.label;
  const subject = hasCfg ? courseConfig.label : "Mathematics";
  const p4 = hasCfg ? courseConfig.p4Descriptor : "Complete, correct, well-documented work";
  const p3 = hasCfg ? courseConfig.p3Descriptor : "Correct approach with minor errors";
  const p2 = hasCfg ? courseConfig.p2Descriptor : "Partial understanding; significant gaps";
  const p1 = hasCfg ? courseConfig.p1Descriptor : "No meaningful attempt or fundamentally wrong approach";
  const problemTypes = hasCfg ? courseConfig.problemTypes.join(", ") : "";
  const partialCreditRules = hasCfg
    ? courseConfig.partialCreditRules.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : "";

  return `CRITICAL: Respond with valid JSON only — a single JSON object, no markdown fences, no text outside the JSON.

You are a mastery coach reviewing a student's self-submitted mathematics work to help them improve BEFORE they submit it to their instructor. You are not grading for a record. Your job is to give the student a clear, encouraging, and honest read on where they are and what to revise next.

## SUBJECT: ${subject}${problemTypes ? `\nProblem types covered: ${problemTypes}.` : ""}

## DM3A PROFICIENCY LEVEL SCALE
"P" stands for Proficiency Level. Every score below is an unofficial practice estimate — it will not appear in the student's gradebook.
- P4 = Mastery: ${p4}
- P3 = Approaching Mastery: ${p3}
- P2 = Developing: ${p2}
- P1 = Beginning: ${p1}
- P0 = No evidence of proficiency: no work visible for this dimension

## SCORING DIMENSIONS — score each independently
${dimListPrompt(dims)}${dimScopeRule(dims)}
${partialCreditRules ? `\n## PARTIAL CREDIT RULES (apply these before scoring)\n${partialCreditRules}` : ""}

## STRICT FEEDBACK RULES — follow all of them
1. NEVER provide the correct final answer. NEVER write out a full worked solution.
2. When the student's answer is WRONG: pinpoint WHERE the error is (which step, which concept), then give exactly ONE short hint that nudges toward the fix — not the solution. Example: "Check how you set up the denominator in the variance step — what should n represent here?" Never write: "The answer is 14.2."
3. Use revision language throughout: "revise this step," "check this assumption," "state your formula first," "interpret this result in context." Tell the student WHAT TO DO, not what the answer is.
4. Be warm and growth-oriented. Never condescending. Name what they did well FIRST, then what to work on.
5. Keep per-dimension feedback to 1–3 sentences each.
6. End with exactly one "What to work on next" sentence targeting the single lowest-scoring dimension.

## READING HANDWRITTEN WORK
- If handwriting is ambiguous, interpret it charitably.
- Faint or partial marks count as evidence of process — do not ignore them.
- If a step is genuinely unreadable, note it briefly; do not penalize for legibility.

## OUTPUT — return exactly this JSON object shape, nothing else
{
  "studentName": "Student",
  "overallTier": "P1|P2|P3|P4",
  "unofficial": true,
  "dimensions": {
${dimJson(dims, "P0|P1|P2|P3|P4", "    ")}
  },
  "dimensionFeedback": {
${dimFeedbackJson(dims)}
  },
  "problems": [
    {
      "id": "1",
      "description": "brief description of what the problem asked",
      "tier": "P0|P1|P2|P3|P4",
      "reasoning": "what the student did and why this Proficiency Level was assigned",
      "hint": "one specific nudge toward what to revise — never give the answer or a full solution",
      "processCorrect": true,
      "answerCorrect": false
    }
  ],
  "strengths": ["one or two specific things the student did well"],
  "whatToWorkOnNext": "one sentence about the highest-priority revision, tied to the lowest-scoring dimension",
  "feedback": "2–3 sentence warm, personalized summary: name a strength, identify the key growth area, close with forward-looking revision language"
}`;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

// api.dm3agrader.com is a sibling of the site's own domain, which keeps the login
// cookie first-party (iOS Safari blocks third-party cookies outright). Override
// with VITE_SERVER_URL for local development — same pattern as AdminDashboard.jsx.
const SERVER_URL =
  (import.meta.env && import.meta.env.VITE_SERVER_URL) ||
  'https://api.dm3agrader.com';

export default function DM3AGraderV5() {
  const [step, setStep] = useState("login");
  // ── Instructor account session ──────────────────────────────────────────────
  // authUser is the signed-in account (null when signed out OR on a legacy
  // shared-password session, which is deliberately account-less).
  const [authUser, setAuthUser] = useState(null);
  const [authLegacy, setAuthLegacy] = useState(false);
  const [courseSyncNote, setCourseSyncNote] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  // Which AuthGate screen to open on — so "Create an account" on the role picker
  // lands directly on sign-up instead of making people find it again.
  const [authInitialView, setAuthInitialView] = useState("login");
  const [showTierGuide, setShowTierGuide] = useState(false);
  const [subject, setSubject] = useState("");
  const [assignment, setAssignment] = useState("");
  const [rubric, setRubric] = useState("");
  // Which DM3A dimensions this assignment is scored on. Remembered as the default
  // for next time; a T/F quiz and a project in the same section need different sets.
  const [activeDims, setActiveDims] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DIM_PREF_KEY) || "null");
      if (saved && typeof saved === "object") return { ...ALL_DIMS, ...saved };
    } catch { /* ignore */ }
    return { ...ALL_DIMS };
  });
  useEffect(() => {
    try { localStorage.setItem(DIM_PREF_KEY, JSON.stringify(activeDims)); } catch { /* ignore */ }
  }, [activeDims]);
  const [assignmentFile, setAssignmentFile] = useState(null);
  const [answerKeyFile, setAnswerKeyFile] = useState(null);
  const [studentFiles, setStudentFiles] = useState([]);
  const [isBatchPDF, setIsBatchPDF] = useState(false);
  const [batchMode, setBatchMode] = useState("auto"); // "auto" | "fixed"
  const [pagesPerStudent, setPagesPerStudent] = useState(2);
  const [combineImages, setCombineImages] = useState(false);
  const [combinedStudentName, setCombinedStudentName] = useState("");
  const [fileSizeWarnings, setFileSizeWarnings] = useState([]);
  const [heicFailedFiles, setHeicFailedFiles] = useState([]);
  const [generatingReports, setGeneratingReports] = useState(false);
  const [includeNameOnReport, setIncludeNameOnReport] = useState(false); // blind: opt-in real name in report body
  const [pageNotes, setPageNotes] = useState([]); // #18: reference-file page usage ("Using X of Y pages")
  const [answerKeyPages, setAnswerKeyPages] = useState(null); // #20: answer-key page count surfaced
  const [redactStats, setRedactStats] = useState(null); // §3.3: { checked, redacted, noun } | null — per-run name-zone redaction count
  const [submissionImages, setSubmissionImages] = useState([]); // #23: per-result { image, redacted } — the page-1 AS GRADED (redacted for vaulted). In-memory only; never persisted or sent.
  const [submissionOpen, setSubmissionOpen] = useState(false); // #23: show/hide the "submitted page as graded" image
  const [expandedThumb, setExpandedThumb] = useState(null); // #33: Confirm-row index whose thumbnail is expanded
  const [redactWarning, setRedactWarning] = useState(false); // #25 invariant: vaulted+toggle ON but redaction never ran → surface loudly
  const [bbStubNote, setBbStubNote] = useState(0); // #25: count of Blackboard .txt submission stubs excluded from grading
  const [problemInventory, setProblemInventory] = useState({}); // studentName → inventory array
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [overrides, setOverrides] = useState({});
  const [problemOverrides, setProblemOverrides] = useState({});
  const [activeStudent, setActiveStudent] = useState(0);
  const [rosterMap, setRosterMap] = useState({}); // studentId -> "Last, First"
  const [skipCoverSheet, setSkipCoverSheet] = useState(new Set()); // studentIds to skip last file (cover sheet)
  const [problemScope, setProblemScope] = useState(""); // e.g. "even problems 2–84"
  const [courseContext, setCourseContext] = useState(""); // e.g. "unit covers matrix operations only"
  const [showHelp, setShowHelp] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const rosterInputRef = useRef(null);
  const [isBBBatch, setIsBBBatch] = useState(false);
  const [bbGroups, setBbGroups] = useState([]);
  // ── STUDENT MODE ──────────────────────────────────────────────────────────
  const [isStudentMode, setIsStudentMode] = useState(false);
  const [gatekeeperBlocked, setGatekeeperBlocked] = useState(false);
  const [gatekeeperReason, setGatekeeperReason] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentClassCode, setStudentClassCode] = useState(""); // optional instructor code → unlimited
  const [codeStatus, setCodeStatus] = useState("idle"); // idle|checking|valid|capped|invalid|error
  const [codeCourse, setCodeCourse] = useState("");     // course name when a code checks out
  const [studentSubmissionsLeft, setStudentSubmissionsLeft] = useState(null);
  const [studentRubricFile, setStudentRubricFile] = useState(null);

  // ── At-Risk Predictor (Phase 3) — course profiles + per-session inputs ──
  // Input + localStorage only. NOTHING here is sent to the server in this step.
  const [courses, setCourses] = useState([]); // [{courseCode, professorEmail, roster:[{studentName, studentEmail}]}]
  const [activeCourseCode, setActiveCourseCode] = useState("");
  const [professorEmail, setProfessorEmail] = useState(""); // active, editable override of the profile's email
  const [activeRoster, setActiveRoster] = useState([]);      // roster of the selected course
  const [assignmentWeight, setAssignmentWeight] = useState("homework");
  const [assignmentIndex, setAssignmentIndex] = useState(""); // optional; "" = unset
  const [semesterTag, setSemesterTag] = useState("Spring 2026");
  const [showManageCourses, setShowManageCourses] = useState(false);

  // ── Blind Grading (Part A): in-memory unlock + migration state ────────────
  // NONE of this is persisted. Decrypted rosters and passphrases live only in
  // memory for the session (like an unlocked password manager).
  const [unlockedRosters, setUnlockedRosters] = useState({}); // courseCode -> [{alias, studentName, studentEmail, bbUsername, studentId}]
  const [sessionPass, setSessionPass] = useState({});         // courseCode -> passphrase (to re-encrypt on roster update)
  const [unlockPrompt, setUnlockPrompt] = useState(null);     // { courseCode, message, onUnlocked } | null
  const [unlockPass, setUnlockPass] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);
  const [vaultNote, setVaultNote] = useState("");
  const [securePass, setSecurePass] = useState({}); // courseCode -> passphrase input (secure action)
  const [viewAliases, setViewAliases] = useState(null); // #21: courseCode whose alias table is shown

  // ── Finding #16: session persistence + resume + SPA history ────────────────
  const [pendingResume, setPendingResume] = useState(null); // { courseCode, count, savedAt } | null
  const histReady = useRef(false); // replaceState the first entry, pushState after
  const fromPop = useRef(false);   // suppress the push triggered by a popstate-driven setStep
  // Manage Courses editor state
  const [addCourseCode, setAddCourseCode] = useState("");
  const [addProfessorEmail, setAddProfessorEmail] = useState("");
  // Student Access Codes: the admin key (shared with the admin dashboard via
  // sessionStorage) authorizes code creation; per-course transient UI state.
  const [accessKeyInput, setAccessKeyInput] = useState(() => sessionStorage.getItem("dm3a_admin_key") || "");
  const [accessBusy, setAccessBusy] = useState("");     // courseCode currently generating, or ""
  const [accessNote, setAccessNote] = useState("");     // small status/error line for the access-code area
  const [copiedCode, setCopiedCode] = useState("");     // courseCode whose code was just copied
  const [editingCourseCode, setEditingCourseCode] = useState(null); // courseCode being edited, or null
  const [editCourseCode, setEditCourseCode] = useState("");
  const [editProfessorEmail, setEditProfessorEmail] = useState("");
  const [editRosterText, setEditRosterText] = useState("");
  // ── Phase 3 Step 2: roster confirmation (state only; nothing sent to server) ──
  const [confirmedRoster, setConfirmedRoster] = useState([]); // [{studentName, studentEmail}] — sent to /api/risk/record
  const [studentMapping, setStudentMapping] = useState({});   // result index -> chosen studentEmail ("" = skip)
  const [autoMatched, setAutoMatched] = useState({});         // #33: result index -> true when pre-filled via BB-username join (verify)
  const [rosterConfirmed, setRosterConfirmed] = useState(false);
  const [trackingNote, setTrackingNote] = useState("");       // non-blocking status after a tracked confirm


  const assignmentRef = useRef();
  const answerKeyRef = useRef();
  const studentRef = useRef();
  const studentRubricRef = useRef();

  // ─── AT-RISK: COURSE PROFILE STORE (localStorage `dm3a-courses`) ────────────
  // Load saved course profiles on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DM3A_COURSES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        const normalized = parsed.map((c) => ({
          ...c,
          roster: Array.isArray(c?.roster) ? c.roster : [],
        }));
        // Keep the full roster IN MEMORY for this session (so a course can still
        // be secured), but IMMEDIATELY purge any legacy plaintext rosters from
        // disk (Blind Grading, Part C-final — no student names in localStorage).
        setCourses(normalized);
        try {
          localStorage.setItem(
            DM3A_COURSES_KEY,
            JSON.stringify(normalized.map((c) => ({ ...c, roster: [] })))
          );
        } catch {
          /* storage unavailable — in-memory state still applied */
        }
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // Persist course metadata. The full roster is kept IN MEMORY (React state) so a
  // course can still be secured this session, but student names/emails are NEVER
  // written to localStorage (Blind Grading, Part C-final). Only stripped metadata
  // (course code, professor email, vault flag) is persisted; secure a course to
  // persist its roster encrypted in the vault.
  //
  // Instructor accounts: when signed in, the same metadata is ALSO synced to the
  // account so courses follow the instructor between devices. localStorage stays
  // as the offline cache and as the whole story for legacy (account-less)
  // sessions. Every course mutation in this file already funnels through here,
  // so this one function is the entire sync seam.
  function persistCourses(next) {
    setCourses(next);
    try {
      const stripped = next.map((c) => ({ ...c, roster: [] }));
      localStorage.setItem(DM3A_COURSES_KEY, JSON.stringify(stripped));
    } catch {
      /* storage unavailable — keep in-memory */
    }
    syncCoursesToAccount(next);
  }

  // Push course metadata to the signed-in account. Best-effort and non-blocking:
  // a sync failure must never interrupt grading, so it only leaves a note.
  // Deletions are handled by removeCourse, which knows which code disappeared.
  function syncCoursesToAccount(next) {
    if (!authUser) return; // signed out, or a legacy session with no account
    Promise.all(
      next.map((c) =>
        authApi.saveCourse(c.courseCode, {
          professorEmail: c.professorEmail || "",
          studentAccessCode: c.studentAccessCode || "",
          vaulted: !!c.vaulted,
          vaultUpdatedAt: c.vaultUpdatedAt || null,
          redactNames: c.redactNames !== false,
        })
      )
    )
      .then(() => setCourseSyncNote(""))
      .catch(() => setCourseSyncNote("Couldn't save your courses to your account — they're still saved on this device."));
  }

  // ─── INSTRUCTOR ACCOUNTS: session restore + course load ─────────────────────
  // Ask the server who we are on every load. A valid session cookie means the
  // instructor skips the sign-in screen entirely.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { user, legacy } = await authApi.me();
      if (cancelled) return;
      if (user) {
        setAuthUser(user);
        setStep((s) => (s === "login" ? "setup" : s));
        loadAccountCourses();
      } else if (legacy) {
        setAuthLegacy(true);
        setStep((s) => (s === "login" ? "setup" : s));
      }
    })();
    return () => { cancelled = true; };
  }, []); // run once on mount

  // Replace local course state with the account's courses. The roster is never
  // stored server-side, so entries come back roster-less — matching what
  // localStorage holds after the plaintext purge.
  async function loadAccountCourses() {
    try {
      const { courses: mine } = await authApi.listCourses();
      const withRoster = (mine || []).map((c) => ({
        courseCode: c.courseCode,
        professorEmail: c.professorEmail || "",
        studentAccessCode: c.studentAccessCode || "",
        vaulted: !!c.vaulted,
        vaultUpdatedAt: c.vaultUpdatedAt || null,
        redactNames: c.redactNames !== false,
        roster: [],
      }));
      setCourses(withRoster);
      try {
        localStorage.setItem(DM3A_COURSES_KEY, JSON.stringify(withRoster));
      } catch { /* storage unavailable */ }
    } catch {
      setCourseSyncNote("Couldn't load your courses from your account — showing what's saved on this device.");
    }
  }

  // Called by AuthGate once a session exists.
  function handleAuthed({ user, legacy }) {
    setAuthUser(user || null);
    setAuthLegacy(!!legacy);
    setStep("setup");
    setShowTierGuide(true);
    if (user) loadAccountCourses();
  }

  async function handleSignOut() {
    try { await authApi.logout(); } catch { /* sign out locally regardless */ }
    setAuthUser(null);
    setAuthLegacy(false);
    setCourses([]);
    setCourseSyncNote("");
    setStep("login");
    setShowLanding(true);
  }

  // One-time import of the courses sitting in THIS browser's localStorage. Skips
  // codes the account already has, so re-clicking (or importing from a second
  // machine) is safe.
  async function importLocalCourses() {
    setImportBusy(true);
    setCourseSyncNote("");
    try {
      const raw = localStorage.getItem(DM3A_COURSES_KEY);
      const local = raw ? JSON.parse(raw) : [];
      const payload = (Array.isArray(local) ? local : [])
        .filter((c) => c && c.courseCode)
        .map((c) => ({
          courseCode: c.courseCode,
          professorEmail: c.professorEmail || "",
          studentAccessCode: c.studentAccessCode || "",
          vaulted: !!c.vaulted,
          vaultUpdatedAt: c.vaultUpdatedAt || null,
          redactNames: c.redactNames !== false,
        }));
      if (!payload.length) {
        setCourseSyncNote("No courses found in this browser to import.");
        return;
      }
      const { imported, skipped } = await authApi.importCourses(payload);
      await loadAccountCourses();
      setCourseSyncNote(
        `Imported ${imported} course${imported === 1 ? "" : "s"}` +
        (skipped ? `, skipped ${skipped} already on your account.` : ".")
      );
    } catch (e) {
      setCourseSyncNote(e.message || "Could not import courses from this browser.");
    } finally {
      setImportBusy(false);
    }
  }

  // Parse pasted "Name, email" lines -> [{studentName, studentEmail}].
  // Trim fields, lowercase email, skip blank/invalid lines.
  // NOTE: named parseRosterLines (NOT parseRoster) to avoid colliding with the
  // pre-existing Blackboard parseRoster() below, which returns an ID->name map.
  // Function declarations hoist, so a duplicate name would shadow this one.
  // Unified roster schema (#9): every entry carries the full identity set so the
  // BB export can match by Username → Student ID → email → name.
  //   { studentName, studentEmail, lastName, firstName, bbUsername, studentId }
  function splitFullName(full) {
    const n = String(full || "").trim();
    if (!n) return { lastName: "", firstName: "" };
    if (n.includes(",")) { const [l, f] = n.split(","); return { lastName: l.trim(), firstName: (f || "").trim() }; }
    const p = n.split(/\s+/);
    return p.length <= 1 ? { lastName: n, firstName: "" } : { lastName: p[p.length - 1], firstName: p.slice(0, -1).join(" ") };
  }

  // Paste box: "Full Name, email" lines → the unified schema.
  function parseRosterLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => {
        const idx = line.indexOf(",");
        if (idx === -1) return null;
        const studentName = line.slice(0, idx).trim();
        const studentEmail = line.slice(idx + 1).trim().toLowerCase();
        if (!studentName || !studentEmail || !studentEmail.includes("@")) return null;
        const { lastName, firstName } = splitFullName(studentName);
        return { studentName, studentEmail, lastName, firstName, bbUsername: "", studentId: "" };
      })
      .filter(Boolean);
  }

  // BB Grade Center CSV → the unified schema (#9). Captures Last/First/Username/
  // Student ID/email. This is the canonical import so the export can round-trip.
  async function importBBRoster(course, file) {
    const Papa = (await import("papaparse")).default;
    const rows = await new Promise((resolve, reject) => {
      Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data || []), error: reject });
    });
    const n = (s) => String(s || "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/["']/g, "");
    const fields = rows.length ? Object.keys(rows[0]) : [];
    const pick = (cands) => { const m = new Map(fields.map((f) => [n(f), f])); for (const c of cands) { const h = m.get(n(c)); if (h) return h; } return null; };
    const hLast = pick(["Last Name", "LastName", "Last"]);
    const hFirst = pick(["First Name", "FirstName", "First"]);
    const hUser = pick(["Username", "User Name", "User Id", "UserId"]);
    const hId = pick(["Student ID", "StudentID", "Student Id"]);
    const hEmail = pick(["Email", "Email Address", "E-mail", "EmailAddress"]);
    const roster = rows.map((r) => {
      const lastName = hLast ? String(r[hLast] || "").trim() : "";
      const firstName = hFirst ? String(r[hFirst] || "").trim() : "";
      const bbUsername = hUser ? String(r[hUser] || "").trim() : "";
      return {
        lastName, firstName, bbUsername,
        studentName: `${firstName} ${lastName}`.trim() || bbUsername,
        studentId: hId ? String(r[hId] || "").trim() : "",
        studentEmail: hEmail ? String(r[hEmail] || "").trim().toLowerCase() : "",
      };
    }).filter((s) => s.lastName || s.bbUsername);
    if (!roster.length) throw new Error("No students detected — need a Last Name or Username column.");
    persistCourses(courses.map((c) => c.courseCode === course.courseCode ? { ...c, roster } : c));
    setVaultNote(`Imported ${roster.length} students from BB CSV into ${course.courseCode} — now set a passphrase and Secure the roster.`);
  }

  function rosterToText(roster) {
    return (roster || []).map((r) => `${r.studentName}, ${r.studentEmail}`).join("\n");
  }

  function addCourse() {
    const code = addCourseCode.trim();
    if (!code) return;
    if (courses.some((c) => c.courseCode.toLowerCase() === code.toLowerCase())) return; // no duplicate codes
    persistCourses([
      ...courses,
      { courseCode: code, professorEmail: addProfessorEmail.trim(), roster: [] },
    ]);
    setAddCourseCode("");
    setAddProfessorEmail("");
  }

  function deleteCourse(code) {
    persistCourses(courses.filter((c) => c.courseCode !== code));
    // Mirror the removal to the account. Best-effort: the encrypted roster vault
    // and grade history are untouched, exactly as before accounts existed.
    if (authUser) authApi.deleteCourse(code).catch(() => {});
    if (activeCourseCode === code) {
      setActiveCourseCode("");
      setProfessorEmail("");
      setActiveRoster([]);
    }
    if (editingCourseCode === code) setEditingCourseCode(null);
  }

  // Generate (or regenerate) a Student Access Code for a course. Requires the admin
  // key (server enforces it too). Regenerating passes the old code so the server
  // Set which dimensions a STUDENT's self-check scores for this course. Saved on
  // the course, and pushed to the live access code so it reaches students without
  // rotating the code. A missing admin key is not an error — the course still
  // remembers the choice and the next code mint carries it.
  async function setCourseStudentDims(course, key, checked) {
    const next = { ...ALL_DIMS, ...(course.studentDims || {}), [key]: checked };
    if (!Object.values(next).some(Boolean)) return; // never allow zero dimensions
    persistCourses(courses.map((c) => c.courseCode === course.courseCode ? { ...c, studentDims: next } : c));
    const code = course.studentAccessCode || "";
    const adminKey = (accessKeyInput || "").trim() || sessionStorage.getItem("dm3a_admin_key") || "";
    if (!code || !adminKey) return;
    try {
      const res = await fetch(`${SERVER_URL}/instructor/access-code/dims`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ code, dims: next }),
      });
      setAccessNote(res.ok
        ? `Student self-check scope updated for ${course.courseCode}.`
        : "Saved for this course, but the live access code could not be updated — enter your admin key and toggle again.");
    } catch {
      setAccessNote("Saved for this course, but the server could not be reached to update the live code.");
    }
  }

  // invalidates it immediately. The returned code is stored with the course.
  async function generateAccessCode(course, { regenerate = false } = {}) {
    const key = (accessKeyInput || "").trim();
    if (!key) { setAccessNote("Enter your admin key above to create access codes."); return; }
    if (regenerate && !window.confirm(`Regenerate the code for ${course.courseCode}? The current code (${course.studentAccessCode}) stops working immediately, and any student using it will need the new one.`)) return;
    setAccessNote("");
    setAccessBusy(course.courseCode);
    try {
      const res = await fetch(`${SERVER_URL}/instructor/access-code/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": key },
        body: JSON.stringify({
          course: course.courseCode,
          professorEmail: course.professorEmail || "",
          previousCode: regenerate ? (course.studentAccessCode || "") : "",
          dims: course.studentDims || ALL_DIMS,
        }),
      });
      if (res.status === 401) { setAccessNote("Admin key not accepted — check the key and try again."); return; }
      const data = await res.json();
      if (!res.ok || !data.code) { setAccessNote(data.error || "Could not create a code — try again."); return; }
      // Remember the working key for the session (shared with the admin dashboard).
      sessionStorage.setItem("dm3a_admin_key", key);
      persistCourses(courses.map((c) => c.courseCode === course.courseCode ? { ...c, studentAccessCode: data.code } : c));
      setAccessNote(`${regenerate ? "Regenerated" : "Created"} code for ${course.courseCode}: ${data.code}`);
    } catch {
      setAccessNote("Network error reaching the server — try again.");
    } finally {
      setAccessBusy("");
    }
  }

  function copyAccessCode(course) {
    const code = course.studentAccessCode || "";
    if (!code) return;
    try { navigator.clipboard?.writeText(code); } catch { /* clipboard unavailable */ }
    setCopiedCode(course.courseCode);
    setTimeout(() => setCopiedCode((c) => c === course.courseCode ? "" : c), 1500);
  }

  function startEdit(course) {
    setEditingCourseCode(course.courseCode);
    setEditCourseCode(course.courseCode);
    setEditProfessorEmail(course.professorEmail || "");
    setEditRosterText(rosterToText(course.roster));
  }

  function cancelEdit() {
    setEditingCourseCode(null);
  }

  function saveEdit() {
    const originalCode = editingCourseCode;
    const newCode = editCourseCode.trim();
    if (!newCode) return;
    const newEmail = editProfessorEmail.trim();
    const newRoster = parseRosterLines(editRosterText);
    const next = courses.map((c) =>
      c.courseCode === originalCode
        ? { courseCode: newCode, professorEmail: newEmail, roster: newRoster }
        : c
    );
    persistCourses(next);
    // A rename creates the new code on the account (via persistCourses); drop the
    // old one so it doesn't linger as a duplicate.
    if (authUser && newCode !== originalCode) authApi.deleteCourse(originalCode).catch(() => {});
    // Keep active selection in sync if the edited course is the active one.
    if (activeCourseCode === originalCode) {
      setActiveCourseCode(newCode);
      setProfessorEmail(newEmail);
      setActiveRoster(newRoster);
    }
    setEditingCourseCode(null);
  }

  // Active course selection: auto-fill professor email + load roster.
  function selectActiveCourse(code) {
    setActiveCourseCode(code);
    const profile = courses.find((c) => c.courseCode === code);
    setProfessorEmail(profile ? profile.professorEmail || "" : "");
    // Prefer the in-memory decrypted roster (secured courses); fall back to the
    // legacy plaintext roster (un-migrated courses). A secured+locked course
    // resolves to [] until the instructor unlocks it (graceful gate handles that).
    setActiveRoster(unlockedRosters[code] || (profile ? profile.roster || [] : []));
  }

  // Editing the active professor email also updates the saved profile.
  function updateActiveProfessorEmail(value) {
    setProfessorEmail(value);
    persistCourses(
      courses.map((c) =>
        c.courseCode === activeCourseCode ? { ...c, professorEmail: value } : c
      )
    );
  }

  // ── Blind Grading (Part A): vault migration + unlock + roster update ────────
  const courseByCode = (code) => courses.find((c) => c.courseCode === code);
  const isVaulted = (c) => !!(c && c.vaulted);
  // §3.3: automatic name-zone redaction runs on EVERY grading path by default —
  // no course, non-secured, or secured alike (privacy-first). The ONLY way it's off
  // is an explicit per-course opt-out (c.redactNames === false), which we log so a
  // deliberate skip is always visible in the console and never looks like a silent
  // failure. New courses have no such setting, so they default ON.
  const redactionOn = (c) => {
    if (c && c.redactNames === false) {
      console.log("[REDACT] skipped — disabled by course setting");
      return false;
    }
    return true;
  };
  const MIN_SCAN_WORDS = 6; // fewer OCR words than this on every page ⇒ treat as "couldn't scan" (blur/glare/angle)
  const REDACT_TIMEOUT_MS = 25000; // per-page OCR timeout — a stuck OCR must not hang grading

  // §3.3: redact the top-band name zone on one or more submission page images BEFORE
  // they are graded or stored. TWO PASSES:
  //   1) BEST-EFFORT browser pass — on a capable device this blacks out the name so it
  //      never leaves the browser. A browser OCR failure here is NON-fatal (iOS Safari
  //      OCR is unreliable); the server pass is the guarantee.
  //   2) AUTHORITATIVE server pass (/redact) — device-independent OCR that catches what
  //      the browser missed (e.g. iPad). FAIL CLOSED: if the server can't verify a page
  //      it throws a tagged error (err.isRedaction) and the grading path aborts, so an
  //      unverified image never reaches the payload.
  // Returns { pages, checked, redacted, maxWords, perPage }. `all` covers every page.
  async function redactPageImages(pages, { all = false } = {}) {
    const out = (pages || []).slice();
    const targets = all ? out.map((_, i) => i) : (out.length ? [0] : []);
    if (targets.length === 0) return { pages: out, checked: 0, redacted: 0, maxWords: 0, perPage: [] };

    // Pass 1 — best-effort browser redaction (keeps the name in the browser when it works).
    for (const i of targets) {
      try {
        const r = await Promise.race([
          redactNameZone(out[i], "REDACTED"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("OCR timed out")), REDACT_TIMEOUT_MS)),
        ]);
        out[i] = r.base64;
      } catch (e) {
        // Non-fatal: keep the original image and let the authoritative server pass handle it.
        console.warn(`[REDACT] browser pass could not verify page ${i + 1} — deferring to server:`, e && e.message);
      }
    }

    // Pass 2 — authoritative server redaction. FAIL CLOSED on any failure.
    let data;
    try {
      const resp = await fetch(`${SERVER_URL}/redact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: targets.map((i) => out[i]) }),
      });
      if (!resp.ok) throw new Error(`server responded ${resp.status}`);
      data = await resp.json();
    } catch (e) {
      const err = new Error(`Could not verify the name-zone redaction (${e && e.message}).`);
      err.isRedaction = true;
      throw err;
    }
    if (!data || !Array.isArray(data.images) || data.images.length !== targets.length) {
      const err = new Error("The redaction service returned an unexpected response.");
      err.isRedaction = true;
      throw err;
    }

    let redacted = 0, maxWords = 0;
    const perPage = new Array(out.length).fill(null);
    targets.forEach((i, k) => {
      out[i] = data.images[k];
      const pp = (data.perPage && data.perPage[k]) || {};
      const words = typeof pp.words === "number" ? pp.words : 0;
      perPage[i] = { redacted: !!pp.redacted, words };
      if (pp.redacted) redacted++;
      maxWords = Math.max(maxWords, words);
    });

    const coverage = redacted > 0
      ? `covered a name on ${redacted} of ${targets.length} page(s)`
      : `no name detected in the name zone`;
    console.log(`[REDACT] processed ${targets.length} page(s) via server safety net — ${coverage}`);
    return { pages: out, checked: targets.length, redacted, maxWords, perPage };
  }

  // #26/§3.3 SINGLE SOURCE OF TRUTH. The banner count and the per-student badges are
  // derived from ONE artifact: the per-result redaction fields (_subId/_pageRedacted/
  // _pageScanned). Deduped by submission so a student Claude split into multiple result
  // objects is never double-counted. A page whose OCR read almost nothing (MIN_SCAN_WORDS)
  // is reported as "couldn't scan — verify manually", NOT silently as "no name detected".
  function deriveRedactStats(entries) {
    // entries: [{ subId, redacted, scanned, present } | null]. present = the submission
    // actually went through OCR (had a page image). Deduped by subId.
    const bySub = new Map();
    for (const e of entries || []) {
      if (!e || e.subId == null || !e.present) continue;
      const cur = bySub.get(e.subId) || { redacted: false, scanned: false };
      bySub.set(e.subId, { redacted: cur.redacted || !!e.redacted, scanned: cur.scanned || !!e.scanned });
    }
    let checked = 0, redacted = 0, unscanned = 0;
    for (const v of bySub.values()) { checked++; if (v.redacted) redacted++; else if (!v.scanned) unscanned++; }
    return { checked, redacted, unscanned, noun: "submissions" };
  }

  // ── Blind Grading (Part B): client-side name overlay ────────────────────────
  // Alias→name index for the ACTIVE course, built from the in-memory decrypted
  // roster. Display-only: nothing here changes what is sent to the server.
  const nameIndex = useMemo(
    () => buildNameIndex(unlockedRosters[activeCourseCode] || []),
    [unlockedRosters, activeCourseCode]
  );
  const namesUnlocked = !!unlockedRosters[activeCourseCode];
  const activeVaulted = isVaulted(courseByCode(activeCourseCode));
  const activeVaultedLocked = activeVaulted && !namesUnlocked;
  // A known alias renders as the real name once unlocked; anything else (a real
  // name from a legacy course, or an unknown value) passes through unchanged.
  const showName = (value) => (namesUnlocked && nameIndex.isAlias(value) ? nameIndex.toName(value) : value);
  // "Real Name (ALIAS)" for the results tabs/headers when unlocked; passes the raw
  // value through otherwise (locked → alias; non-blind → the name as-is).
  const showNameWithAlias = (value) =>
    (namesUnlocked && nameIndex.isAlias(value) ? `${nameIndex.toName(value)} (${value})` : value);

  // #33: a BB-download batch labels each result "Student_<username>". Recover that
  // username (a JOIN KEY only — never displayed, never sent) so it can be matched
  // against the vault's stored BB usernames.
  const bbUsernameOf = (studentName) => {
    const m = /^student[_-](.+)$/i.exec(String(studentName || "").trim());
    return m ? m[1].trim() : "";
  };
  // #32: the roster student's display name for a chosen mapping value (alias | email).
  const rosterLabelForValue = (val) => {
    if (!val) return "";
    const r = (activeRoster || []).find((rr) => (activeVaulted ? rr.alias : rr.studentEmail) === val);
    return r ? (r.studentName || val) : val;
  };
  // #32: indices (other than `self`) already mapped to the same roster student.
  const duplicateMapIndices = (val, self) =>
    !val ? [] : results.map((_s, j) => j).filter((j) => j !== self && studentMapping[j] === val);

  function downloadKeyBackup(courseCode, blob) {
    try {
      const b = new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${courseCode}-roster-key.dm3a`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* download best-effort */
    }
  }

  // Wrap a vault op with busy state + error surfacing (never throws to the UI).
  async function runVault(fn) {
    setVaultBusy(true);
    setVaultNote("");
    try { await fn(); }
    catch (e) { setVaultNote(`⚠ ${e.message || "Vault operation failed."}`); }
    finally { setVaultBusy(false); }
  }

  // Graceful gate: open the inline unlock prompt. onUnlocked(roster) runs on success.
  function openUnlock(courseCode, message, onUnlocked) {
    setUnlockPass("");
    setUnlockError("");
    setUnlockPrompt({ courseCode, message, onUnlocked: onUnlocked || (() => {}) });
  }

  // Decrypt a course's server vault with the entered passphrase; hold in memory only.
  async function doUnlock() {
    if (!unlockPrompt) return;
    const code = unlockPrompt.courseCode;
    setUnlockError("");
    if (!unlockPass || unlockPass.length < MIN_PASSPHRASE_LEN) {
      setUnlockError(`Passphrase must be at least ${MIN_PASSPHRASE_LEN} characters.`);
      return;
    }
    setVaultBusy(true);
    try {
      const vault = await getVault(code);
      if (!vault) { setUnlockError("No secured roster found for this course."); return; }
      const mapping = await decryptMapping(vault.blob, unlockPass); // throws cleanly on wrong pass
      const roster = (mapping.students || []).filter((s) => !s.dropped);
      setUnlockedRosters((m) => ({ ...m, [code]: roster }));
      setSessionPass((m) => ({ ...m, [code]: unlockPass }));
      if (activeCourseCode === code) setActiveRoster(roster);
      const cb = unlockPrompt.onUnlocked;
      setUnlockPrompt(null);
      setUnlockPass("");
      cb(roster);
    } catch (e) {
      setUnlockError(e.message || "Unlock failed — wrong passphrase?");
    } finally {
      setVaultBusy(false);
    }
  }

  // Encrypt a course's plaintext roster into the vault, READ-BACK VERIFY, download
  // a backup key by default, THEN purge the plaintext PII from localStorage.
  async function secureCourse(course, passphrase) {
    if (!passphrase || passphrase.length < MIN_PASSPHRASE_LEN) {
      throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LEN} characters. There is NO recovery — DM3A cannot reset it.`);
    }
    const base = Array.isArray(course.roster) ? course.roster : [];
    if (base.length === 0) throw new Error("This course has no roster to secure yet — add students first.");

    // #19: the SERVER is the source of truth for whether a vault exists (the local
    // `vaulted` flag can be stale across devices / the /blind flow). Never silently
    // regenerate aliases — that orphans printed cards + labeled work in flight.
    const existingVault = await getVault(course.courseCode);
    if (existingVault) {
      const when = existingVault.updatedAt ? new Date(existingVault.updatedAt).toLocaleDateString() : "earlier";
      const proceed = window.confirm(
        `⚠ ${course.courseCode} already has aliases (secured ${when}).\n\n` +
        `Re-securing REPLACES ALL of them — printed alias cards and any labeled work already in flight will stop matching.\n\n` +
        `To add or remove students while KEEPING existing aliases, cancel and use "Update roster (CSV)" instead.\n\n` +
        `Replace ALL aliases anyway?`
      );
      if (!proceed) throw new Error("Re-secure cancelled — use Update roster (CSV) to keep existing aliases.");
    }

    const withAliases = assignAliases(base, course.courseCode); // {studentName, studentEmail} + .alias
    const createdAt = new Date().toISOString();
    const mapping = { courseId: course.courseCode, version: 1, createdAt, students: withAliases };
    const blob = await encryptMapping(mapping, passphrase);
    await putVault(course.courseCode, blob);
    // Read-back verify BEFORE purging the plaintext copy (lazy, safe migration).
    const check = await getVault(course.courseCode);
    const rt = check && (await decryptMapping(check.blob, passphrase));
    if (!rt || (rt.students || []).length !== withAliases.length) {
      throw new Error("Vault read-back verification failed — plaintext NOT purged. Please retry.");
    }
    downloadKeyBackup(course.courseCode, blob); // backup by default
    // Purge plaintext PII from localStorage; keep metadata + vault flag.
    persistCourses(courses.map((c) => c.courseCode === course.courseCode
      ? { ...c, roster: [], vaulted: true, vaultCreatedAt: createdAt, vaultUpdatedAt: check.updatedAt || createdAt }
      : c));
    setUnlockedRosters((m) => ({ ...m, [course.courseCode]: withAliases }));
    setSessionPass((m) => ({ ...m, [course.courseCode]: passphrase }));
    if (activeCourseCode === course.courseCode) setActiveRoster(withAliases);
  }

  // Re-upload a roster CSV → diff against the decrypted mapping (alias continuity)
  // → re-encrypt → store. Requires the course to be unlocked this session.
  async function updateRosterFromCsv(course, file) {
    const passphrase = sessionPass[course.courseCode];
    const existing = unlockedRosters[course.courseCode];
    if (!passphrase || !existing) {
      openUnlock(course.courseCode, "Enter your course passphrase to update its roster.", () => {});
      return;
    }
    const Papa = (await import("papaparse")).default;
    const rows = await new Promise((resolve, reject) => {
      Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data || []), error: reject });
    });
    const norm = (s) => String(s || "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/["']/g, "");
    const fields = rows.length ? Object.keys(rows[0]) : [];
    const pick = (cands) => { const m = new Map(fields.map((f) => [norm(f), f])); for (const c of cands) { const h = m.get(norm(c)); if (h) return h; } return null; };
    const hLast = pick(["Last Name", "LastName", "Last"]);
    const hFirst = pick(["First Name", "FirstName", "First"]);
    const hUser = pick(["Username", "User Name", "User Id", "UserId"]);
    const hId = pick(["Student ID", "StudentID", "Student Id", "ID"]);
    const incoming = rows.map((r) => ({
      lastName: hLast ? String(r[hLast] || "").trim() : "",
      firstName: hFirst ? String(r[hFirst] || "").trim() : "",
      studentName: `${hFirst ? r[hFirst] : ""} ${hLast ? r[hLast] : ""}`.trim(),
      bbUsername: hUser ? String(r[hUser] || "").trim() : "",
      studentId: hId ? String(r[hId] || "").trim() : "",
    })).filter((s) => s.lastName || s.bbUsername);
    if (incoming.length === 0) throw new Error("No students detected in that CSV (need a Last Name or Username column).");
    const { merged, added, dropped } = diffRoster(existing, incoming, course.courseCode);
    const mapping = { courseId: course.courseCode, version: 1, createdAt: new Date().toISOString(), students: merged };
    const blob = await encryptMapping(mapping, passphrase);
    await putVault(course.courseCode, blob);
    const live = merged.filter((s) => !s.dropped);
    setUnlockedRosters((m) => ({ ...m, [course.courseCode]: live }));
    if (activeCourseCode === course.courseCode) setActiveRoster(live);
    persistCourses(courses.map((c) => c.courseCode === course.courseCode ? { ...c, vaultUpdatedAt: new Date().toISOString() } : c));
    setVaultNote(`Roster updated for ${course.courseCode}: ${added.length} added, ${dropped.length} dropped (flagged, not deleted).`);
  }

  // #21: print alias cards for an UNLOCKED course (read the codes to distribute).
  async function printAliasCards(course) {
    const roster = unlockedRosters[course.courseCode] || [];
    if (!roster.length) { setVaultNote("Unlock this course first to view/print alias cards."); return; }
    const { buildAliasCardPdf } = await import("./blind/aliasCardPdf.js");
    const bytes = await buildAliasCardPdf(course.courseCode, roster, course.vaultCreatedAt);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${course.courseCode}-alias-cards.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Purge a course's server vault + in-memory copies (per-course purge button).
  async function purgeCourseVault(course) {
    await deleteVault(course.courseCode);
    setUnlockedRosters((m) => { const n = { ...m }; delete n[course.courseCode]; return n; });
    setSessionPass((m) => { const n = { ...m }; delete n[course.courseCode]; return n; });
    persistCourses(courses.map((c) => c.courseCode === course.courseCode ? { ...c, vaulted: false, vaultUpdatedAt: null } : c));
    if (activeCourseCode === course.courseCode) setActiveRoster([]);
    setVaultNote(`Secured roster purged for ${course.courseCode}.`);
  }

  // ─── PHASE 3 STEP 2: ROSTER CONFIRMATION (state only; nothing sent to server) ──
  // When a grading run produces a new result set, clear any prior confirmation and
  // auto-map each graded studentName to a roster entry by case-insensitive EXACT
  // match. Unmatched names default to Skip (""). No fuzzy guessing. This also
  // satisfies "reset confirmedRoster at the start of each new grading run."
  useEffect(() => {
    setConfirmedRoster([]);
    setRosterConfirmed(false);
    setTrackingNote("");
    if (!activeCourseCode || activeRoster.length === 0 || results.length === 0) {
      setStudentMapping({});
      return;
    }
    const norm = (v) => String(v || "").trim().toLowerCase();
    const mapping = {};
    const auto = {};
    results.forEach((s, i) => {
      if (activeVaulted) {
        // Blind: the AI read the student's alias; map it to the roster alias.
        // normalizeAlias absorbs OCR whitespace ("TEST 11 - UEGR" → "TEST11-UEGR").
        const match = activeRoster.find((r) => normalizeAlias(r.alias) === normalizeAlias(s.studentName));
        if (match) { mapping[i] = match.alias; return; }
        // #33: no alias on the sheet (a BB-download batch) — join the submission's
        // source-filename username against the vault's stored BB username. The username
        // is a key only; it is never displayed and never leaves the browser.
        const user = bbUsernameOf(s.studentName);
        const userMatch = user ? activeRoster.find((r) => r.bbUsername && norm(r.bbUsername) === norm(user)) : null;
        if (userMatch) { mapping[i] = userMatch.alias; auto[i] = true; return; }
        mapping[i] = ""; // Skip (not in vault)
      } else {
        const match = activeRoster.find((r) => norm(r.studentName) === norm(s.studentName));
        mapping[i] = match ? match.studentEmail : ""; // "" = Skip
      }
    });
    setStudentMapping(mapping);
    setAutoMatched(auto);
  }, [results, activeCourseCode, activeRoster, activeVaulted]);

  // ── Desync fix: activeRoster is a MIRROR of the unlock state, never a separate
  // source that can drift from the doorway/Manage-Courses card. Both surfaces and
  // this all read unlockedRosters, so they stay consistent by construction.
  useEffect(() => {
    const profile = courses.find((c) => c.courseCode === activeCourseCode);
    setActiveRoster(unlockedRosters[activeCourseCode] || (profile ? profile.roster || [] : []));
  }, [unlockedRosters, activeCourseCode, courses]);

  // ── Finding #16 (1): persist the active session — BLIND-SAFE. Only for a
  // vaulted course (results are alias-keyed by construction), and only if a
  // plaintext scan against the unlocked mapping comes back clean. Never persists
  // activeRoster or the unlocked mapping (those hold real names).
  useEffect(() => {
    try {
      if (step !== "results" || results.length === 0 || !activeVaulted) return;
      const snap = {
        v: 1, savedAt: Date.now(), courseCode: activeCourseCode, count: results.length,
        subject, assignment, assignmentWeight, assignmentIndex, semesterTag,
        results, overrides, studentMapping, activeStudent,
      };
      if (namesUnlocked) {
        const secrets = (unlockedRosters[activeCourseCode] || []).flatMap((r) => [r.studentName, r.studentEmail]).filter(Boolean);
        if (secrets.length && findPlaintext(snap, secrets).length > 0) return; // a real name slipped in — don't persist
      }
      localStorage.setItem(DM3A_SESSION_KEY, JSON.stringify(snap));
    } catch { /* storage unavailable */ }
  }, [step, results, overrides, studentMapping, activeStudent, activeCourseCode, subject, assignment, assignmentWeight, assignmentIndex, semesterTag, activeVaulted, namesUnlocked, unlockedRosters]);

  // Restore-on-mount: offer resume if a recent snapshot exists for a known course.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DM3A_SESSION_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.results) || !snap.results.length) return;
      if (Date.now() - (snap.savedAt || 0) > SESSION_MAX_AGE_MS) { localStorage.removeItem(DM3A_SESSION_KEY); return; }
      setPendingResume({ courseCode: snap.courseCode, count: snap.count || snap.results.length, savedAt: snap.savedAt });
    } catch { /* ignore malformed */ }
  }, []);

  // ── Finding #16 (2): SPA history — Back navigates views instead of exiting. ──
  useEffect(() => {
    if (fromPop.current) { fromPop.current = false; return; }
    if (step === "grading") return; // transient — don't create a Back target on the spinner
    const state = { dm3aStep: step, showLanding, isStudentMode };
    if (!histReady.current) { window.history.replaceState(state, ""); histReady.current = true; }
    else { window.history.pushState(state, ""); }
  }, [step, showLanding, isStudentMode]);
  useEffect(() => {
    const onPop = (e) => {
      fromPop.current = true;
      const s = e.state || { dm3aStep: "login", showLanding: true };
      setStep(s.dm3aStep || "login");
      setShowLanding(s.showLanding !== undefined ? s.showLanding : true);
      setIsStudentMode(!!s.isStudentMode);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Self-heal stale cached clients (privacy-critical): a phone can keep running an old
  // cached version that predates a redaction fix and would skip the server safety net.
  // On load AND when a backgrounded tab is reopened (bfcache), compare the running
  // bundle hash to the deployed one and reload ONCE if they differ. sessionStorage guard
  // prevents any reload loop.
  useEffect(() => {
    const runningHash = (([...document.scripts].map(s => s.src).find(s => /\/index-[A-Za-z0-9_-]+\.js/.test(s))) || "").match(/index-([A-Za-z0-9_-]+)\.js/)?.[1];
    if (!runningHash) return; // dev server / no hashed bundle — nothing to compare
    const check = async () => {
      try {
        const html = await fetch("/", { cache: "no-store" }).then(r => r.text());
        const latestHash = (html.match(/index-([A-Za-z0-9_-]+)\.js/) || [])[1];
        const key = "dm3a_reloaded_" + latestHash;
        if (latestHash && latestHash !== runningHash && !sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          console.warn("[VERSION] newer app deployed — reloading to stay current");
          window.location.reload();
        }
      } catch { /* offline / fetch failed — ignore */ }
    };
    check();
    const onShow = (e) => { if (e.persisted) check(); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // Live-check the student's class code as they type (debounced). Drives the status
  // line and whether the email field is shown/required — a valid code hides it.
  useEffect(() => {
    const code = (studentClassCode || "").trim();
    if (!code) { setCodeStatus("idle"); setCodeCourse(""); return; }
    setCodeStatus("checking");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${SERVER_URL}/code-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        // A valid code carries the instructor's scoring scope for that course, so a
        // student self-checking a true/false quiz is not scored on Work Shown.
        if (data.valid && data.dims) setActiveDims({ ...ALL_DIMS, ...data.dims });
        if (data.valid && data.allowed) { setCodeStatus("valid"); setCodeCourse(data.course || ""); }
        else if (data.valid && !data.allowed) { setCodeStatus("capped"); setCodeCourse(data.course || ""); }
        else { setCodeStatus("invalid"); setCodeCourse(""); }
      } catch { setCodeStatus("error"); setCodeCourse(""); }
    }, 700);
    return () => clearTimeout(t);
  }, [studentClassCode]);

  // ── Finding #16 (3): warn before unload while a graded session is open. ──
  useEffect(() => {
    if (!(step === "results" && results.length > 0)) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [step, results.length]);

  // Restore a persisted session into the results view (alias-keyed; names require unlock).
  function resumeSession() {
    try {
      const snap = JSON.parse(localStorage.getItem(DM3A_SESSION_KEY) || "null");
      if (!snap || !Array.isArray(snap.results)) { setPendingResume(null); return; }
      setResults(snap.results);
      setOverrides(snap.overrides || {});
      setStudentMapping(snap.studentMapping || {});
      setActiveStudent(snap.activeStudent || 0);
      setSubject(snap.subject || "");
      setAssignment(snap.assignment || "");
      if (snap.assignmentWeight) setAssignmentWeight(snap.assignmentWeight);
      if (snap.assignmentIndex !== undefined) setAssignmentIndex(snap.assignmentIndex);
      if (snap.semesterTag) setSemesterTag(snap.semesterTag);
      if (snap.courseCode) selectActiveCourse(snap.courseCode);
      // Resumed sessions carry no thumbnails/redaction counts (not persisted); clear
      // any stale per-run notices so they don't bleed across sessions. (#23/#25)
      setSubmissionImages([]); setRedactStats(null); setRedactWarning(false); setBbStubNote(0);
      setPendingResume(null);
      setShowLanding(false);
      setStep("results");
    } catch { setPendingResume(null); }
  }
  function dismissResume() {
    setPendingResume(null);
    try { localStorage.removeItem(DM3A_SESSION_KEY); } catch { /* ignore */ }
  }

  // Confirm = build the roster NOW from the current result names + selections
  // (keyed to each result's CURRENT studentName, so it cannot diverge), then
  // POST { riskContext, results } to /api/risk/record. The /grade body is never
  // touched; nothing here re-grades. Non-blocking: status goes into trackingNote.
  async function confirmRoster() {
    // Graceful gate: a secured course must be unlocked before we can map names.
    // Show the inline unlock prompt (a doorway) rather than silently recording nothing.
    const activeCourse = courseByCode(activeCourseCode);
    if (isVaulted(activeCourse) && !unlockedRosters[activeCourseCode]) {
      openUnlock(
        activeCourseCode,
        "Enter your course passphrase to record at-risk tracking.",
        () => setVaultNote('Course unlocked — click “Confirm & record” again to record.')
      );
      return;
    }
    // #32: a roster student mapped to >1 submission loses a grade unless the student
    // genuinely submitted more than once. Require an explicit override, not a hard block.
    const usedBy = {};
    results.forEach((_s, i) => { const v = studentMapping[i]; if (v) (usedBy[v] = usedBy[v] || []).push(i); });
    const dups = Object.entries(usedBy).filter(([, idxs]) => idxs.length > 1);
    if (dups.length) {
      const lines = dups.map(([v, idxs]) => `• ${rosterLabelForValue(v)} → Submissions ${idxs.map((j) => j + 1).join(", ")}`).join("\n");
      if (!window.confirm(`${dups.length} student${dups.length === 1 ? " is" : "s are"} assigned to more than one submission:\n\n${lines}\n\nThis is only correct if the student actually submitted more than once — otherwise a grade will be lost. Record anyway?`)) {
        return;
      }
    }
    // Build the recording roster + payload. Blind (vaulted) courses send
    // ALIAS-ONLY records — no studentName/studentEmail ever leaves the browser.
    // Legacy courses send name + email exactly as before.
    let roster, payloadResults;
    if (activeVaulted) {
      const chosen = results
        .map((s, i) => ({ s, alias: studentMapping[i] || "" }))
        .filter((e) => e.alias);
      roster = chosen.map((e) => ({ alias: e.alias }));
      payloadResults = chosen.map(({ s, alias }) => ({
        alias,
        overallTier: s.overallTier ?? s.tier,
        dimensions: s.dimensions,
        feedback: s.feedback,
      }));
    } else {
      roster = results
        .map((s, i) => ({ studentName: s.studentName, studentEmail: studentMapping[i] || "" }))
        .filter((e) => e.studentEmail);
      payloadResults = results;
    }
    setConfirmedRoster(roster);
    setRosterConfirmed(true);

    // Only send when there's something to track and we have a professor email.
    if (!activeCourseCode || !professorEmail.trim() || roster.length === 0) {
      setTrackingNote("");
      return;
    }

    const riskContext = {
      professorEmail,
      courseCode: activeCourseCode,
      assignmentName: assignment || "Student Submission",
      assignmentWeight,
      assignmentIndex: assignmentIndex === "" ? undefined : Number(assignmentIndex),
      semesterTag,
      roster,
    };

    // Zero-plaintext guard (live §6 assertion): for a blind course, REFUSE to
    // send if any real name/email from the decrypted roster leaked into the
    // payload. A doorway to fix, not a silent leak.
    if (activeVaulted) {
      const secrets = (unlockedRosters[activeCourseCode] || [])
        .flatMap((r) => [r.studentName, r.studentEmail])
        .filter(Boolean);
      const leaks = findPlaintext({ riskContext, results: payloadResults }, secrets);
      if (leaks.length > 0) {
        setTrackingNote(`Blocked: a name/email would have been sent (${leaks[0].path}). Nothing was transmitted.`);
        return;
      }
    }

    setTrackingNote("Recording at-risk tracking…");
    try {
      const res = await fetch(`${SERVER_URL}/api/risk/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskContext, results: payloadResults }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setTrackingNote(`At-risk tracking failed${data.error ? `: ${data.error}` : ""}.`);
        return;
      }
      let note = `At-risk tracking: recorded ${data.recorded} student${data.recorded === 1 ? "" : "s"} for ${activeCourseCode}`;
      if (data.skipped) note += ` · ${data.skipped} skipped`;
      if (data.alertsFired > 0) note += ` · ${data.alertsFired} alert${data.alertsFired === 1 ? "" : "s"} sent`;
      setTrackingNote(note + ".");
    } catch (err) {
      setTrackingNote(`At-risk tracking failed: ${err.message}`);
    }
  }

  // ─── LOGIN ────────────────────────────────────────────────────────────────

  // ─── BB FILENAME PARSER ───────────────────────────────────────────────────
  function parseBBFilename(filename) {
    // Pattern: anything_STUDENTID_attempt_YYYY-MM-DD-HH-MM-SS_originalname.ext
    // studentId may be numeric (01560658) or alphanumeric username (mdecker)
    const match = filename.match(/^(.+?)_([a-zA-Z0-9_]{2,20})_attempt_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})_(.+)$/i);
    if (!match) return null;
    return { studentId: match[2], timestamp: match[3], originalName: match[4] };
  }

  function isDocx(file) {
    return file.name.toLowerCase().endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  async function convertOnServer(file, endpoint) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result.split(',')[1];
          // Privacy (Change 4): never send the student's real filename (e.g. "Jane Doe.pdf")
          // off the device. The server only uses this to swap the extension on the output,
          // so a generic "submission.<ext>" is all it needs.
          const safeExt = (file.name.split('.').pop() || 'bin').toLowerCase();
          const safeName = `submission.${safeExt}`;
          console.log('[convertOnServer] calling', endpoint, 'base64 length:', base64?.length);
          const res = await fetch(`${SERVER_URL}/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, filename: safeName })
          });
          console.log('[convertOnServer] response status:', res.status);
          const data = await res.json();
          console.log('[convertOnServer] response data keys:', Object.keys(data));
          if (data.error) { console.error('[convertOnServer] server error:', data.error); resolve(null); return; }
          const isHeic = endpoint === 'convert-heic';
          const b64 = isHeic ? data.jpeg : data.pdf;
          const newFilename = isHeic
            ? file.name.replace(/\.(heic|heif)$/i, '.jpg')
            : file.name.replace(/\.docx$/i, '.pdf');
          const mimeType = isHeic ? 'image/jpeg' : 'application/pdf';
          const byteArr = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          resolve(new File([byteArr], newFilename, { type: mimeType }));
        } catch (e) { console.warn(`[${endpoint}] failed:`, e.message); resolve(null); }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  async function convertDocxToPdf(file) {
    const converted = await convertOnServer(file, 'convert-docx');
    if (!converted) throw new Error('Server DOCX conversion failed — check Railway logs');
    return converted;
  }

  function groupBBFiles(files) {
    const isGradable = f =>
      looksLikeImage(f) ||
      f.type === "application/pdf" ||
      f.name.toLowerCase().endsWith(".pdf") ||
      f.name.toLowerCase().endsWith(".docx") ||
      f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const groups = {};
    files.filter(isGradable).forEach(f => {
      const parsed = parseBBFilename(f.name);
      const key = parsed ? parsed.studentId : "UNRECOGNIZED";
      if (!groups[key]) groups[key] = { studentId: key, files: [] };
      if (!groups[key].files.some(existing => existing.file.name === f.name)) {
        groups[key].files.push({ file: f, timestamp: parsed ? parsed.timestamp : "0" });
      }
    });
    // Sort each group's files by timestamp ascending
    Object.values(groups).forEach(g => {
      g.files.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    });
    return Object.values(groups);
  }

  function parseRoster(text) {
    // Supports UTF-16 TSV (Blackboard export) and plain CSV/TSV
    // Indexes by both numeric Student ID and Username so either format matches
    const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
    if (lines.length < 2) return {};
    const sep = lines[0].includes("\t") ? "\t" : ",";
    const headers = lines[0].split(sep).map(h => h.replace(/"/g, "").trim().toLowerCase());
    const lastIdx = headers.findIndex(h => h.includes("last"));
    const firstIdx = headers.findIndex(h => h.includes("first"));
    const idIdx = headers.findIndex(h => h.includes("student id") || h === "id");
    const usernameIdx = headers.findIndex(h => h === "username" || h.includes("user name"));
    if (lastIdx === -1 || firstIdx === -1) return {};
    const map = {};
    lines.slice(1).forEach(line => {
      const cols = line.split(sep).map(c => c.replace(/"/g, "").trim());
      const last = cols[lastIdx] || "";
      const first = cols[firstIdx] || "";
      if (!last) return;
      const fullName = `${last}, ${first}`;
      // Index by numeric student ID (for ID-based BB filenames)
      if (idIdx !== -1) {
        const id = cols[idIdx]?.replace(/\D/g, "").padStart(8, "0");
        if (id) map[id] = fullName;
      }
      // Also index by username (for username-based BB filenames like "mdecker")
      if (usernameIdx !== -1) {
        const username = cols[usernameIdx]?.trim().toLowerCase();
        if (username) map[username] = fullName;
      }
    });
    return map;
  }

  // Sign-in now lives in src/auth/AuthGate.jsx (accounts + the shared-password
  // and trial-password fallbacks). handleAuthed() above takes it from there.

  // ─── FILE HELPERS ─────────────────────────────────────────────────────────

  async function fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(",")[1]);
      r.onerror = () => rej(new Error("Read failed"));
      r.readAsDataURL(file);
    });
  }

  function isImage(file) {
    return file?.type?.startsWith("image/");
  }

  // Auto-compress images to stay under 1MB before sending to API
  // Handles large phone camera photos (3-8MB) transparently
  async function convertHeicToJpeg(file) {
    // Dynamically load heic2any only when needed
    const heic2any = (await import("https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js")).default;
    const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const jpegBlob = Array.isArray(blob) ? blob[0] : blob;
    return new File([jpegBlob], file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg"), { type: "image/jpeg" });
  }

  // Decodes any image format the browser supports (including HEIC on WebKit/Safari/Chrome-Mac),
  // draws it to a canvas, and returns a clean standard JPEG base64 string.
  // This strips EXIF, ICC profiles, and wide-gamut colour spaces at the client side.
  async function convertToJpegViaCanvas(file, quality = 0.75, maxDimension = 1600, { index, total } = {}) {
    const label = index != null ? `${index} of ${total}` : "";
    const originalKB = (file.size / 1024).toFixed(0);
    console.log(`Converting image ${label}: [submission] (${originalKB} KB)`);

    const conversionPromise = new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error("canvas.toBlob returned null")); return; }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }, "image/jpeg", quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Browser could not decode image: ${file.name}`));
      };
      img.src = url;
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 10000)
    );

    try {
      const b64 = await Promise.race([conversionPromise, timeoutPromise]);
      const outKB = (b64.length * 0.75 / 1024).toFixed(0);
      console.log(`Converted [submission]: ${originalKB}KB -> ${outKB}KB`);
      return b64;
    } catch(e) {
      const isHeicExt = /\.(heic|heif)$/i.test(file?.name || "");
      if (isHeicExt) {
        console.warn(`[canvas failed] [submission]: HEIC conversion failed — returning null (not sending raw bytes)`);
        return null;
      }
      console.warn(`[canvas failed] [submission]: ${e.message} — sending raw for server-side conversion`);
      return fileToBase64(file);
    }
  }

  async function compressImage(file, maxSizeMB = 3.0, maxDimension = 2400) {
    // Always route through canvas — this natively handles HEIC on WebKit, strips EXIF/ICC,
    // and produces a clean JPEG regardless of the input format or colour profile.
    try {
      return await convertToJpegViaCanvas(file, 0.85, maxDimension);
    } catch(e) {
      console.warn("convertToJpegViaCanvas failed, falling back to fileToBase64:", e.message);
      return fileToBase64(file);
    }
  }

  function looksLikeImage(file) {
    return file?.type?.startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file?.name || "");
  }

  async function pdfToImages(file, maxPages = 16, maxDimension = 1200, quality = 0.75, onPages) {
    console.log(`[pdfToImages] called: [submission] type="${file?.type}" maxPages=${maxPages}`);
    if (looksLikeImage(file)) {
      console.warn(`[pdfToImages] BLOCKED — image file passed to pdfToImages (type=${file?.type}) — returning empty array`);
      return [];
    }
    try {
      const pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      console.log(`[pdfToImages] pdf.numPages=${pdf.numPages} maxPages=${maxPages}`);
      // #18: report page usage so the instructor is never silently given a partial file.
      if (typeof onPages === "function") onPages({ name: file?.name, numPages: pdf.numPages, used: Math.min(pdf.numPages, maxPages) });
      if (pdf.numPages > 20) console.warn(`[pdfToImages] PDF.js may be misreading page count — pdf.numPages=${pdf.numPages} seems too high`);
      const images = [];
      // Use try-catch per page rather than trusting pdf.numPages, which can misreport
      for (let pageNum = 1; pageNum <= Math.min(pdf.numPages, maxPages); pageNum++) {
        let page;
        try {
          page = await pdf.getPage(pageNum);
        } catch {
          break; // no more pages in the actual page tree
        }
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(maxDimension / viewport.width, maxDimension / viewport.height);
        const scaledViewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: scaledViewport }).promise;
        console.log('[pdfToImages] canvas size:', canvas.width, 'x', canvas.height, 'scale:', scale);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        console.log('[pdfToImages] page', pageNum, 'b64 preview:', dataUrl.split(",")[1].slice(0, 50), 'isJpeg:', dataUrl.split(",")[1].startsWith('/9j/'));
        images.push(dataUrl.split(",")[1]);
      }
      console.log(`[pdfToImages] produced ${images.length} images`);
      return images;
    } catch (err) {
      console.error(`[pdfToImages] failed for submission (type=${file?.type}):`, err);
      throw err;
    }
  }

  async function uploadPDF(base64) {
    const resp = await fetch(`${SERVER_URL}/upload-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mediaType: "application/pdf" })
    });
    const respText = await resp.text();
    if (!resp.ok) {
      let errMsg = `Upload failed: HTTP ${resp.status}`;
      try { errMsg = JSON.parse(respText).error || errMsg; } catch { errMsg = respText || errMsg; }
      throw new Error(errMsg);
    }
    let file_id;
    try { file_id = JSON.parse(respText).file_id; } catch {}
    return file_id;
  }

  // Converts any file (PDF or image) into Anthropic image content blocks.
  // #20: read a PDF's page count (answer key is sent whole as a document block).
  async function getPdfPageCount(file) {
    try {
      const pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      return pdf.numPages;
    } catch { return null; }
  }

  // #18: record when a reference file is truncated so it can be surfaced.
  const notePages = (info) => {
    if (info && info.numPages > info.used) {
      setPageNotes((prev) => [...prev.filter((n) => n.name !== info.name), info]);
    }
  };

  // All PDFs go through pdfToImages so Claude can read handwritten/scanned content.
  // #18: default raised 3 → 15 so multi-page reference material isn't silently
  // truncated. onPages surfaces "Using X of Y pages" to the instructor.
  async function fileToImageBlocks(file, maxPages = 15, onPages) {
    console.log(`[fileToImageBlocks] "[submission]" type="${file?.type}" looksLikeImage=${looksLikeImage(file)}`);
    if (looksLikeImage(file)) {
      const b64 = await convertToJpegViaCanvas(file, 0.75, 1200);
      return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }];
    }
    const pages = await pdfToImages(file, maxPages, 1200, 0.75, onPages);
    return pages.map(b64 => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
  }

  async function fetchGradeResult(body) {
    const response = await fetch(`${SERVER_URL}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const rawText = await response.text();
    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try { errMsg = JSON.parse(rawText).error || errMsg; } catch { errMsg = rawText || errMsg; }
      throw new Error(errMsg);
    }
    let resultText;
    try {
      const parsed = JSON.parse(rawText);
      resultText = parsed.result || parsed.text || rawText;
    } catch {
      resultText = rawText;
    }
    return resultText;
  }

  // ─── GRADING ─────────────────────────────────────────────────────────────

  // ─── TWO-PASS COMPLETENESS HELPERS ───────────────────────────────────────

  const SCAN_PROMPT = `You are scanning student work before grading. Do not grade anything yet. Your only job is to identify every problem or sub-problem visible across ALL images. For each problem found, record:
- Problem number or label — normalize all labels to standard numeric form: "Problem One" = "1", "Problem Two" = "2", "Problem Three" = "3", "Problem Four" = "4", "Problem Five" = "5", "Prob 1" = "1", "#1" = "1", "Q1" = "1". If a student writes sub-parts as "a)" or "b)" under a numbered problem, label them as "2a", "2b" etc. Use the normalized form in your output, not what the student wrote.
- Which image it appears in (image 1, image 2, etc.)
- Whether the work is legible (yes / partially / no)
- A one-line description of what the student did

Return ONLY a JSON array like this:
[
  { "problem": "1", "image": 1, "legible": "yes", "description": "Rewrites quadratic, finds vertex" },
  { "problem": "2a", "image": 2, "legible": "yes", "description": "Vertex form equation" },
  { "problem": "2b", "image": 2, "legible": "yes", "description": "Converts to standard form" }
]
Return nothing else — no preamble, no explanation, just the JSON array.`;

  // ── STUDENT WORK DETECTION PROMPT ─────────────────────────────────────────
  // Used by detectStudentWork() — sent to a cheap/fast model (haiku), never to
  // the full grading model. Keep this concise: haiku max_tokens is only 200.
  const DETECT_WORK_PROMPT = `You are a work-detection classifier. Examine ALL images provided. Classify the entire submission as one of:
  HAS_WORK           – at least one image shows steps, calculations, setup, formulas, or written reasoning
  ANSWER_ONLY        – only final answers or boxed numbers visible; no supporting work shown on any image
  PROMPT_ONLY        – only printed problem text visible; no student marks on any image
  BLANK_OR_UNREADABLE – all images are empty, solid color, illegible, or not math content

CRITICAL BIAS RULES:
- If ANY single image in the set contains student work (even light pencil marks, partial setup, or a single formula), classify the ENTIRE submission as HAS_WORK.
- Light or partial handwriting COUNTS as HAS_WORK.
- When in doubt, choose HAS_WORK — it is always better to pass a thin attempt to grading than to block a student who tried.
- Only choose ANSWER_ONLY, PROMPT_ONLY, or BLANK_OR_UNREADABLE when you are clearly and confidently certain.

Return ONLY this JSON — no other text:
{
  "classification": "HAS_WORK",
  "work_present": true,
  "confidence": 0.0,
  "reason": "one short sentence"
}
work_present must be true ONLY when classification is HAS_WORK.`;

  // ── STUDENT WORK GATEKEEPER ───────────────────────────────────────────────
  // Called ONLY in the student flow. Sends images to /detect-work (haiku) and
  // returns { pass: true } or { pass: false, reason, classification }.
  // Bias rule: confidence < 0.7 always passes, even if work_present is false.
  async function detectStudentWork(imageBlocks) {
    if (imageBlocks.length === 0) {
      console.log("[STUDENT GATEKEEPER] no image blocks — PASS (nothing to check)");
      return { pass: true };
    }
    try {
      const res = await fetch(`${SERVER_URL}/detect-work`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentBlocks: imageBlocks, detectionPrompt: DETECT_WORK_PROMPT })
      });
      const data = await res.json();
      // Guard against missing fields — treat any absent/non-numeric confidence as 0
      const confidence = typeof data.confidence === "number" ? data.confidence : 0;
      const workPresent = data.work_present === true; // only true when explicitly true
      console.log(`[STUDENT GATEKEEPER] classification=${data.classification} confidence=${confidence} work_present=${workPresent} reason="${data.reason}"`);
      // Bias toward passing: low confidence (or missing) never blocks
      if (confidence < 0.7) {
        console.log("[STUDENT GATEKEEPER] confidence < 0.7 → PASS");
        return { pass: true, reason: data.reason };
      }
      if (workPresent) {
        console.log("[STUDENT GATEKEEPER] HAS_WORK → PASS");
        return { pass: true, reason: data.reason };
      }
      console.log(`[STUDENT GATEKEEPER] ${data.classification} confidence=${confidence} → BLOCK`);
      return { pass: false, reason: data.reason, classification: data.classification };
    } catch (err) {
      // Fail open — a detection error must never block a real student attempt
      console.warn("[STUDENT GATEKEEPER] detection error — PASS:", err.message);
      return { pass: true };
    }
  }

  async function scanProblems(pageBlocks, systemPromptBase) {
    const imageBlocks = pageBlocks.filter(b => b.type === "image");
    if (imageBlocks.length === 0) return null;
    const scanContentBlocks = [
      { type: "text", text: "=== STUDENT WORK SCAN — inventory only, do not grade ===" },
      ...imageBlocks,
      { type: "text", text: "=== END ===" }
    ];
    try {
      const raw = await fetchGradeResult({ contentBlocks: scanContentBlocks, systemPrompt: systemPromptBase, userPrompt: SCAN_PROMPT });
      const start = raw.indexOf("["); const end = raw.lastIndexOf("]");
      if (start !== -1 && end !== -1) {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) { console.warn("[scan] Problem scan failed:", e.message); }
    return null;
  }

  function detectProblemScope() {
    // Priority 1: explicit problemScope field
    if (problemScope.trim()) return problemScope.trim();
    // Priority 2: rubric field if it looks like a comma-separated problem list
    if (rubric.trim()) {
      const looksLikeList = /\b\d+[a-dA-D]?\b/.test(rubric) && rubric.includes(",");
      if (looksLikeList) return rubric.trim();
    }
    return null;
  }

  function normalizeProblemLabel(label) {
    if (!label) return label;
    const WORD_MAP = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };
    let s = label.trim().toLowerCase();
    // "problem one" / "prob two" / "question three" → digit
    s = s.replace(/^(?:problem|prob|question|q|#)\s*([a-z]+)$/, (_, w) => WORD_MAP[w] || _);
    s = s.replace(/^(?:problem|prob|question|q|#)\s*(\d+)([a-z]?)$/, (_, n, sub) => n + sub);
    // standalone written numbers "one", "two"
    s = s.replace(/^([a-z]+)$/, w => WORD_MAP[w] || w);
    // "2 a" → "2a", "2 b" → "2b"
    s = s.replace(/^(\d+)\s+([a-z])$/, "$1$2");
    // "part a" / "a)" under parent context — leave as-is if already looks like "2a"
    return s;
  }

  function buildInventoryPrefix(inventory) {
    if (!inventory || inventory.length === 0) return "";
    const scope = detectProblemScope();
    // Normalize all scanned labels before building the prompt
    const normalized = inventory.map(p => ({ ...p, problem: normalizeProblemLabel(p.problem) || p.problem }));
    const list = normalized.map(p => `- Problem ${p.problem} (Image ${p.image}, ${p.legible} legibility): ${p.description}`).join("\n");
    const scopeLine = scope
      ? `The instructor specified these problems for this assignment: ${scope}.\n\n`
      : "";
    return `${scopeLine}The following ${normalized.length} problems were detected across all submitted images:\n${list}\n\nYou MUST grade EVERY problem in this list. Do not stop until all ${normalized.length} problems have been graded. If a problem is marked as partially legible, grade what you can see and note 'Partial legibility — instructor review recommended.' If a problem is marked as not legible, assign P1 and note 'Work not legible — could not be graded. Instructor should request resubmission.'\n\n`;
  }

  function buildScopeDirectPrefix(scope) {
    return `The instructor has specified these problems must be graded: ${scope}.\n\nEach image you receive is a separate page of THIS SAME STUDENT'S submission — work for different problems may appear on different pages/images. Before concluding that ANY problem is missing, you MUST examine EVERY image independently, page by page, looking for that problem's label or matching content. Do not stop searching after the first image.\n\nStudents may label problems using words ("Problem One", "Problem Two") or numerals ("Problem 1", "Problem 2", "#1", "Q1") — treat these as completely equivalent (e.g., "Problem One" = "Problem 1" = "1"). Match work to problems by context and content, not just by exact label text.\n\nGrade every problem in the list — if, after examining ALL images individually, you genuinely cannot find any work for a problem, only then mark it as not submitted.\n\n`;
  }

  async function handleGrade() {
    console.log('[BB GROUPS START] handleGrade called — isBBBatch:', isBBBatch, 'files:', studentFiles.length);
    if (!subject || !studentFiles.length) {
      setError("Please select a subject and upload at least one student file.");
      return;
    }
    setError("");
    setHeicFailedFiles([]);
    setProblemInventory({});
    setPageNotes([]); // #18: fresh page-usage notes per grade run
    setAnswerKeyPages(null); // #20
    setRedactStats(null); // §3.3: fresh redaction count per grade run
    setSubmissionImages([]); // #23: fresh per-run submission thumbnails
    setRedactWarning(false); setBbStubNote(0); // #25
    // §3.3: name-zone redaction gate — active vaulted course + per-course toggle.
    const doRedact = redactionOn(courseByCode(activeCourseCode));
    // #23/#26: per-result redaction ledger AND thumbnail source, parallel to allResults.
    // ONE artifact — the banner count and the badges both derive from this. padImages
    // fills every result added for the current submission with the same entry.
    const pageImages = [];
    const padImages = (entry) => { while (pageImages.length < allResults.length) pageImages.push(entry || null); };
    if (answerKeyFile && /pdf/i.test(`${answerKeyFile.type} ${answerKeyFile.name}`)) {
      getPdfPageCount(answerKeyFile).then((pc) => { if (pc) setAnswerKeyPages(pc); });
    }
    setLoading(true);
    setStep("grading");
    const courseConfig = COURSE_CONFIGS[subject];
    const heicFailed = [];
    const systemPrompt = buildSystemPrompt(courseConfig, activeDims);
    const allResults = [];

    // ── BATCH PDF MODE ──────────────────────────────────────────────────────
    const file = studentFiles[0];
    const isSinglePDF = studentFiles.length === 1 && file.type === "application/pdf" && isBatchPDF;
    const isTrueBatch = isSinglePDF && batchMode !== "single";

    // Fail-closed redaction (Change 3): a tagged redaction error from any path below
    // propagates to the catch at the end of this block and STOPS the whole grade run
    // with a retry message — an unredacted image is never graded.
    try {
    if (isTrueBatch) {
      setLoadingMsg("Reading batch PDF and identifying students...");
      try {
        const fileMB = file.size / 1024 / 1024;
        console.log(`[grading] batch PDF — file: "[submission]", size: ${fileMB.toFixed(1)} MB`);
        const isLarge = fileMB > 5;
        const isVeryLarge = fileMB > 20;
        setLoadingMsg(`Converting batch PDF to images${isLarge ? " (compressing — large file)..." : "..."}`);
        console.log(`[pdfToImages call] batch PDF: "[submission]" type="${file?.type}"`);
        let batchPageImages = await pdfToImages(file, 60, isVeryLarge ? 800 : isLarge ? 1000 : 1200, isVeryLarge ? 0.5 : isLarge ? 0.6 : 0.75);
        console.log(`[batch PDF] converted ${batchPageImages.length} pages to images`);
        if (!batchPageImages || batchPageImages.length === 0) {
          throw new Error("Could not convert PDF to images — please try a different file");
        }
        const batchCompressedMB = (batchPageImages.reduce((s, b64) => s + b64.length * 0.75, 0) / 1024 / 1024).toFixed(1);
        const batchEstMin = Math.max(1, Math.ceil(batchPageImages.length / 3));
        setLoadingMsg(`${batchPageImages.length} pages detected · Compressed to ~${batchCompressedMB} MB · Est. ~${batchEstMin} min`);
        const sharedBlocks = [];
        if (assignmentFile) {
          const blocks = await fileToImageBlocks(assignmentFile, 15, notePages);
          sharedBlocks.push(...blocks);
          sharedBlocks.push({ type: "text", text: "The above is the ASSIGNMENT PROMPT — the questions the student was asked to answer." });
        }
        if (answerKeyFile) {
          const akBlock = await answerKeyToDocumentBlock(answerKeyFile);
          sharedBlocks.push(akBlock);
          sharedBlocks.push({ type: "text", text: "The above is the MODEL SOLUTION / ANSWER KEY." });
        }

        if (batchMode === "fixed") {
          // Grade each student's page-chunk independently
          const chunks = [];
          for (let i = 0; i < batchPageImages.length; i += pagesPerStudent) {
            chunks.push(batchPageImages.slice(i, i + pagesPerStudent));
          }
          for (let c = 0; c < chunks.length; c++) {
            const studentNum = c + 1;
            setLoadingMsg(`Grading student ${studentNum} of ${chunks.length}...`);
            let subRed = false, subScan = false;
            if (doRedact) { const rr = await redactPageImages(chunks[c], { all: true }); chunks[c] = rr.pages; subRed = rr.redacted > 0; subScan = rr.maxWords >= MIN_SCAN_WORDS; }
            const chunkBlocks = chunks[c].flatMap((b64, i) => [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
              { type: "text", text: `Page ${c * pagesPerStudent + i + 1}` }
            ]);
            const contentBlocks = [
              { type: "text", text: "=== STUDENT WORK (grade everything below this line) ===" },
              ...chunkBlocks,
              { type: "text", text: "=== END OF STUDENT WORK ===" },
              ...(sharedBlocks.length ? [{ type: "text", text: "=== ANSWER KEY (for reference — do not grade this, use it to evaluate the student work above) ===" }, ...sharedBlocks] : [])
            ];
            const userPrompt = `Subject: ${subject}
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}
${courseContext.trim() ? `\nCOURSE CONTEXT: The instructor has provided the following information about what has been covered in this course so far: ${courseContext.trim()}.\n\nImportant: Do NOT penalize students for using terminology or methods that go beyond what has been covered — flag these cases instead with: 'Note: Student used concept not yet covered in course — instructor review recommended.' Do NOT reward students for using advanced terminology if their underlying reasoning is incomplete. Grade only based on what has been explicitly taught.` : ""}

BATCH FIXED-PAGES: This is student ${studentNum} of ~${chunks.length} in a batch scan (${pagesPerStudent} page(s) per student).
Find the student's name on the first page. If no name found, label them "Unknown Student ${studentNum}".

GRADING INSTRUCTIONS:
1. Identify ALL problems and sub-parts. Do not skip any.
2. Apply DM3A P1–P4 mastery scoring — never binary correct/wrong.
3. Weight process and reasoning heavily.

Return a JSON array with exactly ONE student object.`;
            try {
              const raw = await fetchGradeResult({ contentBlocks, systemPrompt, userPrompt });
              const cleaned = raw.replace(/```json|```/g, "").trim();
              const parsed = JSON.parse(cleaned);
              allResults.push(...(Array.isArray(parsed) ? parsed : [parsed]));
            } catch (err) {
              allResults.push({
                studentName: `Student ${studentNum}`,
                overallTier: "P1",
                error: err.message,
                dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" },
                problems: [],
                feedback: err.message || `Error grading student ${studentNum}.`,
                strengths: [],
                growthAreas: [],
                instructorNote: `Failed on pages ${c * pagesPerStudent + 1}–${Math.min((c + 1) * pagesPerStudent, batchPageImages.length)}.`
              });
            }
            padImages({ image: chunks[c][0], redacted: subRed, scanned: subScan, subId: `fixed${c}` }); // #23/#26
          }
        } else {
          // Auto-detect: TWO-PASS — boundary detection first, then grade each student individually.
          // §3.3: boundaries aren't known yet and the boundary pass sends EVERY page to
          // Claude, so redact the name zone on every page up front (all:true) — no name
          // reaches the API even during boundary detection.
          let batchPerPage = null;
          if (doRedact) { const rr = await redactPageImages(batchPageImages, { all: true }); batchPageImages = rr.pages; batchPerPage = rr.perPage; }
          const boundarySystemPrompt = systemPrompt + `
You are scanning a batch of student exams to find student boundaries only.
Return ONLY a JSON array: [{"studentName":"Name","startPage":0,"endPage":2},...]
Page numbers are 0-indexed. Find every student. Return ONLY the JSON array starting with [.`;

          const boundaryUserPrompt = `You are looking at ${batchPageImages.length} pages from a batch scan.
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}
TASK: Find every student name and which pages (0-indexed) belong to them. Separator pages mark new students.
Return ONLY the JSON array of boundaries. Do not grade anything yet.`;

          const boundaryContentBlocks = [
            ...sharedBlocks,
            { type: "text", text: `The following ${batchPageImages.length} pages are the complete batch scan. Each page is labeled.` },
            ...batchPageImages.flatMap((b64, i) => [
              { type: "text", text: `=== PAGE ${i + 1} OF ${batchPageImages.length} ===` },
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }
            ])
          ];

          setLoadingMsg(`Pass 1 of 2 — detecting student boundaries across ${batchPageImages.length} pages...`);
          let boundaries = [];
          try {
            const boundaryRaw = await fetchGradeResult({ contentBlocks: boundaryContentBlocks, systemPrompt: boundarySystemPrompt, userPrompt: boundaryUserPrompt });
            const boundaryCleaned = boundaryRaw.replace(/```json|```/g, "").trim();
            boundaries = JSON.parse(boundaryCleaned);
            if (boundaries.length === 0) throw new Error("No boundaries detected");
          } catch (err) {
            boundaries = [{ studentName: "Unknown Student 1", startPage: 0, endPage: batchPageImages.length - 1 }];
          }

          for (let s = 0; s < boundaries.length; s++) {
            const { studentName, startPage, endPage } = boundaries[s];
            const studentNum = s + 1;
            setLoadingMsg(`Pass 2 — grading ${studentName} (${studentNum} of ${boundaries.length})...`);
            const studentPages = batchPageImages.slice(startPage, endPage + 1);
            const studentContentBlocks = [
              ...sharedBlocks,
              { type: "text", text: `The following ${studentPages.length} pages are ${studentName}s submission only.` },
              ...studentPages.flatMap((b64, i) => [
                { type: "text", text: `=== PAGE ${i + 1} OF ${studentPages.length} ===` },
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }
              ])
            ];
            const studentUserPrompt = `Student: ${studentName}
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}
Grade ALL problems on this student pages using DM3A P1-P4 mastery scoring.
Return a JSON array with exactly ONE student object.`;
            try {
              const raw = await fetchGradeResult({ contentBlocks: studentContentBlocks, systemPrompt, userPrompt: studentUserPrompt });
              const cleaned = raw.replace(/```json|```/g, "").trim();
              const parsed = JSON.parse(cleaned);
              allResults.push(...(Array.isArray(parsed) ? parsed : [parsed]));
            } catch (err) {
              allResults.push({ studentName, overallTier: "P1", error: err.message, dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" }, problems: [], feedback: err.message, strengths: [], growthAreas: [], instructorNote: `Failed on pages ${startPage + 1}-${endPage + 1}.` });
            }
            // #26: attribute the up-front bulk redaction to THIS student's page range.
            let subRed = false, subScan = false;
            if (doRedact && batchPerPage) {
              for (let pi = startPage; pi <= endPage; pi++) {
                const pp = batchPerPage[pi];
                if (pp) { if (pp.redacted) subRed = true; if ((pp.words || 0) >= MIN_SCAN_WORDS) subScan = true; }
              }
            }
            padImages({ image: studentPages[0], redacted: subRed, scanned: subScan, subId: `auto${s}` }); // #23/#26
          }
        }
        } catch (err) {
          if (err && err.isRedaction) throw err; // fail-closed: abort, don't fake a grade row
          allResults.push({ studentName: "Submission", overallTier: "P1", error: err.message, dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" }, problems: [], feedback: "Error processing batch PDF.", strengths: [], growthAreas: [], instructorNote: "Batch setup failed (PDF conversion or network error). Try uploading individual files per student." });
        }
    } else if (combineImages && studentFiles.length > 1 && studentFiles.every(f => f.type.startsWith("image/"))) {
      // ── COMBINED IMAGES MODE — chunk 2 images per API call, merge results ─
      const studentLabel = combinedStudentName.trim() || "Unknown Student";
      try {
        // Pre-compress all images at aggressive settings
        const compressedPages = [];
        for (let i = 0; i < studentFiles.length; i++) {
          setLoadingMsg(`Compressing page ${i + 1} of ${studentFiles.length}...`);
          const b64 = await compressImage(studentFiles[i], 0.5, 1000);
          if (b64 === null) { heicFailed.push(studentFiles[i].name); continue; }
          compressedPages.push(b64);
        }
        // §3.3: redact the name zone on page 1 of this combined submission.
        let combinedRedacted = false, combinedScanned = false;
        if (doRedact && compressedPages.length) { const rr = await redactPageImages(compressedPages, { all: true }); rr.pages.forEach((p, i) => { compressedPages[i] = p; }); combinedRedacted = rr.redacted > 0; combinedScanned = rr.maxWords >= MIN_SCAN_WORDS; }

        // Build shared context blocks (assignment + answer key) — images only, no raw PDF base64
        const sharedBlocks = [];
        if (assignmentFile) {
          const blocks = await fileToImageBlocks(assignmentFile, 15, notePages);
          sharedBlocks.push(...blocks);
          sharedBlocks.push({ type: "text", text: "The above is the ASSIGNMENT PROMPT." });
        }
        if (answerKeyFile) {
          const akBlock = await answerKeyToDocumentBlock(answerKeyFile);
          sharedBlocks.push(akBlock);
          sharedBlocks.push({ type: "text", text: "The above is the MODEL SOLUTION / ANSWER KEY." });
        }

        // Build problem context — use instructor scope directly if provided, else scan
        const allPageBlocks = compressedPages.map(b64 => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
        let combinedInventoryPrefix = "";
        if (problemScope.trim()) {
          setLoadingMsg(`Grading ${studentLabel} using instructor-specified problem list...`);
          combinedInventoryPrefix = buildScopeDirectPrefix(problemScope.trim());
        } else {
          setLoadingMsg(`Scanning all pages for ${studentLabel}...`);
          const combinedInventory = await scanProblems(allPageBlocks, systemPrompt);
          if (combinedInventory && combinedInventory.length > 0) {
            setLoadingMsg(`Found ${combinedInventory.length} problems for ${studentLabel} — grading...`);
            setProblemInventory(prev => ({ ...prev, [studentLabel]: combinedInventory }));
          }
          combinedInventoryPrefix = buildInventoryPrefix(combinedInventory);
        }

        // Send 2 pages per API call
        const chunkSize = 2;
        const chunkResults = [];
        for (let c = 0; c < compressedPages.length; c += chunkSize) {
          const chunk = compressedPages.slice(c, c + chunkSize);
          const chunkNum = Math.floor(c / chunkSize) + 1;
          const totalChunks = Math.ceil(compressedPages.length / chunkSize);
          setLoadingMsg(`Grading ${studentLabel} — part ${chunkNum} of ${totalChunks}...`);

          const contentBlocks = [
            { type: "text", text: "=== STUDENT WORK (grade everything below this line) ===" },
          ];
          contentBlocks.push({ type: "text", text: `STUDENT SUBMISSION — pages ${c + 1} to ${c + chunk.length} of ${compressedPages.length} total. This is part ${chunkNum} of ${totalChunks}.` });
          chunk.forEach((b64, idx) => {
            contentBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
            contentBlocks.push({ type: "text", text: `Page ${c + idx + 1}` });
          });
          contentBlocks.push({ type: "text", text: "=== END OF STUDENT WORK ===" });

          const userPrompt = `Subject: ${subject}
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}
${courseContext.trim() ? `\nCOURSE CONTEXT: The instructor has provided the following information about what has been covered in this course so far: ${courseContext.trim()}.\n\nImportant: Do NOT penalize students for using terminology or methods that go beyond what has been covered — flag these cases instead with: 'Note: Student used concept not yet covered in course — instructor review recommended.' Do NOT reward students for using advanced terminology if their underlying reasoning is incomplete. Grade only based on what has been explicitly taught.\n` : ""}Student: ${studentLabel}
This is part ${chunkNum} of ${totalChunks} of this student's submission (pages ${c + 1}–${c + chunk.length} of ${compressedPages.length}).

INSTRUCTIONS:
1. Identify and grade ALL problems visible on these pages only.
2. Apply DM3A P1–P4 mastery scoring — never binary correct/wrong.
3. Weight process and reasoning heavily.
4. Use "${studentLabel}" as the studentName.
${totalChunks > 1 ? `5. Note: This is a partial submission. Grade only what you can see on these pages.` : ""}

Return a JSON array with exactly ONE student object covering only the problems on these pages.`;

          const raw = await fetchGradeResult({ contentBlocks, systemPrompt, userPrompt: combinedInventoryPrefix + userPrompt });
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          const chunkStudents = Array.isArray(parsed) ? parsed : [parsed];
          chunkResults.push(...(chunkStudents[0]?.problems || []));
        }

        // Merge all chunk results into one student object
        const tierOrder = ["P4", "P3", "P2", "P1"];
        const lowestTier = (tiers) => tierOrder[Math.max(...tiers.map(t => tierOrder.indexOf(t)))];
        const allProblems = chunkResults;
        const problemTiers = allProblems.map(p => p.tier).filter(Boolean);
        const overallTier = problemTiers.length
          ? tierOrder[Math.round(problemTiers.reduce((s, t) => s + tierOrder.indexOf(t), 0) / problemTiers.length)]
          : "P1";

        allResults.push({
          studentName: studentLabel,
          overallTier,
          dimensions: {
            conceptualUnderstanding: overallTier,
            problemSolving: overallTier,
            workShown: overallTier,
            accuracy: overallTier
          },
          problems: allProblems,
          feedback: `Graded across ${Math.ceil(compressedPages.length / chunkSize)} passes. Review individual problem scores above.`,
          strengths: [],
          growthAreas: [],
          instructorNote: compressedPages.length > 2 ? "Multi-page submission graded in chunks. Dimension scores are averaged — use overrides to adjust." : null
        });

      } catch (err) {
        if (err && err.isRedaction) throw err; // fail-closed: abort, don't fake a grade row
        allResults.push({
          studentName: studentLabel,
          overallTier: "P1",
          error: err.message,
          dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" },
          problems: [],
          feedback: `Error processing combined images: ${err.message}`,
          strengths: [],
          growthAreas: []
        });
      }
      padImages({ image: compressedPages[0], redacted: combinedRedacted, scanned: combinedScanned, subId: "combined" }); // #23/#26

    } else {
      // ── INDIVIDUAL FILES MODE ─────────────────────────────────────────────
      for (let i = 0; i < studentFiles.length; i++) {
        setLoadingMsg(`Grading file ${i + 1} of ${studentFiles.length}...`);
        let subImg = null, subRed = false, subScan = false; // #23/#26: page-1 as graded for this file

        try {
          let f = studentFiles[i]; // may be reassigned after server-side HEIC/DOCX conversion
          const isHEICIndiv = /\.(heic|heif)$/i.test(f.name) || f.type === "image/heic" || f.type === "image/heif";
          const isDocxIndiv = /\.docx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          if (isHEICIndiv) {
            setLoadingMsg(`Converting ${f.name} (HEIC) via server...`);
            const conv = await convertOnServer(f, 'convert-heic');
            if (conv) { f = conv; }
            else { heicFailed.push(f.name); continue; }
          } else if (isDocxIndiv) {
            setLoadingMsg(`Converting ${f.name} (Word doc) via server...`);
            const conv = await convertOnServer(f, 'convert-docx');
            if (conv) { f = conv; }
            else { continue; }
          }
          const isPDF = f.type === "application/pdf";
          const fileSize = f.size;
          // All PDFs: convert pages to JPEG images so Claude can read handwritten/scanned content.
          // Image files: compress directly.
          let studentB64 = null;
          let pdfPageImages = null;
          console.log(`[ROUTING] file: [submission], size: ${fileSize}, isPDF: ${isPDF}`);
          if (isPDF) {
            const fMB = f.size / 1024 / 1024;
            const fLarge = fMB > 5;
            const fVeryLarge = fMB > 20;
            console.log(`[grading] individual PDF — file: "[submission]", size: ${fMB.toFixed(1)} MB`);
            setLoadingMsg(`Converting ${f.name} to images${fLarge ? " (compressing — large file)..." : "..."}`);
            console.log(`[pdfToImages call] individual: "[submission]" type="${f?.type}" — calling with maxPages=8`);
            pdfPageImages = await pdfToImages(f, 8, fVeryLarge ? 800 : fLarge ? 1000 : 1200, fVeryLarge ? 0.5 : fLarge ? 0.6 : 0.75);
            console.log(`[PDF→images] [submission]: pdfToImages returned ${pdfPageImages.length} page(s) (maxPages was 8)`);
            if (!pdfPageImages || pdfPageImages.length === 0) {
              throw new Error("Could not convert PDF to images — please try a different file");
            }
            const indivCompressedMB = (pdfPageImages.reduce((s, b64) => s + b64.length * 0.75, 0) / 1024 / 1024).toFixed(1);
            const indivEstMin = Math.max(1, Math.ceil(pdfPageImages.length / 2));
            setLoadingMsg(`${pdfPageImages.length} pages detected · Compressed to ~${indivCompressedMB} MB · Est. ~${indivEstMin} min`);
          } else {
            studentB64 = await compressImage(f);
            if (studentB64 === null) { heicFailed.push(f.name); continue; }
          }
          const studentMediaType = isImage(f) ? "image/jpeg" : f.type;

          // §3.3: redact the name zone on page 1 of this student's submission before
          // it is graded or stored. One submission = one file here.
          if (doRedact) {
            if (isPDF && pdfPageImages) {
              const rr = await redactPageImages(pdfPageImages); pdfPageImages = rr.pages;
              subRed = rr.redacted > 0; subScan = rr.maxWords >= MIN_SCAN_WORDS;
            } else if (studentB64) {
              const rr = await redactPageImages([studentB64]); studentB64 = rr.pages[0];
              subRed = rr.redacted > 0; subScan = rr.maxWords >= MIN_SCAN_WORDS;
            }
          }
          subImg = isPDF ? (pdfPageImages && pdfPageImages[0]) : studentB64; // #23: page-1 as graded

          // Build shared context blocks — images only, no raw PDF base64
          const sharedBlocks = [];
          if (assignmentFile) {
            const blocks = await fileToImageBlocks(assignmentFile, 15, notePages);
            sharedBlocks.push(...blocks);
            sharedBlocks.push({ type: "text", text: "The above is the ASSIGNMENT PROMPT." });
          }
          if (answerKeyFile) {
            const akBlock = await answerKeyToDocumentBlock(answerKeyFile);
            sharedBlocks.push(akBlock);
            sharedBlocks.push({ type: "text", text: "The above is the MODEL SOLUTION / ANSWER KEY." });
          }

          const userPrompt = `Subject: ${subject}
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}
${courseContext.trim() ? `\nCOURSE CONTEXT: The instructor has provided the following information about what has been covered in this course so far: ${courseContext.trim()}.\n\nImportant: Do NOT penalize students for using terminology or methods that go beyond what has been covered — flag these cases instead with: 'Note: Student used concept not yet covered in course — instructor review recommended.' Do NOT reward students for using advanced terminology if their underlying reasoning is incomplete. Grade only based on what has been explicitly taught.\n` : ""}
INSTRUCTIONS:
1. First, identify ALL problems and sub-parts (a, b, c, d, etc.) visible across ALL images. List them ALL before grading.
2. Grade EVERY identified problem/sub-part. Do not skip any.
3. Use the answer key if provided. If not, use your subject expertise.
4. Apply DM3A P1–P4 mastery scoring — never binary correct/wrong.
5. Weight process and reasoning heavily.

Return a JSON array with one object per student found in the submission.`;

          const pageBlocks = isPDF
            ? pdfPageImages.map(b64 => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }))
            : [{ type: "image", source: { type: "base64", media_type: studentMediaType, data: studentB64 } }];
          // Order: assignment prompt → answer key → student work (sharedBlocks already in this order)
          const answerKeyImageCount = sharedBlocks.filter(b => b.type === "image").length;
          const studentImageCount = pageBlocks.filter(b => b.type === "image").length;
          console.log(`[contentBlocks] answer key images: ${answerKeyImageCount}, student images: ${studentImageCount}`);
          console.log(`[contentBlocks] ORDER: STUDENT WORK → END${sharedBlocks.length ? " → ANSWER KEY" : ""}`);
          console.log(`[contentBlocks] student pageBlocks types:`, pageBlocks.map(b => b.type));
          const contentBlocks = [
            { type: "text", text: "=== STUDENT WORK (grade everything below this line) ===" },
            ...pageBlocks,
            { type: "text", text: "=== END OF STUDENT WORK ===" },
            ...(sharedBlocks.length ? [{ type: "text", text: "=== ANSWER KEY (for reference — do not grade this, use it to evaluate the student work above) ===" }, ...sharedBlocks] : [])
          ];
          console.log(`[contentBlocks] total blocks sent to API: ${contentBlocks.length} (${contentBlocks.filter(b=>b.type==="image").length} images, ${contentBlocks.filter(b=>b.type==="text").length} text)`);
          let effectiveUserPrompt = userPrompt;
          if (problemScope.trim()) {
            setLoadingMsg(`Grading ${f.name} using instructor-specified problem list...`);
            effectiveUserPrompt = buildScopeDirectPrefix(problemScope.trim()) + userPrompt;
          } else {
            setLoadingMsg(`Scanning problems in ${f.name}...`);
            const inventory = await scanProblems(pageBlocks, systemPrompt);
            if (inventory && inventory.length > 0) {
              setLoadingMsg(`Found ${inventory.length} problem${inventory.length !== 1 ? "s" : ""} in ${f.name} — grading...`);
              setProblemInventory(prev => ({ ...prev, [f.name]: inventory }));
              effectiveUserPrompt = buildInventoryPrefix(inventory) + userPrompt;
            } else {
              setLoadingMsg(`Problem scan inconclusive — grading all visible content in ${f.name}...`);
            }
          }
          const raw = await fetchGradeResult({ contentBlocks, systemPrompt, userPrompt: effectiveUserPrompt });
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          allResults.push(...(Array.isArray(parsed) ? parsed : [parsed]));
        } catch (err) {
          if (err && err.isRedaction) throw err; // fail-closed: abort, don't fake a grade row
          allResults.push({
            studentName: `Submission ${i + 1}`,
            overallTier: "P1",
            error: err.message,
            dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" },
            problems: [],
            feedback: err.message || "Error processing this file.",
            strengths: [],
            growthAreas: []
          });
        }
        padImages({ image: subImg, redacted: subRed, scanned: subScan, subId: `file${i}` }); // #23/#26
      }
    }
    } catch (err) {
      // Fail-closed abort (Change 3): a redaction failure stops the WHOLE grade run
      // with a clear retry message — an unredacted image is never graded.
      if (err && err.isRedaction) {
        console.warn("[REDACT] grading aborted — " + err.message);
        setError("Couldn't verify the name-zone redaction on page 1 — grading was stopped to protect privacy. Please retry.");
        try { terminateRedactor(); } catch { /* ignore */ }
        setLoading(false);
        setStep("setup");
        return;
      }
      throw err; // unexpected error — let it surface
    }

    padImages(null); // #23: reconcile any tail so pageImages aligns 1:1 with results
    setSubmissionImages(pageImages.map(e => e ? { image: e.image, redacted: !!e.redacted, scanned: !!e.scanned } : null));
    setResults(applyDimScope(allResults, activeDims));
    setOverrides({});
    setActiveStudent(0);
    if (heicFailed.length > 0) setHeicFailedFiles(heicFailed);
    // §3.3/#26: derive the banner from the SAME per-submission ledger the badges use.
    if (doRedact) {
      const stats = deriveRedactStats(pageImages.map(e => e ? { subId: e.subId, redacted: e.redacted, scanned: e.scanned, present: e.image != null } : null));
      if (stats.checked > 0) setRedactStats(stats);
      // #25/#26 invariant: banner redacted count MUST equal distinct redacted-badge
      // submissions (same source ⇒ equal), and gradable work ⇒ something was checked.
      const badgeSubs = new Set(pageImages.filter(e => e && e.redacted && e.image).map(e => e.subId)).size;
      const anyGradable = allResults.some(r => !["HEIC", "DOCX"].includes(r.overallTier));
      if (stats.redacted !== badgeSubs || (anyGradable && stats.checked === 0)) {
        console.error(`[REDACT INVARIANT] banner redacted=${stats.redacted} vs badge submissions=${badgeSubs}, checked=${stats.checked}`);
        setRedactWarning(true);
      }
      try { terminateRedactor(); } catch { /* ignore */ }
    }
    setLoading(false);
    setStep("results");
  }

  // ─── STUDENT GRADE HANDLER ───────────────────────────────────────────────
  // Mirrors the individual-files path of handleGrade() but:
  //   (a) runs detectStudentWork() before the grading call, and
  //   (b) blocks and returns early if the gatekeeper fires.
  // Never called from the instructor flow.
  async function handleStudentGrade() {
    if (!subject || !studentFiles.length) {
      setError("Please select a subject and upload your work.");
      return;
    }
    setError("");
    setGatekeeperBlocked(false);
    setGatekeeperReason("");

    // ── ACCESS CODE / ALLOWANCE CHECK ─────────────────────────────────────────
    // A valid instructor code = unlimited for the session with NO email collected.
    // codeContext, when set, rides along on the grade so the server can count/tag it.
    // Invalid code => fall through to the free tier. Capped code => friendly screen.
    let codeContext = null;
    const enteredCode = (studentClassCode || "").trim();

    if (enteredCode) {
      try {
        const res = await fetch(`${SERVER_URL}/code-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: enteredCode }),
        });
        const data = await res.json();
        if (data.valid && data.allowed) {
          codeContext = { code: enteredCode.toUpperCase(), course: data.course || "" };
          setStudentSubmissionsLeft(null); // unlimited — no counter, no email
        } else if (data.valid && !data.allowed) {
          // Real code, daily cap reached — same friendly screen as the free tier.
          setStudentSubmissionsLeft(0);
          setError("");
          setStep("student-upload");
          return;
        }
        // else: unrecognized — leave codeContext null and fall through to the free
        // tier (the live status line under the code box already explains this).
      } catch {
        // Couldn't reach the check — fall through to the free tier rather than block.
      }
    }

    const normalEmail = (studentEmail || "").trim().toLowerCase();
    if (!codeContext) {
      // Free tier requires an email (for the anonymous per-email counter).
      if (!normalEmail || !normalEmail.includes("@")) {
        setError("Enter your email to use the free tier, or add a valid class code from your instructor.");
        return;
      }
      try {
        const checkRes = await fetch(`${SERVER_URL}/student-check-allowance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalEmail }),
        });
        const checkData = await checkRes.json();
        if (!checkData.allowed) {
          setStudentSubmissionsLeft(0);
          setError("");
          setStep("student-upload");
          return;
        }
        setStudentSubmissionsLeft(checkData.remaining);
      } catch {
        // fail open — network error doesn't block the student
      }
    }
    // ── END ACCESS CODE / ALLOWANCE CHECK ─────────────────────────────────────

    setLoading(true);
    setStep("grading");

    const courseConfig = COURSE_CONFIGS[subject];
    const systemPrompt = buildStudentSystemPrompt(courseConfig, activeDims); // student flow uses its own prompt
    const allImageBlocks = [];
    const heicFailed = [];

    // Preprocessing — same HEIC/DOCX/PDF pipeline as the instructor individual flow
    for (let i = 0; i < studentFiles.length; i++) {
      let f = studentFiles[i];
      setLoadingMsg(`Preparing file ${i + 1} of ${studentFiles.length}...`);
      try {
        const isHEICFile = /\.(heic|heif)$/i.test(f.name) || f.type === "image/heic" || f.type === "image/heif";
        if (isHEICFile) {
          setLoadingMsg(`Converting ${f.name} (HEIC)...`);
          const conv = await convertOnServer(f, "convert-heic");
          if (conv) { f = conv; } else { heicFailed.push(f.name); continue; }
        } else if (isDocx(f)) {
          setLoadingMsg(`Converting ${f.name} (Word doc)...`);
          const conv = await convertOnServer(f, "convert-docx");
          if (conv) { f = conv; } else { continue; }
        }
        if (f.type === "application/pdf") {
          const fMB = f.size / 1024 / 1024;
          const pages = await pdfToImages(f, 8, fMB > 5 ? 1000 : 1200, fMB > 5 ? 0.6 : 0.75);
          pages.forEach(b64 => allImageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
        } else {
          const b64 = await compressImage(f);
          if (b64 !== null) allImageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
          else heicFailed.push(f.name);
        }
      } catch { heicFailed.push(f.name); }
    }

    // ── NAME-ZONE REDACTION (Change 5) ────────────────────────────────────
    // Redact the student's OWN submission before anything sends these images to the
    // API — BOTH the gatekeeper check below and the grading call do. Privacy-first:
    // student self-grading always redacts (no instructor opt-out applies) and fails
    // closed. Files are flattened here with no per-file page-1 boundary, so we redact
    // EVERY page — a handwritten name can land on any of them.
    if (allImageBlocks.length) {
      try {
        const b64s = allImageBlocks.map(b => b.source.data);
        const rr = await redactPageImages(b64s, { all: true });
        rr.pages.forEach((p, i) => { allImageBlocks[i].source.data = p; });
      } catch (err) {
        console.warn("[REDACT] student grading aborted — " + (err && err.message));
        setError("Couldn't verify the name-zone redaction — grading was stopped to protect privacy. Please retry.");
        setLoading(false);
        setStep("student-upload");
        return;
      } finally {
        try { terminateRedactor(); } catch { /* ignore */ }
      }
    }

    // ── GATEKEEPER ────────────────────────────────────────────────────────
    setLoadingMsg("Checking your submission for student work...");
    const gate = await detectStudentWork(allImageBlocks);
    if (!gate.pass) {
      setGatekeeperBlocked(true);
      setGatekeeperReason(gate.reason || "");
      setLoading(false);
      setStep("student-upload");
      return;
    }
    // ── END GATEKEEPER ────────────────────────────────────────────────────

    setLoadingMsg("Grading your submission...");

    // Rubric file — convert to image blocks if provided
    let rubricBlocks = [];
    if (studentRubricFile) {
      try {
        setLoadingMsg("Reading rubric...");
        rubricBlocks = await fileToImageBlocks(studentRubricFile, 15, notePages);
      } catch { /* non-fatal — grade without rubric */ }
    }

    const userPrompt = `Subject: ${subject === "Other" ? "Math" : subject}
Assignment: ${assignment || "Student Submission"}
INSTRUCTIONS:
1. Identify ALL problems and sub-parts visible across all images.
2. Grade EVERY problem. Do not skip any.
3. Apply DM3A P1–P4 mastery scoring — never binary correct/wrong.
Return a JSON array with exactly ONE student object.`;

    const contentBlocks = [
      ...(rubricBlocks.length > 0 ? [
        { type: "text", text: "=== RUBRIC / ASSIGNMENT SHEET ===" },
        ...rubricBlocks,
        { type: "text", text: "=== END OF RUBRIC ===" }
      ] : []),
      { type: "text", text: "=== STUDENT WORK (grade everything below this line) ===" },
      ...allImageBlocks,
      { type: "text", text: "=== END OF STUDENT WORK ===" }
    ];

    let gradeSucceeded = false;
    try {
      const effectivePrompt = problemScope.trim()
        ? buildScopeDirectPrefix(problemScope.trim()) + userPrompt
        : userPrompt;
      const raw = await fetchGradeResult({ contentBlocks, systemPrompt, userPrompt: effectivePrompt, codeContext });
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setResults(applyDimScope(Array.isArray(parsed) ? parsed : [parsed], activeDims));
      gradeSucceeded = true;
    } catch (err) {
      setResults([{
        studentName: "Student Submission",
        overallTier: "P1",
        error: err.message,
        dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" },
        problems: [],
        feedback: err.message || "Error processing submission.",
        strengths: [],
        growthAreas: []
      }]);
    }

    // ── RECORD SUBMISSION (free tier only — coded sessions are counted server-side
    //    against the code's daily budget by /grade, not the per-email counter) ────
    if (gradeSucceeded && !codeContext) {
      try {
        const recRes = await fetch(`${SERVER_URL}/student-record-submission`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalEmail }),
        });
        const recData = await recRes.json();
        setStudentSubmissionsLeft(recData.remaining ?? null);
      } catch {
        // non-fatal — counter failure doesn't break the results screen
      }
    }
    // ── END RECORD SUBMISSION ─────────────────────────────────────────────────

    setOverrides({});
    setActiveStudent(0);
    if (heicFailed.length > 0) setHeicFailedFiles(heicFailed);
    setLoading(false);
    setStep("results");
  }

  // ─── PROBLEM OVERRIDE HELPER ─────────────────────────────────────────────
  function getProblemTier(studentName, probId, originalTier) {
    return problemOverrides?.[studentName]?.[probId] || originalTier;
  }

  function setProblemTier(studentName, probId, tier) {
    setProblemOverrides(prev => ({
      ...prev,
      [studentName]: { ...(prev[studentName] || {}), [probId]: tier }
    }));
  }

  // ─── PDF DOWNLOAD ─────────────────────────────────────────────────────────
  function downloadPDF(student) {
    const ov = overrides[student.studentName] || {};
    const displayName = ov.renamedName || student.studentName;
    const overall = ov.overall || student.overallTier;
    const tierLabels = { P4: "Mastery", P3: "Approaching Mastery", P2: "Developing", P1: "Beginning" };
    const tierColors = { P4: "#0F6E56", P3: "#185FA5", P2: "#854F0B", P1: "#A32D2D" };

    const problemRows = (student.problems || []).map(prob => {
      const t = getProblemTier(student.studentName, prob.id, prob.tier);
      return `
        <tr style="border-bottom:1px solid #E8E6DE;">
          <td style="padding:8px 10px;font-weight:600;">Problem ${prob.id}</td>
          <td style="padding:8px 10px;font-size:12px;color:#5A5A55;">${prob.description || ""}</td>
          <td style="padding:8px 10px;text-align:center;">
            <span style="background:${tierColors[t]}20;color:${tierColors[t]};border:1px solid ${tierColors[t]}40;border-radius:4px;padding:2px 8px;font-weight:700;">${t}</span>
          </td>
          <td style="padding:8px 10px;font-size:11px;color:#5A5A55;">${prob.processAssessment || ""}</td>
        </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>DM3A Report - ${student.studentName}</title>
    <style>
      body { font-family: Georgia, serif; max-width: 800px; margin: 0 auto; padding: 32px; color: #1A1A18; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      .badge { background: #1A1A18; color: #fff; font-size: 10px; padding: 3px 10px; border-radius: 2px; letter-spacing: 0.1em; text-transform: uppercase; }
      .overall { font-size: 36px; font-weight: 700; color: ${tierColors[overall]}; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th { background: #F5F4EF; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #5A5A55; }
      .dim-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin: 16px 0; }
      .dim { border: 1px solid #E8E6DE; border-radius: 6px; padding: 10px; text-align: center; }
      .dim-label { font-size: 10px; text-transform: uppercase; color: #888; margin-bottom: 4px; }
      .feedback { background: #F5F4EF; border-radius: 6px; padding: 14px; margin-top: 16px; }
      .footer { margin-top: 32px; border-top: 1px solid #E8E6DE; padding-top: 12px; font-size: 11px; color: #888; }
      @media print { body { padding: 16px; } }
    </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
      <div>
        <span class="badge">DM3A Mastery Report</span>
        <h1 style="margin-top:8px;">${displayName}</h1>
        <p style="margin:0;color:#5A5A55;">${subject} · ${assignment || "Assignment"}</p>
        <p style="margin:4px 0 0;color:#888;font-size:12px;">${new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })}</p>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px;color:#888;margin-bottom:4px;">OVERALL MASTERY</div>
        <div class="overall">${overall}</div>
        <div style="color:${tierColors[overall]};font-size:13px;">${tierLabels[overall]}</div>
      </div>
    </div>
    <div class="dim-grid">
      ${[["Conceptual", ov.conceptual || student.dimensions?.conceptualUnderstanding],
         ["Problem Solving", ov.problemSolving || student.dimensions?.problemSolving],
         ["Work Shown", ov.workShown || student.dimensions?.workShown],
         ["Accuracy", ov.accuracy || student.dimensions?.accuracy]].filter(([, val]) => val != null).map(([label, val]) =>
        `<div class="dim"><div class="dim-label">${label}</div><div style="font-weight:700;font-size:18px;color:${tierColors[val||"P1"]}">${val||"—"}</div></div>`
      ).join("")}
    </div>
    ${student.problems?.length > 0 ? `
    <table>
      <thead><tr><th>Problem</th><th>Description</th><th style="text-align:center;">Mastery</th><th>Process Assessment</th></tr></thead>
      <tbody>${problemRows}</tbody>
    </table>` : ""}
    <div class="feedback">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#5A5A55;margin-bottom:8px;">Personalized Feedback</div>
      <p style="margin:0 0 8px;line-height:1.6;">${student.feedback || ""}</p>
      ${student.strengths?.length ? `<div style="color:#0F6E56;font-size:12px;">✓ Strengths: ${student.strengths.join(", ")}</div>` : ""}
      ${student.growthAreas?.length ? `<div style="color:#185FA5;font-size:12px;margin-top:4px;">→ Growth areas: ${student.growthAreas.join(", ")}</div>` : ""}
    </div>
    ${student.instructorNote ? `<div style="background:#FFF3CD;border:1px solid #FFCA2C;border-radius:6px;padding:10px 14px;margin-top:12px;font-size:13px;color:#856404;"><strong>Note for instructor:</strong> ${student.instructorNote}</div>` : ""}
    <div class="footer">
      Dr. Ralph Minaya, Ed.D. · support@dm3agrader.com<br>
      Generated by DM3A Grader v5 · ${new Date().toLocaleDateString()}
    </div>
    </body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DM3A_${displayName.replace(/\s+/g, "_")}_${assignment || "Report"}.html`;
    a.click();
    setTimeout(() => window.open(url, "_blank"), 100);
  }

  // ─── EXPORT CSV ───────────────────────────────────────────────────────────

  function exportCSV() {
    const rows = [["Student", "Overall", "Conceptual", "Problem Solving", "Work Shown", "Accuracy", "Feedback"]];
    results.forEach(s => {
      const ov = overrides[s.studentName] || {};
      rows.push([
        s.studentName,
        ov.overall || s.overallTier,
        ov.conceptual || s.dimensions?.conceptualUnderstanding || "",
        ov.problemSolving || s.dimensions?.problemSolving || "",
        ov.workShown || s.dimensions?.workShown || "",
        ov.accuracy || s.dimensions?.accuracy || "",
        s.feedback || ""
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DM3A_${subject}_${assignment || "Results"}.csv`;
    a.click();
  }

  // ─── PDF REPORT GENERATION ───────────────────────────────────────────────

  // Blind Grading (§4.3): resolve a graded student's REAL identity from the
  // unlocked mapping (client-side only). Returns null unless the active course is
  // vaulted + unlocked and the alias is found — so non-blind courses are untouched.
  // ONE identity resolver for every surface — tabs, report title, both download paths.
  // On a vaulted course it NEVER emits the source BB filename ("Student_<username>"):
  // it resolves the CONFIRMED alias mapping to the real name, falls back to the alias,
  // and finally to a neutral "Submission N" — never PII from the filename. (#24/#28/#30)
  // `index` is passed explicitly (not results.indexOf) so the zip loop keys the mapping
  // by the true results index. normalizeAlias absorbs OCR whitespace. (#20)
  function reportIdentity(student, index) {
    const i = (typeof index === "number" && index >= 0) ? index : results.indexOf(student);
    const ov = overrides[student.studentName] || {};
    const raw = String(student.studentName || "");
    const isBBLabel = /^student[_-]/i.test(raw) || /_attempt_/i.test(raw); // filename-derived, never an identity
    const submissionLabel = `Submission ${i >= 0 ? i + 1 : "?"}`;

    if (!activeVaulted) {
      const name = ov.renamedName || raw || submissionLabel;
      return { resolved: false, realName: name, safeLabel: name, alias: "", lastName: "", firstName: "", display: name };
    }
    const confirmedAlias = (i >= 0 && studentMapping[i]) ? studentMapping[i] : (isBBLabel ? "" : raw);
    const roster = unlockedRosters[activeCourseCode] || [];
    const m = confirmedAlias ? roster.find((r) => normalizeAlias(r.alias) === normalizeAlias(confirmedAlias)) : null;
    if (m) {
      let lastName = m.lastName || "", firstName = m.firstName || "";
      if (!lastName && !firstName) {
        const full = String(m.studentName || "").trim();
        if (full.includes(",")) { const [l, f] = full.split(","); lastName = l.trim(); firstName = (f || "").trim(); }
        else { const p = full.split(/\s+/); lastName = p[p.length - 1] || ""; firstName = p.slice(0, -1).join(" "); }
      }
      const realName = m.studentName || `${firstName} ${lastName}`.trim();
      const display = namesUnlocked ? `${realName} (${m.alias})` : m.alias;
      return { resolved: true, realName, safeLabel: m.alias, alias: m.alias, lastName, firstName, display };
    }
    // Vaulted but unmapped: an alias if we somehow have one, else a NEUTRAL label — never `raw`.
    const alias = (confirmedAlias && !isBBLabel) ? confirmedAlias : "";
    const safe = alias || submissionLabel;
    return { resolved: false, realName: safe, safeLabel: safe, alias, lastName: "", firstName: "", display: safe };
  }

  // Back-compat: the resolved real identity, or null when unresolved.
  function resolveReportIdentity(student, index) {
    const r = reportIdentity(student, index);
    return r.resolved ? r : null;
  }

  function buildReportFilename(student, index) {
    const ov = overrides[student.studentName] || {};
    const tier = ov.overall || student.overallTier;
    const id = reportIdentity(student, index);
    const san = (s) => String(s || "").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "") || "NA";
    if (id.resolved) return `${san(id.lastName)}_${san(id.firstName)}_${san(id.alias)}_Report.pdf`;
    // Vaulted-but-unresolved: alias or "Submission_N" — NEVER the BB filename. (#28/#30)
    if (activeVaulted) return `${san(id.safeLabel)}_Report.pdf`;
    const displayName = ov.renamedName || student.studentName;
    const namePart = displayName.includes(",")
      ? displayName.split(",").map(p => p.trim()).reverse().join("_")
      : displayName.replace(/\s+/g, "_");
    const assignPart = (assignment || "Assignment").slice(0, 15).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").replace(/_+$/, "");
    return `${namePart}_${assignPart}_${tier}.pdf`;
  }

  async function generateStudentPDF(student, index) {
    const { jsPDF } = await import("jspdf");
    const ov = overrides[student.studentName] || {};
    // Blind (§4.3): body is alias-only by default (safe to distribute). Instructors
    // handing back in person can opt in to the real name, rendered client-side here.
    // #28: the title is ALWAYS a safe label (alias / "Submission N") for a vaulted
    // course — never the source BB filename — unless the real name is opted in.
    const idobj = reportIdentity(student, index);
    const displayName = (includeNameOnReport && idobj.resolved) ? idobj.realName : idobj.safeLabel;
    const tier = ov.overall || student.overallTier;
    const NAVY = [10, 22, 40];
    const GOLD = [201, 168, 76];
    const WHITE = [255, 255, 255];
    const LIGHT = [248, 247, 244];
    const tierColors = { P4: [15, 110, 86], P3: [24, 95, 165], P2: [133, 79, 11], P1: [163, 45, 45] };
    const tc = tierColors[tier] || [80, 80, 80];

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = 210; const M = 15;

    // Header bar
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 28, "F");
    doc.setFillColor(...GOLD);
    doc.rect(0, 28, W, 2, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(16); doc.setFont("helvetica", "bold");
    doc.text("DM3A Grader", M, 12);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text("Mastery-Based Assessment Report", M, 19);
    doc.text(`${subject} · ${assignment || "Assignment"}`, M, 25);
    doc.setTextColor(0, 0, 0);

    // Student name + tier badge
    let y = 40;
    doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text(displayName, M, y);
    doc.setFillColor(...tc);
    doc.roundedRect(W - M - 22, y - 9, 22, 10, 2, 2, "F");
    doc.setTextColor(...WHITE);
    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text(tier, W - M - 11, y - 3, { align: "center" });
    doc.setTextColor(0, 0, 0);

    // P3/P4 rate
    const probs = student.problems || [];
    const graded = probs.filter(p => p.tier && p.tier !== "N/A");
    const masteryCount = graded.filter(p => p.tier === "P3" || p.tier === "P4").length;
    const pct = graded.length > 0 ? Math.round(masteryCount / graded.length * 100) : null;
    y += 7;
    doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(90, 90, 85);
    doc.text(pct !== null ? `P3/P4 Rate: ${pct}% (${masteryCount} of ${graded.length} problems at mastery)` : "", M, y);
    doc.setTextColor(0, 0, 0);

    // Dimensions
    y += 10;
    doc.setFillColor(...LIGHT);
    doc.rect(M, y, W - M * 2, 24, "F");
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(90, 90, 85);
    doc.text("DIMENSIONS", M + 3, y + 5);
    const dims = [
      ["Conceptual", ov.conceptual || student.dimensions?.conceptualUnderstanding],
      ["Problem Solving", ov.problemSolving || student.dimensions?.problemSolving],
      ["Work Shown", ov.workShown || student.dimensions?.workShown],
      ["Accuracy", ov.accuracy || student.dimensions?.accuracy],
    ].filter(([, val]) => val != null);
    const colW = (W - M * 2) / Math.max(1, dims.length);
    dims.forEach(([label, val], i) => {
      const x = M + i * colW + colW / 2;
      const dtc = tierColors[val] || [80, 80, 80];
      doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(...dtc);
      doc.text(val || "—", x, y + 16, { align: "center" });
      doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(90, 90, 85);
      doc.text(label, x, y + 22, { align: "center" });
    });
    doc.setTextColor(0, 0, 0);

    // Problem breakdown
    y += 32;
    if (probs.length > 0) {
      doc.setFontSize(9); doc.setFont("helvetica", "bold");
      doc.setFillColor(...NAVY); doc.rect(M, y, W - M * 2, 6, "F");
      doc.setTextColor(...WHITE); doc.setFont("helvetica", "bold");
      doc.text("PROBLEM BREAKDOWN", M + 3, y + 4.5);
      doc.setTextColor(0, 0, 0);
      y += 8;
      const NOTE_X = M + 26; const NOTE_W = W - M - NOTE_X - 6; const LINE_H = 4.5;
      probs.forEach((prob, idx) => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0, 0, 0); // hard reset every row
        doc.setFontSize(8); doc.setFont("helvetica", "normal");
        const noteText = (prob.processAssessment || prob.description || "").replace(/[^\x00-\xFF]/g, '').replace(/°/g, ' deg').replace(/·/g, '-').replace(/≈/g, '~').replace(/"/g, '"');
        const noteLines = doc.splitTextToSize(noteText, NOTE_W);
        const rowH = Math.max(9, noteLines.length * LINE_H + 4);
        if (y + rowH > 270) { doc.addPage(); y = 20; }
        const ptc = tierColors[getProblemTier(student.studentName, prob.id, prob.tier)] || [80, 80, 80];
        doc.setFillColor(idx % 2 === 0 ? 248 : 255, idx % 2 === 0 ? 247 : 255, idx % 2 === 0 ? 244 : 255);
        doc.rect(M, y, W - M * 2, rowH, "F");
        const textY = y + LINE_H + 1;
        doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(...ptc);
        doc.text(`${prob.id}`, M + 2, textY);
        doc.setFont("helvetica", "bold"); doc.setTextColor(...ptc);
        doc.text(getProblemTier(student.studentName, prob.id, prob.tier), M + 14, textY);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(50, 50, 50);
        doc.text(noteLines, NOTE_X, textY);
        y += rowH;
      });
    }

    // Feedback
    y += 6;
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "normal"); // explicit reset before feedback section
    doc.setFillColor(...LIGHT); doc.rect(M, y, W - M * 2, 5, "F");
    doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setFillColor(...NAVY);
    doc.setTextColor(...NAVY); doc.text("PERSONALIZED FEEDBACK", M + 3, y + 3.5);
    doc.setTextColor(0, 0, 0); y += 8;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    const feedbackText = (student.feedback || "").replace(/[^\x00-\xFF]/g, '').replace(/°/g, ' deg').replace(/·/g, '-').replace(/≈/g, '~').replace(/"/g, '"');
    const feedbackLines = doc.splitTextToSize(feedbackText, W - M * 2 - 4);
    doc.text(feedbackLines, M + 2, y);
    y += feedbackLines.length * 5 + 4;

    // Footer
    doc.setFontSize(7); doc.setTextColor(150, 150, 150);
    doc.text(`Generated by DM3A Grader · Dr. Ralph Minaya, Ed.D. · ${new Date().toLocaleDateString()}`, M, 290);

    return doc;
  }

  async function downloadStudentReport(student, index) {
    const doc = await generateStudentPDF(student, index);
    doc.save(buildReportFilename(student, index));
  }

  async function downloadAllReports() {
    const { default: JSZip } = await import("jszip");
    if (!results.some(s => !["HEIC", "DOCX"].includes(s.overallTier))) return;
    setGeneratingReports(true);
    try {
      const zip = new JSZip();
      // #30: iterate by TRUE results index so buildReportFilename/reportIdentity read the
      // confirmed studentMapping[i] — both download paths now share one identity resolver.
      for (let i = 0; i < results.length; i++) {
        const student = results[i];
        if (["HEIC", "DOCX"].includes(student.overallTier)) continue;
        const doc = await generateStudentPDF(student, i);
        const pdfBytes = doc.output("arraybuffer");
        zip.file(buildReportFilename(student, i), pdfBytes);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const date = new Date().toISOString().slice(0, 10);
      const assignPart = (assignment || "Assignment").slice(0, 15).replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `DM3A_Reports_${assignPart}_${date}.zip`; a.click();
    } finally {
      setGeneratingReports(false);
    }
  }

  // ─── COLORS ───────────────────────────────────────────────────────────────

  // Top-level systemPrompt — used by BB batch preview screen (subject may not be set yet at render time)
  const systemPrompt = buildSystemPrompt(COURSE_CONFIGS[subject] || COURSE_CONFIGS["Intermediate Algebra"], activeDims);

  const tierColor = { P4: "#0F6E56", P3: "#185FA5", P2: "#854F0B", P1: "#A32D2D" };
  const tierBg = { P4: "#E1F5EE", P3: "#E6F1FB", P2: "#FAEEDA", P1: "#FCEBEB" };
  const tierBorder = { P4: "#A3D9C8", P3: "#A3C4E8", P2: "#E8C98A", P1: "#F5BEBE" };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  const styles = {
    root: { fontFamily: "'Georgia', 'Times New Roman', serif", maxWidth: 780, margin: "0 auto", padding: "24px 20px", color: "#1A1A18", background: "#FAFAF7", minHeight: "100vh" },
    header: { borderBottom: "2px solid #1A1A18", paddingBottom: 16, marginBottom: 28 },
    badge: { background: "#1A1A18", color: "#F0EFE9", fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 2, letterSpacing: "0.12em", textTransform: "uppercase" },
    h1: { margin: "10px 0 4px", fontSize: 26, fontWeight: 400, letterSpacing: "-0.02em" },
    sub: { margin: 0, fontSize: 13, color: "#5A5A55" },
    card: { background: "#fff", border: "1px solid #D8D6CE", borderRadius: 8, padding: 20, marginBottom: 16 },
    label: { display: "block", fontSize: 11, fontWeight: 700, color: "#5A5A55", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" },
    input: { width: "100%", padding: "10px 12px", border: "1px solid #C8C6BE", borderRadius: 6, fontSize: 14, background: "#FAFAF7", boxSizing: "border-box", fontFamily: "inherit" },
    btn: { background: "#1A1A18", color: "#F0EFE9", border: "none", borderRadius: 6, padding: "12px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em" },
    btnOutline: { background: "transparent", color: "#1A1A18", border: "1px solid #1A1A18", borderRadius: 6, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" },
    uploadZone: (active) => ({ border: `2px dashed ${active ? "#0F6E56" : "#C8C6BE"}`, borderRadius: 8, padding: "20px 16px", textAlign: "center", cursor: "pointer", background: active ? "#E1F5EE" : "#FAFAF7", transition: "all 0.2s" }),
    tierPill: (tier) => ({ background: TIER_META[tier]?.bg, color: TIER_META[tier]?.color, border: `1px solid ${TIER_META[tier]?.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, display: "inline-block", letterSpacing: "0.06em" }),
    mastery: (t) => ({ background: tierBg[t] || "#F5F5F0", color: tierColor[t] || "#333", border: `1px solid ${tierBorder[t] || "#DDD"}`, borderRadius: 4, padding: "3px 10px", fontSize: 13, fontWeight: 700, display: "inline-block" }),
  };



  // ── LOGIN SCREEN ──────────────────────────────────────────────────────────
  // Resume banner (Finding #16) — fixed top bar, shown wherever it's placed. One
  // screen renders at a time, so including it in several returns can't duplicate it.
  const resumeMins = pendingResume ? Math.max(1, Math.round((Date.now() - pendingResume.savedAt) / 60000)) : 0;
  const resumeBanner = pendingResume ? (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1200, background: "#0f2d5a", color: "#fff", padding: "10px 16px", display: "flex", justifyContent: "center", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 14 }}>
      <span>↩ Resume session: <b>{pendingResume.courseCode || "session"}</b> · {pendingResume.count} graded · {resumeMins} min ago</span>
      <button style={{ background: "#f5c842", color: "#0f2d5a", border: "none", borderRadius: 6, padding: "5px 14px", fontWeight: 700, cursor: "pointer" }} onClick={resumeSession}>Resume</button>
      <button style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.5)", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }} onClick={dismissResume}>Dismiss</button>
    </div>
  ) : null;

  // Unlock modal (Finding #15): shared so it renders on EVERY screen the doorway
  // can be triggered from (setup + results). Previously it lived only in the setup
  // return, so clicking "Unlock names" on the results screen was a dead click.
  const unlockModal = unlockPrompt ? (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 360, maxWidth: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>🔒 Unlock {unlockPrompt.courseCode}</h3>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#5A5A55" }}>{unlockPrompt.message}</p>
        <input type="password" autoFocus placeholder={`Course passphrase (≥${MIN_PASSPHRASE_LEN})`} value={unlockPass}
          onChange={e => setUnlockPass(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") doUnlock(); }}
          style={{ ...styles.input, marginBottom: 8 }} />
        {unlockError && <div style={{ color: "#9f1239", fontSize: 12.5, marginBottom: 8 }}>{unlockError}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={styles.btn} disabled={vaultBusy} onClick={doUnlock}>{vaultBusy ? "Unlocking…" : "Unlock"}</button>
          <button type="button" style={styles.btnOutline} disabled={vaultBusy} onClick={() => { setUnlockPrompt(null); setUnlockPass(""); setUnlockError(""); }}>Cancel</button>
        </div>
      </div>
    </div>
  ) : null;

  if (step === "login" && showLanding)
    return <>
      {resumeBanner}
      <LandingPage
        onSignIn={() => { setShowLanding(false); setStep("role-select"); }}
        onStudentStart={() => { setShowLanding(false); setIsStudentMode(true); setStep("student-upload"); }}
      />
    </>;

  // ── ROLE SELECTOR ────────────────────────────────────────────────────────
  if (step === "role-select") return (
    <div style={{ ...styles.root, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={{ ...styles.header, textAlign: "center" }}>
          <span style={styles.badge}>DM3A Grader™</span>
          <h1 style={{ ...styles.h1, marginBottom: 6 }}>Who are you?</h1>
          <p style={styles.sub}>Choose your path to get started.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* Instructor card */}
          <div style={{ background: "#1B2A4A", borderRadius: 12, padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "0.02em" }}>I'm an Instructor</div>
            <div style={{ width: 32, height: 2, background: "#C9A84C", borderRadius: 1 }} />
            <p style={{ fontSize: 13, color: "#C4BFAD", lineHeight: 1.6, margin: 0, flex: 1 }}>
              Grade your class with mastery-based AI scoring.
            </p>
            <button
              style={{ ...styles.btn, background: "#C9A84C", color: "#1B2A4A", marginTop: 8 }}
              onClick={() => { setAuthInitialView("login"); setStep("login"); }}>
              Sign in →
            </button>
            {/* Instructors now need an account, so the way to make one has to be
                visible from the front door — not buried on the next screen. */}
            <p style={{ margin: 0, textAlign: "center", fontSize: 12, color: "#C4BFAD" }}>
              New here?{" "}
              <button
                style={{ background: "none", border: "none", padding: 0, color: "#C9A84C", cursor: "pointer", fontSize: 12, textDecoration: "underline", fontFamily: "inherit" }}
                onClick={() => { setAuthInitialView("signup"); setStep("login"); }}>
                Create an account
              </button>
            </p>
          </div>
          {/* Student card */}
          <div style={{ background: "#fff", border: "2px solid #1B2A4A", borderRadius: 12, padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1B2A4A", letterSpacing: "0.02em" }}>I'm a Student</div>
            <div style={{ width: 32, height: 2, background: "#0F6E56", borderRadius: 1 }} />
            <p style={{ fontSize: 13, color: "#5A5A55", lineHeight: 1.6, margin: 0, flex: 1 }}>
              Get feedback on your own math work — free.
            </p>
            <button
              style={{ ...styles.btn, marginTop: 8 }}
              onClick={() => { setIsStudentMode(true); setStep("student-upload"); }}>
              Start →
            </button>
          </div>
        </div>
        <p style={{ textAlign: "center", fontSize: 12, color: "#888" }}>
          <button
            style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
            onClick={() => { setShowLanding(true); setStep("login"); }}>
            ← Back to dm3agrader.com
          </button>
        </p>
      </div>
    </div>
  );

  // Instructor accounts: sign in / create account / forgot password, plus the
  // shared-password and trial-password fallbacks. See src/auth/AuthGate.jsx.
  if (step === "login") return (
    <AuthGate initialView={authInitialView} onAuthed={handleAuthed} onBack={() => setStep("role-select")} />
  );

  // ── STUDENT UPLOAD SCREEN ─────────────────────────────────────────────────
  if (step === "student-upload") return (
    <div style={{ ...styles.root, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={styles.header}>
          <span style={styles.badge}>DM3A Grader™ — Student Submission</span>
          <h1 style={styles.h1}>Submit Your Work</h1>
          <p style={styles.sub}>Upload your assignment — we'll review your reasoning and give you feedback.</p>
        </div>

        {/* Limit-reached state */}
        {studentSubmissionsLeft !== null && studentSubmissionsLeft <= 0 && (
          <div style={{ background: "#FEF9EC", border: "1px solid #F5C842", borderRadius: 8, padding: 24, marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "#1A1A18" }}>
              You've used your free submissions
            </div>
            <p style={{ fontSize: 14, color: "#5A5A55", lineHeight: 1.65, marginBottom: 20 }}>
              Ask your instructor about DM3A Grader — a class access code gives you unlimited feedback on your work.
            </p>
            <a
              href="https://dm3agrader.com"
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", ...styles.btn, textDecoration: "none" }}>
              dm3agrader.com
            </a>
          </div>
        )}

        {/* Blocked state — gatekeeper fired */}
        {(studentSubmissionsLeft === null || studentSubmissionsLeft > 0) && gatekeeperBlocked && (
          <div style={{ background: "#FEF9EC", border: "1px solid #F5C842", borderRadius: 8, padding: 24, marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "#1A1A18" }}>
              We need to see your work first
            </div>
            <p style={{ fontSize: 14, color: "#5A5A55", lineHeight: 1.65, marginBottom: 20 }}>
              It looks like this submission doesn't include your steps. DM3A Grader gives feedback on your reasoning, so we need to see your attempt — your setup, formulas, or calculations — even if you're not sure they're right. Add your work and try again.
            </p>
            <button
              style={styles.btn}
              onClick={() => { setGatekeeperBlocked(false); setGatekeeperReason(""); setStudentFiles([]); }}>
              Re-upload my work
            </button>
          </div>
        )}

        {(studentSubmissionsLeft === null || studentSubmissionsLeft > 0) && !gatekeeperBlocked && (
          <div style={styles.card}>
            {/* Class code first — a valid code hides the email field entirely. */}
            <label style={styles.label}>Have a class code from your instructor? <span style={{ fontWeight: 400, color: "#888" }}>(optional)</span></label>
            <input
              style={{ ...styles.input, marginBottom: codeStatus === "idle" ? 14 : 6, fontFamily: "monospace", letterSpacing: "0.04em" }}
              placeholder="e.g. DM3A-7K9QP2"
              value={studentClassCode}
              onChange={e => setStudentClassCode(e.target.value)} />
            {codeStatus === "checking" && <div style={{ fontSize: 12.5, color: "#5A5A55", marginBottom: 14 }}>Checking code…</div>}
            {codeStatus === "valid" && <div style={{ fontSize: 12.5, color: "#0F6E56", fontWeight: 600, marginBottom: 14 }}>✓ Class code accepted{codeCourse ? ` for ${codeCourse}` : ""} — unlimited access. No email needed.</div>}
            {codeStatus === "capped" && <div style={{ fontSize: 12.5, color: "#9a6a00", marginBottom: 14 }}>This class code has reached today's limit. Remove it to use the free tier, or try again tomorrow.</div>}
            {codeStatus === "invalid" && <div style={{ fontSize: 12.5, color: "#9a6a00", marginBottom: 14 }}>Code not recognized — check with your instructor, or leave it blank to use the free tier.</div>}
            {codeStatus === "error" && <div style={{ fontSize: 12.5, color: "#5A5A55", marginBottom: 14 }}>Couldn't check that code right now — you can still use the free tier below.</div>}

            {/* Email — only for the free tier; hidden once a code checks out. */}
            {codeStatus !== "valid" && (
              <>
                <label style={styles.label}>Your Email *</label>
                <input
                  style={{ ...styles.input, marginBottom: 14 }}
                  type="email"
                  placeholder="you@school.edu"
                  value={studentEmail}
                  onChange={e => setStudentEmail(e.target.value)} />
              </>
            )}
            <label style={styles.label}>Subject *</label>
            <select style={{ ...styles.input, marginBottom: 14 }} value={subject} onChange={e => setSubject(e.target.value)}>
              <option value="">— Select a subject —</option>
              <option value="Elementary Statistics">Elementary Statistics</option>
              <option value="Intermediate Algebra">Intermediate Algebra</option>
              <option value="Precalculus">Precalculus</option>
              <option value="Other">Other</option>
            </select>
            <label style={styles.label}>Assignment Name (optional)</label>
            <input style={{ ...styles.input, marginBottom: 14 }} placeholder="e.g., Quiz 3 — Linear Systems" value={assignment} onChange={e => setAssignment(e.target.value)} />
            <label style={styles.label}>Upload Your Work *</label>
            <div style={styles.uploadZone(studentFiles.length > 0)} onClick={() => studentRef.current.click()}>
              <input ref={studentRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }}
                onChange={e => setStudentFiles(Array.from(e.target.files))} />
              {studentFiles.length > 0
                ? <span style={{ color: "#0F6E56", fontWeight: 600 }}>{studentFiles.length} file{studentFiles.length !== 1 ? "s" : ""} selected</span>
                : <span style={{ color: "#888", fontSize: 13 }}>Photos or PDFs of your handwritten work</span>
              }
            </div>
            <label style={{ ...styles.label, marginTop: 14 }}>Rubric or Assignment Sheet <span style={{ fontWeight: 400, color: "#888" }}>(optional)</span></label>
            <div style={styles.uploadZone(!!studentRubricFile)} onClick={() => studentRubricRef.current.click()}>
              <input ref={studentRubricRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
                onChange={e => setStudentRubricFile(e.target.files[0] || null)} />
              {studentRubricFile
                ? <span style={{ color: "#0F6E56", fontWeight: 600 }}>{studentRubricFile.name}</span>
                : <span style={{ color: "#888", fontSize: 13 }}>Upload the rubric or problem set (PDF or image)</span>
              }
            </div>
            {error && <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 10 }}>{error}</p>}
            <button
              style={{ ...styles.btn, width: "100%", marginTop: 16 }}
              disabled={loading || !subject || !studentFiles.length || (codeStatus !== "valid" && !studentEmail.trim())}
              onClick={handleStudentGrade}>
              {loading ? loadingMsg || "Checking..." : "Get my feedback →"}
            </button>
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: 12, color: "#888", marginTop: 8 }}>
          <button style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
            onClick={() => { setIsStudentMode(false); setStep("role-select"); setGatekeeperBlocked(false); setStudentFiles([]); setStudentEmail(""); setStudentClassCode(""); setCodeStatus("idle"); setCodeCourse(""); setStudentSubmissionsLeft(null); setStudentRubricFile(null); }}>
            ← Back
          </button>
        </p>
      </div>
    </div>
  );

  // ── TIER GUIDE MODAL ──────────────────────────────────────────────────────
  const TierGuideModal = () => showTierGuide && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 28, maxWidth: 600, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <span style={styles.badge}>Course Coverage</span>
            <h2 style={{ margin: "8px 0 4px", fontSize: 20, fontWeight: 400 }}>Supported Subjects</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#5A5A55" }}>Know your grading confidence level before uploading</p>
          </div>
          <button onClick={() => setShowTierGuide(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#888" }}>✕</button>
        </div>

        {/* Tier Legend */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {Object.entries(TIER_META).map(([key, meta]) => (
            <div key={key} style={{ background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 6, padding: "8px 12px", flex: 1, minWidth: 140 }}>
              <div style={{ color: meta.color, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{meta.icon} {meta.label}</div>
              <div style={{ fontSize: 11, color: "#5A5A55", lineHeight: 1.4 }}>{meta.description}</div>
            </div>
          ))}
        </div>

        {/* Course List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(COURSE_CONFIGS).map(([name, config]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1px solid #E8E6DE", borderRadius: 6, background: "#FAFAF7" }}>
              <span style={styles.tierPill(config.tier)}>{TIER_META[config.tier].icon} {TIER_META[config.tier].label}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{config.label}</div>
                <div style={{ fontSize: 12, color: "#5A5A55" }}>{config.description}</div>
              </div>
            </div>
          ))}
          {/* Experimental placeholders */}
          {["Calculus III / Multivariable", "Differential Equations", "Discrete Mathematics"].map(name => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "1px solid #E8E6DE", borderRadius: 6, background: "#FAFAF7", opacity: 0.6 }}>
              <span style={styles.tierPill("experimental")}>{TIER_META.experimental.icon} Coming Soon</span>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
            </div>
          ))}
        </div>

        <button onClick={() => setShowTierGuide(false)} style={{ ...styles.btn, width: "100%", marginTop: 20 }}>
          I understand — Start Grading →
        </button>
      </div>
    </div>
  );

  // ── HELP PANEL (slide-in overlay) ────────────────────────────────────────
  const NAVY = "#0f2d5a"; const GOLD = "#f5c842";
  const helpTabs = [
    {
      label: "Getting Started",
      items: [
        { q: "What is DM3A Grader?", a: <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}><li>Select your course from the dropdown.</li><li>Type the assignment name.</li><li>Upload your answer key (Zone 2).</li><li>Upload student work — photos or PDFs (Zone 3).</li><li>Click Grade and wait about 60 seconds.</li></ol> },
        { q: "Which courses are supported?", a: <><p style={{ margin: "0 0 6px" }}><strong>Fully Supported:</strong> Elementary Statistics, Intermediate Algebra, Precalculus.</p><p style={{ margin: 0 }}><strong>Beta</strong> (review scores before finalizing): Linear Algebra, Calculus I, Calculus II.</p></> },
      ]
    },
    {
      label: "Uploading Files",
      items: [
        { q: "What file types are accepted?", a: <><p style={{ margin: "0 0 6px" }}><strong>Zone 2 (Answer Key):</strong> PDF or image.</p><p style={{ margin: 0 }}><strong>Zone 3 (Student Work):</strong> JPEG, PNG, PDF, HEIC, DOCX. Multiple files allowed.</p></> },
        { q: "My file is large — will it work?", a: "4–25 MB: automatically compressed. Over 100 MB: a warning appears but you can proceed. Very large files may take several minutes." },
        { q: "What if a student submitted a Word document?", a: "DOCX files are automatically converted on our server. No action needed — the app handles it." },
      ]
    },
    {
      label: "Batch Mode",
      items: [
        { q: "How do I grade a whole class at once?", a: <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}><li>Download the batch ZIP from Blackboard.</li><li>Unzip the folder on your computer.</li><li>Drag all the files into Zone 3 at once.</li><li>The app detects Blackboard filenames and switches to Batch Mode automatically.</li><li>Review the student groups, then click Grade All.</li></ol> },
        { q: "Can I remove files before grading?", a: "Yes. The Group Preview screen shows every file per student. Click ✕ next to any file to remove it before grading starts." },
      ]
    },
    {
      label: "Results",
      items: [
        { q: "Can I change a score the AI gave?", a: "Yes. Every score — overall, per dimension, per problem — has an override dropdown. Overrides appear in the downloaded PDF report." },
        { q: "How do I load real student names?", a: "Click Load Roster and upload your Blackboard TSV export. The app matches by username and renames all student tabs automatically." },
        { q: "How do I download reports?", a: "Click ⬇ Download Report for the current student, or ⬇ Download All Reports for a zip of all PDFs at once." },
      ]
    },
    {
      label: "P1–P4 Scale",
      items: [
        { q: "What do P1–P4 mean?", a: <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{[["P4","Mastery (90%+)","#0F6E56","#E1F5EE"],["P3","Approaching (80–89%)","#185FA5","#E6F1FB"],["P2","Developing (60–79%)","#854F0B","#FAEEDA"],["P1","Beginning (<60%)","#A32D2D","#FCEBEB"]].map(([t,l,c,bg]) => <div key={t} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:bg, borderRadius:4, border:`1px solid ${c}30` }}><span style={{ fontWeight:700, color:c, minWidth:24, fontSize:15 }}>{t}</span><span style={{ fontSize:12, color:c }}>{l}</span></div>)}<p style={{ margin:"8px 0 0", fontSize:12, color:"#5A5A55" }}>Each student also gets four dimension scores: Conceptual Understanding, Problem Solving, Work Shown, Accuracy.</p></div> },
      ]
    },
    {
      label: "Troubleshooting",
      items: [
        { q: "A student shows a gray HEIC ⚠ badge", a: "The student's iPhone photo could not be processed. Ask the student to resubmit as JPEG or PDF." },
        { q: "A student shows a gray DOCX ⚠ badge", a: "Word document conversion failed. Ask the student to save as PDF and resubmit." },
        { q: "The AI says no student work found", a: "Images may be blurry, dark, or at an extreme angle. Ask the student to retake photos straight-on in good lighting." },
        { q: "I need more help", a: <span>Email <a href="mailto:support@dm3agrader.com" style={{ color: NAVY }}>support@dm3agrader.com</a> — we respond within 24 hours.</span> },
      ]
    },
  ];

  const HelpPanel = () => {
    const [activeTab, setActiveTab] = useState(0);
    const [openItems, setOpenItems] = useState(new Set([0]));
    const toggleItem = i => setOpenItems(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
    const items = helpTabs[activeTab].items;
    return (
      <div style={{ position: "fixed", top: 0, right: showHelp ? 0 : -340, width: 340, height: "100vh", background: "#fff", boxShadow: "-4px 0 20px rgba(0,0,0,0.18)", zIndex: 200, display: "flex", flexDirection: "column", transition: "right 0.3s ease", fontFamily: "'Georgia','Times New Roman',serif" }}>
        {/* Header */}
        <div style={{ background: NAVY, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <span style={{ color: GOLD, fontWeight: 700, fontSize: 14, letterSpacing: "0.03em" }}>DM3A Grader — Help</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={() => setShowHelp(false)} style={{ background: "none", border: "none", color: GOLD, fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
          </div>
        </div>
        {/* Tab bar */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: "8px 8px 0", background: "#f5f4ef", flexShrink: 0 }}>
          {helpTabs.map((tab, i) => (
            <button key={i} onClick={() => { setActiveTab(i); setOpenItems(new Set([0])); }}
              style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", background: activeTab === i ? NAVY : "transparent", color: activeTab === i ? GOLD : "#5A5A55", letterSpacing: "0.03em" }}>
              {tab.label}
            </button>
          ))}
        </div>
        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
          {items.map((item, i) => (
            <div key={i} style={{ borderBottom: "1px solid #E8E6DE" }}>
              <button onClick={() => toggleItem(i)}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 16px", background: openItems.has(i) ? "#f5f4ef" : "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                <span style={{ fontWeight: 700, fontSize: 12, color: "#1A1A18", lineHeight: 1.4 }}>{item.q}</span>
                <span style={{ color: "#888", fontSize: 14, marginLeft: 8, flexShrink: 0 }}>{openItems.has(i) ? "−" : "+"}</span>
              </button>
              {openItems.has(i) && (
                <div style={{ padding: "10px 16px 14px", fontSize: 12, color: "#3A3A35", lineHeight: 1.7, background: "#fff" }}>
                  {typeof item.a === "string" ? <p style={{ margin: 0 }}>{item.a}</p> : item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── SETUP SCREEN ──────────────────────────────────────────────────────────
  if (step === "setup") return (
    <div style={styles.root}>
      {resumeBanner}
      <HelpPanel />
      <TierGuideModal />
      <div style={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={styles.badge}>DM3A Grader v5</span>
            <h1 style={styles.h1}>Mastery-Based AI Grading</h1>
            <p style={styles.sub}>Dr. Ralph Minaya, Ed.D.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowTierGuide(true)} style={styles.btnOutline}>Course Coverage Guide</button>
            <button onClick={() => setShowHelp(prev => !prev)} style={{ ...styles.btnOutline, ...(showHelp ? { background: "#0f2d5a", color: "#f5c842", borderColor: "#0f2d5a" } : {}) }}>
              {showHelp ? "× Close Help" : "? Help"}
            </button>
          </div>
        </div>
        {/* Account bar (instructor accounts) */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 10, fontSize: 12, color: "#5A5A55" }}>
          {authUser ? (
            <>
              <span>Signed in as <b>{authUser.name || authUser.email}</b></span>
              <button onClick={handleSignOut} style={{ ...styles.btnOutline, padding: "4px 10px", fontSize: 12 }}>Sign out</button>
            </>
          ) : authLegacy ? (
            <>
              <span>Signed in with the shared password — courses stay on this device.</span>
              <button onClick={handleSignOut} style={{ ...styles.btnOutline, padding: "4px 10px", fontSize: 12 }}>Sign out</button>
            </>
          ) : null}
        </div>
      </div>

      {/* Subject Selection */}
      <div style={styles.card}>
        <label style={styles.label}>Subject *</label>
        <select
          style={{ ...styles.input, marginBottom: subject ? 10 : 0 }}
          value={subject}
          onChange={e => setSubject(e.target.value)}
        >
          <option value="">— Select a subject —</option>
          {Object.entries(COURSE_CONFIGS).map(([name, config]) => (
            <option key={name} value={name}>{TIER_META[config.tier].icon} {config.label} [{TIER_META[config.tier].label}]</option>
          ))}
        </select>
        {subject && (
          <div style={{ background: TIER_META[COURSE_CONFIGS[subject].tier].bg, border: `1px solid ${TIER_META[COURSE_CONFIGS[subject].tier].border}`, borderRadius: 6, padding: "10px 14px", marginTop: 8 }}>
            <span style={{ color: TIER_META[COURSE_CONFIGS[subject].tier].color, fontWeight: 700, fontSize: 13 }}>
              {TIER_META[COURSE_CONFIGS[subject].tier].icon} {TIER_META[COURSE_CONFIGS[subject].tier].label}
            </span>
            <span style={{ fontSize: 13, color: "#5A5A55", marginLeft: 8 }}>
              {TIER_META[COURSE_CONFIGS[subject].tier].description}
            </span>
          </div>
        )}
      </div>

      {/* Assignment Info */}
      <div style={styles.card}>
        <label style={styles.label}>Assignment Name</label>
        <input style={{ ...styles.input, marginBottom: 14 }} placeholder="e.g., Quiz 3 — Linear Systems" value={assignment} onChange={e => setAssignment(e.target.value)} />
        <label style={styles.label}>Additional Rubric Notes (optional)</label>
        <textarea style={{ ...styles.input, minHeight: 80, resize: "vertical", marginBottom: 14 }} placeholder="Any specific grading notes for this assignment..." value={rubric} onChange={e => setRubric(e.target.value)} />

        <label style={styles.label}>Scoring Dimensions</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
          {DIM_META.map(([key, label]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!activeDims[key]}
                onChange={e => setActiveDims(prev => {
                  const next = { ...prev, [key]: e.target.checked };
                  return Object.values(next).some(Boolean) ? next : prev; // never allow zero dimensions
                })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: "#5A5A55", lineHeight: 1.5 }}>
          Uncheck any dimension this assignment does not evidence. A true/false or multiple-choice quiz
          normally scores Accuracy only — scoring the others from a page with no work produces guesses
          that change between runs. Unchecking Work Shown also tells the grader that written
          justifications are not expected, so a correct answer is not capped at P3.
        </p>
        <label style={styles.label}>Problems to grade (optional)</label>
        <input style={styles.input} placeholder="e.g. Problems 1, 2a, 2b, 3, 4a, 4b, 4c, 5a, 5b" value={problemScope} onChange={e => setProblemScope(e.target.value)} />
      </div>

      {/* Blind Grading — inline unlock prompt (shared; see unlockModal). */}
      {unlockModal}

      {/* At-Risk Tracking — Course Profiles (optional; input + local storage only) */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>At-Risk Tracking <span style={{ fontWeight: 400, color: "#888" }}>(optional)</span></h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#888" }}>Saved locally on this device. Not sent anywhere in this step.</p>
          </div>
          <button type="button" style={{ ...styles.btnOutline, ...(showManageCourses ? { background: "#0f2d5a", color: "#f5c842", borderColor: "#0f2d5a" } : {}) }} onClick={() => setShowManageCourses(v => !v)}>
            {showManageCourses ? "× Close Manage Courses" : "Manage Courses"}
          </button>
        </div>

        {/* Active course selector */}
        <label style={styles.label}>Course / Section</label>
        {courses.length === 0 ? (
          <select style={{ ...styles.input, marginBottom: 12 }} value="" disabled>
            <option value="">No courses yet — add one in Manage Courses</option>
          </select>
        ) : (
          <select style={{ ...styles.input, marginBottom: 12 }} value={activeCourseCode} onChange={e => selectActiveCourse(e.target.value)}>
            <option value="">— Select a course —</option>
            {courses.map(c => <option key={c.courseCode} value={c.courseCode}>{c.courseCode}</option>)}
          </select>
        )}

        {activeCourseCode && (
          <div style={{ marginBottom: 4 }}>
            <label style={styles.label}>Professor Email (auto-filled — editable; updates the saved profile)</label>
            <input style={{ ...styles.input, marginBottom: 8 }} type="email" value={professorEmail} onChange={e => updateActiveProfessorEmail(e.target.value)} />
            <div style={{ fontSize: 13, color: activeRoster.length ? "#0F6E56" : "#854F0B", fontWeight: 600, marginBottom: 12 }}>
              {activeRoster.length
                ? `Roster: ${activeRoster.length} students loaded for ${activeCourseCode}`
                : "No roster saved for this section."}
            </div>
          </div>
        )}

        {/* Per-session assignment details (NOT tied to a course) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label style={styles.label}>Assignment Weight</label>
            <select style={styles.input} value={assignmentWeight} onChange={e => setAssignmentWeight(e.target.value)}>
              {ASSIGNMENT_WEIGHTS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </div>
          <div>
            <label style={styles.label}>Assignment # in course (1 = first)</label>
            <input style={styles.input} type="number" min="1" placeholder="optional" value={assignmentIndex} onChange={e => setAssignmentIndex(e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>Semester</label>
            <input style={styles.input} value={semesterTag} onChange={e => setSemesterTag(e.target.value)} />
          </div>
        </div>

        {/* Manage Courses panel */}
        {showManageCourses && (
          <div style={{ marginTop: 16, borderTop: "1px solid #D8D6CE", paddingTop: 16 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#5A5A55" }}>Manage Courses</h4>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              <a href="/blind" target="_blank" rel="noreferrer" style={{ color: "#2860C8" }}>Privacy verification ↗</a>
              <span style={{ color: "#888" }}> — how the alias/encryption layer works</span>
            </div>
            {vaultNote && <div style={{ fontSize: 12.5, background: "#EEF4FF", border: "1px solid #cfe0ff", borderRadius: 6, padding: "6px 10px", marginBottom: 10 }}>{vaultNote}</div>}

            {/* Admin key — authorizes creating Student Access Codes (same key as the admin dashboard) */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ ...styles.label, display: "block", marginBottom: 4 }}>Admin key <span style={{ fontWeight: 400, color: "#888" }}>(to create student access codes)</span></label>
              <input
                style={{ ...styles.input, fontFamily: "monospace" }}
                type="password"
                placeholder="Your admin dashboard key"
                value={accessKeyInput}
                onChange={e => setAccessKeyInput(e.target.value)} />
              {accessNote && <div style={{ fontSize: 12, color: "#5A5A55", marginTop: 6 }}>{accessNote}</div>}
            </div>

            {/* Add course */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <input style={{ ...styles.input, flex: 2, minWidth: 140 }} placeholder="Course code / section" value={addCourseCode} onChange={e => setAddCourseCode(e.target.value)} />
              <input style={{ ...styles.input, flex: 2, minWidth: 140 }} type="email" placeholder="Professor email" value={addProfessorEmail} onChange={e => setAddProfessorEmail(e.target.value)} />
              <button type="button" style={styles.btn} onClick={addCourse} disabled={!addCourseCode.trim()}>Add Course</button>
            </div>

            {/* One-time import of this browser's saved courses into the account.
                Idempotent — codes already on the account are skipped — so it is
                safe to run again, and once per machine that holds courses. */}
            {authUser && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                <button type="button" style={{ ...styles.btnOutline, padding: "6px 12px", fontSize: 12 }}
                  disabled={importBusy} onClick={importLocalCourses}>
                  {importBusy ? "Importing…" : "Import courses from this browser"}
                </button>
                <span style={{ fontSize: 12, color: "#888" }}>
                  Brings courses saved on this device into your account. Safe to click twice.
                </span>
              </div>
            )}
            {courseSyncNote && (
              <div style={{ fontSize: 12, color: "#5A5A55", background: "#FEF9EC", border: "1px solid #F5C842", borderRadius: 6, padding: "8px 10px", marginBottom: 12 }}>
                {courseSyncNote}
              </div>
            )}

            {/* Course list */}
            {courses.length === 0 && <div style={{ fontSize: 13, color: "#888" }}>No courses yet.</div>}
            {courses.map(c => (
              <div key={c.courseCode} style={{ border: "1px solid #D8D6CE", borderRadius: 6, padding: 12, marginBottom: 10 }}>
                {editingCourseCode === c.courseCode ? (
                  <div>
                    <label style={styles.label}>Course code</label>
                    <input style={{ ...styles.input, marginBottom: 8 }} value={editCourseCode} onChange={e => setEditCourseCode(e.target.value)} />
                    <label style={styles.label}>Professor email</label>
                    <input style={{ ...styles.input, marginBottom: 8 }} type="email" value={editProfessorEmail} onChange={e => setEditProfessorEmail(e.target.value)} />
                    <label style={styles.label}>Roster — one per line: Name, email</label>
                    <textarea style={{ ...styles.input, minHeight: 110, resize: "vertical", marginBottom: 8, fontFamily: "monospace" }} placeholder={"One student per line, formatted:\nFull Name, email address"} value={editRosterText} onChange={e => setEditRosterText(e.target.value)} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" style={styles.btn} onClick={saveEdit} disabled={!editCourseCode.trim()}>Save</button>
                      <button type="button" style={styles.btnOutline} onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{c.courseCode}</div>
                      <div style={{ fontSize: 12, color: "#5A5A55" }}>
                        {c.professorEmail || "(no email)"} · {isVaulted(c)
                          ? <span style={{ color: "#0F6E56", fontWeight: 700 }}>🔒 secured</span>
                          : `${(c.roster?.length || 0)} students`}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" style={styles.btnOutline} onClick={() => startEdit(c)}>Edit</button>
                      <button type="button" style={{ ...styles.btnOutline, color: "#9f1239", borderColor: "#9f1239" }} onClick={() => deleteCourse(c.courseCode)}>Delete</button>
                    </div>
                  </div>

                  {/* Student Access Code — instructor-linked unlimited Student Mode */}
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #D8D6CE" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#5A5A55", marginBottom: 6 }}>Student Access Code</div>
                    {c.studentAccessCode ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", color: "#1B2A4A", background: "#F1F5FF", border: "1px solid #cfe0ff", borderRadius: 6, padding: "3px 10px" }}>{c.studentAccessCode}</span>
                        <button type="button" style={{ ...styles.btnOutline, padding: "3px 8px", fontSize: 12 }} onClick={() => copyAccessCode(c)}>{copiedCode === c.courseCode ? "✓ Copied" : "Copy"}</button>
                        <button type="button" style={{ ...styles.btnOutline, padding: "3px 8px", fontSize: 12 }} disabled={accessBusy === c.courseCode} onClick={() => generateAccessCode(c, { regenerate: true })}>{accessBusy === c.courseCode ? "Working…" : "Regenerate"}</button>
                        <span style={{ fontSize: 11.5, color: "#888" }}>Students enter this for unlimited access (up to {"100"}/day).</span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12.5, color: "#888" }}>Not generated yet.</span>
                        <button type="button" style={{ ...styles.btnOutline, padding: "3px 10px", fontSize: 12 }} disabled={accessBusy === c.courseCode || !accessKeyInput.trim()} onClick={() => generateAccessCode(c, { regenerate: false })}>{accessBusy === c.courseCode ? "Working…" : "Generate code"}</button>
                        {!accessKeyInput.trim() && <span style={{ fontSize: 11.5, color: "#888" }}>Enter your admin key above first.</span>}
                      </div>
                    )}
                  </div>

                  {/* Blind Grading per-course controls (Part A) */}
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #D8D6CE" }}>
                    {isVaulted(c) ? (
                      <div style={{ fontSize: 12 }}>
                        <span style={{ color: "#0F6E56", fontWeight: 700 }}>🔒 Secured</span>
                        {c.vaultCreatedAt && <span style={{ color: "#5A5A55", marginLeft: 8 }}>· aliases generated {new Date(c.vaultCreatedAt).toLocaleDateString()}</span>}
                        {unlockedRosters[c.courseCode]
                          ? <span style={{ color: "#0F6E56", marginLeft: 8 }}>· Unlocked ({unlockedRosters[c.courseCode].length} students · names in memory only)</span>
                          : <button type="button" style={{ ...styles.btnOutline, marginLeft: 8, padding: "2px 8px", fontSize: 12 }} onClick={() => openUnlock(c.courseCode, "Enter your course passphrase to unlock names for this session.", () => {})}>Unlock</button>}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                          {/* #21: view/print the codes so the instructor can distribute them (unlocked only). */}
                          {unlockedRosters[c.courseCode] && (
                            <button type="button" style={{ ...styles.btnOutline, padding: "3px 8px", fontSize: 12 }} onClick={() => setViewAliases(viewAliases === c.courseCode ? null : c.courseCode)}>
                              {viewAliases === c.courseCode ? "Hide aliases" : "👁 View aliases"}
                            </button>
                          )}
                          {unlockedRosters[c.courseCode] && (
                            <button type="button" style={{ ...styles.btnOutline, padding: "3px 8px", fontSize: 12 }} disabled={vaultBusy} onClick={() => runVault(() => printAliasCards(c))}>🖨 Print alias cards</button>
                          )}
                          <label style={{ ...styles.btnOutline, padding: "3px 8px", fontSize: 12, cursor: "pointer", margin: 0 }}>
                            Update roster (CSV)
                            <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) runVault(() => updateRosterFromCsv(c, f)); }} />
                          </label>
                          <button type="button" style={{ ...styles.btnOutline, padding: "3px 8px", fontSize: 12 }} disabled={vaultBusy} onClick={() => runVault(async () => { const v = await getVault(c.courseCode); if (v) downloadKeyBackup(c.courseCode, v.blob); else setVaultNote("No vault found to back up."); })}>Re-download backup</button>
                          <button type="button" style={{ ...styles.btnOutline, padding: "3px 8px", fontSize: 12, color: "#9f1239", borderColor: "#9f1239" }} disabled={vaultBusy} onClick={() => { if (window.confirm(`Purge the secured roster for ${c.courseCode}? Grade history stays; the encrypted name mapping is removed from the server and this session.`)) runVault(() => purgeCourseVault(c)); }}>Purge vault</button>
                        </div>
                        {/* §3.3: automatic name-zone redaction toggle (default ON for vaulted courses). */}
                        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, cursor: "pointer", color: "#5A5A55" }}>
                          <input type="checkbox" checked={c.redactNames !== false} onChange={e => persistCourses(courses.map(x => x.courseCode === c.courseCode ? { ...x, redactNames: e.target.checked } : x))} />
                          <span>Auto-redact handwritten names on page 1 before grading{c.redactNames !== false ? "" : " (off)"}</span>
                        </label>
                        {/* Student self-check scope: what a STUDENT's own run is scored on for this course. */}
                        <div style={{ marginTop: 8, color: "#5A5A55" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Student self-check scores</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                            {DIM_META.map(([key, label]) => (
                              <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={(c.studentDims || ALL_DIMS)[key] !== false}
                                  onChange={e => setCourseStudentDims(c, key, e.target.checked)}
                                />
                                <span>{label}</span>
                              </label>
                            ))}
                          </div>
                          <div style={{ fontSize: 11, marginTop: 3 }}>Applies to students who enter this course's access code. Your own grading scope is set per assignment on the setup form.</div>
                        </div>
                        {/* #21: current roster/aliases, so an instructor can read the codes before updating or distributing. */}
                        {viewAliases === c.courseCode && unlockedRosters[c.courseCode] && (
                          <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", border: "1px solid #E6E4DC", borderRadius: 6 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                              <thead><tr><th style={{ textAlign: "left", padding: "4px 8px", background: "#F8F7F4" }}>Alias</th><th style={{ textAlign: "left", padding: "4px 8px", background: "#F8F7F4" }}>Student</th></tr></thead>
                              <tbody>
                                {unlockedRosters[c.courseCode].map((s, si) => (
                                  <tr key={si}><td style={{ padding: "4px 8px", fontFamily: "monospace", color: "#2860C8", borderTop: "1px solid #EFEEE8" }}>{s.alias}</td><td style={{ padding: "4px 8px", borderTop: "1px solid #EFEEE8" }}>{s.studentName || `${s.firstName || ""} ${s.lastName || ""}`.trim()}</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12 }}>
                        {/* #9: BB Grade Center CSV import — the canonical roster source. */}
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ ...styles.btnOutline, padding: "4px 10px", fontSize: 12, cursor: "pointer", margin: 0, display: "inline-block" }}>
                            📥 Import BB Grade Center CSV
                            <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) runVault(() => importBBRoster(c, f)); }} />
                          </label>
                          <span style={{ color: "#888", marginLeft: 8 }}>captures Last/First/Username/Student ID/email for export matching</span>
                        </div>
                        <div style={{ color: "#854F0B", marginBottom: 6 }}>⚠ {(c.roster?.length || 0)} names stored <b>unencrypted</b> on this device. Secure them:</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <input type="password" placeholder={`Passphrase (≥${MIN_PASSPHRASE_LEN})`} value={securePass[c.courseCode] || ""} onChange={e => setSecurePass(m => ({ ...m, [c.courseCode]: e.target.value }))} style={{ ...styles.input, flex: 1, minWidth: 160, marginBottom: 0, padding: "6px 8px", fontSize: 13 }} />
                          <button type="button" style={{ ...styles.btn, padding: "5px 10px", fontSize: 12 }} disabled={!(c.roster?.length) || vaultBusy} onClick={() => runVault(async () => { await secureCourse(c, securePass[c.courseCode] || ""); setSecurePass(m => ({ ...m, [c.courseCode]: "" })); setVaultNote(`${c.courseCode} secured — backup key downloaded, plaintext purged from this device.`); })}>🔒 Secure roster</button>
                        </div>
                        <div style={{ color: "#888", marginTop: 4 }}>No recovery — a lost passphrase with no backup means the mapping is gone. A backup key file downloads automatically.</div>
                      </div>
                    )}
                  </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Three-Zone Upload */}
      <div style={styles.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Upload Files</h3>
        </div>

        {/* Zone 1: Assignment Prompt */}
        <div style={{ marginBottom: 14 }}>
          <label style={styles.label}>① Assignment Prompt (optional)</label>
          <div style={styles.uploadZone(!!assignmentFile)} onClick={() => assignmentRef.current.click()}>
            <input ref={assignmentRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={e => setAssignmentFile(e.target.files[0])} />
            {assignmentFile
              ? <span style={{ color: "#0F6E56", fontWeight: 600 }}>📄 {assignmentFile.name}</span>
              : <span style={{ color: "#888", fontSize: 13 }}>Upload the assignment questions / problem set</span>
            }
          </div>
        </div>

        {/* Zone 2: Answer Key */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <label style={{ ...styles.label, margin: 0 }}>② Answer Key / Model Solution</label>
            <span style={{ background: "#FFF3CD", border: "1px solid #FFCA2C", borderRadius: 4, fontSize: 10, fontWeight: 700, padding: "1px 6px", color: "#856404" }}>STRONGLY RECOMMENDED</span>
          </div>
          <div style={styles.uploadZone(!!answerKeyFile)} onClick={() => answerKeyRef.current.click()}>
            <input ref={answerKeyRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={e => setAnswerKeyFile(e.target.files[0])} />
            {answerKeyFile
              ? <span style={{ color: "#0F6E56", fontWeight: 600 }}>🔑 {answerKeyFile.name}</span>
              : <div>
                  <div style={{ color: "#854F0B", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>⚠ Upload your answer key for highest accuracy</div>
                  <div style={{ color: "#888", fontSize: 12 }}>Without an answer key, grading relies on AI subject knowledge alone</div>
                </div>
            }
          </div>
        </div>

        {/* Zone 3: Student Work */}
        <div>
          <label style={styles.label}>③ Student Work * (PDF or images — one file per student, or one batch PDF)</label>
          <div style={styles.uploadZone(studentFiles.length > 0)} onClick={() => studentRef.current.click()}>
            <input ref={studentRef} type="file" accept="application/pdf,image/jpeg,image/jpg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple style={{ display: "none" }}
              onChange={e => {
                const files = Array.from(e.target.files);
                setStudentFiles(files);
                // ── BB Batch Mode detection ──────────────────────────────
                // Detect by presence of "_attempt_" — works for both numeric and username-based BB filenames
                const hasBBFiles = files.length > 1 && files.some(f => f.name.includes("_attempt_"));
                console.log('[BB DETECT] first filename:', '[submission]');
                console.log('[BB DETECT] hasBBFiles:', hasBBFiles, '(any file contains "_attempt_":', files.some(f => f.name.includes("_attempt_")), ')');
                setIsBBBatch(hasBBFiles);
                if (hasBBFiles) {
                  setBbGroups(groupBBFiles(files));
                  setIsBatchPDF(false);
                  setCombineImages(false);
                  setCombinedStudentName("");
                  setFileSizeWarnings([]);
                  return;
                }
                setIsBBBatch(false);
                setBbGroups([]);
                // ── Existing logic (unchanged) ───────────────────────────
                const singlePDF = files.length === 1 && files[0].type === "application/pdf";
                setIsBatchPDF(singlePDF);
                if (singlePDF) setBatchMode("single");
                const multipleImages = files.length > 1 && files.every(f => f.type.startsWith("image/"));
                setCombineImages(multipleImages);
                if (!multipleImages) setCombinedStudentName("");
                const LARGE_MB = 4;
                const OVERSIZED_MB = 100;
                const warnings = [];
                files.forEach(f => {
                  const sizeMB = (f.size / 1024 / 1024).toFixed(1);
                  if (f.type === "application/pdf" && f.size > LARGE_MB * 1024 * 1024) {
                    warnings.push({
                      type: f.size > OVERSIZED_MB * 1024 * 1024 ? "oversized" : "large",
                      name: f.name,
                      sizeMB,
                      isBatch: singlePDF && files.length === 1
                    });
                  }
                });
                setFileSizeWarnings(warnings);
              }} />
            {studentFiles.length > 0
              ? <div>
                  {isBBBatch
                    ? <div>
                        <div style={{ color: "#0F6E56", fontWeight: 700, marginBottom: 6 }}>✓ BB Batch Mode — {bbGroups.length} student(s) detected from {studentFiles.length} files</div>
                        {bbGroups.map(g => (
                          <div key={g.studentId} style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>
                            📁 Student {g.studentId} — {g.files.length} file(s)
                          </div>
                        ))}
                        <div style={{ fontSize: 11, color: "#185FA5", marginTop: 6 }}>You will review groupings before grading starts.</div>
                      </div>
                    : <div>
                        <div style={{ color: "#0F6E56", fontWeight: 600, marginBottom: 4 }}>✓ {studentFiles.length} file(s) selected</div>
                        {studentFiles.map(f => <div key={f.name} style={{ fontSize: 12, color: "#555" }}>{f.name}</div>)}
                      </div>
                  }
                </div>
              : <div>
                  <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>Upload student submissions (PDF or images)</div>
                  <div style={{ fontSize: 11, color: "#AAA" }}>Multiple individual files, or one combined batch PDF</div>
                </div>
            }
          </div>

          {/* File Size Warnings */}
          {fileSizeWarnings.map((w, i) => w.type === "large" ? (
            // 4–25 MB: info banner, grading proceeds with auto-compression
            <div key={i} style={{ marginTop: 10, background: "#E6F1FB", border: "1px solid #A3C4E8", borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>⚙</span>
              <div style={{ fontSize: 13, color: "#185FA5", flex: 1 }}>
                <strong>Large file detected ({w.sizeMB} MB)</strong> — pages will be compressed automatically before grading. This may take a moment.
              </div>
            </div>
          ) : (
            // >25 MB: warning banner with "Grade anyway" option
            <div key={i} style={{ marginTop: 10, background: "#FFF3CD", border: "2px solid #FFCA2C", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ fontSize: 20 }}>⚠</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#856404", marginBottom: 4 }}>
                    Very large file — {w.sizeMB} MB
                  </div>
                  <div style={{ fontSize: 13, color: "#5A5A55", marginBottom: 10, lineHeight: 1.5 }}>
                    <strong>{w.name}</strong> is {w.sizeMB} MB. Grading will use aggressive compression and may take several minutes. Files over 50 MB may time out.
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => setFileSizeWarnings(prev => prev.filter((_, j) => j !== i))}
                      style={{ ...styles.btn, padding: "8px 18px", fontSize: 13, background: "#856404" }}>
                      Grade anyway (may be slow)
                    </button>
                    <button
                      onClick={() => { setStudentFiles([]); setFileSizeWarnings([]); setIsBatchPDF(false); setBatchMode("auto"); }}
                      style={{ ...styles.btnOutline, padding: "8px 18px", fontSize: 13 }}>
                      ← Choose a different file
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Batch Mode Toggle — only shows when a single PDF is uploaded and NOT in BB batch mode */}
          {!isBBBatch && isBatchPDF && studentFiles.length === 1 && (
            <div style={{ marginTop: 12, background: "#F0EEE8", border: "1px solid #D8D6CE", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#5A5A55", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                📄 PDF Detected — What does this file contain?
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

                {/* Single student option */}
                <div
                  onClick={() => setBatchMode("single")}
                  style={{ flex: 1, minWidth: 160, border: `2px solid ${batchMode === "single" ? "#0F6E56" : "#C8C6BE"}`, borderRadius: 8, padding: "12px 14px", cursor: "pointer", background: batchMode === "single" ? "#E1F5EE" : "#fff", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${batchMode === "single" ? "#0F6E56" : "#C8C6BE"}`, background: batchMode === "single" ? "#0F6E56" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {batchMode === "single" && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: batchMode === "single" ? "#0F6E56" : "#1A1A18" }}>One student's exam</span>
                    <span style={{ background: "#0F6E56", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em" }}>RECOMMENDED</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#5A5A55", lineHeight: 1.5 }}>This PDF is a single student's multi-page exam or assignment — grade it all as one submission</div>
                </div>

                {/* Auto-detect option */}
                <div
                  onClick={() => setBatchMode("auto")}
                  style={{ flex: 1, minWidth: 160, border: `2px solid ${batchMode === "auto" ? "#185FA5" : "#C8C6BE"}`, borderRadius: 8, padding: "12px 14px", cursor: "pointer", background: batchMode === "auto" ? "#E6F1FB" : "#fff", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${batchMode === "auto" ? "#185FA5" : "#C8C6BE"}`, background: batchMode === "auto" ? "#185FA5" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {batchMode === "auto" && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: batchMode === "auto" ? "#185FA5" : "#1A1A18" }}>Multiple students (auto-detect)</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#5A5A55", lineHeight: 1.5 }}>PDF contains several students' work — Claude finds each name and grades separately</div>
                </div>

                {/* Fixed pages option */}
                <div
                  onClick={() => setBatchMode("fixed")}
                  style={{ flex: 1, minWidth: 160, border: `2px solid ${batchMode === "fixed" ? "#854F0B" : "#C8C6BE"}`, borderRadius: 8, padding: "12px 14px", cursor: "pointer", background: batchMode === "fixed" ? "#FAEEDA" : "#fff", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${batchMode === "fixed" ? "#854F0B" : "#C8C6BE"}`, background: batchMode === "fixed" ? "#854F0B" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {batchMode === "fixed" && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: batchMode === "fixed" ? "#854F0B" : "#1A1A18" }}>Multiple students (fixed pages)</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#5A5A55", lineHeight: 1.5, marginBottom: 8 }}>Each student's work is exactly the same number of pages</div>
                  {batchMode === "fixed" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "#854F0B", fontWeight: 600 }}>Pages per student:</span>
                      <input type="number" min="1" max="20" value={pagesPerStudent}
                        onChange={e => setPagesPerStudent(parseInt(e.target.value) || 1)}
                        onClick={e => e.stopPropagation()}
                        style={{ width: 60, padding: "4px 8px", border: "1px solid #854F0B", borderRadius: 4, fontSize: 13, fontWeight: 600, color: "#854F0B", background: "#fff" }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Combine Images Toggle — shows when multiple images uploaded */}
          {combineImages && studentFiles.length > 1 && studentFiles.every(f => f.type.startsWith("image/")) && (
            <div style={{ marginTop: 12, background: "#E6F1FB", border: "2px solid #185FA5", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  id="combineToggle"
                  checked={combineImages}
                  onChange={e => setCombineImages(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#185FA5" }}
                />
                <label htmlFor="combineToggle" style={{ fontWeight: 700, fontSize: 13, color: "#185FA5", cursor: "pointer" }}>
                  📎 These {studentFiles.length} images are all one student's work (multi-page submission)
                </label>
              </div>
              <div style={{ fontSize: 11, color: "#5A5A55", marginBottom: 12, paddingLeft: 28 }}>
                All images will be sent together and graded as a single student. Uncheck if each image is a different student.
              </div>
              {/* Prominent name field */}
              <div style={{ paddingLeft: 28 }}>
                <div style={{ background: combinedStudentName.trim() ? "#E1F5EE" : "#FFF3CD", border: `2px solid ${combinedStudentName.trim() ? "#0F6E56" : "#FFCA2C"}`, borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>{combinedStudentName.trim() ? "✓" : "⚠"}</span>
                    <label style={{ fontWeight: 700, fontSize: 13, color: combinedStudentName.trim() ? "#0F6E56" : "#856404" }}>
                      Student Name {combinedStudentName.trim() ? "— Set" : "— Required for Report"}
                    </label>
                  </div>
                  <input
                    style={{ ...styles.input, fontSize: 14, fontWeight: combinedStudentName.trim() ? 600 : 400, border: `1px solid ${combinedStudentName.trim() ? "#A3D9C8" : "#FFCA2C"}`, background: "#fff" }}
                    placeholder="⚠ Type student name here before grading"
                    value={combinedStudentName}
                    onChange={e => setCombinedStudentName(e.target.value)}
                    autoFocus
                  />
                  {!combinedStudentName.trim() && (
                    <div style={{ fontSize: 11, color: "#856404", marginTop: 6 }}>
                      Without a name, the report will show "Unknown Student" — you cannot change it after grading
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <div style={{ background: "#FCEBEB", border: "1px solid #F5BEBE", borderRadius: 6, padding: "10px 14px", marginBottom: 16, color: "#A32D2D", fontSize: 13 }}>{error}</div>}

      {(() => {
        const blocked = fileSizeWarnings.some(w => w.type === "oversized");
        return (
          <button
            style={{ ...styles.btn, width: "100%", padding: 16, fontSize: 15, opacity: blocked ? 0.4 : 1, cursor: blocked ? "not-allowed" : "pointer" }}
            onClick={blocked ? undefined : isBBBatch ? () => { console.log('[BB GROUPS START] setup button → preview (isBBBatch=true)'); setStep('preview'); } : (...args) => { console.log('[BB GROUPS START] setup button → handleGrade (isBBBatch=false)'); return handleGrade(...args); }}
            disabled={blocked}>
            {blocked ? "⚠ Acknowledge the large file warning above to continue" : isBBBatch ? "Review Student Groups →" : "Grade with DM3A →"}
          </button>
        );
      })()}

    </div>
  );

  // ── BB PREVIEW SCREEN ────────────────────────────────────────────────────
  if (step === "preview") {
    return (
      <div style={styles.root}>
        <div style={styles.header}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={styles.badge}>DM3A Grader v5</span>
              <h1 style={styles.h1}>Review Student Groups</h1>
              <p style={styles.sub}>{bbGroups.length} student(s) detected — confirm before grading</p>
            </div>
            <button style={styles.btnOutline} onClick={() => setStep("setup")}>← Back</button>
          </div>
        </div>

        <div style={{ ...styles.card, marginBottom: 16 }}>
          <label style={styles.label}>Problems to grade (e.g. even 2–84, all, 1–20)</label>
          <input
            style={styles.input}
            placeholder="e.g. even problems 2–84, problems 1–20, all problems"
            value={problemScope}
            onChange={e => setProblemScope(e.target.value)}
          />
          <label style={{ ...styles.label, marginTop: 12 }}>Course Context (optional)</label>
          <textarea
            style={{ ...styles.input, minHeight: 72, resize: "vertical" }}
            placeholder="e.g. Students have not yet covered eigenvalues or determinants. Unit covers matrix operations and row reduction only."
            value={courseContext}
            onChange={e => setCourseContext(e.target.value)}
            rows={3}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          {bbGroups.map((group, gi) => (
            <div key={group.studentId} style={{ ...styles.card, borderLeft: "4px solid #185FA5" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>
                    {group.studentId === "UNRECOGNIZED" ? "⚠ Unrecognized Files" : `Student ID: ${group.studentId}`}
                  </span>
                  <span style={{ fontSize: 12, color: "#5A5A55" }}>{group.files.length} file(s)</span>
                  {group.files.some(item => isDocx(item.file)) && (
                    <span style={{ background: "#FFF3CD", border: "1px solid #FFCA2C", borderRadius: 4, fontSize: 11, fontWeight: 700, padding: "2px 8px", color: "#856404" }}>⚠ Word doc</span>
                  )}
                </div>
                {group.files.some(item => isDocx(item.file)) && (
                  <button
                    onClick={async () => {
                      try {
                        const updated = await Promise.all(group.files.map(async item => {
                          if (!isDocx(item.file)) return item;
                          const pdf = await convertDocxToPdf(item.file);
                          return { ...item, file: pdf };
                        }));
                        setBbGroups(prev => prev.map((g, idx) => idx !== gi ? g : { ...g, files: updated }));
                      } catch(err) {
                        alert('Conversion failed: ' + err.message + '\n\nMake sure the local converter is running:\ncd ~/dm3a-grader/local-converter && node server.js');
                      }
                    }}
                    style={{ background: "#856404", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    Convert .docx → PDF
                  </button>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {group.files.map((item, fi) => (
                  <div key={fi} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#3A3A35", background: "#F5F4EF", borderRadius: 4, padding: "6px 10px" }}>
                    <span>📄 {item.file.name}</span>
                    <button
                      onClick={() => {
                        const updated = bbGroups.map((g, idx) => idx !== gi ? g : {
                          ...g,
                          files: g.files.filter((_, fIdx) => fIdx !== fi)
                        }).filter(g => g.files.length > 0);
                        setBbGroups(updated);
                      }}
                      style={{ background: "none", border: "none", color: "#A32D2D", cursor: "pointer", fontSize: 11, padding: "2px 6px" }}>
                      ✕ Remove
                    </button>
                  </div>
                ))}
              </div>
              {group.files.length > 1 && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#5A5A55", cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={skipCoverSheet.has(group.studentId)}
                    onChange={e => setSkipCoverSheet(prev => {
                      const next = new Set(prev);
                      e.target.checked ? next.add(group.studentId) : next.delete(group.studentId);
                      return next;
                    })}
                    style={{ accentColor: "#185FA5", width: 14, height: 14 }}
                  />
                  Skip first uploaded file (cover sheet / printed assignment)
                </label>
              )}
            </div>
          ))}
        </div>

        <button
          style={{ ...styles.btn, width: "100%", padding: 16, fontSize: 15 }}
          onClick={async () => {
            // Grade each BB group sequentially using individual files mode
            console.log('[BB GROUPS START] preview-screen Grade All button clicked');
            console.log('[BB GROUPS]', JSON.stringify(bbGroups.map(g => ({ id: g.studentId, n: g.files.length }))));
            setStep("grading");
            setLoading(true);
            setRedactStats(null); setSubmissionImages([]); setRedactWarning(false); setBbStubNote(0); // #25
            const allResults = [];
            const heicFailed = [];
            // #25/§3.3/#23: this BB-batch path was previously uninstrumented — wire in
            // the same name-zone redaction + thumbnail capture + counts as handleGrade.
            const doRedact = redactionOn(courseByCode(activeCourseCode));
            const bbStubFiles = []; // Blackboard .txt submission stubs excluded from grading
            const courseConf = COURSE_CONFIGS[subject] || {};
            const systemPrompt = buildSystemPrompt(COURSE_CONFIGS[subject] || COURSE_CONFIGS["Intermediate Algebra"], activeDims);
            function chunkArray(arr, size) {
              const chunks = [];
              for (let i = 0; i < arr.length; i += size) {
                chunks.push(arr.slice(i, i + size));
              }
              return chunks;
            }

            setLoadingMsg(`Preparing all ${bbGroups.length} students for parallel grading...`);

            // Build all grading promises simultaneously
            const gradingPromises = bbGroups.map(async (group, gi) => {
              // Reverse so later-uploaded files (notebook pages) come before cover sheet.
              // If instructor checked "skip cover sheet", drop the last file (earliest upload).
              let groupFiles = group.files.map(item => item.file).reverse();
              // #25: Blackboard exports a per-submission .txt metadata stub alongside the
              // real attachments — never gradable. Exclude and count for an honest note.
              groupFiles = groupFiles.filter(f => {
                if (/\.txt$/i.test(f.name)) { bbStubFiles.push(f.name); return false; }
                return true;
              });
              if (skipCoverSheet.has(group.studentId) && groupFiles.length > 1) {
                console.log(`[${group.studentId}] Skipping cover sheet: [submission]`);
                groupFiles = groupFiles.slice(0, -1);
              }
              const studentLabel = `Student_${group.studentId}`;
              // #25: a group with only a stub (no gradable attachment) — skip, don't grade blank.
              if (groupFiles.length === 0) return [];
              try {
                const sharedBlocks = [];
                if (assignmentFile) {
                  const blocks = await fileToImageBlocks(assignmentFile, 15, notePages);
                  sharedBlocks.push(...blocks);
                  sharedBlocks.push({ type: "text", text: "The above is the ASSIGNMENT PROMPT." });
                }
                if (answerKeyFile) {
                  const akBlock = await answerKeyToDocumentBlock(answerKeyFile);
                  sharedBlocks.push(akBlock);
                  sharedBlocks.push({ type: "text", text: "The above is the MODEL SOLUTION / ANSWER KEY." });
                }
                // Fingerprint Zone 1 to skip student files that are the same document
                const assignFingerprint = assignmentFile
                  ? (await fileToBase64(assignmentFile)).slice(0, 200)
                  : null;
                const pageBlocks = [];
                const seenOriginalNames = new Set();
                const heicFailedForStudent = [];
                const docxFailedForStudent = [];
                for (let fi = 0; fi < groupFiles.length; fi++) {
                  const f = groupFiles[fi];
                  try {
                    // Deduplicate by original filename from BB pattern to skip double-exports
                    const parsed = parseBBFilename(f.name);
                    const origName = parsed ? parsed.originalName : f.name;
                    if (seenOriginalNames.has(origName)) {
                      console.log(`Skipping duplicate file: [submission] (original: [submission])`);
                      continue;
                    }
                    seenOriginalNames.add(origName);
                    if (assignFingerprint) {
                      const fp = (await fileToBase64(f)).slice(0, 200);
                      if (fp === assignFingerprint) {
                        console.log(`Skipping [submission] — matches Zone 1 assignment prompt`);
                        continue;
                      }
                    }
                    const isPDFFile = f.type === "application/pdf";
                    const isImgFile = f.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(f.name);
                    const isHEICFile = /\.(heic|heif)$/i.test(f.name) || f.type === "image/heic" || f.type === "image/heif";
                    const isDocxFile = /\.docx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                    if (isPDFFile) {
                      console.log(`[pdfToImages call] BB batch student: "[submission]" type="${f?.type}"`);
                    const imgs = await pdfToImages(f, 8, 2400, 0.92);
                      imgs.forEach(b64 => pageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
                    } else if (isDocxFile) {
                      setLoadingMsg(`Converting ${f.name} (Word doc) via server...`);
                      const converted = await convertOnServer(f, 'convert-docx');
                      if (converted) {
                        const imgs = await pdfToImages(converted, 8, 2400, 0.92);
                        imgs.forEach(b64 => pageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }));
                      } else {
                        console.warn(`[BB batch] DOCX conversion failed, marking as badge: [submission]`);
                        docxFailedForStudent.push(f.name);
                      }
                    } else if (isHEICFile) {
                      setLoadingMsg(`Converting ${f.name} (HEIC) via server...`);
                      const converted = await convertOnServer(f, 'convert-heic');
                      if (converted) {
                        const b64 = await fileToBase64(converted);
                        pageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
                      } else {
                        console.warn(`[BB batch] HEIC conversion failed, marking as badge: [submission]`);
                        heicFailed.push(f.name);
                        heicFailedForStudent.push(f.name);
                      }
                    } else if (isImgFile) {
                      const b64 = await convertToJpegViaCanvas(f, 0.92, 2400);
                      if (b64 === null) {
                        heicFailed.push(f.name);
                      } else {
                        pageBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
                      }
                    } else {
                      console.warn(`Skipping unrecognised file type: [submission] (${f.type})`);
                    }
                  } catch (err) { console.error("Error processing file", "[submission]", err); }
                }
                // §3.3/#25: redact name zones across ALL of this student's pages — BB
                // reverses files so the name-bearing cover sheet can land anywhere, so
                // page-1-only isn't safe here. Then capture page 1 as graded (#23).
                let groupRedacted = false, groupScanned = false;
                if (doRedact && pageBlocks.length) {
                  const b64s = pageBlocks.map(b => b.source.data);
                  const rr = await redactPageImages(b64s, { all: true });
                  rr.pages.forEach((p, i) => { pageBlocks[i].source.data = p; });
                  groupRedacted = rr.redacted > 0;
                  groupScanned = rr.maxWords >= MIN_SCAN_WORDS;
                }
                const groupImg = pageBlocks.length ? pageBlocks[0].source.data : null;
                // #26: tag every result for this submission with the SAME redaction fields
                // that drive the banner — one truth. _subId dedupes multi-result groups.
                const tagImg = (arr) => arr.map(s => ({ ...s, _pageImage: groupImg, _pageRedacted: groupRedacted, _pageScanned: groupScanned, _subId: `bb${gi}` }));
                // If all files failed as HEIC, return a special unprocessable result instead of grading
                if (pageBlocks.length === 0 && docxFailedForStudent.length > 0) {
                  console.warn(`[BB batch] ${studentLabel}: all files are DOCX — returning DOCX badge`);
                  return tagImg([{ studentName: studentLabel, overallTier: "DOCX", dimensions: { conceptualUnderstanding: "DOCX", problemSolving: "DOCX", workShown: "DOCX", accuracy: "DOCX" }, problems: [], feedback: "Submission could not be processed — Word documents are not supported. Ask the student to resubmit as JPG or PDF.", strengths: [], growthAreas: [], instructorNote: `DOCX files: ${docxFailedForStudent.join(", ")}` }]);
                }
                if (pageBlocks.length === 0 && heicFailedForStudent.length > 0) {
                  console.warn(`[BB batch] ${studentLabel}: all files are unprocessable HEIC — returning HEIC badge`);
                  return tagImg([{ studentName: studentLabel, overallTier: "HEIC", dimensions: { conceptualUnderstanding: "HEIC", problemSolving: "HEIC", workShown: "HEIC", accuracy: "HEIC" }, problems: [], feedback: "Submission could not be processed — HEIC format is not supported in this browser. Ask the student to resubmit as JPG or PDF.", strengths: [], growthAreas: [], instructorNote: `HEIC files: ${heicFailedForStudent.join(", ")}` }]);
                }
                const userPrompt = `Subject: ${subject}
Assignment: ${assignment || "Student Submission"}
${rubric ? "Instructor Rubric Notes: " + rubric : ""}
${courseContext.trim() ? `\nCOURSE CONTEXT: The instructor has provided the following information about what has been covered in this course so far: ${courseContext.trim()}.\n\nImportant: Do NOT penalize students for using terminology or methods that go beyond what has been covered — flag these cases instead with: 'Note: Student used concept not yet covered in course — instructor review recommended.' Do NOT reward students for using advanced terminology if their underlying reasoning is incomplete. Grade only based on what has been explicitly taught.\n` : ""}Student ID: ${group.studentId}
${problemScope.trim() ? `The student was assigned the following problems: ${problemScope.trim()}. Grade ALL of these problems across ALL submitted images. Do not stop until every assigned problem has been graded or confirmed missing.\n` : ""}INSTRUCTIONS:
1. Identify ALL problems and sub-parts visible. List them ALL before grading.
2. Grade EVERY identified problem/sub-part. Do not skip any.
3. Use the answer key if provided. If not, use your subject expertise.
4. Apply DM3A P1-P4 mastery scoring — never binary correct/wrong.
5. Weight process and reasoning heavily.
6. Use "${studentLabel}" as the studentName in your response.
Return a JSON array with exactly ONE student object.`;
                const contentBlocks = [
                  { type: "text", text: "=== STUDENT WORK (grade everything below this line) ===" },
                  ...pageBlocks,
                  { type: "text", text: "=== END OF STUDENT WORK ===" },
                  ...(sharedBlocks.length ? [{ type: "text", text: "=== ANSWER KEY (for reference — do not grade this, use it to evaluate the student work above) ===" }, ...sharedBlocks] : [])
                ];
                const imageBlocks = contentBlocks.filter(b => b.type === "image");
                console.log(`[BB SEND] Student ${group.studentId}: ${contentBlocks.length} total blocks, ${imageBlocks.length} image blocks`);
                // Use scope directly if provided, else scan for problem inventory
                let bbInventory = null;
                let bbUserPrompt = userPrompt;
                if (problemScope.trim()) {
                  bbUserPrompt = buildScopeDirectPrefix(problemScope.trim()) + userPrompt;
                } else {
                  bbInventory = await scanProblems(pageBlocks, systemPrompt);
                  if (bbInventory && bbInventory.length > 0) {
                    bbUserPrompt = buildInventoryPrefix(bbInventory) + userPrompt;
                  }
                }
                const raw = await fetchGradeResult({ contentBlocks, systemPrompt, userPrompt: bbUserPrompt });
                const cleaned = raw.replace(/\`\`\`json|\`\`\`/g, "").trim();
                const jsonMatch = cleaned.match(/(\[\s*\{[\s\S]*\}\s*\])/);
                const jsonStr = jsonMatch ? jsonMatch[1] : cleaned;
                const parsed = JSON.parse(jsonStr);
                const students = Array.isArray(parsed) ? parsed : [parsed];
                // Ensure studentName is always the BB label — never "Unknown" or empty
                const UNKNOWN_NAMES = new Set(["unknown", "unknown student", "", "n/a"]);
                const normalized = students.map(s => ({
                  ...s,
                  studentName: (!s.studentName || UNKNOWN_NAMES.has(s.studentName.toLowerCase())) ? studentLabel : s.studentName,
                  _inventory: bbInventory || null
                }));
                if (bbInventory) setProblemInventory(prev => ({ ...prev, [studentLabel]: bbInventory }));
                return tagImg(normalized);
              } catch (err) {
                if (err && err.isRedaction) throw err; // fail-closed: abort the whole run, don't fake a row
                return tagImg([{ studentName: studentLabel, overallTier: "P1", error: err.message, dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" }, problems: [], feedback: err.message || "Error processing this student.", strengths: [], growthAreas: [] }]);
              }
            });

            try {
            const CHUNK_SIZE = 5;
            const chunks = chunkArray(gradingPromises, CHUNK_SIZE);
            for (let ci = 0; ci < chunks.length; ci++) {
              setLoadingMsg(`Grading students ${ci * CHUNK_SIZE + 1}–${Math.min((ci + 1) * CHUNK_SIZE, bbGroups.length)} of ${bbGroups.length}...`);
              const chunkResults = await Promise.all(chunks[ci]);
              chunkResults.forEach(arr => allResults.push(...arr));
            }
            // #23/#26: derive the banner from the SAME per-submission fields as the
            // badges (one truth), THEN lift thumbnails and strip transient fields so
            // they never reach persisted results / the server.
            if (doRedact) {
              const stats = deriveRedactStats(allResults.map(r => ({ subId: r._subId, redacted: r._pageRedacted, scanned: r._pageScanned, present: r._pageImage != null })));
              if (stats.checked > 0) setRedactStats(stats);
              // #25/#26 invariant: the banner's redacted count MUST equal the number of
              // distinct submissions showing a redacted badge — same source, so equal by
              // construction; a mismatch (or gradable work with nothing checked) is a bug.
              const badgeSubs = new Set(allResults.filter(r => r._pageRedacted && r._pageImage).map(r => r._subId)).size;
              const anyGradable = allResults.some(r => !["HEIC", "DOCX"].includes(r.overallTier));
              if (stats.redacted !== badgeSubs || (anyGradable && stats.checked === 0)) {
                console.error(`[REDACT INVARIANT] BB batch: banner redacted=${stats.redacted} vs badge submissions=${badgeSubs}, checked=${stats.checked}`);
                setRedactWarning(true);
              }
              try { terminateRedactor(); } catch { /* ignore */ }
            }
            const imgs = allResults.map(r => (r._pageImage ? { image: r._pageImage, redacted: !!r._pageRedacted, scanned: !!r._pageScanned } : null));
            const cleanResults = allResults.map(({ _pageImage, _pageRedacted, _pageScanned, _subId, ...rest }) => rest);
            setSubmissionImages(imgs);
            setBbStubNote(bbStubFiles.length); // #25
            setResults(applyDimScope(cleanResults, activeDims));
            setOverrides({});
            setActiveStudent(0);
            setLoading(false);
            setStep("results");
            } catch (err) {
              // Fail-closed abort (Change 3d): a redaction failure in ANY BB group stops
              // the whole batch with a retry message — no unredacted image is graded.
              if (err && err.isRedaction) {
                console.warn("[REDACT] BB batch grading aborted — " + err.message);
                setError("Couldn't verify the name-zone redaction on page 1 — grading was stopped to protect privacy. Please retry.");
                try { terminateRedactor(); } catch { /* ignore */ }
                setLoading(false);
                setStep("setup");
                return;
              }
              throw err; // unexpected error — let it surface
            }
          }}>
          Grade All {bbGroups.length} Student(s) →
        </button>
      </div>
    );
  }

  // ── GRADING SCREEN ────────────────────────────────────────────────────────
  if (step === "grading") return (
    <div style={{ ...styles.root, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "80vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16, animation: "spin 2s linear infinite" }}>⟳</div>
        <h2 style={{ fontSize: 20, fontWeight: 400, marginBottom: 8 }}>Grading in Progress</h2>
        <p style={{ color: "#5A5A55", fontSize: 14 }}>{loadingMsg}</p>
        <p style={{ color: "#888", fontSize: 12, marginTop: 8 }}>Analyzing handwriting, identifying all problems, applying DM3A rubric...</p>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  // ── RESULTS SCREEN ────────────────────────────────────────────────────────
  if (step === "results") {
    const student = results[activeStudent];
    if (!student) return null;
    const ov = overrides[student.studentName] || {};
    const courseConfig = COURSE_CONFIGS[subject];
    const isBeta = courseConfig?.tier !== "optimized";

    return (
      <div style={styles.root}>
        {unlockModal}
        {/* #25 invariant: redaction should have run on this vaulted batch but didn't. */}
        {redactWarning && (
          <div style={{ background: "#FCEBEB", border: "1px solid #E5A3A3", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#9f1239", fontWeight: 600 }}>
            ⚠ Name-zone redaction did NOT run on this batch even though this course is secured and the toggle is on. Do not rely on redaction for this session — verify the sheets manually before sharing.
          </div>
        )}
        {/* #25: Blackboard .txt submission stubs were excluded from grading. */}
        {bbStubNote > 0 && (
          <div style={{ background: "#EEF3FA", border: "1px solid #B9CDE8", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#2A4B7C" }}>
            📎 {bbStubNote} file{bbStubNote === 1 ? "" : "s"} look{bbStubNote === 1 ? "s" : ""} like Blackboard submission stubs (.txt metadata) — excluded from grading.
          </div>
        )}
        {/* §3.3/#26: name-zone redaction summary — count only, never a name, derived from
            the SAME per-submission ledger as the per-student badges (one truth). */}
        {redactStats && (() => {
          const clean = Math.max(0, redactStats.checked - redactStats.redacted - redactStats.unscanned);
          return (
            <div style={{ background: "#E7F2EE", border: "1px solid #9FCBBB", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#0F6E56" }}>
              {redactStats.redacted > 0 && <div>🛡 Redacted name zones on <b>{redactStats.redacted} of {redactStats.checked}</b> {redactStats.noun} before grading.</div>}
              {clean > 0 && <div>No printed name field detected on <b>{clean}</b> {clean === 1 ? "submission" : "submissions"}. <span style={{ color: "#5A5A55" }}>(The scanner reads print, not handwriting — a handwritten name with no printed label can still pass through.)</span></div>}
              {redactStats.redacted === 0 && clean === 0 && redactStats.unscanned === 0 && <div>Name-zone redaction ran on {redactStats.checked} {redactStats.noun}.</div>}
            </div>
          );
        })()}
        {/* #26: submissions OCR couldn't read — a real name may remain AND may have
            reached the grader (Claude reads handwriting far better than Tesseract). */}
        {redactStats && redactStats.unscanned > 0 && (
          <div style={{ background: "#FDF2E3", border: "1px solid #E5B769", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#8a4b00", fontWeight: 600 }}>
            ⚠ Could not scan <b>{redactStats.unscanned}</b> {redactStats.unscanned === 1 ? "submission" : "submissions"} — the photo was too blurry / angled / low-contrast for the redaction scanner, so {redactStats.unscanned === 1 ? "it was" : "they were"} NOT redacted. <b>The AI grader may still read what the scanner could not</b>, so a real name may have reached it. Verify by hand before sharing — look for the “⚠ couldn’t scan” tag on the student cards.
          </div>
        )}
        {(pageNotes.length > 0 || answerKeyPages) && (
          <div style={{ background: "#FFF3CD", border: "1px solid #FFCA2C", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#856404" }}>
            {answerKeyPages && <div>📄 Answer key: <b>{answerKeyPages} page{answerKeyPages === 1 ? "" : "s"}</b> — all sent to the grader (document block).</div>}
            {pageNotes.map((n, i) => (
              <div key={i}>⚠ Reference file “{n.name || "file"}”: used <b>{n.used} of {n.numPages}</b> pages. Grading saw a partial file — split it or reduce pages if the rest matters.</div>
            ))}
          </div>
        )}
        <div style={styles.header}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={styles.badge}>DM3A Results</span>
              <h1 style={styles.h1}>{assignment || "Grading Results"}</h1>
              <p style={styles.sub}>{subject} · {results.length} student(s)</p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={styles.btnOutline} onClick={() => setStep("setup")}>← Back to Setup</button>
              <button style={styles.btnOutline} onClick={exportCSV}>Export CSV</button>
              <button style={{ ...styles.btnOutline, opacity: generatingReports ? 0.6 : 1 }} onClick={downloadAllReports} disabled={generatingReports}>
                {generatingReports ? "Generating reports…" : "⬇ Download All Reports"}
              </button>
              {activeVaulted && namesUnlocked && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5A5A55" }}
                  title="Blind reports are alias-only by default. Enable to print the real name for in-person handback. Files are renamed LastName_FirstName_ALIAS_Report.pdf either way.">
                  <input type="checkbox" checked={includeNameOnReport} onChange={e => setIncludeNameOnReport(e.target.checked)} />
                  Include student name on report
                </label>
              )}
              {/* Load Roster renames graded students from an external file. On a
                  blind (vaulted) course the vault IS the roster, so this is hidden
                  to avoid a conflicting second source of names. */}
              {!activeVaulted && (
              <button style={styles.btnOutline} onClick={() => rosterInputRef.current.click()}>
                👥 Load Roster
              </button>
              )}
              <input ref={rosterInputRef} type="file" accept=".xls,.xlsx,.csv,.tsv,.txt" style={{ display: "none" }}
                onChange={e => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => {
                    const text = ev.target.result;
                    const map = parseRoster(text);
                    const count = Object.keys(map).length;
                    if (count === 0) { alert("Could not parse roster. Make sure it has Last Name, First Name, and Student ID columns."); return; }
                    setRosterMap(map);
                    // Auto-rename all students — try numeric ID first, then username
                    const newOverrides = { ...overrides };
                    let matched = 0;
                    results.forEach(s => {
                      let found = null;
                      // Try numeric ID (e.g. Student_01234567)
                      const idMatch = s.studentName.match(/(\d{6,10})/);
                      if (idMatch) found = map[idMatch[1].padStart(8, "0")];
                      // Try username extracted from "Student_mdecker" pattern
                      if (!found) {
                        const uMatch = s.studentName.match(/^Student_(.+)$/i);
                        if (uMatch) found = map[uMatch[1].toLowerCase()];
                      }
                      // Try contains match across all map keys
                      if (!found) {
                        const lower = s.studentName.toLowerCase();
                        const key = Object.keys(map).find(k => lower.includes(k.toLowerCase()));
                        if (key) found = map[key];
                      }
                      if (found) {
                        newOverrides[s.studentName] = { ...(newOverrides[s.studentName] || {}), renamedName: found };
                        matched++;
                      }
                    });
                    setOverrides(newOverrides);
                    alert(`Roster loaded — ${matched} of ${results.length} students matched and renamed.`);
                  };
                  reader.readAsText(file, "utf-16");
                  e.target.value = "";
                }}
              />
              <button style={styles.btnOutline} onClick={() => downloadStudentReport(student, activeStudent)}>⬇ Download Report</button>
              <button style={styles.btn} onClick={() => { try { localStorage.removeItem(DM3A_SESSION_KEY); } catch { /* ignore */ } setPendingResume(null); setStep("setup"); setResults([]); setStudentFiles([]); setAssignmentFile(null); setAnswerKeyFile(null); setProblemOverrides({}); setIsBatchPDF(false); setBatchMode("auto"); setCombineImages(false); setCombinedStudentName(""); setFileSizeWarnings([]); setIsBBBatch(false); setBbGroups([]); }}>New Session</button>
            </div>
          </div>
        </div>

        {/* Blind Grading (Part B): names locked → show aliases + unlock prompt */}
        {!isStudentMode && activeVaultedLocked && results.length >= 1 && (
          <div style={styles.card}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>🔒 Names for {activeCourseCode} are locked</div>
            <p style={{ margin: "6px 0 10px", fontSize: 13, color: "#5A5A55" }}>
              Graded work shows course aliases. Unlock with your course passphrase to see real names and record at-risk tracking.
            </p>
            <button type="button" style={styles.btn} onClick={() => openUnlock(activeCourseCode, "Enter your course passphrase to view names and record tracking.", () => {})}>Unlock names</button>
          </div>
        )}

        {/* Phase 3 Step 2 — Confirm Students (roster mapping for tracking; nothing sent to the server) */}
        {!isStudentMode && activeCourseCode && activeRoster.length >= 1 && results.length >= 1 && (
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Confirm Students <span style={{ fontWeight: 400, color: "#888" }}>· {activeCourseCode}</span></h3>
              {rosterConfirmed && <span style={{ fontSize: 12, fontWeight: 700, color: "#0F6E56" }}>✓ Confirmed</span>}
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "#888" }}>
              Blackboard downloads map themselves — each submission is matched to your roster by its file, in your browser (the username is never shown or sent). Verify the ✓ auto-matches; assign any leftover ones. Nothing is sent to the server in this step.
            </p>

            {(() => {
              const mappedCount = results.reduce((n, _s, i) => n + (studentMapping[i] ? 1 : 0), 0);
              const autoCount = results.reduce((n, _s, i) => n + ((autoMatched[i] && studentMapping[i]) ? 1 : 0), 0);
              const skipCount = results.length - mappedCount;
              const dupCount = Object.values(results.reduce((acc, _s, i) => { const v = studentMapping[i]; if (v) acc[v] = (acc[v] || 0) + 1; return acc; }, {})).filter((c) => c > 1).length;
              return (
                <div style={{ fontSize: 13, fontWeight: 600, color: "#5A5A55", marginBottom: 12 }}>
                  {mappedCount} of {results.length} students mapped · {skipCount} will be skipped (not tracked).
                  {autoCount > 0 && <span style={{ color: "#0F6E56", display: "block", marginTop: 4 }}>✓ {autoCount} auto-matched from the submission files — verify below.</span>}
                  {dupCount > 0 && <span style={{ color: "#9f1239", display: "block", marginTop: 4 }}>⚠ {dupCount} student{dupCount === 1 ? " is" : "s are"} assigned to more than one submission — a grade is lost unless they submitted more than once.</span>}
                </div>
              );
            })()}

            {results.map((s, i) => {
              const dupIdx = duplicateMapIndices(studentMapping[i], i); // #32
              const isBB = !!bbUsernameOf(s.studentName); // #33
              const thumb = submissionImages[i]?.image; // #33: redacted page as graded
              return (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: `${thumb ? "46px " : ""}1fr 1fr`, gap: 10, alignItems: "center" }}>
                  {thumb && (
                    <img src={`data:image/jpeg;base64,${thumb}`} alt={`Submission ${i + 1}`} onClick={() => setExpandedThumb(expandedThumb === i ? null : i)}
                      title="Click to enlarge the submitted page (as graded)"
                      style={{ width: 46, height: 46, objectFit: "cover", objectPosition: "top", borderRadius: 4, border: "1px solid #D8D6CE", cursor: "pointer" }} />
                  )}
                  <div style={{ fontWeight: 600, fontSize: 14, wordBreak: "break-word" }}>
                    {/* #28/#32: safe label on a vaulted course — never the source BB filename. */}
                    {activeVaulted ? reportIdentity(s, i).display : showName(s.studentName)}
                    {/* #33: pre-filled via the BB-username join — asks the instructor to verify. */}
                    {autoMatched[i] && studentMapping[i] && (
                      <span style={{ fontWeight: 700, fontSize: 10, color: "#0F6E56", background: "#E7F2EE", border: "1px solid #9FCBBB", borderRadius: 3, padding: "1px 5px", marginLeft: 6 }}
                        title="Pre-filled by matching this submission's file to your roster (in your browser). Please verify.">✓ auto-matched from file — verify</span>
                    )}
                    {/* #17: flag a detected ALIAS that isn't in the vault (not applicable to BB-file rows). */}
                    {activeVaulted && namesUnlocked && !isBB && !nameIndex.isAlias(s.studentName) && !studentMapping[i] && (
                      <span style={{ fontWeight: 700, fontSize: 10, color: "#A32D2D", background: "#FCEBEB", border: "1px solid #F5BEBE", borderRadius: 3, padding: "1px 5px", marginLeft: 6 }}
                        title="This detected ID was not found in the course vault — check the handwriting/roster.">⚠ not in vault</span>
                    )}
                    {dupIdx.length > 0 && (
                      <span style={{ fontWeight: 700, fontSize: 10, color: "#9f1239", background: "#FCEBEB", border: "1px solid #F5BEBE", borderRadius: 3, padding: "1px 5px", marginLeft: 6 }}
                        title="The same roster student is assigned to another submission.">⚠ also → Submission {dupIdx.map((j) => j + 1).join(", ")}</span>
                    )}
                  </div>
                  <select style={styles.input} value={studentMapping[i] ?? ""} onChange={e => {
                    const val = e.target.value;
                    // #32: warn before creating a duplicate assignment; keep the old value if declined.
                    if (val) {
                      const other = results.map((_s, j) => j).find((j) => j !== i && studentMapping[j] === val);
                      if (other !== undefined && !window.confirm(`${rosterLabelForValue(val)} is already assigned to Submission ${other + 1}. Assign anyway? (Only if this student submitted more than once.)`)) {
                        return;
                      }
                    }
                    setStudentMapping(m => ({ ...m, [i]: val }));
                    setAutoMatched(a => ({ ...a, [i]: false })); // #33: a manual choice is no longer "auto — verify"
                  }}>
                    <option value="">— Skip (don't track) —</option>
                    {activeRoster.map((r, ri) => (
                      <option key={ri} value={activeVaulted ? r.alias : r.studentEmail}>
                        {activeVaulted ? `${r.studentName} (${r.alias})` : `${r.studentName} — ${r.studentEmail}`}
                      </option>
                    ))}
                  </select>
                </div>
                {expandedThumb === i && thumb && (
                  <div style={{ marginTop: 6, border: "1px solid #E6E4DC", borderRadius: 6, overflow: "hidden", maxWidth: 420 }}>
                    <img src={`data:image/jpeg;base64,${thumb}`} alt={`Submission ${i + 1} — page as graded`} style={{ display: "block", width: "100%" }} />
                  </div>
                )}
              </div>
              );
            })}

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" style={styles.btn} onClick={confirmRoster}>
                {rosterConfirmed ? "Re-confirm Students" : "Confirm Students"}
              </button>
              {trackingNote && (
                <span style={{ fontSize: 13, fontWeight: 600, color: trackingNote.toLowerCase().includes("failed") ? "#9f1239" : "#0F6E56" }}>
                  {trackingNote}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Student Mode — practice estimate banner (always shown in student flow) */}
        {isStudentMode && (
          <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#1D4ED8" }}>
            <strong>Practice estimate only.</strong> These Proficiency Levels are for your own review and revision — they are not an official grade and will not appear in your instructor's gradebook.
            {studentSubmissionsLeft !== null && studentSubmissionsLeft > 0 && (
              <span style={{ marginLeft: 10, color: "#1E40AF", fontWeight: 600 }}>
                {studentSubmissionsLeft} free submission{studentSubmissionsLeft !== 1 ? "s" : ""} left.
              </span>
            )}
            {studentSubmissionsLeft !== null && studentSubmissionsLeft <= 0 && (
              <span style={{ marginLeft: 10, color: "#B45309", fontWeight: 600 }}>
                You've used all 5 free submissions.{" "}
                <a href="mailto:support@dm3agrader.com?subject=Student%20Access%20Request" style={{ color: "#B45309" }}>Contact for access →</a>
              </span>
            )}
          </div>
        )}

        {/* Beta Warning */}
        {isBeta && (
          <div style={{ background: "#E6F1FB", border: "1px solid #A3C4E8", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#185FA5" }}>
            <strong>β Beta Subject:</strong> {TIER_META.beta.description} Use the override controls below to adjust any score before finalizing.
          </div>
        )}

        {/* HEIC/DOCX Conversion Warning */}
        {(heicFailedFiles.length > 0 || results.some(s => s.overallTier === "DOCX")) && (
          <div style={{ background: "#FFF3CD", border: "2px solid #FFCA2C", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#856404" }}>
            {(() => {
              const docxStudents = results.map((s, i) => ({ s, i })).filter(({ s }) => s.overallTier === "DOCX");
              const total = heicFailedFiles.length + docxStudents.length;
              // #33: on a vaulted course the raw studentName/filename carries the username
              // (or a real name in "jane_doe.pdf") — show a safe label / count, never the raw string.
              const safeLabel = (s, i) => activeVaulted ? reportIdentity(s, i).display : s.studentName;
              return (<>
                <strong>⚠️ {total} file(s) could not be processed (HEIC/DOCX format not supported).</strong> Ask those students to resubmit as JPG or PDF.
                <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                  {activeVaulted
                    ? (heicFailedFiles.length > 0 && <li key="hc">{heicFailedFiles.length} HEIC file{heicFailedFiles.length === 1 ? "" : "s"} — check the ⚠ tags in the student list</li>)
                    : heicFailedFiles.map((name, i) => <li key={"h" + i}>{name} (HEIC)</li>)}
                  {docxStudents.map(({ s, i }) => <li key={"d" + i}>{safeLabel(s, i)} (DOCX)</li>)}
                </ul>
              </>);
            })()}
          </div>
        )}

        {/* Blackboard export (Blind Grading, Part D) — vaulted + unlocked only */}
        {!isStudentMode && activeVaulted && namesUnlocked && results.length >= 1 && (
          <Suspense fallback={null}>
            <BBExport
              results={results}
              studentMapping={studentMapping}
              overrides={overrides}
              mapping={unlockedRosters[activeCourseCode] || []}
              courseCode={activeCourseCode}
            />
          </Suspense>
        )}

        {/* Student Tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {results.map((s, i) => {
            const t = overrides[s.studentName]?.overall || s.overallTier;
            return (
              <button key={i} onClick={() => setActiveStudent(i)}
                style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${activeStudent === i ? "#1A1A18" : "#D8D6CE"}`, background: activeStudent === i ? "#1A1A18" : "#fff", color: activeStudent === i ? "#fff" : "#1A1A18", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {activeVaulted ? reportIdentity(s, i).display : (overrides[s.studentName]?.renamedName || showName(s.studentName))} <span style={{ marginLeft: 4, ...styles.mastery(t), padding: "1px 6px", fontSize: 11 }}>{t === "HEIC" ? "HEIC ⚠" : t === "DOCX" ? "DOCX ⚠" : t}</span>{(() => { const inv = s._inventory || problemInventory[s.studentName]; return inv && inv.some(p => p.legible === "no") ? <span style={{ marginLeft: 4, background: "#FCEBEB", color: "#A32D2D", border: "1px solid #F5BEBE", borderRadius: 3, fontSize: 9, fontWeight: 700, padding: "1px 4px" }}>⚠ illegible</span> : null; })()}
              </button>
            );
          })}
        </div>

        {/* Student Card */}
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              {/* Inline rename — click pencil to edit. Disabled on blind (vaulted)
                  courses: the name comes from the encrypted vault, not a manual
                  override, so the header shows "Real Name (ALIAS)" read-only. */}
              {(!activeVaulted && ov.renamedName !== undefined)
                ? <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <input
                      autoFocus
                      style={{ ...styles.input, fontSize: 18, fontWeight: 600, maxWidth: 280, padding: "4px 10px" }}
                      value={ov.renamedName}
                      onChange={e => setOverrides(prev => ({ ...prev, [student.studentName]: { ...prev[student.studentName], renamedName: e.target.value } }))}
                      onKeyDown={e => { if (e.key === "Enter") setOverrides(prev => ({ ...prev, [student.studentName]: { ...prev[student.studentName], renamedName: e.target.value } })); }}
                    />
                    <button onClick={() => setOverrides(prev => ({ ...prev, [student.studentName]: { ...prev[student.studentName], renamedName: ov.renamedName } }))}
                      style={{ ...styles.btn, padding: "4px 12px", fontSize: 12 }}>✓ Save</button>
                  </div>
                : <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{activeVaulted ? reportIdentity(student, activeStudent).display : (ov.renamedName || showName(student.studentName))}</h2>
                    {!activeVaulted && (
                    <button
                      onClick={() => setOverrides(prev => ({ ...prev, [student.studentName]: { ...prev[student.studentName], renamedName: ov.renamedName || student.studentName } }))}
                      title="Rename student"
                      style={{ background: "none", border: "1px solid #D8D6CE", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#888", cursor: "pointer" }}>
                      ✏ Rename
                    </button>
                    )}
                  </div>
              }
              <p style={{ margin: 0, fontSize: 13, color: "#5A5A55" }}>{subject} · {assignment}</p>
              {/* #23: the page-1 image exactly as it was graded/stored. For vaulted
                  courses this is the REDACTED artifact — the black box + alias stamp
                  where the handwritten name was — so the instructor (and a demo
                  audience) can visually confirm the name never left the browser. */}
              {submissionImages[activeStudent]?.image && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setSubmissionOpen(o => !o)} style={{ ...styles.btnOutline, padding: "3px 10px", fontSize: 12 }}>
                    {submissionOpen ? "Hide submitted page" : "🖼 View submitted page (as graded)"}
                  </button>
                  {submissionImages[activeStudent].redacted
                    ? <span style={{ marginLeft: 8, background: "#E7F2EE", color: "#0F6E56", border: "1px solid #9FCBBB", borderRadius: 4, fontSize: 11, fontWeight: 700, padding: "2px 7px" }}>🛡 name zone redacted</span>
                    : (submissionImages[activeStudent].scanned === false && activeVaulted && (
                        <span style={{ marginLeft: 8, background: "#FDF2E3", color: "#8a4b00", border: "1px solid #E5B769", borderRadius: 4, fontSize: 11, fontWeight: 700, padding: "2px 7px" }}>⚠ couldn’t scan — verify name by hand</span>
                      ))}
                  {submissionOpen && (
                    <div style={{ marginTop: 8, border: "1px solid #E6E4DC", borderRadius: 8, overflow: "hidden", maxWidth: 520 }}>
                      <img alt="Submitted page 1 as graded" src={`data:image/jpeg;base64,${submissionImages[activeStudent].image}`} style={{ display: "block", width: "100%" }} />
                      <div style={{ padding: "6px 10px", fontSize: 11, color: "#5A5A55", background: "#FAF9F6" }}>
                        Page 1 exactly as sent to the grader{submissionImages[activeStudent].redacted ? " — the handwritten name zone is boxed and stamped with the alias." : "."}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              {(() => {
                const tier = ov.overall || student.overallTier;
                const isUnprocessable = tier === "HEIC" || tier === "DOCX";
                return (<>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{isUnprocessable ? "UNPROCESSABLE" : "OVERALL MASTERY"}</div>
                  <span style={{ ...(isUnprocessable ? { background: "#F5F5F0", color: "#888", border: "1px solid #DDD", borderRadius: 4, fontWeight: 700, display: "inline-block" } : styles.mastery(tier)), fontSize: 20, padding: "4px 16px" }}>{isUnprocessable ? `${tier} ⚠` : tier}</span>
                </>);
              })()}
              {(() => {
                const probs = student.problems || [];
                const graded = probs.filter(p => p.tier && p.tier !== "N/A");
                const mastery = graded.filter(p => p.tier === "P3" || p.tier === "P4").length;
                const total = graded.length;
                const pct = total > 0 ? Math.round(mastery / total * 100) : null;
                return total > 0 ? (
                  <div style={{ fontSize: 12, color: "#5A5A55", marginTop: 6 }}>
                    P3/P4 Rate: <strong>{pct}%</strong> ({mastery} of {total} problems)
                  </div>
                ) : null;
              })()}
              <div style={{ marginTop: 6 }}>
                <select style={{ fontSize: 12, padding: "3px 8px", border: "1px solid #C8C6BE", borderRadius: 4, background: "#FAFAF7" }}
                  value={ov.overall || student.overallTier}
                  onChange={e => setOverrides(prev => ({ ...prev, [student.studentName]: { ...prev[student.studentName], overall: e.target.value } }))}>
                  {["P4", "P3", "P2", "P1"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{ fontSize: 11, color: "#888", marginLeft: 6 }}>Override</span>
              </div>
            </div>
          </div>

          {/* Dimensions */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            {[
              ["Conceptual Understanding", "conceptualUnderstanding", "conceptual"],
              ["Problem Solving", "problemSolving", "problemSolving"],
              ["Work Shown", "workShown", "workShown"],
              ["Accuracy", "accuracy", "accuracy"]
            ].filter(([, key]) => !student.dimensions || student.dimensions[key] != null).map(([label, key, ovKey]) => {
              const val = ov[ovKey] || student.dimensions?.[key] || "P1";
              const feedbackNote = isStudentMode ? student.dimensionFeedback?.[key] : null;
              return (
                <div key={key} style={{ background: tierBg[val], border: `1px solid ${tierBorder[val]}`, borderRadius: 6, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: "#5A5A55", marginBottom: 4, fontWeight: 600 }}>{label.toUpperCase()}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: feedbackNote ? 6 : 0 }}>
                    <span style={{ color: tierColor[val], fontWeight: 700, fontSize: 18 }}>{val}</span>
                    {!isStudentMode && (
                      <select style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${tierBorder[val]}`, borderRadius: 4, background: "transparent" }}
                        value={val}
                        onChange={e => setOverrides(prev => ({ ...prev, [student.studentName]: { ...prev[student.studentName], [ovKey]: e.target.value } }))}>
                        {["P4", "P3", "P2", "P1"].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                  {feedbackNote && (
                    <p style={{ margin: 0, fontSize: 11, color: "#1A1A18", lineHeight: 1.5 }}>{feedbackNote}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* What to work on next (student mode only) */}
          {isStudentMode && student.whatToWorkOnNext && (
            <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
              <strong>What to work on next:</strong> {student.whatToWorkOnNext}
            </div>
          )}

          {/* Problem Inventory (from two-pass scan) */}
          {(student._inventory || problemInventory[student.studentName]) && (() => {
            const inv = student._inventory || problemInventory[student.studentName];
            const hasIllegible = inv.some(p => p.legible === "no");
            const hasPartial = inv.some(p => p.legible === "partially");
            return (
              <details style={{ marginBottom: 12, background: "#F5F4EF", borderRadius: 6, padding: "8px 12px" }} open={false}>
                <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#1A1A18", userSelect: "none", display: "flex", alignItems: "center", gap: 8 }}>
                  Problems detected: {inv.length}
                  {hasIllegible && <span style={{ background: "#FCEBEB", color: "#A32D2D", border: "1px solid #F5BEBE", borderRadius: 4, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>⚠ Illegible work</span>}
                  {!hasIllegible && hasPartial && <span style={{ background: "#FFF3CD", color: "#856404", border: "1px solid #FFCA2C", borderRadius: 4, fontSize: 10, fontWeight: 700, padding: "1px 6px" }}>Partial legibility</span>}
                </summary>
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                  {inv.map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11 }}>
                      <span style={{ fontWeight: 700, minWidth: 60, color: p.legible === "no" ? "#A32D2D" : p.legible === "partially" ? "#856404" : "#0F6E56" }}>{p.problem}</span>
                      <span style={{ color: "#5A5A55", flex: 1 }}>{p.description}</span>
                      {p.legible !== "yes" && <span style={{ color: p.legible === "no" ? "#A32D2D" : "#856404", fontWeight: 600, whiteSpace: "nowrap" }}>{p.legible === "no" ? "not legible" : "partial"}</span>}
                    </div>
                  ))}
                </div>
              </details>
            );
          })()}

          {/* Problems graded count */}
          {student.problems?.length > 0 && (
            <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>
              Problems graded: {student.problems.length}
            </div>
          )}

          {/* Problem Breakdown */}
          {student.problems?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5A5A55" }}>Problem Breakdown</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {student.problems.map((prob, i) => {
                  const pt = getProblemTier(student.studentName, prob.id, prob.tier);
                  return (
                  <div key={i} style={{ border: `1px solid ${tierBorder[pt] || "#E8E6DE"}`, borderLeft: `4px solid ${tierColor[pt] || "#888"}`, borderRadius: 6, padding: "10px 12px", background: "#FAFAF7" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: 14, marginRight: 8 }}>Problem {prob.id}</span>
                        <span style={{ fontSize: 12, color: "#5A5A55" }}>{prob.description}</span>
                        {prob.flagged && <span style={{ marginLeft: 8, background: "#FFF3CD", border: "1px solid #FFCA2C", borderRadius: 4, fontSize: 10, fontWeight: 700, padding: "1px 6px", color: "#856404" }}>⚑ Review</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={styles.mastery(pt)}>{pt}</span>
                        <select
                          style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${tierBorder[pt] || "#C8C6BE"}`, borderRadius: 4, background: "#fff", cursor: "pointer" }}
                          value={pt}
                          onChange={e => setProblemTier(student.studentName, prob.id, e.target.value)}>
                          {["P4", "P3", "P2", "P1"].map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#3A3A35", marginBottom: 4 }}><strong>Process:</strong> {prob.processAssessment}</div>
                    <div style={{ fontSize: 12, color: "#5A5A55" }}>{prob.reasoning}</div>
                    {prob.flagReason && <div style={{ fontSize: 11, color: "#856404", marginTop: 4 }}>⚑ {prob.flagReason}</div>}
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Feedback */}
          <div style={{ background: "#F5F4EF", borderRadius: 6, padding: "14px 16px", marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#5A5A55", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Personalized Feedback</div>
            <p style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.6 }}>{student.feedback}</p>
            {student.strengths?.length > 0 && <div style={{ fontSize: 12, color: "#0F6E56" }}>✓ Strengths: {student.strengths.join(", ")}</div>}
            {student.growthAreas?.length > 0 && <div style={{ fontSize: 12, color: "#185FA5", marginTop: 4 }}>→ Growth areas: {student.growthAreas.join(", ")}</div>}
          </div>

          {/* Instructor Note */}
          {student.instructorNote && (
            <div style={{ background: "#FFF3CD", border: "1px solid #FFCA2C", borderRadius: 6, padding: "10px 14px", fontSize: 13, color: "#856404" }}>
              <strong>Note for instructor:</strong> {student.instructorNote}
            </div>
          )}
        </div>

        {/* Class Summary */}
        <div style={styles.card}>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5A5A55" }}>Class Summary</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {["P4", "P3", "P2", "P1"].map(t => {
              const count = results.filter(s => (overrides[s.studentName]?.overall || s.overallTier) === t).length;
              return (
                <div key={t} style={{ background: tierBg[t], border: `1px solid ${tierBorder[t]}`, borderRadius: 6, padding: "12px", textAlign: "center" }}>
                  <div style={{ color: tierColor[t], fontWeight: 700, fontSize: 22 }}>{count}</div>
                  <div style={{ color: tierColor[t], fontWeight: 700, fontSize: 13 }}>{t}</div>
                  <div style={{ color: "#888", fontSize: 11 }}>{results.length ? Math.round(count / results.length * 100) : 0}%</div>
                </div>
              );
            })}
          </div>
          {(() => {
            const rates = results.map(s => {
              const probs = (s.problems || []).filter(p => p.tier && p.tier !== "N/A");
              const total = probs.length;
              const mastery = probs.filter(p => p.tier === "P3" || p.tier === "P4").length;
              return total > 0 ? mastery / total : null;
            }).filter(r => r !== null);
            if (!rates.length) return null;
            const avg = Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 100);
            return (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #E8E6DE", fontSize: 13, color: "#5A5A55", textAlign: "center" }}>
                Class P3/P4 Rate: <strong style={{ color: "#185FA5" }}>{avg}%</strong>
                <span style={{ color: "#888", fontSize: 12, marginLeft: 6 }}>(average across {rates.length} student{rates.length !== 1 ? "s" : ""} with graded problems)</span>
              </div>
            );
          })()}
        </div>
  
      </div>
    );
  }

  return null;
}

async function answerKeyToDocumentBlock(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 }
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

