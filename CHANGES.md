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

## Instructor accounts (2026-08-08) — BUILT, TESTED LOCALLY, **NOT DEPLOYED**
Replaces the single shared app password with per-instructor email+password logins.
Nothing is on Railway/Vercel yet — deploy is gated on the DNS step below.

- **Two new collections.** `models/User.js` (email, bcrypt hash cost 12, name, reset
  token *hash* + expiry) and `models/Course.js` (userId + the course metadata the
  frontend already used). Rosters are NOT in Course — student names stay in the
  client-encrypted `RosterVault`, untouched.
- **`/api/auth`** (`routes/auth.js`): register, login, logout, me, legacy-login,
  request-reset, reset. Session = JWT in an httpOnly cookie, 7 days, `SameSite=Lax`,
  `Secure` + `Domain=.dm3agrader.com` in production. `lib/auth.js` fails closed when
  `JWT_SECRET` is unset (same policy as `lib/adminAuth.js`).
- **`/api/my/courses`** (`routes/myCourses.js`): every query filtered by
  `req.user.id`. Unique index on `{userId, courseCode}` + an explicit duplicate
  check (don't trust the index alone). `POST /import` is idempotent.
- **The shared password was NOT in `.env`** — it was hardcoded at `src/App.jsx:596`
  (a literal `APP_PASSWORD` constant, unchanged since 2026-05-21) and therefore shipped in
  the public JS bundle. It now lives ONLY in server env as `LEGACY_SHARED_PASSWORD`,
  gated by `ALLOW_LEGACY_LOGIN`. Confirmed absent from `dist/` after rebuild.
  **A legacy session is deliberately account-less** (no uid): that password is
  public, so binding it to a real account would hand strangers that instructor's
  data. Legacy users keep browser-local courses — exactly the old behavior.
- **Courses moved server-side.** They previously lived only in localStorage
  (`dm3a-courses`) — which is why `RosterVault.js` says "there is no Course
  collection". The sync seam is the single existing `persistCourses()` in App.jsx,
  so the monolith barely changed. localStorage is now an offline cache. A one-time
  **"Import courses from this browser"** button moves them in (once per browser).
- **`scripts/migrateToAccounts.js`** — DRY RUN by default, `--commit` to write,
  `--create-user` to create the account. Backfills `userId` on Submission and
  AtRiskFlag by professorEmail (case-insensitive), idempotent. Both models gained an
  optional `userId` (default null, nothing queries it yet — the unauthenticated
  grading pipeline does not populate it, so `professorEmail` stays the operative key
  for NEW records). Dry run against production on 2026-08-08: **43 submissions, 0
  at-risk flags** for ralph.minaya@gmail.com.
- **Trial passwords still work** (`/validate-trial`, untouched) via the same
  fallback screen. Student Access Codes, piiGuard, roster vault, `/redact`,
  `/grade`, and the Redis limiters were not modified.
- **Incidental fix:** `new Resend(...)` was constructed eagerly in three places
  (`services/alertDispatcher.js`, `index.js`, and new code). Resend THROWS without an
  API key, so the server was **unbootable on any machine without `RESEND_API_KEY`** —
  i.e. every local dev environment. All three are now lazy. Railway behavior unchanged.

### Deploying this (NOT done — needs a DNS step first)
The site is `dm3agrader.com` but the API is on `up.railway.app`. A login cookie
between two different domains is a **third-party cookie, which Safari blocks** — so
accounts would silently fail on iPhone. Fix chosen: put the API on
`api.dm3agrader.com` so both are first-party to `dm3agrader.com`.
1. Add `api.dm3agrader.com` as a custom domain on the Railway service; add the CNAME
   it gives you at the registrar. Wait for it to resolve.
2. Set on Railway: `JWT_SECRET` (long random), `ALLOW_LEGACY_LOGIN=true`,
   `LEGACY_SHARED_PASSWORD` (the old shared password — recover it from
   `git show c7e2305:src/App.jsx | grep APP_PASSWORD` if needed),
   `APP_BASE_URL=https://dm3agrader.com`.
   See `server/.env.example`.
3. Deploy backend (push to main), THEN frontend (`vercel --prod`). The frontend
   points at `https://api.dm3agrader.com` — deploying it first yields a dead app.
4. Run the migration: dry run, read it, then `--commit`.
5. Only after accounts are confirmed working: `ALLOW_LEGACY_LOGIN=false`.

**Risk to remember:** accounts REQUIRE Mongo, but `config/db.js` is deliberately
fail-open so grading survives a DB outage. If Atlas goes down, nobody can sign in.
`ALLOW_LEGACY_LOGIN=true` is the break-glass — keep it on until confident.

## Atlas / MongoDB security hardening (2026-08-04 → 2026-08-06)
Both apps share ONE Atlas cluster (`dm3a`, project "Project 0", M0/free). Two DB users:
`checkpoint` (CheckPoint app, `readWriteAnyDatabase`) and `ralphminaya_db_user` (Grader
app, `atlasAdmin`). CheckPoint is **not** deployed on Railway — it runs locally only.

- **DB password rotated (2026-08-04) — KEPT, and it's the PRIMARY DB control.** The
  `checkpoint` user's exposed password was rotated in Atlas and updated in
  `~/dm3a-checkpoint/server/.env` (git-ignored → the ONLY copy; back it up in a password
  manager). Verified by reconnecting via `npm run verify-pii`. Grader's `ralphminaya_db_user`
  was untouched.

- **Network Access: intentionally left OPEN (`0.0.0.0/0`).** We tried to tighten it to
  Railway's egress range, but **Railway Hobby has no static egress and hops between multiple
  egress blocks** — the same Grader service was observed egressing from `152.55.180.x`
  (block `152.55.176.0/20`) at setup AND later from `162.220.234.121` (block
  `162.220.234.0/23`). A range rule that passed at setup later fell outside the allow-list on
  a redeploy and **took the whole backend down** (crash-loop → 502 → 000) on 2026-08-06. No
  fixed set of range rules can reliably cover Hobby egress. Options: (1) Railway **Pro** static
  IPs ($20/mo) to pin egress, or (2) keep `0.0.0.0/0` + rely on the strong rotated password.
  **Chose (2)** for the pilot — open network + strong SCRAM auth is a standard posture for
  M0/serverless that can't pin egress. Revisit Pro static IPs if the pilot scales.

- **Backend made resilient (fail-open) — the real durable fix.** `server/config/db.js` used
  to `process.exit(1)` on any Mongo failure, so a DB blip crash-looped the ENTIRE service.
  Now it logs + retries in the background and keeps serving (grading / access codes /
  redaction need no Mongo; only admin-stats & at-risk degrade until it reconnects). A future
  DB/network problem is now graceful degradation, not a full outage.

- **Uptime monitoring:** `GET /healthz` returns 200 whenever the server is up (DB state is
  informational only). An external monitor (UptimeRobot, free) pings it every few minutes and
  alerts via Telegram/email if it stops responding — so an outage is caught before students.

### If the DB / backend is ever unreachable — how to tell + fix
- **What you see:** admin dashboard "Failed to fetch" / CORS errors (a down or erroring
  backend returns no CORS headers — the CORS message is a *symptom*, not the cause). If the
  server itself is down, `/healthz` stops returning 200 and the uptime monitor alerts you.
- **Diagnose:** hit `https://dm3a-grader-production.up.railway.app/healthz` — 200 = server up
  (check `mongo`: 1=DB connected, 0/2=DB reconnecting). Non-200/no-response = server down →
  **Railway → Grader service → Logs**, look for `❌ MongoDB connection error …`.
- **Fixes:** confirm Atlas Network Access still contains `0.0.0.0/0`; confirm the password in
  the app's `MONGODB_URI` matches the Atlas user; the Mac home-IP entry can change (new IP at
  https://api.ipify.org). **Do NOT re-tighten to a Railway IP range** — Hobby egress is not
  fixed; that would need Pro static IPs, not range rules.

## Open items / recommendations
- **Handwritten-name redaction is imperfect.** A name low on the page, or on an angled /
  margin-heavy photo, can sit *below* the top strip and slip through. **Primary mitigation
  is workflow: tell students NOT to write their name — the class access code identifies
  them.** The strip is a backup. Durable technical fix = a server-side handwriting /
  text-region detector (deferred).
- **Least-privilege DB user (future):** the Grader connects as `ralphminaya_db_user`
  (`atlasAdmin`) — more power than an app needs. Consider a scoped `readWrite` user someday.
- **CheckPoint Phase-A security: DONE (2026-08-04 → 08-06)** — `checkpoint` password rotated;
  network tightening attempted but **reverted to `0.0.0.0/0` by decision** (Railway Hobby
  egress hops blocks → range rules caused an outage); backend made fail-open; `/healthz` +
  UptimeRobot monitoring added. Full story in the "Atlas / MongoDB security hardening" section
  above. The originally-planned "README TODO about Railway egress IPs" was never added; this
  file is the durable record instead.
