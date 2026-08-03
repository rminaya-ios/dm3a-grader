# DM3A Grader — Recent Changes (context for AI assistants & future work)

> ⚠️ **VERIFY AGAINST CURRENT CODE BEFORE ACTING.** This file is a point-in-time
> snapshot written ~2026-08-03. It describes intent and state as of then, not live
> truth. Code moves. Before you rely on any claim here — a file path, an endpoint, an
> env var, a behavior — confirm it against the current source and `git log`. Treat this
> as a map to *where to look*, not as ground truth.

Frontend: Vercel (`vercel --prod`, dm3agrader.com). Backend: Railway (auto-deploys on
git push to `main`). Verify a deploy by fetching the live `index-<hash>.js`.

## What shipped (≈2026-07-28 → 2026-08-03)

### 1. Name-zone redaction: universal + fail-closed
The handwritten-name blackout previously ran only for "secured" courses. It now runs on
**every** grading path (no-course / non-secured / secured) and in **both** the instructor
and student self-grade flows. Default ON; the only off-switch is a per-course opt-out
(logged). If redaction can't be verified, grading **fails closed** (aborts with a "please
retry" message) rather than sending an unredacted image. The student's filename never
leaves the browser (sent as `submission.<ext>`) and was scrubbed from all console logs;
error-row labels are generic.

### 2. Student Access Codes (instructor-linked unlimited Student Mode)
- Instructors generate/regenerate a per-course code `DM3A-XXXXXX` (admin-key gated — same
  key as `/api/admin`; stored in Upstash Redis). Regenerating invalidates the old code.
- Students enter the **optional** code → unlimited for the session with **no email
  collected** (the email field hides once a code validates). Blank/invalid → the unchanged
  free tier (5 grades per email); an invalid code shows a gentle note and never blocks.
- **Daily circuit breaker:** 100 submissions/code/day (resets at ET midnight). First time a
  code passes 60/day → one Telegram alert (existing bot). Usage tagged on `GradingEvent`
  (identity-free).
- `/code-check` is public but rate-limits only *wrong* guesses (a lab sharing one NAT IP
  with a valid code is never throttled).
- Fixed a pre-existing bug: student allowance/record calls used relative URLs (404) → now
  hit `SERVER_URL`, re-enabling the free-tier cap.

### 3. Server-side redaction (primary iOS fix)
Browser OCR (tesseract.js) silently **misses handwritten names on iOS**, which leaked a name
to the AI from an iPhone photo. Fix:
- Authoritative server pass `POST /redact` (`server/lib/serverRedact.js`, tesseract.js in
  Node + `sharp`), **fail-closed**. The flow is two-pass: browser best-effort (keeps the
  name in the browser on a computer) + server authoritative.
- **Positional safety net:** when OCR reads a page but finds no name, black out the top
  ~15% of the **first** page (catches handwritten names OCR can't read). Tunable via
  `REDACT_BAND_FRACTION`.
- `server/eng.traineddata` is committed so Railway needs no runtime download.

### 4. Self-healing clients
iPhone Safari ran a **cached old bundle** that skipped `/redact` and leaked. Added a
version-check in `src/App.jsx` that reloads once when the running bundle is stale (on load +
bfcache `pageshow`). A client cached *before* this needs one manual refresh to adopt it.

## Open items / recommendations
- **Handwritten-name redaction is imperfect.** A name low on the page, or on an angled /
  margin-heavy photo, can sit *below* the top strip and slip through. **Primary mitigation
  is workflow: tell students NOT to write their name — the class access code identifies
  them.** The strip is a backup. Durable technical fix = a server-side handwriting /
  text-region detector (deferred).
- **Paused (separate repo `~/dm3a-checkpoint`):** Phase-A security items — rotate the Atlas
  `checkpoint` DB password, tighten Atlas Network Access (remove `0.0.0.0/0`, add home IP),
  README TODO re Railway egress IPs. Not resumed.
