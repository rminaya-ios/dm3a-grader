---

## Phase 1 Development Plan

### Priority 0 — Multi-File Batch Upload (Build BEFORE resuming stress tests)

Real professors download a ZIP from Blackboard containing 20-25 mixed files and drop them all at once. The app must support this workflow.

#### Features to build:
1. Multi-file drag-and-drop — accept 25+ files simultaneously, mixed formats (PDF, JPG, HEIC, PNG)
2. Auto-group by student ID — parse Blackboard filename pattern (see below)
3. Handle multiple files per student — merge all files with same student ID into one submission
4. Pre-grading preview — show instructor proposed groupings before grading starts
5. Instructor adjustment — allow corrections before grading starts
6. Grade each student group as one unified submission
7. Label results as Student_[ID] — instructor uses existing Rename button to add real names post-grading

#### Blackboard filename pattern (CONFIRMED from real download):
AssignmentName_StudentID_attempt_YYYY-MM-DD-HH-MM-SS_OriginalFilename.ext
Example: 10_28 - HW 5.1 Exercises_ Practice Section_01560658_attempt_2025-10-30-15-24-40_IMG_2683.jpeg

#### Parsing logic:
- Split on underscore
- Student ID = numeric token (e.g. 01560658)
- Group all files sharing the same student ID as one student submission
- Attempt timestamp used to sort pages in correct order within a student group
- If filename does not match BB pattern, fall back to Claude reading student name from handwriting on page

#### Why student names are not in BB filenames:
Blackboard uses student ID numbers, not names, in downloaded filenames.
Workaround for now: instructor renames after grading using Rename button.
Future fix (next semester): require students to name files LastName_FirstName_AssignmentName_P#.ext before uploading.

#### Syllabus language for future semesters:
All assignments submitted digitally must follow this naming format:
LastName_FirstName_AssignmentName_P#.ext
Example: Smith_John_CCBalance_P1.pdf
Rules: No spaces (underscores only), last name first, exact assignment name from Blackboard,
page number required for multi-page submissions.
Accepted formats: PDF, JPG, JPEG, PNG, HEIC. Max 25 MB per file.

#### Marketing angle:
Download from Blackboard. Drop everything in. Done.
Beats Gradescope, Crowdmark, and Canvas SpeedGrader which all require pre-formatted single PDFs.

---

### Priority 1 — Stress Test 3 (After Priority 0 is built)

Course: MATH 1010-04 Intermediate Algebra
Students: 20-25
File size: 50-100 MB
Format: Mixed BB download (PDF + JPG + HEIC + PNG, no separators)
Goal: Verify DM3A rubric quality holds for algebra work (equations, factoring, graphing)
Note: Run Test 3 using the new multi-file drop interface, not combined PDF method

### Priority 2 — Stress Test 4 (Final ceiling test)

Course: Statistics OR Algebra
Students: 25-30
File size: 100+ MB
Goal: Find the true upper limit of the app under real professor workflow

---

## Stress Test Log

### May 22, 2026 - Stress Test 1
- File: DM3A_Test_Packet_Combined.pdf
- Size: 21.7 MB (mixed formats: PDF + JPG + HEIC + PNG with separators)
- Students: 4 (Elementary Statistics - CC Balance assignment)
- Result: PASSED - All 4 students graded successfully
- Instructor validation: Dr. Minaya confirmed grades are FAIR and accurate across all four DM3A dimensions
- Notes: 3 of 4 student names not fully detected (handwriting legibility issue) - name detection prompt improved
- Significance: First successful stress test beyond 4 MB limit. App now handles 25 MB mixed-format batch PDFs.

### May 22, 2026 - Stress Test 2
- File: DM3A_Test_Packet_2026-05-23_193032_12Students_35Pages_71.03MB.pdf
- Size: 71.03 MB (22 files: 3 PDFs + 19 images + 12 separators = 35 pages)
- Students: 12 (MATH 110-03 and MATH 110-04 combined - CC Balance assignment)
- Result: PASSED - All 12 students graded successfully
- Fixes applied during this session:
  1. Two-pass auto-detect: boundary detection first, then per-student grading loop
  2. maxPages raised from 16 to 60 for batch PDFs
  3. Orphaned single-call block removed
