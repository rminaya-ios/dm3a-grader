# Roster Vault v2 — server-managed encryption (SPEC, in progress)

Replaces the passphrase vault. Instructors never type a passphrase or handle a backup
file. Names still never reach any AI request.

Status at 2026-11-18: **design locked, foundations built, nothing wired up.**
`server/lib/rosterCrypto.js` exists and is tested. No route, no migration, no UI switch.
`ROSTER_KEK` does not exist in Railway yet, and no live vault has been touched.

---

## Why the passphrase scheme is being replaced

It has no recovery path. On 2026-09-27 a lost passphrase for MATH1010050 forced a
re-secure, which minted a fresh alias set and orphaned every printed alias card the
students were holding. Recovering took a PDF-scraping script and a hand-verified merge.
The instructor must not be the single point of failure for their own students' data.

## Encryption (built)

Envelope, two layers, so the master key can rotate without reading or re-encrypting a
single roster:

```
roster JSON --AES-256-GCM--> ciphertext        (random 32-byte DATA KEY, fresh per record)
data key    --AES-256-GCM--> wrapped data key  (MASTER KEY = ROSTER_KEK)
```

Rotation re-wraps 32 bytes and returns the roster ciphertext byte-for-byte unchanged, so
**a rotation cannot alter or lose an alias.** Every record carries `keyVersion`; old keys
stay readable as `ROSTER_KEK_V<n>` during a rotation, so nothing has to be atomic.

Environment (Railway, plus a copy in macOS Keychain as `DM3A_ROSTER_KEK`):

| Variable | Meaning |
|---|---|
| `ROSTER_KEK` | current master key, 32 bytes, base64 or hex |
| `ROSTER_KEK_VERSION` | integer, default 1 — stamped on everything sealed now |
| `ROSTER_KEK_V<n>` | a previous master key, kept only until its records are rotated |

Fails closed: no key means seal and open throw, and routes answer 503 rather than
storing or returning clear text. Same rule as `lib/piiBox.js`.

## DECISION — the roster is keyed by Course `_id`, not by course code

`RosterVault.courseId` is a **globally unique** string holding the course code, but
`Course` is unique on `{userId, courseCode}` — two instructors may both have
"MATH11003". So the current schema can hold exactly one vault per code across the whole
system. The second instructor to secure that code gets a 403 from `lib/vaultAccess.js`
and can never create a vault at all.

This is latent today because there is one instructor. It becomes a hard lockout the
moment a second one is turned on (RUNBOOK §C), which is also exactly when one shared
roster across four tools starts to matter. v2 therefore keys the roster on the stable
`Course._id`, already exposed as `id` by the Course model.

Migration keeps `courseCode` on the record as a human label and for legacy lookup.

## DECISION — CheckPoint never decrypts and never stores names

Confirmed by Ralph, 2026-11-18.

- Students and the live/projected view: **aliases only**.
- The instructor review screen shows names beside aliases.
- CheckPoint **never holds `ROSTER_KEK`** and **never stores a name**. The instructor's
  signed-in browser fetches the decrypted roster from the Hub roster API (owner-only,
  audit-logged) and joins names to aliases **in the browser**.
- Projector mode hides names on every instructor screen.
- Names never enter any AI request.

Consequence: CheckPoint needs no crypto, no key, and no schema change — only the shared
Hub cookie (RUNBOOK §E) and a read call. This is the smallest possible integration and
it keeps the blast radius of a CheckPoint bug away from student names.

The same applies to attendance and make-up: one roster, read in the browser, joined in
the browser.

## Still to build

1. **Hub roster API** — owner-only read/write of the decrypted roster, keyed by course
   id, reusing `lib/owner.js` and `lib/vaultAccess.js`. 503 when `ROSTER_KEK` is absent.
2. **Alias permanence** — a server-side invariant: an existing student's alias can never
   change. New students get new aliases; dropped students are marked inactive, never
   deleted mid-term. This is the rule whose absence caused the September incident.
3. **Audit log** — who viewed names, when, for which course.
4. **Migration** — demo course with fake students first. Then, per live course
   (MATH11003, MATH11005, MATH1010050, MATH0900-017): the instructor unlocks the old
   vault once in the browser, the app re-encrypts under v2, and shows an alias-by-alias
   match report against `~/Downloads/*alias-cards*.csv`. **The old vault blob stays
   untouched until Ralph confirms each report.**
5. **Retire the passphrase UI** — passphrase prompts, the backup-key download and the
   "Secure roster" re-secure button. Last, not first.
6. **CheckPoint / attendance** — in their own repos, once the API exists.

## Privacy gate (unchanged, extended 2026-11-18)

Name-zone redaction for scans, text redaction for typed submissions, fail-closed, and a
pre-send assertion that now rejects roster **identifiers** (Username, Student ID) as well
as names, and checks the user prompt itself. Prompt instruction 6 no longer carries
`Student_<username>`; it names the alias. See `src/blind/textRedact.js`.
