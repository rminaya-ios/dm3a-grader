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

## Migration status

| Course | Path | State |
|---|---|---|
| MATH11003 | migrate (passphrase held) | **migrated & verified** 2026-11-19 — 19/19 vs `MATH11003-alias-cards.csv` (set A), confirmed in the browser |
| MATH11005 | migrate (passphrase held) | **migrated & verified** 2026-11-19 — 19/19 vs `MATH11005-alias-cards.csv`, confirmed in the browser |
| MATH1010050 | migrate (passphrase held) | **migrated & verified** 2026-11-19 — 24/24 vs `MATH1010050-alias-cards-V2pdf.csv`, two non-student cards accounted for |
| MATH0900-017 | rebuild from cards + Blackboard roster | unambiguous, but the course is not in use; lowest priority |

### Which card file is live

MATH11003 has three card PDFs resolving to two alias sets. `MATH11003_alias_restore.csv`
— the file used in the September recovery — matches `MATH11003-alias-cards.csv` (and the
identical `(1)`) on all 19 students, and `(2)` on none. So **set A is live** and `(2)` is
a superseded generation. The migration's own match report confirms this independently,
by comparing the decrypted vault against the cards.

MATH11005 has exactly one card PDF, `math11005-alias-cards.pdf` (lowercase), which had
no CSV until now. Converted with `scripts/alias-cards-to-csv.js` to
`MATH11005-alias-cards.csv`: 19 cards, one generation date (8/31/2026), no duplicate
aliases, and a 19/19 alias match against `MATH11005_alias_restore.csv` with no student on
only one side. **Unambiguous.**

MATH1010050 has two card files differing on all 26 students, both minted on 8 Sep 2026
(07:21 and 09:31). It has a passphrase after all, so it takes the migrate path, and the
ambiguity was resolved from disk without a physical card.

**Set B, `MATH1010050-alias-cards-V2pdf.csv`, is live.** The evidence is the app's own
output: the Oct 28 and Nov 9 run folders in `~/Downloads/DM3A_*MATH1010050*` contain
`<Last>_<First>_<ALIAS>_Report.pdf` files written from the unlocked vault. Across 22
students, 22 match set B and 0 match set A, and no student appears under two aliases, so
the vault was stable across both runs.

`MATH1010050_alias_restore.csv` disagrees — it matches set A 26/26 — but it is dated
Sep 27 13:39, the afternoon of the incident, and records a state the vault no longer
holds. **Lesson: a `*_alias_restore.csv` file is not evidence of the live alias set.** It
is a historical input, and for this course a misleading one. Graded-run output filenames
are the stronger witness because they are written from the decrypted vault at run time.
This does not cast doubt on MATH11003 or MATH11005: for those the authoritative check was
the migration's own report, which compared the decrypted vault against the cards in the
browser, and both came back clean.

### What the two migrations established

Both passphrase-held courses went through the three-step panel on the first attempt with
a clean report, so the flow needs no changes before the rebuild courses. Neither old
passphrase vault was touched: they remain on disk and in the browser as the fallback, and
nothing retires them until all four courses are across and Ralph says so.

Note that `verifiedAt` on the server is set by step 3 only. A green report is not a
confirmation; the migrated-but-unconfirmed state is deliberate and must not be treated as
the trustworthy copy.

### Cards that belong to nobody

The MATH1010050 report came back red on a roster that was in fact perfect: 24 of 24
students matched their card, and the two complaints were a withdrawn student and the
instructor's own `_PreviewUser` enrolment, used to check the student view in Blackboard
Ultra. Two different problems wearing the same red box.

The preview and instructor rows were a gap: `importBBRoster` has always run incoming rows
through `filterRosterRows`, but `checkMigrationAgainstCards` did not apply it to the CARD
file, so rows that were never students arrived as cards belonging to nobody. The card
file now gets the same filter, and what it skipped is listed under the report — never
dropped silently.

A withdrawal is not detectable by any code, so it is the instructor's call: each
unmatched card is ticked off individually in the panel, and step 3 stays locked until
every one is accounted for. What is NOT waiveable, at any effort: an alias that differs
from the card a student already holds, an ambiguous match, or a duplicate alias. Those
are the permanence invariant, and `migrationBlockers()` refuses them whatever is ticked.

The sign-off is logged as its own `verify` action carrying the aliases that were waved
through. The browser sends **aliases and counts, never prose** — a free-text note was
written first and a test immediately showed it would let a student name into the one
place that must never hold one. The server composes the sentence and discards anything
that is not alias-shaped.

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