- Root causes fixed:
  - Single-call auto-detect truncated at 16k tokens causing only 6 students to grade
  - maxPages=16 cap converting only 16 of 35 pages
  - Old block still executing causing 24 duplicate students
- Known issue remaining: PDF.js misreads numPages=35 as too high (Epson ScanSmart issue)
  but try-catch per-page correctly produces 35 images. Not blocking.
- Notes: Student_003 scored P1 (genuine low score, not an error)
- Commit: a9fc607

---

## Current App Limits (as of May 25, 2026)
- File size soft limit: 100 MB (amber warning + Grade anyway button)
- Compression ladder: <=5 MB = 1200px/0.75 · 5-20 MB = 1000px/0.60 · 20-100 MB = 800px/0.50 · >100 MB = 800px/0.50 + warning
- Max tokens: 16000 (set in server/index.js - raise if large batches still truncate)
- Batch mode maxPages: 60 (raised from 16 during Stress Test 2)
- Batch mode: auto-detect recommended for mixed-format files

## Known Issues / Watch Out For
- Render free tier spins down after inactivity - first request after idle takes ~15s
- pdfToImages uses a CDN import; if the CDN is down, PDF conversion silently fails (error shown in feedback field)
- PDF.js misreads Epson ScanSmart PDFs (numPages inflated) but try-catch per-page handles it correctly
- max_tokens: 16000 is set in server/index.js - raise if large batches still truncate
- Auto-detect works best with <=60 pages total

## URLs and Passwords
- Frontend: https://dm3a-grader.vercel.app (Vercel, auto-deploys on vercel --prod)
- Backend: https://dm3a-grader-server.onrender.com
- App password: dmgof50c

## Deployment
- Frontend deploy: cd ~/dm3a-grader && vercel --prod
- Backend: Railway.app migration paused (platform incident) - still on Render free tier
- GitHub: rminaya-ios/dm3a-grader

---

## Stress Test 3 — May 25, 2026 (Priority 0 BB Batch Mode)

### What was built today
- BB Batch Mode: drop 15+ extracted Blackboard files, auto-group by student ID
- parseBBFilename() utility: parses BB pattern (AssignmentName_StudentID_attempt_YYYY-MM-DD-HH-MM-SS_file.ext)
- Group Preview screen: shows proposed groupings before grading, with Remove button per file
- Parallel grading: all students graded simultaneously via Promise.all (16 min -> 6 min for 15 students)
- JSON extraction fix: regex pulls JSON array even when Claude adds preamble text
- systemPrompt moved to top-level component scope (available in all screens)
- HEIC fix: file picker now excludes HEIC (accept= no longer includes image/heic)
- HEIC pre-processing: run sips command before uploading to convert HEIC to JPG
- LibreOffice installed at /Applications/LibreOffice.app for future .docx conversion

### HEIC pre-processing command (run before every BB upload)
find ~/Downloads -name "*_attempt_*.HEIC" | while read f; do sips -s format jpeg "$f" --out "${f%.HEIC}.jpg"; done

### Stress Test 3 Results
- Files: 15 students, real Blackboard download (mixed JPG, JPEG, PNG, PDF, HEIC->JPG)
- Assignment: HW 5.1 Exercises, Intermediate Algebra
- Result: PASSED — 14/15 students graded with real DM3A feedback
- Score distribution: mostly P3, some P2/P4, realistic and differentiated
- Time: ~6 minutes (parallel grading)
- Known issue: student 01793443 submitted only 2 HEIC images (very small submission), graded P1

### Commits today
- df06dfa: Priority 0 BB batch mode — multi-file drop, student ID grouping, preview screen, JSON parse fix
- 92c2c64: perf: parallel grading — 15 students in 6min vs 16min sequential
- bc0032f: fix: HEIC conversion via sips, exclude HEIC from file picker, parallel grading stable

### Current App Limits (as of May 25, 2026 end of day)
- File types accepted: PDF, JPG, JPEG, PNG, GIF, WEBP (HEIC excluded — convert first with sips)
- Parallel grading: all students fired simultaneously via Promise.all
- BB Batch Mode: auto-activates when 2+ files with BB filename pattern detected
- Group Preview: shows student ID groupings, allows file removal before grading
- Sequential mode (single PDF batch): still available and unchanged
- Backend: still on Render free tier (Railway migration paused)
