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

## Atlas / MongoDB security hardening (2026-08-04)
Both apps share ONE Atlas cluster (`dm3a`, project "Project 0", M0/free). Two DB users:
`checkpoint` (CheckPoint app, `readWriteAnyDatabase`) and `ralphminaya_db_user` (Grader
app, `atlasAdmin`). CheckPoint is **not** deployed on Railway — it runs locally only.

- **DB password rotated (2026-08-04):** the `checkpoint` user's password (which had been
  exposed) was rotated in Atlas and updated in `~/dm3a-checkpoint/server/.env`. Verified by
  reconnecting via `npm run verify-pii`. Grader's `ralphminaya_db_user` was untouched.
- **Network Access tightened:** removed `0.0.0.0/0` (was open to the whole internet). The
  Atlas IP Access List now allows only:
  - `152.55.176.0/20` — Railway's own registered egress block (AS400940, Ashburn/US-East)
    that the Grader connects from. Verified: the Grader's egress IP shifts per restart
    (observed `152.55.180.48 / .21 / .89`) but always stays inside this `/20`, so a single
    `/32` would break but the `/20` holds.
  - `64.25.0.207/32` — Ralph's Mac Mini (home IP) for local scripts / Compass.
  Confirmed safe by restarting the Grader on a fresh container and watching it hold a DB
  connection (crash-free) through the `/20`, then a successful end-to-end grade.

### ⚠️ Failure signature if this network rule ever blocks a legitimate connection
Railway Hobby has **no** static egress, so the `/20` is a best-effort trust boundary —
Railway *could* move the Grader to a different block someday; and the Mac's home IP can
change. If either happens with `0.0.0.0/0` removed:
- **What you see:** grading on dm3agrader.com fails/errors; local `verify-pii`/Compass
  can't connect (timeout).
- **Railway logs (Grader service → Logs):** `❌ MongoDB connection error …` and the
  container **crash-loops** (startup DB connect calls `process.exit(1)` in
  `server/config/db.js`); the deployment shows as crashed/restarting.
- **Atlas side:** the connection is refused because the source IP isn't in the access list.
- **Two fixes:**
  1. **Immediate unblock:** in Atlas → Network Access → **+ ADD IP ADDRESS → "Allow Access
     from Anywhere" → Confirm** to temporarily re-add `0.0.0.0/0` and restore service.
  2. **Proper fix — re-check the range:** find the Grader's *current* egress IP, then
     allow-list its block. To find it: temporarily re-add a probe endpoint like the removed
     `GET /debug/egress-ip` (see git history, commit `ce0e822`) and `curl` it, **or** look up
     the IP's owner/CIDR with `whois <ip>` / ipinfo.io. Add that block to the Atlas access
     list, verify a fresh grade works, then remove `0.0.0.0/0` again.
- **Changed home IP (Mac):** update the `64.25.0.207/32` entry — find the new IP at
  https://api.ipify.org, EDIT that Atlas entry.

## Open items / recommendations
- **Handwritten-name redaction is imperfect.** A name low on the page, or on an angled /
  margin-heavy photo, can sit *below* the top strip and slip through. **Primary mitigation
  is workflow: tell students NOT to write their name — the class access code identifies
  them.** The strip is a backup. Durable technical fix = a server-side handwriting /
  text-region detector (deferred).
- **Least-privilege DB user (future):** the Grader connects as `ralphminaya_db_user`
  (`atlasAdmin`) — more power than an app needs. Consider a scoped `readWrite` user someday.
- **CheckPoint Phase-A security: DONE (2026-08-04)** — password rotated + network tightened
  (see the section above). The originally-planned "README TODO about Railway egress IPs" was
  never actually added; this `CHANGES.md` section is the durable record instead.
