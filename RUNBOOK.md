# DM3A Grader / Hub — RUNBOOK

Operational notes for the Grader (dm3agrader.com), its API (api.dm3agrader.com) and
the Hub (app.dm3agrader.com). Steps marked **Ralph** are clicks for a non-programmer.

---

## A. Where things run

| Piece | Host | Notes |
|---|---|---|
| Grader + Hub frontend | Vercel project `dm3a-grader` (team ralph-minayas-projects) | One project, two domains: `dm3agrader.com` (Grader) and `app.dm3agrader.com` (Hub). The hostname decides which page renders (`src/main.jsx`). |
| API | Railway project `ravishing-commitment`, service `dm3a-grader`, env `production` | Custom domain `api.dm3agrader.com`. **Railway account = rminaya@comcast.net via GitHub.** Signing in to Railway with Google lands in an empty trial account. |
| Database | MongoDB Atlas, database `dm3a` | |
| Google sign-in | Google Cloud project `dm3a-hub`, OAuth Web client "DM3A Hub Web" | App is in **Testing**; test users: ralph.minaya@gmail.com. |

## B. Shared sign-in (DM3A Hub)

One cookie signs you in to every `*.dm3agrader.com` tool.

- Cookie `dm3a_session`: HS256 JWT, `HttpOnly; Secure; SameSite=Lax; Domain=.dm3agrader.com`, 7 days.
- Issued ONLY by the API (`server/lib/auth.js`): email+password (`/api/auth/login`) or Google (`/api/auth/google`).
- Signed with **`HUB_JWT_SECRET`**. One value, stored in two places:
  - Railway variable `HUB_JWT_SECRET` (service `dm3a-grader`)
  - Mac Keychain: `security find-generic-password -s HUB_JWT_SECRET -a dm3a-hub -w`
- `JWT_SECRET` was the old name. It was **removed from Railway on 2026-11-02** after production
  sign-in was verified on `HUB_JWT_SECRET`. The code still reads it as a fallback only for
  old local `.env` files.
- Changing the secret signs everyone out everywhere. Change both places together.

### Who may sign in (config, no rebuild)

| Railway variable | Meaning |
|---|---|
| `GOOGLE_CLIENT_ID` | Web OAuth client id (public). Unset → Google sign-in refused; password login unaffected. |
| `SIGNUP_MODE` | `allowlist` (default — anything but `open`) or `open`. |
| `ALLOWED_EMAILS` | Comma list allowed to use Google sign-in in allowlist mode. |

Vercel needs `VITE_GOOGLE_CLIENT_ID` (same value) for the button to appear.

Google sign-in **never creates an account**. It matches a verified Google address to an
existing account by its primary email or a linked email.

### Linking another address to an account

School addresses (ctstate.edu, usj.edu) are Microsoft accounts, not Google — they sign in
with **email + the DM3A password**. To let an address sign in to an existing account:

```
cd ~/dm3a-grader/server
node scripts/linkEmails.js --account ralph.minaya@gmail.com --link new@school.edu           # dry run
node scripts/linkEmails.js --account ralph.minaya@gmail.com --link new@school.edu --commit  # apply
```

Currently linked to ralph.minaya@gmail.com: ralph.minaya@ctstate.edu, rminaya@usj.edu.

### Turning on another instructor (later)

1. They create an account at dm3agrader.com (email + password).
2. To allow Google sign-in too: add their address to `ALLOWED_EMAILS` in Railway, and add
   them as a test user in Google Cloud → Google Auth Platform → Audience (or publish the app).
3. Nothing else: every record is already owner-scoped (section C).

## C. Ownership — every record has an owner

- Owner = the account `_id`. Field is `userId` on Course, Submission, AtRiskFlag; `ownerId`
  on RosterVault, GradingEvent, Settings. All checks go through `server/lib/owner.js`
  (`getOwnerId`, `ownerFilter`).
- A request that doesn't match the owner gets **404** (never "forbidden"), so the API can't
  reveal what other accounts have.
- Records that arrive without a cookie (`/api/risk/record` from grading, `/api/risk/bridge`
  from CheckPoint) get their owner from `professorEmail` (primary or linked email).
- `/grade` sends no cookie, so new GradingEvents (cost telemetry, identity-free) stay
  unowned until that changes.
- Backfill (already run 2026-11-02; safe to re-run, a second run changes nothing):
  `node scripts/backfillOwner.js --default-owner ralph.minaya@gmail.com [--commit]`
- Proof: `test/ownerScope.test.js` runs the real server against an in-memory database and
  checks user B can't read, list or change user A's courses, vaults, results or settings.

## D. Settings (shared by every tool)

`GET/PUT /api/my/settings` — one document per owner, created with these defaults:

