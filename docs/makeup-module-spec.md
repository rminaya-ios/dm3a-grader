# Make-up module — spec (Hub Phase 4; build next session)

The first tool built on the Hub foundation. A **mode inside the Grader** that reuses the
grading engine — not a separate app. Owner-scoped like everything else (`lib/owner.js`).

**Ground rules for v1**
- The AI recommends; **Ralph confirms**. Nothing posts to Blackboard without his confirmation.
- **Every message to a student is a DRAFT** that Ralph approves and sends himself. The system
  never sends to a student on its own in v1.
- A problem with a submission (missing or expired answer, unclear transcript) is **flagged for
  Ralph's review — never an automatic penalty**.

## Covers three things
1. **Absent-student follow-up**: who missed what, with a drafted follow-up for each.
2. **Video-explanation make-up**: the student explains their work on video.
3. **The Loom idea**: the same flow, recorded with Loom.

## Intake: the two-step reply
Intake is by **email or Google Voice**, not Blackboard.

| Step | Who | What happens |
|---|---|---|
| **1. Work** | Student | Sends a **photo of the completed written work**. |
| **2. Question** | System, then Ralph | The photo goes through the normal scan path. The AI writes **ONE random follow-up question about that student's own work** (e.g. "In step 3, why did you divide both sides by 4 instead of subtracting?"). The reply is a **draft**; Ralph approves it and sends it. The question is **valid for 24 hours from when Ralph sends it**. |
| **3. Explain** | Student | Records a Loom explaining **each step**, and **ends by answering the question**. Sends the **transcript (pasted text) and the video link**. |
| **4. Check** | System | Checks that the transcript **actually answers the question**, then recommends a level. |
| **5. Confirm** | Ralph | Reviews, confirms or changes the level, and approves any reply to the student. Only then can it post. |

### Stored with the submission (owner-scoped)
- Follow-up: `question`, `questionGeneratedAt`, `sentAt` (when Ralph sent the draft), `expiresAt` (`sentAt + 24h`).
- Answer check: `answerStatus` = `answered` | `not_answered` | `unclear` | `late` | `missing`, plus a one-line `answerNote` from the AI.
- `reviewFlags`: a list, e.g. `missing_answer`, `expired_answer`, `unclear_transcript`. A flag
  puts the submission in Ralph's review queue. **It never lowers the level by itself.**
- Late policy: `daysLate`, `cap`, `capReason`, `exception`, `exceptionReason` (see below).
- Final: `recommendedLevel`, `confirmedLevel`, `confirmedAt`, `postedAt`.

### What "expired" means
The question expires 24 hours after **Ralph sends it** (not after it is drafted), because in
v1 a human sends it. A transcript received after `expiresAt` → `answerStatus: late` + flag
`expired_answer`. No transcript at all → nothing to grade yet; it stays in "waiting on
student". After a reasonable time it is flagged `missing_answer` for Ralph to decide.

### The question itself
- One question, generated from **that student's photo**: about a specific step, choice or
  result in their work, so it can't be answered from a generic solution.
- "Random": the AI picks a step at random from the steps it can read, and the prompt varies the
  question type (why / what if / check-your-answer). Two students with the same problem should
  normally get different questions.
- The question is about the math only. It must never contain the student's name; it goes
  through the same name check as everything else that leaves the browser.

## Privacy handling of each item
| Item | Handling |
|---|---|
| Photo of the written work | The normal scan path (redaction, alias, piiGuard). |
| Follow-up question | Generated from the redacted image; name assertion before it is shown or sent. |
| Loom transcript (pasted text) | `src/blind/textRedact.js` + the pre-send name assertion. **Spoken names are redacted** before anything leaves the browser. |
| Video link | Stored for **Ralph's eyes only**. Code never opens, fetches, previews or sends it. |

Vault, aliases, redaction, fail-closed: unchanged. Student names are never logged.

## Late-policy engine
- Input: due date + submission date (the photo in step 1) → `daysLate`.
- Look up the cap in the owner's Settings (`latePolicy.windows`, `latePolicy.beyond`).
  Defaults: ≤ 7 days → cap P3; ≤ 14 days → cap P2; later → instructor review.
- A **documented-exception** flag (with a reason) lifts the cap.
- Pure function in `server/lib/` with unit tests, like `settingsRules.js`.

## Grading
- The existing engine grades the photo. The transcript is extra evidence of understanding.
- The answer check (step 4) informs the recommendation and sets flags. It does not change the
  level on its own.
- Recommended level = min(AI level, late cap), unless an exception is set.
- Ralph confirms. BB points come from Settings `bbPoints` (26 = "talk to student").

## Absent-student follow-up
- From attendance (and missing submissions): who missed what.
- For each student, a drafted message (what was missed, how to make it up: the two-step
  reply above). Drafts only; Ralph approves and sends.

## Out of scope for v1
- Auto-sending anything to a student.
- Reading the video itself.
- Blackboard as an intake channel.
