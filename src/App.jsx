import { useState, useRef } from "react";

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
    tier: "beta",
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

function buildSystemPrompt(courseConfig) {
  return `You are an expert mathematics grader using the DM3A mastery-based assessment framework developed by Dr. Ralph Minaya, Ed.D.

## CORE DM3A PHILOSOPHY
You NEVER use binary "correct" or "wrong" labels. Every problem is graded on the P1–P4 mastery scale.
PROCESS IS MORE IMPORTANT THAN THE FINAL ANSWER. A student who demonstrates correct mathematical reasoning with a computational error is NOT a failing student.

## P1–P4 MASTERY SCALE
- P4 (Mastery, 90%+): ${courseConfig.p4Descriptor}
- P3 (Approaching Mastery, 80–89%): ${courseConfig.p3Descriptor}
- P2 (Developing, 60–79%): ${courseConfig.p2Descriptor}
- P1 (Beginning, below 60%): ${courseConfig.p1Descriptor}

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

## OUTPUT FORMAT
Return ONLY a valid JSON array. No preamble, no markdown fences, no explanation outside the JSON.

Each student object:
{
  "studentName": "string",
  "overallTier": "P1|P2|P3|P4",
  "dimensions": {
    "conceptualUnderstanding": "P1|P2|P3|P4",
    "problemSolving": "P1|P2|P3|P4",
    "workShown": "P1|P2|P3|P4",
    "accuracy": "P1|P2|P3|P4"
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
}`;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

const SERVER_URL = 'https://dm3a-grader-server.onrender.com';

export default function DM3AGraderV5() {
  const [step, setStep] = useState("login");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showTierGuide, setShowTierGuide] = useState(false);
  const [subject, setSubject] = useState("");
  const [assignment, setAssignment] = useState("");
  const [rubric, setRubric] = useState("");
  const [assignmentFile, setAssignmentFile] = useState(null);
  const [answerKeyFile, setAnswerKeyFile] = useState(null);
  const [studentFiles, setStudentFiles] = useState([]);
  const [isBatchPDF, setIsBatchPDF] = useState(false);
  const [batchMode, setBatchMode] = useState("auto"); // "auto" | "fixed"
  const [pagesPerStudent, setPagesPerStudent] = useState(2);
  const [combineImages, setCombineImages] = useState(false);
  const [combinedStudentName, setCombinedStudentName] = useState("");
  const [fileSizeWarnings, setFileSizeWarnings] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [overrides, setOverrides] = useState({});
  const [problemOverrides, setProblemOverrides] = useState({});
  const [activeStudent, setActiveStudent] = useState(0);

  const assignmentRef = useRef();
  const answerKeyRef = useRef();
  const studentRef = useRef();

  const APP_PASSWORD = "dmgof50c";

  // ─── LOGIN ────────────────────────────────────────────────────────────────

  function handleLogin(e) {
    e.preventDefault();
    if (password === APP_PASSWORD) {
      setStep("setup");
      setShowTierGuide(true);
    } else {
      setLoginError("Incorrect password. Please contact Dr. Minaya for access.");
    }
  }

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
  async function compressImage(file, maxSizeMB = 1.0, maxDimension = 1600) {
    return new Promise((resolve) => {
      // If already small enough, skip compression
      if (file.size <= maxSizeMB * 1024 * 1024) {
        fileToBase64(file).then(resolve);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        // Scale down if too large
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        // Try quality 0.85 first, then lower if still too big
        let quality = 0.85;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length > maxSizeMB * 1024 * 1024 * 1.37 && quality > 0.3) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        resolve(dataUrl.split(",")[1]);
      };
      img.onerror = () => {
        // Fallback to uncompressed if something goes wrong
        fileToBase64(file).then(resolve);
      };
      img.src = url;
    });
  }

  async function pdfToImages(file, maxPages = 16, maxDimension = 400, quality = 0.3) {
    const pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    console.log(`[pdfToImages] pdf.numPages=${pdf.numPages} maxPages=${maxPages}`);
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
      const scale = Math.min(maxDimension / viewport.width, maxDimension / viewport.height, 1);
      const scaledViewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: scaledViewport }).promise;
      images.push(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
    }
    console.log(`[pdfToImages] produced ${images.length} images`);
    return images;
  }

  async function uploadPDF(base64) {
    const resp = await fetch(`${SERVER_URL}/upload-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, mediaType: "application/pdf" })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      throw new Error(err.error || `Upload failed: HTTP ${resp.status}`);
    }
    const { file_id } = await resp.json();
    return file_id;
  }

  async function fetchGradeResult(body) {
    const response = await fetch(`${SERVER_URL}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(err.error || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.result;
  }

  // ─── GRADING ─────────────────────────────────────────────────────────────

  async function handleGrade() {
    if (!subject || !studentFiles.length) {
      setError("Please select a subject and upload at least one student file.");
      return;
    }
    setError("");
    setLoading(true);
    setStep("grading");
    const courseConfig = COURSE_CONFIGS[subject];
    const systemPrompt = buildSystemPrompt(courseConfig);
    const allResults = [];

    // ── BATCH PDF MODE ──────────────────────────────────────────────────────
    const file = studentFiles[0];
    const isSinglePDF = studentFiles.length === 1 && file.type === "application/pdf" && isBatchPDF;
    // PDFs over 5MB always use chunked image path regardless of batchMode
    const isTrueBatch = isSinglePDF && batchMode !== "single" && file.size <= 5 * 1024 * 1024;

    if (isTrueBatch) {
      setLoadingMsg("Reading batch PDF and identifying students...");
      try {
        setLoadingMsg("Converting batch PDF pages to images...");
        const batchPageImages = await pdfToImages(file, 16, 1200, 0.75);
        console.log(`[batch PDF] converted ${batchPageImages.length} pages to images`);
        const contentBlocks = [];

        if (assignmentFile) {
          const assignB64 = await fileToBase64(assignmentFile);
          if (isImage(assignmentFile)) {
            contentBlocks.push({ type: "image", source: { type: "base64", media_type: assignmentFile.type, data: assignB64 } });
          } else {
            contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: assignB64 }, title: "ASSIGNMENT PROMPT" });
          }
          contentBlocks.push({ type: "text", text: "The above is the ASSIGNMENT PROMPT — the questions the student was asked to answer." });
        }

        if (answerKeyFile) {
          const keyB64 = await fileToBase64(answerKeyFile);
          if (isImage(answerKeyFile)) {
            contentBlocks.push({ type: "image", source: { type: "base64", media_type: answerKeyFile.type, data: keyB64 } });
          } else {
            contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: keyB64 }, title: "MODEL SOLUTION / ANSWER KEY" });
          }
          contentBlocks.push({ type: "text", text: "The above is the MODEL SOLUTION / ANSWER KEY." });
        }

        batchPageImages.forEach((b64, i) => {
          contentBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
          contentBlocks.push({ type: "text", text: `Page ${i + 1}` });
        });

        const batchInstruction = batchMode === "auto"
          ? `BATCH MODE — AUTO-DETECT: This PDF contains multiple students' work scanned together.
STEP 1: Scan through the entire PDF and identify each student by their name written at the top of their work. Students may use varying numbers of pages.
STEP 2: Group all pages belonging to each student together.
STEP 3: Grade each student's complete work independently using DM3A P1–P4 mastery scoring.
STEP 4: If you cannot find a name for a student, label them "Unknown Student [number]" and flag with instructorNote.
Return a JSON array with one object per student found.`
          : `BATCH MODE — FIXED PAGES: This PDF contains multiple students' work scanned together.
Each student's work is exactly ${pagesPerStudent} page(s).
Split the PDF into groups of ${pagesPerStudent} page(s) each and grade each group as one student.
Try to find the student's name on the first page of each group.
If no name is found, label them "Unknown Student [number]".
Return a JSON array with one object per student found.`;

        const userPrompt = `Subject: ${subject}
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}

${batchInstruction}

GRADING INSTRUCTIONS:
1. Identify ALL problems and sub-parts for each student. Do not skip any.
2. Apply DM3A P1–P4 mastery scoring — never binary correct/wrong.
3. Weight process and reasoning heavily.
4. Grade each student completely and independently.`;

        setLoadingMsg("Grading all students in batch — this may take a moment...");

        const raw = await fetchGradeResult({ contentBlocks, systemPrompt, userPrompt });
        const cleaned = raw.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const students = Array.isArray(parsed) ? parsed : [parsed];
        allResults.push(...students);

      } catch (err) {
        allResults.push({
          studentName: "Batch Processing Error",
          overallTier: "P1",
          error: err.message,
          dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" },
          problems: [],
          feedback: `Error processing batch PDF: ${err.message}`,
          strengths: [],
          growthAreas: [],
          instructorNote: "Batch processing failed. Try uploading individual files per student."
        });
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
          compressedPages.push(b64);
        }

        // Build shared context blocks (assignment + answer key)
        const sharedBlocks = [];
        if (assignmentFile) {
          const assignB64 = isImage(assignmentFile) ? await compressImage(assignmentFile, 0.5, 1000) : await fileToBase64(assignmentFile);
          if (isImage(assignmentFile)) {
            sharedBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: assignB64 } });
          } else {
            sharedBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: assignB64 }, title: "ASSIGNMENT PROMPT" });
          }
          sharedBlocks.push({ type: "text", text: "The above is the ASSIGNMENT PROMPT." });
        }
        if (answerKeyFile) {
          const keyB64 = isImage(answerKeyFile) ? await compressImage(answerKeyFile, 0.5, 1000) : await fileToBase64(answerKeyFile);
          if (isImage(answerKeyFile)) {
            sharedBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: keyB64 } });
          } else {
            sharedBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: keyB64 }, title: "MODEL SOLUTION / ANSWER KEY" });
          }
          sharedBlocks.push({ type: "text", text: "The above is the MODEL SOLUTION / ANSWER KEY." });
        }

        // Send 2 pages per API call
        const chunkSize = 2;
        const chunkResults = [];
        for (let c = 0; c < compressedPages.length; c += chunkSize) {
          const chunk = compressedPages.slice(c, c + chunkSize);
          const chunkNum = Math.floor(c / chunkSize) + 1;
          const totalChunks = Math.ceil(compressedPages.length / chunkSize);
          setLoadingMsg(`Grading ${studentLabel} — part ${chunkNum} of ${totalChunks}...`);

          const contentBlocks = [...sharedBlocks];
          contentBlocks.push({ type: "text", text: `STUDENT SUBMISSION — pages ${c + 1} to ${c + chunk.length} of ${compressedPages.length} total. This is part ${chunkNum} of ${totalChunks}.` });
          chunk.forEach((b64, idx) => {
            contentBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
            contentBlocks.push({ type: "text", text: `Page ${c + idx + 1}` });
          });

          const userPrompt = `Subject: ${subject}
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}
Student: ${studentLabel}
This is part ${chunkNum} of ${totalChunks} of this student's submission (pages ${c + 1}–${c + chunk.length} of ${compressedPages.length}).

INSTRUCTIONS:
1. Identify and grade ALL problems visible on these pages only.
2. Apply DM3A P1–P4 mastery scoring — never binary correct/wrong.
3. Weight process and reasoning heavily.
4. Use "${studentLabel}" as the studentName.
${totalChunks > 1 ? `5. Note: This is a partial submission. Grade only what you can see on these pages.` : ""}

Return a JSON array with exactly ONE student object covering only the problems on these pages.`;

          const raw = await fetchGradeResult({ contentBlocks, systemPrompt, userPrompt });
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

    } else {
      // ── INDIVIDUAL FILES MODE ─────────────────────────────────────────────
      for (let i = 0; i < studentFiles.length; i++) {
        const f = studentFiles[i];
        setLoadingMsg(`${isImage(f) ? "Compressing and grading" : "Grading"} ${f.name} (${i + 1} of ${studentFiles.length})...`);

        try {
          const isPDF = f.type === "application/pdf";
          const fileSize = f.size;
          // All PDFs: convert pages to JPEG images so Claude can read handwritten/scanned content.
          // Image files: compress directly.
          let studentB64 = null;
          let pdfPageImages = null;
          console.log(`[ROUTING] file: ${f.name}, size: ${fileSize}, isPDF: ${isPDF}`);
          if (isPDF) {
            setLoadingMsg(`Converting ${f.name} to images...`);
            pdfPageImages = await pdfToImages(f, 8, 1200, 0.75);
            console.log(`[PDF→images] ${f.name}: ${pdfPageImages.length} pages`);
          } else {
            studentB64 = await compressImage(f);
          }
          const studentMediaType = isImage(f) ? "image/jpeg" : f.type;

          // Build shared context blocks
          const sharedBlocks = [];
          if (assignmentFile) {
            const assignB64 = isImage(assignmentFile) ? await compressImage(assignmentFile) : await fileToBase64(assignmentFile);
            if (isImage(assignmentFile)) {
              sharedBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: assignB64 } });
            } else {
              sharedBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: assignB64 }, title: "ASSIGNMENT PROMPT" });
            }
            sharedBlocks.push({ type: "text", text: "The above is the ASSIGNMENT PROMPT." });
          }
          if (answerKeyFile) {
            const keyB64 = isImage(answerKeyFile) ? await compressImage(answerKeyFile) : await fileToBase64(answerKeyFile);
            const studentBytes = isPDF
              ? pdfPageImages.reduce((s, b64) => s + b64.length * 0.75, 0)
              : studentB64.length * 0.75;
            const keyBytes = keyB64.length * 0.75;
            console.log('SIZE CHECK — student:', Math.round(studentBytes / 1024), 'KB | answer key:', Math.round(keyBytes / 1024), 'KB | combined:', Math.round((studentBytes + keyBytes) / 1024), 'KB');
            if (studentBytes + keyBytes > 3 * 1024 * 1024) {
              sharedBlocks.push({ type: "text", text: "No answer key provided - use subject expertise." });
            } else {
              if (isImage(answerKeyFile)) {
                sharedBlocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: keyB64 } });
              } else {
                sharedBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: keyB64 }, title: "MODEL SOLUTION / ANSWER KEY" });
              }
              sharedBlocks.push({ type: "text", text: "The above is the MODEL SOLUTION / ANSWER KEY." });
            }
          }

          const userPrompt = `Subject: ${subject}
Assignment: ${assignment || "Student Submission"}
${rubric ? `Instructor Rubric Notes: ${rubric}` : ""}

INSTRUCTIONS:
1. First, identify ALL problems and sub-parts (a, b, c, d, etc.) visible. List them ALL before grading.
2. Grade EVERY identified problem/sub-part. Do not skip any.
3. Use the answer key if provided. If not, use your subject expertise.
4. Apply DM3A P1–P4 mastery scoring — never binary correct/wrong.
5. Weight process and reasoning heavily.

Return a JSON array with one object per student found in the submission.`;

          const pageBlocks = isPDF
            ? pdfPageImages.map(b64 => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }))
            : [{ type: "image", source: { type: "base64", media_type: studentMediaType, data: studentB64 } }];
          const contentBlocks = [...sharedBlocks, ...pageBlocks];
          const raw = await fetchGradeResult({ contentBlocks, systemPrompt, userPrompt });
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          allResults.push(...(Array.isArray(parsed) ? parsed : [parsed]));
        } catch (err) {
          allResults.push({
            studentName: f.name,
            overallTier: "P1",
            error: err.message,
            dimensions: { conceptualUnderstanding: "P1", problemSolving: "P1", workShown: "P1", accuracy: "P1" },
            problems: [],
            feedback: "Error processing this file.",
            strengths: [],
            growthAreas: []
          });
        }
      }
    }

    setResults(allResults);
    setOverrides({});
    setActiveStudent(0);
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
         ["Accuracy", ov.accuracy || student.dimensions?.accuracy]].map(([label, val]) =>
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
      Dr. Ralph Minaya, Ed.D. · Department of Mathematics · University of Saint Joseph · rminaya@usj.edu<br>
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

  // ─── COLORS ───────────────────────────────────────────────────────────────

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
  if (step === "login") return (
    <div style={{ ...styles.root, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={styles.header}>
          <span style={styles.badge}>DM3A Grader</span>
          <h1 style={styles.h1}>Mastery-Based AI Grading</h1>
          <p style={styles.sub}>University of Saint Joseph · Dr. Ralph Minaya, Ed.D.</p>
        </div>
        <div style={styles.card}>
          <form onSubmit={handleLogin}>
            <label style={styles.label}>Access Password</label>
            <input
              style={{ ...styles.input, marginBottom: 16 }}
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
            {loginError && <p style={{ color: "#A32D2D", fontSize: 13, marginBottom: 12 }}>{loginError}</p>}
            <button style={{ ...styles.btn, width: "100%" }} type="submit">Enter DM3A Grader →</button>
          </form>
        </div>
        <p style={{ textAlign: "center", fontSize: 12, color: "#888" }}>Contact rminaya@usj.edu for access</p>
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

  // ── SETUP SCREEN ──────────────────────────────────────────────────────────
  if (step === "setup") return (
    <div style={styles.root}>
      <TierGuideModal />
      <div style={styles.header}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={styles.badge}>DM3A Grader v5</span>
            <h1 style={styles.h1}>Mastery-Based AI Grading</h1>
            <p style={styles.sub}>University of Saint Joseph · Dr. Ralph Minaya, Ed.D.</p>
          </div>
          <button onClick={() => setShowTierGuide(true)} style={styles.btnOutline}>Course Coverage Guide</button>
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
        <textarea style={{ ...styles.input, minHeight: 80, resize: "vertical" }} placeholder="Any specific grading notes for this assignment..." value={rubric} onChange={e => setRubric(e.target.value)} />
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
            <input ref={studentRef} type="file" accept="application/pdf,image/*" multiple style={{ display: "none" }}
              onChange={e => {
                const files = Array.from(e.target.files);
                setStudentFiles(files);
                const singlePDF = files.length === 1 && files[0].type === "application/pdf";
                setIsBatchPDF(singlePDF);
                if (singlePDF) setBatchMode("single"); // default to single student
                // Auto-enable combine when multiple images uploaded
                const multipleImages = files.length > 1 && files.every(f => f.type.startsWith("image/"));
                setCombineImages(multipleImages);
                if (!multipleImages) setCombinedStudentName("");
                // File size warnings
                const MAX_PDF_MB = 4;
                const warnings = [];
                files.forEach(f => {
                  const sizeMB = (f.size / 1024 / 1024).toFixed(1);
                  if (f.type === "application/pdf" && f.size > MAX_PDF_MB * 1024 * 1024) {
                    warnings.push({
                      type: "oversized_pdf",
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
                  <div style={{ color: "#0F6E56", fontWeight: 600, marginBottom: 4 }}>✓ {studentFiles.length} file(s) selected</div>
                  {studentFiles.map(f => <div key={f.name} style={{ fontSize: 12, color: "#555" }}>{f.name}</div>)}
                </div>
              : <div>
                  <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>Upload student submissions (PDF or images)</div>
                  <div style={{ fontSize: 11, color: "#AAA" }}>Multiple individual files, or one combined batch PDF</div>
                </div>
            }
          </div>

          {/* File Size Warnings */}
          {fileSizeWarnings.length > 0 && fileSizeWarnings.map((w, i) => (
            <div key={i} style={{ marginTop: 10, background: "#FCEBEB", border: "2px solid #F5BEBE", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ fontSize: 20 }}>🚫</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#A32D2D", marginBottom: 6 }}>
                    File Too Large — {w.sizeMB} MB (limit: 4 MB)
                  </div>
                  <div style={{ fontSize: 13, color: "#5A5A55", marginBottom: 10, lineHeight: 1.5 }}>
                    <strong>{w.name}</strong> is {w.sizeMB} MB and will fail to grade.
                    {w.isBatch
                      ? " This appears to be a batch scan of multiple students. Large batch PDFs cannot be processed."
                      : " This PDF is too large to process."}
                  </div>
                  <div style={{ background: "#fff", border: "1px solid #F5BEBE", borderRadius: 6, padding: "10px 12px" }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#A32D2D", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      How to fix this:
                    </div>
                    {w.isBatch
                      ? <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#5A5A55", lineHeight: 1.8 }}>
                          <li><strong>Best:</strong> Have each student submit their own file individually (max 4 MB each)</li>
                          <li><strong>Alternative:</strong> Use Adobe Acrobat to split the PDF by student, then upload each file separately</li>
                          <li><strong>Quick fix:</strong> Photograph each student's work individually with your phone and upload as images</li>
                          <li><strong>Post on Blackboard:</strong> "Please submit your own work as a single PDF or photo. Max 4 MB."</li>
                        </ul>
                      : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#5A5A55", lineHeight: 1.8 }}>
                          <li>Compress the PDF using <strong>Adobe Acrobat</strong> or <strong>smallpdf.com</strong> to under 4 MB</li>
                          <li>Or photograph the pages individually and upload as images instead</li>
                          <li>Or ask the student to resubmit with a smaller file</li>
                        </ul>
                    }
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Batch Mode Toggle — only shows when a single PDF is uploaded */}
          {isBatchPDF && studentFiles.length === 1 && (
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

      <button
        style={{ ...styles.btn, width: "100%", padding: 16, fontSize: 15, opacity: fileSizeWarnings.length > 0 ? 0.4 : 1, cursor: fileSizeWarnings.length > 0 ? "not-allowed" : "pointer" }}
        onClick={fileSizeWarnings.length > 0 ? undefined : handleGrade}
        disabled={fileSizeWarnings.length > 0}>
        {fileSizeWarnings.length > 0 ? "⚠ Fix file size issues above before grading" : "Grade with DM3A →"}
      </button>
    </div>
  );

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
              <button style={styles.btnOutline} onClick={() => downloadPDF(student)}>⬇ Download Report</button>
              <button style={styles.btn} onClick={() => { setStep("setup"); setResults([]); setStudentFiles([]); setAssignmentFile(null); setAnswerKeyFile(null); setProblemOverrides({}); setIsBatchPDF(false); setBatchMode("auto"); setCombineImages(false); setCombinedStudentName(""); setFileSizeWarnings([]); }}>New Session</button>
            </div>
          </div>
        </div>

        {/* Beta Warning */}
        {isBeta && (
          <div style={{ background: "#E6F1FB", border: "1px solid #A3C4E8", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#185FA5" }}>
            <strong>β Beta Subject:</strong> {TIER_META.beta.description} Use the override controls below to adjust any score before finalizing.
          </div>
        )}

        {/* Student Tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {results.map((s, i) => {
            const t = overrides[s.studentName]?.overall || s.overallTier;
            return (
              <button key={i} onClick={() => setActiveStudent(i)}
                style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${activeStudent === i ? "#1A1A18" : "#D8D6CE"}`, background: activeStudent === i ? "#1A1A18" : "#fff", color: activeStudent === i ? "#fff" : "#1A1A18", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                {s.studentName} <span style={{ marginLeft: 4, ...styles.mastery(t), padding: "1px 6px", fontSize: 11 }}>{t}</span>
              </button>
            );
          })}
        </div>

        {/* Student Card */}
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              {/* Inline rename — click pencil to edit */}
              {ov.renamedName !== undefined
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
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{ov.renamedName || student.studentName}</h2>
                    <button
                      onClick={() => setOverrides(prev => ({ ...prev, [student.studentName]: { ...prev[student.studentName], renamedName: ov.renamedName || student.studentName } }))}
                      title="Rename student"
                      style={{ background: "none", border: "1px solid #D8D6CE", borderRadius: 4, padding: "2px 8px", fontSize: 11, color: "#888", cursor: "pointer" }}>
                      ✏ Rename
                    </button>
                  </div>
              }
              <p style={{ margin: 0, fontSize: 13, color: "#5A5A55" }}>{subject} · {assignment}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>OVERALL MASTERY</div>
              <span style={{ ...styles.mastery(ov.overall || student.overallTier), fontSize: 20, padding: "4px 16px" }}>{ov.overall || student.overallTier}</span>
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
            ].map(([label, key, ovKey]) => {
              const val = ov[ovKey] || student.dimensions?.[key] || "P1";
              return (
                <div key={key} style={{ background: tierBg[val], border: `1px solid ${tierBorder[val]}`, borderRadius: 6, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: "#5A5A55", marginBottom: 4, fontWeight: 600 }}>{label.toUpperCase()}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: tierColor[val], fontWeight: 700, fontSize: 18 }}>{val}</span>
                    <select style={{ fontSize: 11, padding: "2px 6px", border: `1px solid ${tierBorder[val]}`, borderRadius: 4, background: "transparent" }}
                      value={val}
                      onChange={e => setOverrides(prev => ({ ...prev, [student.studentName]: { ...prev[student.studentName], [ovKey]: e.target.value } }))}>
                      {["P4", "P3", "P2", "P1"].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

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
        </div>
      </div>
    );
  }

  return null;
}
