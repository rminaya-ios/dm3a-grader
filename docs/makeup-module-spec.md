# Make-up module — spec (Hub Phase 4; build next session)

The first tool built on the Hub foundation. A **mode inside the Grader** that reuses the
grading engine — not a separate app. Owner-scoped like everything else (`lib/owner.js`).

## Covers three things
1. **Absent-student follow-up** — who missed what. Drafts follow-up messages; **Ralph approves
   every message before it is sent**. Nothing sends on its own.
2. **Video-explanation make-up** — the student explains their work on video.
3. **The Loom idea** — the same intake, recorded with Loom.

## Intake (by email or Google Voice — NOT Blackboard)
The student sends three things:

| Item | Handling |
|---|---|
| Loom transcript (pasted text) | `src/blind/textRedact.js`, then the pre-send name assertion. Spoken names are redacted before anything leaves the browser. |
| Photo of the written work | The normal scan path (redaction, alias, piiGuard). |
| Video link | Stored for **Ralph's eyes only**. Code never opens, fetches, previews or sends it. |

## Late-policy engine
- Input: due date + submission date → days late.
- Look up the cap in the owner's Settings (`latePolicy.windows`, `latePolicy.beyond`).
  Defaults: ≤ 7 days → cap P3; ≤ 14 days → cap P2; later → instructor review.
- A **documented-exception** flag (plus a reason) lifts the cap.
- Store on the result: `cap`, `capReason`, `exception` (bool), `exceptionReason`, `daysLate`.
- Pure function in `server/lib/` with unit tests, like `settingsRules.js`.

## Grading flow
- The AI recommends a level (the existing engine, with the transcript as extra evidence).
- The final level = min(recommendation, cap), unless the exception flag is set.
- **The instructor confirms. Nothing posts to Blackboard without confirmation.** BB points come
  from Settings `bbPoints` (26 = "talk to student").

## Open design item
- **Anti-gaming follow-up question**: a random follow-up the student must answer, to show the
  explanation is their own. We only receive a transcript, so: how is the question delivered
  (reply email? a short live check-in? a second Loom?) and when (before or after the AI
  recommendation)? Decide before building.

## Privacy rules (unchanged)
Vault, aliases, redaction, fail-closed — untouched. Never log student names. The transcript is
student text and goes through the same redaction as everything else.
