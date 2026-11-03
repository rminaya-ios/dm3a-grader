# Make-up module — spec (Hub Phase 4) — LOCKED 2026-11-03

Status: **locked**. Build starts next session. Where this differs from any earlier version,
this version wins. Owner-scoped like everything else (`server/lib/owner.js`).

## Purpose
The video (Loom) make-up is an **exception**, not the default.
- **Default make-up = office hours, MWF 11:00 AM–12:00 PM.**
- Only students Ralph approves (schedule conflict, medical, or another reason he accepts) use
  this flow.
- **Ralph watches every Loom himself.** The AI prepares everything so he can watch, confirm and
  post in one pass. The AI recommends; Ralph decides.

## The flow at a glance
| # | Who | What happens |
|---|---|---|
| 1 | Student | Fills in the course's public **Request video make-up** form. |
| 2 | Ralph | Sees the request on the Make-up tile; one click **Approve** or **Deny**. |
| 3 | System | Approve → emails the student a private personal link. Deny → emails a polite pointer to office hours. |
| 4 | Student | On the personal link: picks the assignment, uploads a photo of the completed work. |
| 5 | System | Shows **one random question** about a step the student wrote, immediately, and emails it too. The 24-hour clock starts when it is shown. |
| 6 | Student | Records a Loom walking through each step, answering the question at the end; pastes the Loom link + transcript on the same personal link. |
| 7 | System | Builds the **AI review card**: late cap, draft level + reason, answered or not, script-reading flag. |
| 8 | Ralph | Review screen: Loom beside the card; confirms or changes the level with one click → posts to Blackboard. |

## 1. Request form (public, one link per course)
- One public link per course, which Ralph posts in Blackboard. The link carries a course token,
  not the course code in plain text.
- Fields: **name**, **school email**, **course** (pre-filled from the link), **assignment**,
  **reason category** (schedule conflict / medical / other), **short optional note**.
- Email must end in **@ctstate.edu** or **@usj.edu**; anything else is refused on the form.
- Only the **reason category** is stored as the reason. The form says plainly: *"Do not include
  medical details. Choosing 'medical' is enough."* The optional note is capped in length and
  shown only to Ralph.
- Rate-limited per IP and per email; duplicate open requests for the same assignment are merged.

## 2. Ralph's queue (Make-up tile on app.dm3agrader.com)
- New requests show on the **Make-up tile with a count badge**. **No email to Ralph.**
- Each request: one click **Approve** (optional end date) or **Deny**.
- **Approve** → the system automatically emails the student a **private, unguessable personal
  link**. The link expires with the approval (end date, or end of term if none).
- **Deny** → the system automatically sends a **polite reply pointing to office hours, MWF
  11:00 AM–12:00 PM**.
- These two emails, and the question email in step 3, are **fixed templates** that Ralph
  approves once at build time. They send automatically. **Every other message to a student is
  a draft for Ralph's approval in v1** (see section 8).
- Sent through the existing Resend setup (`server/lib/clients.js`).

## 3. Personal link page (no student accounts)
- Works on phone and laptop. The link itself is the credential: a long random token. Only its
  **hash** is stored; it expires with the approval and can be revoked from the queue.
- Steps on the page:
  1. **Pick the assignment.**
  2. **Upload a photo of the completed work.** This sets `photoReceivedAt`.
  3. **One random question is shown immediately** and also **emailed** to the student. The
     24-hour window starts **when the question is displayed** (`questionShownAt`).
  4. **Same link, later:** paste the **Loom link** and the **transcript**.
- The page tells the student the expected Loom: point at the paper, explain each step in order,
  and **answer the question at the end**.

## 4. The random question
- Must be about a **step the student actually wrote**: never a new problem, never a step that
  isn't on their paper.
- Randomness: the AI lists the steps it can read, the server picks one **at random** (not the
  AI), and the server also picks the question type at random (why did you… / what if… / check
  your answer…). Two students with the same problem should normally get different questions.
- The question is checked against the student's own steps before it is shown. If no step can be
  read reliably, no question is generated and the submission is flagged for Ralph
  (`unreadable_work`) instead of guessing.
- Answered at the **end** of the Loom only. The rest of the walkthrough stays natural.

## 5. Timing and late policy
- **Days late** = due date → `photoReceivedAt` (the photo upload, step 3.2).
- Late caps (defaults from Settings `latePolicy`):
  - ≤ 1 week late → **max P3**
  - ≤ 2 weeks late → **max P2**
  - beyond → **Ralph's review**
