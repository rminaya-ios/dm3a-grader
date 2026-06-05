# DM3A Grader — Feature Inventory
**Application:** dm3agrader.com  
**Stack:** React 19 / Vite (frontend) · Node.js / Express (Railway backend) · Anthropic Claude claude-sonnet-4-6  
**Last updated:** 2026-06-05  
**Purpose of this document:** Master source of truth for user-facing documentation, in-app help, video scripts, and PDF user manual.

---

## Table of Contents
1. [Landing Page](#landing-page)
2. [Login Screen](#login-screen)
3. [Setup Screen — Single Student Mode](#setup-screen--single-student-mode)
4. [Setup Screen — BB Batch Mode](#setup-screen--bb-batch-mode)
5. [Group Preview Screen (BB Batch)](#group-preview-screen-bb-batch)
6. [Grading Screen (Loading)](#grading-screen-loading)
7. [Results Screen](#results-screen)
8. [PDF Report Download (Individual)](#pdf-report-download-individual)
9. [Download All Reports (Zip)](#download-all-reports-zip)
10. [Help Page](#help-page)
11. [Course Coverage Guide Modal](#course-coverage-guide-modal)
12. [Backend — Server Endpoints](#backend--server-endpoints)
13. [Application Workflow Map](#application-workflow-map)
14. [Content Gaps & Open Questions](#content-gaps--open-questions)

---

## Landing Page

**Route:** `/` (unauthenticated visitors)  
**File(s):** `src/LandingPage.jsx`, `src/App.jsx` (routing logic)  
**Purpose:** Markets DM3A Grader to prospective instructors and lets them start a free 7-day trial by entering their email address.

**How it works (user perspective):**
1. A visitor arrives at dm3agrader.com and sees a full marketing page with a navy header and gold accents.
2. The page opens with a bold headline — "You grade alone. Your students deserve better than a percentage." — and a brief description of the tool.
3. Two options are immediately visible: an email input with a "Start Free Trial →" button, and a "See how it works" link that scrolls down.
4. Scrolling down, the visitor sees: a statistics strip (15× faster, 42 problems, P1–P4, JPEG·PDF), a four-step "How it works" card grid, the P1–P4 mastery scale explained, a comparison table (DM3A vs. Gradescope), a personal note from Dr. Minaya, a pricing section ($9/month founding vs. $12/month), and a final dark call-to-action section with another trial signup form.
5. The visitor types their email in any of the trial forms and clicks "Start Free Trial."
6. The button shows "Sending…" briefly, then either a green success banner ("Check your email for your trial password.") or a red error message appears.
7. The navbar also has a "Sign In" button (top right) for existing users.

**How it works (technical):**  
`LandingPage.jsx` is a self-contained React component that renders the full marketing page using inline styles. It loads Google Fonts (Instrument Serif + DM Sans) via a `useEffect` that injects a `<link>` tag. The trial signup calls `POST https://dm3a-grader-production.up.railway.app/request-trial` with `{ email }`. On success, the Railway server generates a random `trial-xxxxxx` password, stores it in Upstash Redis with a 7-day TTL, and sends a Resend email to the admin (temporarily routing to ralph.minaya@drminaya.com during testing). Shared `trialStatus` state (`idle | loading | success | error`) controls both the hero and footer form UI simultaneously. The landing page is shown when `step === "login" && showLanding === true` in `App.jsx`.

**Inputs accepted:**
- Email input field (hero section and footer section — share the same `email` state)
- "Start Free Trial →" button — submits the trial request
- "See how it works" button — smooth-scrolls to the How It Works section
- "Sign In" button (navbar) — dismisses the landing page and shows the login screen
- "Claim Your Founding Spot" / pricing section — links to the footer form section via scroll

**Outputs produced:**
- Success state: green banner "Check your email for your trial password."
- Error state: red inline error with mailto link

**Edge cases / known behaviors:**
- Empty or invalid email silently prevents submission (no toast — the button simply doesn't fire if `!email || !email.includes("@")`)
- The Google Form URL (`GOOGLE_FORM_URL`) constant still exists in the file but is no longer used; the form replaced it
- Both trial forms on the page share a single `trialStatus` state, so success/error on one form changes both simultaneously
- The navbar "Start Free Trial" button scrolls to the footer form rather than submitting directly

**Screenshots needed:**
- Full page (desktop) — initial load state
- Hero section with email filled in, button in "Sending…" state
- Success state (green banner)
- Error state (red message)
- Mobile responsive layout

---

## Login Screen

**Route:** `/` (after dismissing landing page, or returning users)  
**File(s):** `src/App.jsx` (login section, ~lines 1408–1432)  
**Purpose:** Authenticates the instructor using either the permanent admin password or a time-limited trial password.

**How it works (user perspective):**
1. The instructor sees a clean centered login card with the DM3A Grader badge, the tool name, and "Dr. Ralph Minaya, Ed.D." as a subtitle.
2. There is one field: "Access Password."
3. A "Show / Hide" toggle button sits inside the right edge of the password field — clicking it reveals or hides the typed characters.
4. The instructor types their password (admin or trial) and clicks "Enter DM3A Grader →" or presses Enter.
5. If the password is the permanent admin password, they are immediately taken to the Setup screen.
6. If the password looks like a trial password (anything other than the admin password), the app checks it against the server. The login button shows a "Checking password…" message briefly.
7. On success, the Course Coverage Guide modal appears first (first-time experience), then the Setup screen.
8. On failure, a red error message appears below the field explaining what went wrong.
9. Contact information for support is shown below the login card.

**How it works (technical):**  
`handleLogin` is an async function. It first compares `password === APP_PASSWORD` (the hardcoded string `"dmgof50c"`). If true, it immediately sets `step = "setup"` and shows the tier guide modal. Otherwise it calls `POST ${SERVER_URL}/validate-trial` with `{ password }`. The server looks up `trial:${password}` in Upstash Redis, checks the expiry timestamp, and returns `{ valid, reason }`. The login UI updates based on the response. `showPassword` state toggles the input between `type="password"` and `type="text"`.

**Inputs accepted:**
- Password text field (with Show/Hide toggle)
- "Enter DM3A Grader →" submit button

**Outputs produced:**
- Successful login → transitions to Setup screen
- Failed login → inline error message

**Edge cases / known behaviors:**
- Admin password `"dmgof50c"` is hardcoded in the frontend — this is a security consideration for future versions
- Trial password format: `trial-` followed by 6 random alphanumeric characters (e.g., `trial-abc123`)
- Expired trial: shows "Trial password has expired. Contact support@dm3agrader.com to renew."
- Wrong password: shows "Incorrect password. Contact support@dm3agrader.com for access."
- Network error: shows "Could not verify password — check your connection and try again."
- The "Checking password…" message is set via `setLoginError` (repurposed for loading state)

**Screenshots needed:**
- Empty state
- Password visible (Show mode)
- "Checking password…" state
- Error state (wrong password)
- Error state (expired trial)

---

## Setup Screen — Single Student Mode

**Route:** `/setup` (internal step, no URL change)  
**File(s):** `src/App.jsx` (`step === "setup"` block, ~lines 1510–1680)  
**Purpose:** Lets the instructor configure and upload files for a single student (or a batch PDF) before starting AI grading.

**How it works (user perspective):**
1. The instructor sees the main grading configuration screen with three upload zones and several settings.
2. **Subject dropdown:** Select the course being graded (Elementary Statistics, Intermediate Algebra, Precalculus, Linear Algebra, Calculus I, Calculus II, or Precalculus). Each has a colored badge showing whether it is Fully Supported or Beta.
3. **Assignment Name field:** Type the name of the assignment (e.g., "Quiz 3 — Linear Systems"). This appears on the grading report.
4. **Rubric Notes field (optional):** Any special grading instructions for this specific assignment.
5. **Zone 1 — Assignment Prompt (optional):** Upload the printed assignment PDF so the AI knows what questions were asked.
6. **Zone 2 — Answer Key (strongly recommended):** Upload the answer key PDF. Without it, the AI relies only on its own math knowledge.
7. **Zone 3 — Student Work:** Upload the student's work as JPEG photos, HEIC photos, PNG, or a PDF scan. Multiple files can be selected at once.
8. If a single PDF is uploaded in Zone 3, a "What does this file contain?" selector appears with three options: One student's exam, Multiple students (auto-detect), Multiple students (fixed pages).
9. If multiple images are uploaded for one student, a "combine" toggle appears to grade them as one submission.
10. A file-size indicator appears if files are large — blue for 4–25 MB (auto-compressed), amber for over 100 MB (requires confirmation).
11. The "Course Coverage Guide" button (top right) opens a modal explaining which courses are fully supported vs. Beta.
12. The "Help" button opens the in-app Help page.
13. Click "Grade with DM3A →" to start grading.

**How it works (technical):**  
All state (subject, assignment, rubric, file references, batch mode, warnings) is managed in component-level `useState`. File uploads are handled via hidden `<input type="file">` refs and `onChange` handlers. File size is checked against 4 MB (large) and 100 MB (oversized) thresholds. Large files show info banners; oversized files require user acknowledgment via "Grade anyway" button. The "Grade with DM3A →" button calls `handleGrade()` for non-BB-batch submissions, or `setStep('preview')` for BB batch.

**Inputs accepted:**
- Subject dropdown (6 course options)
- Assignment Name text field
- Rubric Notes textarea
- Zone 1 file picker (PDF or image)
- Zone 2 file picker (PDF or image)
- Zone 3 file picker (PDF, JPEG, PNG, HEIC, DOCX — multiple allowed)
- Batch mode selector (Single / Auto-detect / Fixed pages)
- Pages-per-student number input (Fixed pages mode only)
- "Skip cover sheet" checkbox (when multiple images for one student)
- File size warning acknowledgment button (files over 100 MB)
- "Course Coverage Guide" button
- "Help" button
- "Grade with DM3A →" / "Review Student Groups →" button

**Outputs produced:**
- Transitions to Grading screen (single student) or Group Preview screen (BB batch)

**Edge cases / known behaviors:**
- Files between 4–25 MB are silently compressed before sending (blue info banner)
- Files over 100 MB show amber warning with "Grade anyway (may be slow)" button
- HEIC files are filtered from the student file picker accept list
- A `.txt` or `.xml` metadata file from a Blackboard download is silently ignored
- Zone 1 (Assignment Prompt) is excluded from the grading API payload — it previously confused the AI by implying a fixed number of problems
- Large PDFs are rendered at up to 2400px per page using PDF.js

**Screenshots needed:**
- Clean empty state
- All three zones filled
- Single PDF uploaded with batch mode selector visible
- Large file warning (blue)
- Oversized file warning (amber + Grade anyway button)

---

## Setup Screen — BB Batch Mode

**Route:** `/setup` (same screen, different detection state)  
**File(s):** `src/App.jsx` (`isBBBatch` detection logic, ~lines 1497–1515)  
**Purpose:** Automatically detects when an instructor drops multiple Blackboard-exported files and switches the interface to group-based batch grading.

**How it works (user perspective):**
1. The instructor downloads the full batch of student submissions from Blackboard ("Download All Submissions" zip, then unzips).
2. They drag all the files (15–25 mixed JPEGs, HEICs, PDFs, DOCXs) into Zone 3 at once.
3. The interface automatically detects Blackboard filenames (they contain `_attempt_` and a timestamp) and switches to BB Batch Mode.
4. The button changes from "Grade with DM3A →" to "Review Student Groups →."
5. Files are silently grouped by student username (e.g., all files containing `_mdecker_` become one group).
6. Duplicate filenames within a group are automatically removed.
7. Non-gradable files (`.txt`, `.xml` metadata files) are silently excluded.

**How it works (technical):**  
Detection: `hasBBFiles = files.length > 1 && files.some(f => f.name.includes("_attempt_"))`. `groupBBFiles()` parses filenames with regex `/^(.+?)_([a-zA-Z0-9_]{2,20})_attempt_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})_(.+)$/i` to extract `studentId`, `timestamp`, and `originalName`. Files are grouped into a map keyed by `studentId`, sorted by timestamp ascending, and deduplicated by filename within each group. The `isGradable` filter removes `.txt`, `.xml`, and other non-image/non-PDF/non-DOCX files.

**Inputs accepted:**
- Same as Setup Screen but Zone 3 accepts 15–25+ files simultaneously

**Outputs produced:**
- `bbGroups` state array: one entry per detected student, each with their files
- Transition to Group Preview screen

**Edge cases / known behaviors:**
- Blackboard usernames (e.g., `mdecker`) are extracted, not numeric student IDs — this required fixing the regex from `\d{6,12}` to `[a-zA-Z0-9_]{2,20}`
- Files without `_attempt_` in the name go to an "UNRECOGNIZED" group
- A student with only `.txt` files gets no group (filtered out before grouping)

**Screenshots needed:**
- Zone 3 with 15+ files visible
- "Review Student Groups →" button state

---

## Group Preview Screen (BB Batch)

**Route:** Internal `step === "preview"`  
**File(s):** `src/App.jsx` (preview screen block, ~lines 1686–1972)  
**Purpose:** Shows the instructor exactly which files belong to each student before grading starts, with tools to clean up the submission set.

**How it works (user perspective):**
1. After clicking "Review Student Groups →," the instructor sees a list of student groups — one card per student.
2. Each card shows the student's username (e.g., `Student_mdecker`) and a list of their submitted files.
3. For each student, the instructor can:
   - **Remove** individual files (✕ button) — useful for removing duplicate or irrelevant photos
   - **Check "Skip first uploaded file (cover sheet)"** — excludes the earliest-uploaded file (often a photo of the printed assignment form)
   - **Convert .docx to PDF** — a button appears if any Word files are in the group (requires the local converter to be running at localhost:3333, or uses the Railway `/convert-docx` endpoint)
4. At the top of the list, there are two optional fields:
   - **"Problems to grade"** — e.g., "even problems 2–84" — tells the AI exactly which problems to look for
   - **"Course Context"** — e.g., "Unit covers matrix operations only, no eigenvalues yet"
5. The instructor clicks "Grade All [N] Student(s) →" to begin.

**How it works (technical):**  
`bbGroups` state is rendered as a mapped list. Removing a file filters the group's files array and removes the group entirely if it becomes empty. The "Skip cover sheet" toggle adds/removes the `studentId` from a `skipCoverSheet` Set. The "Problems to grade" and "Course Context" fields are prepended to each student's `userPrompt` if non-empty. Grading uses `gradingPromises = bbGroups.map(async group => ...)` and then processes them in chunks of 5 via `chunkArray(gradingPromises, 5)` to avoid hitting the 50 MB server body limit simultaneously.

**Inputs accepted:**
- Per-student "✕ Remove" buttons for individual files
- Per-student "Skip first uploaded file" checkbox
- "Convert .docx → PDF" button (per student, when Word files present)
- "Problems to grade" text input (applies to all students)
- "Course Context" textarea (applies to all students)
- "Grade All [N] Student(s) →" button

**Outputs produced:**
- Transitions to Grading screen

**Edge cases / known behaviors:**
- If all files for a student are HEIC and server conversion fails → student gets a gray "HEIC ⚠" badge in results instead of a grade
- If all files are DOCX and conversion fails → gray "DOCX ⚠" badge
- The local converter at localhost:3333 is a fallback — the Railway `/convert-docx` endpoint is the primary path
- Files are reversed in order before processing (most recent upload first, so notebook pages appear before the cover sheet)
- Chunk size is 5 students per API call batch; loading message updates per chunk

**Screenshots needed:**
- Group Preview with 5–6 students shown
- Student with "Skip cover sheet" checkbox checked
- Student with DOCX file showing Convert button
- "Problems to grade" field filled in

---

## Grading Screen (Loading)

**Route:** Internal `step === "grading"`  
**File(s):** `src/App.jsx` (grading screen block, ~lines 1926–1937)  
**Purpose:** Shows a loading indicator while the AI grades the submission(s).

**How it works (user perspective):**
1. After clicking "Grade with DM3A →" or "Grade All," the screen clears and shows a centered spinning indicator.
2. A status message updates in real time:
   - "Converting [filename] to images (compressing — large file)..."
   - "6 pages detected · Compressed to ~1.2 MB · Est. ~3 min"
   - "Grading students 1–5 of 15..."
   - "Converting [filename] (HEIC) via server..."
3. The instructor waits. For a single student PDF, this typically takes 30–90 seconds. For a 15-student batch, approximately 6 minutes.
4. No cancel button is available — the instructor must wait.

**How it works (technical):**  
`loadingMsg` state is updated throughout the grading pipeline via `setLoadingMsg()`. The spinner is a CSS `@keyframes spin` rotation on a "⟳" character. No progress bar — only text status updates. The screen renders while `loading === true`.

**Inputs accepted:**
- None (no user interaction while loading)

**Outputs produced:**
- Transitions to Results screen when grading completes

**Edge cases / known behaviors:**
- If all students in a BB batch fail (network error, etc.), the results screen still appears with P1 error entries
- No timeout — if the Railway server is cold-starting (Render free tier had this issue; Railway should be always-on), the first request may take 15+ seconds before any response

**Screenshots needed:**
- Loading spinner with a specific status message visible
- Message showing "Compressing large file..."
- Message showing "Grading students 1–5 of 15..."

---

## Results Screen

**Route:** Internal `step === "results"`  
**File(s):** `src/App.jsx` (results screen block, ~lines 1939–2220)  
**Purpose:** Displays the AI-generated mastery scores for all graded students, with inline editing and export tools.

**How it works (user perspective):**
1. The results screen shows a header with the course name and number of students.
2. A row of buttons at the top: "← Back to Setup," "Export CSV," "⬇ Download All Reports," "👥 Load Roster," and a per-student "⬇ Download Report" button.
3. **Student tabs** across the top — one tab per student, showing their name (or username) and a colored mastery badge (P3, P4, etc.). Students with unprocessable HEIC or DOCX files show a gray "HEIC ⚠" or "DOCX ⚠" badge.
4. **Student card** (main area) shows:
   - Student name (editable via ✏ Rename button)
   - Overall Mastery badge (P1–P4) with an override dropdown
   - P3/P4 Rate: e.g., "73% (16 of 22 problems at mastery)"
   - Four dimension scores (Conceptual Understanding, Problem Solving, Work Shown, Accuracy) — each with its own override dropdown
   - Problem Breakdown table — every problem number with its tier, process assessment, and reasoning
   - Per-problem override dropdowns
   - Personalized Feedback (2–3 sentences)
   - Instructor Note (flags, concerns)
5. **Class Summary** card at the bottom: four colored count boxes (P4, P3, P2, P1) and a "Class P3/P4 Rate" line.
6. **Load Roster** — upload a UTF-16 TSV from Blackboard with columns: Last Name, First Name, Username. The app matches by username and renames all tabs automatically.
7. **HEIC/DOCX warning banner** — if any files could not be processed, a yellow banner lists them by name.
8. **Beta subject banner** — if the selected course is Beta, a blue info banner warns to review scores before finalizing.

**How it works (technical):**  
Results are stored in `results` array state. `overrides` object allows per-student per-dimension score changes without mutating original data. `problemOverrides` allows per-problem tier changes. The `rosterMap` maps username → "Last, First" and populates `overrides[studentName].renamedName`. P3/P4 rate is computed inline from `student.problems` array. The Class Summary filters `results` by effective tier (accounting for overrides). `setHeicFailedFiles` tracks unprocessable files. `setActiveStudent` controls which tab is displayed.

**Inputs accepted:**
- Student tabs (click to switch)
- ✏ Rename button + name input
- Overall tier override dropdown (P1–P4)
- Per-dimension override dropdowns (4 dimensions)
- Per-problem tier override dropdowns
- "Load Roster" file upload (.xls, .xlsx, .csv, .tsv, .txt)
- "Export CSV" button
- "⬇ Download All Reports" button
- "⬇ Download Report" button (per student)
- "← Back to Setup" button
- "New Session" button (resets all state)

**Outputs produced:**
- Renamed student tabs (after roster load)
- CSV file download
- Individual PDF report
- Zip of all PDF reports

**Edge cases / known behaviors:**
- HEIC/DOCX badges are not included in "Download All Reports" (only gradeable students)
- Class Summary excludes HEIC/DOCX students from the P3/P4 rate average
- Roster matching: tries numeric ID first, then username extracted from `Student_username` pattern, then contains-match across all map keys
- The `downloadPDF` function (legacy HTML-to-file approach) is still present in the codebase but the "⬇ Download Report" button now calls `downloadStudentReport` (jsPDF)

**Screenshots needed:**
- Results screen with multiple student tabs
- A P4 student card fully expanded
- Problem breakdown table with several problems
- Class summary section
- HEIC/DOCX warning banner
- After roster load (real names in tabs)
- Override dropdown open

---

## PDF Report Download (Individual)

**Route:** Triggered from Results screen  
**File(s):** `src/App.jsx` (`generateStudentPDF`, `downloadStudentReport`, `buildReportFilename`)  
**Purpose:** Generates a formatted A4 PDF report for one student that an instructor can share with that student or keep on file.

**How it works (user perspective):**
1. On the Results screen, the instructor clicks "⬇ Download Report" in the top toolbar (for the currently visible student).
2. A PDF downloads to their computer within a few seconds.
3. The filename follows this format: `LastName_FirstName_AssignmentName_P3.pdf` (e.g., `Jones_Sierra_Trig_Functions_P3.pdf`).
4. Opening the PDF shows:
   - Navy header bar with "DM3A Grader" and the course + assignment name
   - Student name and a color-coded mastery badge
   - P3/P4 rate percentage
   - Four dimension scores in a gray bar
   - Full problem breakdown table (all problems, with process notes that wrap across multiple lines)
   - Personalized feedback section
   - Footer with date and Dr. Minaya's attribution

**How it works (technical):**  
`generateStudentPDF` uses `jspdf` (loaded dynamically via `import("jspdf")`). Layout uses absolute mm coordinates on A4 (210×297mm). Non-Latin-1 characters in notes and feedback are sanitized before rendering (degree symbols → "deg", middle dots → "-", etc.). The problem breakdown loop uses `doc.splitTextToSize(noteText, NOTE_W)` and variable row heights so long notes wrap rather than truncate. Font state is explicitly reset at the start of each problem row to prevent jsPDF font bleed. The PDF is saved via `doc.save(filename)`.

**Inputs accepted:**
- "⬇ Download Report" button click

**Outputs produced:**
- `.pdf` file download

**Edge cases / known behaviors:**
- Students with HEIC/DOCX badges are skippable (their feedback explains the issue)
- If the student name contains a comma (e.g., "Jones, Sierra") the name is reversed to "Sierra_Jones" in the filename
- Trailing underscores in assignment name are trimmed before the tier suffix
- If problems list is empty, the problem breakdown section is omitted
- Long feedback wraps correctly using `splitTextToSize`

**Screenshots needed:**
- PDF first page (full)
- PDF with a multi-page problem breakdown

---

## Download All Reports (Zip)

**Route:** Triggered from Results screen  
**File(s):** `src/App.jsx` (`downloadAllReports`)  
**Purpose:** Generates PDF reports for all graded students and packages them into a single zip file for batch distribution.

**How it works (user perspective):**
1. The instructor clicks "⬇ Download All Reports" in the top toolbar.
2. A "Generating reports…" message appears in the loading area (the screen doesn't change — it's inline).
3. After a few seconds (typically 10–30 seconds for a 15-student class), a `.zip` file downloads.
4. The zip is named like `DM3A_Reports_Trig_Functions_2026-06-05.zip`.
5. Opening the zip reveals one PDF per student, named individually.

**How it works (technical):**  
`downloadAllReports` filters `results` to exclude HEIC/DOCX entries, then loops through all gradeable students calling `generateStudentPDF` for each. Results are added to a `JSZip` instance (loaded dynamically). The zip is generated as a Blob and triggered as a download via a temporary `<a>` element. The assignment name is sanitized for the zip filename (spaces → underscores, special chars removed, 15-char limit).

**Inputs accepted:**
- "⬇ Download All Reports" button

**Outputs produced:**
- `.zip` file containing one `.pdf` per gradeable student

**Edge cases / known behaviors:**
- HEIC/DOCX students are silently excluded
- `setLoadingMsg("Generating reports…")` is called but the grading screen isn't shown — the message only appears if the user happens to be watching the loading state variable elsewhere
- If the class has 0 gradeable students, nothing happens (no file downloads, no error message)

**Screenshots needed:**
- Toolbar with "⬇ Download All Reports" button highlighted
- Downloaded zip in Finder with PDFs visible

---

## Help Page

**Route:** Internal (triggered by "Help" button on Setup screen)  
**File(s):** `src/App.jsx` (`showHelp` state, `HelpAccordion` inline component)  
**Purpose:** Provides in-app documentation for instructors without leaving the grading workflow.

**How it works (user perspective):**
1. On the Setup screen, the instructor clicks the "Help" button (top right, next to "Course Coverage Guide").
2. The entire screen changes to a Help page with the same DM3A Grader header.
3. Six accordion sections are shown, each expandable by clicking the header:
   - Getting Started
   - Uploading Files
   - Getting the Best Results from Student Submissions
   - How DM3A Grader Compares to Other Tools
   - The P1–P4 Mastery Scale
   - Tips for Instructors
4. The "Getting Started" section is open by default.
5. Multiple sections can be open at once.
6. "← Back" button returns to the Setup screen.

**How it works (technical):**  
`showHelp` boolean state. When true, a dedicated screen renders before the `step === "setup"` check. `HelpAccordion` is an inner function component using `useState(new Set([0]))` to track open sections. Sections with rich content (P1–P4 scale, tips) render JSX; text-only sections render a `<p>`.

**Inputs accepted:**
- Section header clicks (toggle accordion)
- "← Back" button

**Outputs produced:**
- No data output — informational only

**Edge cases / known behaviors:**
- Help page is accessible from the Setup screen only (not from Results screen)
- The Help content is hardcoded in the component — not loaded from a CMS or external file

**Screenshots needed:**
- Help page with "Getting Started" open
- Help page with P1–P4 mastery scale section open

---

## Course Coverage Guide Modal

**Route:** Modal overlay on Setup screen  
**File(s):** `src/App.jsx` (`TierGuideModal`, `showTierGuide` state)  
**Purpose:** Shows which courses are fully supported vs. Beta so instructors know the expected accuracy level before grading.

**How it works (user perspective):**
1. The modal appears automatically on first login (after password entry).
2. It can also be opened by clicking "Course Coverage Guide" on the Setup screen.
3. The modal shows three tier badges (Fully Supported ✓, Beta β, Coming Soon) and a list of all supported courses with their tier.
4. Fully Supported: Elementary Statistics, Intermediate Algebra, Precalculus.
5. Beta: Linear Algebra, Calculus I, Calculus II.
6. Coming Soon: Calculus III, Differential Equations, Discrete Mathematics.
7. Clicking "I understand — Start Grading →" closes the modal.

**How it works (technical):**  
`TIER_META` object maps tier keys to colors, labels, and descriptions. `COURSE_CONFIGS` object defines each course's tier, descriptors, key definitions, and partial credit rules — this same data feeds the AI system prompt for grading. The modal is a fixed-position overlay with `z-index: 100`.

**Inputs accepted:**
- "I understand — Start Grading →" button
- "✕" close button

**Outputs produced:**
- Modal closes, `showTierGuide` set to false

**Screenshots needed:**
- Modal in its default open state
- Mobile view of the modal

---

## Backend — Server Endpoints

**Route:** `https://dm3a-grader-production.up.railway.app`  
**File(s):** `server/index.js`  
**Purpose:** Handles image conversion, AI grading calls, HEIC/DOCX conversion, and trial password management.

### `GET /`
Returns `{ status: "DM3A Grader Server running" }`. Health check.

### `POST /upload-pdf`
Pass-through: receives `{ base64, mediaType }`, returns `{ file_id: base64 }`. The "file_id" is literally the same base64 string — used as a token to avoid re-encoding.

### `POST /convert-heic`
Receives `{ base64, filename }`. Decodes the buffer and uses `heic-convert` (pure JavaScript, no system dependencies) to produce a JPEG at 92% quality. Returns `{ jpeg: base64, filename: newFilename }`.

### `POST /convert-docx`
Receives `{ base64, filename }`. Writes buffer to `/tmp`, uses `mammoth` to extract HTML, then `html-pdf-node` to generate a PDF. Returns `{ pdf: base64, filename: newFilename }`. Cleans up `/tmp` file.

### `POST /grade`
Main grading endpoint. Receives `{ contentBlocks, systemPrompt, userPrompt }`.  
**Server-side pipeline:**
1. Attempts `sharp` JPEG conversion on all image blocks (normalizes color spaces, removes EXIF)
2. Skips ZIP/DOCX magic bytes (`PK`) and mislabeled PDFs (`%PDF`)
3. Drops failed HEIC conversions (server-side fallback)
4. Deduplicates image blocks by fingerprinting first 100 chars of base64
5. If total payload > 15 MB, re-compresses all images to 800×800 at quality 50
6. Prepends image-reading instructions to the system prompt
7. Calls `anthropic.messages.create` with `claude-sonnet-4-6`, `max_tokens: 64000`
8. Validates the response is parseable JSON; returns `{ result: text }` or a structured fallback P1 object

### `POST /request-trial`
Receives `{ email }`. Generates a `trial-xxxxxx` password, stores in Upstash Redis (7-day TTL), sends Resend email, returns `{ success: true }`.

### `POST /validate-trial`
Receives `{ password }`. Looks up `trial:${password}` in Redis, checks expiry. Returns `{ valid: bool, reason?: "expired" | "not_found" }`.

### `POST /delete-file`
Legacy endpoint for Anthropic Files API cleanup. Not actively used.

**CORS origins allowed:**
- `https://dm3a-grader.vercel.app`
- `https://dm3a-grader-f4cld6wk8-ralph-minayas-projects.vercel.app`
- `https://dm3agrader.com`
- `https://www.dm3agrader.com`
- `http://localhost:5173`

---

## Application Workflow Map

This section describes the complete journey of a first-time instructor, from discovering DM3A Grader to printing their first graded report. Think of this as the opening chapter of the user manual.

---

You are a math instructor at a community college. You teach three sections of Elementary Statistics — about 75 students total. Every week you collect homework, and every week you spend Sunday afternoon marking papers by hand with a red pen, writing the same comments over and over: "Show more work," "Check your formula," "Good reasoning, small arithmetic error." You have no teaching assistant. The department does not provide grading support.

A colleague mentions DM3A Grader. You visit **dm3agrader.com**.

**Step 1: Starting a free trial**

The landing page explains what the tool does in plain language. You enter your email address in the "Start Free Trial" form and click the button. Within a minute, you receive an email with a temporary password — something like `trial-abc4rf`. The password is good for seven days.

**Step 2: Signing in**

You visit dm3agrader.com again and click "Sign In" in the top-right corner. You see a clean login screen. You type your trial password and click "Enter DM3A Grader →." A small modal appears explaining which courses are fully supported — Elementary Statistics is on the "Fully Supported" list, so you close the modal and move on.

**Step 3: Configuring the grading session**

The Setup screen has three file zones at the bottom and a few fields at the top:

- You select "Elementary Statistics" from the subject dropdown.
- You type the assignment name: "HW 5 — Confidence Intervals."
- You upload your answer key PDF in the middle zone.
- In the bottom zone, you upload the student's work — in this case, four photos taken with your phone showing handwritten notebook pages.

You click "Grade with DM3A →."

**Step 4: Waiting**

The screen shows a spinning indicator and a status message that updates as the tool works:
- "Converting [filename] to images..."
- "4 pages detected · Compressed to ~0.8 MB · Est. ~1 min"

About 45 seconds later, the results appear.

**Step 5: Reviewing the results**

You see the student's name at the top (or their file name if you haven't loaded a roster yet). Below that:

- An overall mastery badge in blue: **P3** — Approaching Mastery
- "P3/P4 Rate: 73% (16 of 22 problems at mastery or approaching mastery)"
- Four dimension scores for Conceptual Understanding, Problem Solving, Work Shown, and Accuracy
- A table listing every problem — problem 2, problem 4, all the way to problem 44 — each with its tier score and a note explaining the AI's reasoning
- Personalized feedback the AI wrote for this specific student

You scan the scores. Problem 18 shows P2, but you feel the AI was too harsh — the student's handwriting was unclear on one step. You click the override dropdown next to Problem 18 and change it to P3.

**Step 6: Downloading the report**

You click "⬇ Download Report." A PDF downloads to your computer immediately. The PDF has:
- Your course name and assignment name in a navy header
- The student's name and overall P3 badge
- All the dimension scores
- The complete problem breakdown with the corrected score for Problem 18
- The personalized feedback paragraph
- Your name and the date at the bottom

You email this PDF to the student. The whole process took about two minutes.

**Step 7: Running a full class batch**

The following week, you decide to grade the entire class. You download the batch export from Blackboard — a folder of 22 files with filenames like `HW5_02_mdecker_attempt_2026-03-15-22-57-16_IMG_2683.jpeg`. You drag all 22 files into Zone 3.

The interface switches to "BB Batch Mode" automatically. You click "Review Student Groups →."

A preview screen shows each student as a card with their files listed. You notice that one student submitted a HEIC photo — the app warns you this may not be processable. You note it and proceed.

You type "even problems 2–44" in the "Problems to grade" field so the AI knows exactly what to look for. Then you click "Grade All 22 Student(s) →."

Six minutes later, 22 student cards appear. Most are graded. One shows a gray "HEIC ⚠" badge with the message "Ask this student to resubmit as JPG or PDF."

You upload your Blackboard class roster (a TSV export). The student usernames in the filenames match the roster, and all 21 graded tabs instantly show real names instead of IDs.

You click "⬇ Download All Reports." A zip file downloads containing 21 individual PDFs — one per student. You're done in under ten minutes.

---

## Content Gaps & Open Questions

The following items were found in the codebase that are incomplete, require a human decision before documentation is finalized, or represent behavior that may surprise users.

### Security
- **Admin password is hardcoded in the frontend** (`APP_PASSWORD = "dmgof50c"` in `App.jsx`). This is visible in the compiled JavaScript bundle. Anyone who inspects the source can find it. Decision needed: should all password validation go through the `/validate-trial` endpoint with a separate permanent-access tier?
- **Trial password format** (`trial-xxxxxx`, 6 chars from a 30-char alphabet) produces approximately 30^6 = 729 million combinations. Reasonable for short-term trials but no rate limiting exists on `/validate-trial`.

### Trial System (partially complete)
- **Email routing is temporary**: `to: 'ralph.minaya@drminaya.com'` routes all trial emails to the admin instead of the user. This is noted in a commit message as "temporarily." The intended final behavior — sending to the trial requester — needs to be restored once the Resend domain is verified.
- **`onboarding@resend.dev`** is Resend's test sender domain. It only sends to verified email addresses. The final sender should be `support@dm3agrader.com` once the domain is verified in Resend.
- **No trial management UI**: There is no admin dashboard to view who has requested trials, revoke access, or extend trials. Currently requires direct Redis inspection.
- **No trial-to-paid conversion flow**: The pricing section ($9/month) is on the landing page but there is no Stripe integration, payment link, or checkout flow built yet.
- **`GOOGLE_FORM_URL` constant** still exists in `LandingPage.jsx` and is unused. It can be removed.

### Grading Behavior
- **Hardcoded assignment description in system prompt**: Several lines in `buildSystemPrompt` reference "problems 2 through 84 (even numbers only = 42 problems)" and "6 pages of work." This is specific to one homework assignment from Spring 2026 and will confuse the AI on other assignments. These lines should be removed or made dynamic.
- **`downloadPDF` function** (the original HTML-to-file approach) still exists at ~line 1088 in `App.jsx`. It is no longer called by any button (replaced by `downloadStudentReport` using jsPDF). It can be removed.
- **`uploadPDF` function** sends base64 to `/upload-pdf` which immediately returns it unchanged. This round-trip is unnecessary overhead. The function is called in individual mode but the result (`studentFileId`) is no longer used in the grading payload.
- **`heicFailed` and `heicFailedFiles`** are two separate tracking mechanisms — one for the `handleGrade` flow and one for the BB batch flow. They could be unified.
- **CHUNK_SIZE = 5** for BB batch parallel grading is hardcoded. For very large classes (25+ students), this may still hit payload limits. No user-facing documentation explains this behavior.

### UI / UX
- **"Generating reports…" message** during "Download All Reports" is set via `setLoadingMsg` but the grading screen is not shown during this operation. The message appears in no visible UI element. Should show a loading state on the results screen instead.
- **No cancel button** during grading. If a large batch is running and the user wants to stop, they must close the browser tab.
- **Roster load feedback** says "N of M students matched and renamed" but does not list which students were *not* matched — useful for catching filename mismatches.
- **"New Session" button** resets all state but does not warn the user that unsaved results will be lost.
- **BB Batch debug logs** (`[BB GROUPS START]`, `[BB DETECT]`, `[convertOnServer]`, etc.) are still in the production code. These should be removed or wrapped in a `if (process.env.NODE_ENV === 'development')` guard before launch.
- **`setLoadingMsg` is called but not reset** after `downloadAllReports` completes in the happy path. The "Generating reports…" message may persist in state.

### Known Limitations
- **HEIC on non-WebKit browsers**: Firefox cannot decode HEIC natively. The server-side `heic-convert` endpoint handles this, but if Railway is unavailable, HEIC files will produce the gray badge even on images that are actually readable.
- **PDF.js warns "pdf.numPages seems too high"** for certain Epson ScanSmart PDFs. This is a known PDF.js quirk. The try-catch-per-page workaround handles it correctly but the console warning is noisy.
- **`html-pdf-node` on Railway**: Uses Chromium internally. If Chromium is unavailable in Railway's build environment, `/convert-docx` will fail silently. No test has been run on Railway's production environment for this specific endpoint.
- **The `≈` character** and other math symbols are replaced with ASCII equivalents in PDF reports. This affects readability of feedback containing mathematical notation. A future improvement would use a Unicode-capable font.
- **Precalculus** was recently promoted from Beta to Fully Supported in both `COURSE_CONFIGS` and the landing page. The system prompt for Precalculus (`p4Descriptor`, `p3Descriptor`, etc.) may need review to match the quality bar of Elementary Statistics and Intermediate Algebra.

### Missing Documentation
- No `.env.example` file — new contributors/deployers have no documented list of required environment variables.
- Required env vars: `ANTHROPIC_API_KEY` (Railway), `UPSTASH_REDIS_REST_URL` (Railway), `UPSTASH_REDIS_REST_TOKEN` (Railway), `RESEND_API_KEY` (Railway).
- No README explaining how to run the project locally.
- The `local-converter/` directory (LibreOffice-based DOCX converter) is not documented. It requires a separate Node.js server to be running at localhost:3333.