- Bands: P4 ≥ 90, P3 80–89, P2 60–79, P1 < 60
- Blackboard points: P4 → 90, P3 → 80, P2 → 60, P1 → 50, **26 = "talk to student"**
- Late policy: ≤ 7 days late → cap P3; ≤ 14 days → cap P2; later → instructor review

Edited from the Hub's Settings tile. Validation: `server/lib/settingsRules.js`.

## E. Other tools joining the shared sign-in

Copy `shared/auth/verifyHubSession.js` (zero dependencies) into the tool's server, set
`HUB_JWT_SECRET` there (same value), then:

```js
const { requireHubSession } = require('./verifyHubSession.js');
app.use('/api', requireHubSession());   // req.hubUser = { uid, email }; uid is the owner id
```

- The tool must be served from a `*.dm3agrader.com` subdomain, or the browser won't send the cookie.
- Its browser `fetch` calls need `credentials: 'include'`, and its CORS must list its own origin with `credentials: true`.
- Not signed in → send the user to `https://app.dm3agrader.com`.
- In an ESM repo, save the file as `verifyHubSession.cjs`.

Order (each when Ralph next works on that tool):
1. **CheckPoint** (`~/dm3a-checkpoint`, checkpoint.dm3agrader.com, own JWT today) → accept the shared cookie.
2. **Attendance** (dm3a-attendance.vercel.app, admin password) → move to `attendance.dm3agrader.com`, then the shared cookie.
3. **Grade Calculator** (dm3a-grade-calculator.vercel.app).

## F. Deploy

```
cd ~/dm3a-grader
npm test                       # must be all green
git push origin main           # Railway redeploys the API from main
npx vercel --prod --force      # frontend; if "not logged in": npx vercel login
```

Confirm the frontend bundle changed: `curl -s https://dm3agrader.com | grep -o 'assets/index-[^"]*\.js'`
before and after — the hash must differ.

Setting a Railway variable without redeploying: `railway variable set KEY=value --skip-deploys`.
Railway CLI login: `railway login --browserless`, then **Ralph** opens the link while signed
in to Railway **with GitHub** and clicks Authorize.

(`JWT_SECRET` was removed from Railway on 2026-11-02; only `HUB_JWT_SECRET` remains.)

## G. Hub domain (app.dm3agrader.com)

Live since 2026-11-02. Let's Encrypt certificate, renewed by Vercel automatically. Vercel
reports "valid configuration"; it *recommends* a newer project-specific CNAME
(`a938ca5b16547d65.vercel-dns-017.com`) — optional, the current record works.

- Vercel: project `dm3a-grader` → Settings → Domains → `app.dm3agrader.com`.
- DNS (Namecheap → dm3agrader.com → Advanced DNS): `CNAME` host `app` → `cname.vercel-dns.com.`
- Google OAuth client authorized JavaScript origins: `https://dm3agrader.com`,
  `https://app.dm3agrader.com`, `http://localhost:5173`.
- API CORS (`server/index.js`) lists `https://app.dm3agrader.com`.
- Local dev: the hub is at `http://localhost:5173/hub`.

## H. Make-up module (video make-ups by approval)
Spec: `docs/makeup-module-spec.md`. Hub → **Make-up** tile (badge = new requests + videos to review).

- **Set up a course:** Make-up → Assignments → add each assignment and its due date → Save.
  Copy the course's **request link** into Blackboard. Days late are counted from the due date
  you enter here to when the student's photo arrives.
- **Student pages** (public, no sign-in, on the hub domain):
  `app.dm3agrader.com/makeup/request/<courseToken>` (request form) and
  `app.dm3agrader.com/makeup/<token>` (personal link). Personal links expire on the end date
  you pick when approving, or **30 days** after approval if you pick none. "New link" replaces
  a lost one; "Stop link" ends it.
- **Automatic emails:** approval link, denial (office hours), and the question. They stay OFF
  until the wording is approved: `TEMPLATES_APPROVED` in `server/services/makeupEmails.js`.
  While off, the queue shows "Email to student: NOT sent" and shows the link to copy by hand.
- **Blackboard:** Make-up → Blackboard → download the Grade Center file (Work Offline →
  Download) → upload it there → choose the column → "Fill and download" → upload the new file
  in Blackboard. Points come from Settings → Blackboard points. Students are matched by email,
  then first + last name; anyone not matched is listed so you can enter them by hand.
- **Secret:** `MAKEUP_PII_KEY` (Railway + Mac Keychain, service `MAKEUP_PII_KEY`, account
  `dm3a-hub`) encrypts student names, emails and notes at rest. Without it the request form
  answers "Requests are not open yet" instead of storing anything. **Never change it once
  requests exist**: stored requests could no longer be read.
- **Privacy:** photos are redacted on the server (same fail-closed pass as the Grader) before
  they are stored or sent to the AI; transcripts have the student's name removed; the Loom
  link is never opened by code. Logs carry record ids only.