- A **documented-exception** flag (with a reason) lifts the cap.
- Question window: `expiresAt = questionShownAt + 24h`. A transcript after that → flag
  `expired_answer`.
- **Missing answer:** no transcript by `expiresAt + 48h` → flag `missing_answer`.
- All flags put the submission in front of Ralph. **No flag lowers the level by itself.**
- The late-policy engine is a pure function in `server/lib/` with unit tests.

## 6. AI review card (one per submission)
- **Late cap applied** (days late, cap, or "exception: cap lifted").
- **Draft P-level** with a **short reason**, graded by the existing engine from the photo;
  the recommended level is min(AI level, cap) unless an exception is set.
- **Question answered?** answered / not answered / unclear, plus a one-line note.
- **Possible script reading** flag, based on the transcript compared with the written work:
  - overly polished or textbook wording that doesn't match the written work;
  - no hesitation or self-correction anywhere;
  - the transcript doesn't follow the order of the steps on the paper.
  Each triggered sign is listed so Ralph can see why.
- **Flags only.** Nothing on the card changes the level by itself.

## 7. Ralph's review screen
- The Loom opens **beside** the review card (Ralph clicks it; the link opens in his browser).
- One click: **confirm** the draft level, or **change** it.
- Confirm → posts to Blackboard (see "Decide before build" A).
- Stored: `recommendedLevel`, `confirmedLevel`, `confirmedAt`, `postedAt`.

## 8. Other messages to students
Feedback or anything beyond the three fixed templates (approval link, denial, question) is a
**draft** that Ralph approves before it goes out, in v1.

## 9. Privacy
- `ownerId` on every record (requests, approvals, submissions, review cards, sent-email log).
- **No student names or work in logs or commit messages.** Logs carry ids only.
- Student **name and email** are needed to send email and for Ralph to see who asked. They are
  stored **encrypted at rest** (server key in Railway, separate from the session secret), shown
  only to the owner, and **never sent to the AI**.
- **Photo:** redacted on the student's device before upload, using the same in-browser name
  redaction the Grader uses (`src/blind/redact.js`). If redaction fails, the upload stops
  (fail-closed), as in the Grader.
- **Transcript:** passed through `src/blind/textRedact.js` with the student's name (known from
  the request) before anything is sent to the AI. Spoken names are removed.
- **Loom link:** stored for Ralph only. Code never opens, fetches, previews or sends it to the AI.
- Vault, aliases, redaction and fail-closed for the Grader: unchanged.

## Data records (owner-scoped)
- **MakeupRequest:** ownerId, course, assignment, reasonCategory, note, encrypted name/email,
  status (pending / approved / denied), endDate, decidedAt.
- **MakeupLink:** ownerId, requestId, tokenHash, expiresAt, revokedAt.
- **MakeupSubmission:** ownerId, requestId, assignment, photoReceivedAt, daysLate, cap,
  capReason, exception, exceptionReason, question, questionStep, questionType,
  questionShownAt, expiresAt, transcriptReceivedAt, loomUrl, answerStatus, answerNote,
  reviewFlags (`missing_answer`, `expired_answer`, `possible_script_reading`,
  `unreadable_work`, …), recommendedLevel, levelReason, confirmedLevel, confirmedAt, postedAt.

## Decide before build (my recommendations)
**A. How "posts to Blackboard" works.** The Grader can't post to Blackboard directly today: it
builds a CSV that Ralph uploads. Blackboard sign-in is Microsoft SSO and is never scripted.
- *Recommended for v1:* confirmed levels go into the same **Blackboard CSV export** the Grader
  uses, so a batch of make-ups posts in one upload.
- *Later option:* a job on Ralph's Mac that posts through his own signed-in Blackboard browser
  profile, like the attendance sync. USJ's Original Course View goes read-only on 2027-01-01, so
  that would have to target Ultra.

**A is decided (2026-11-03):** confirmed levels go into the existing Blackboard upload file.

**B is decided (2026-11-03):** no new subdomain and no DNS change. Student pages are public
routes on the hub domain that need no hub sign-in:
- request form: `app.dm3agrader.com/makeup/request/<courseToken>`
- personal link: `app.dm3agrader.com/makeup/<token>`

## Out of scope for v1
- Absent-student follow-up (attendance → drafts). Later.
- Reading or analysing the video itself.
- Student accounts.
- Any automatic message beyond the three fixed templates.
- Blackboard as an intake channel.
