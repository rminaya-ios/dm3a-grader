// services/makeupAi.js
// DM3A Make-up — the three AI calls (docs/makeup-module-spec.md §4, §6).
//
//   readSteps      photo → the steps the student actually wrote
//   writeQuestion  one chosen step + question type → one question about it
//   reviewCard     photo + question + transcript → draft level, answered?,
//                  possible-script-reading signs
//
// The AI only ever sees REDACTED photos and a transcript with the student's
// name removed. It never sees the Loom link. The server, not the AI, picks the
// step and the question type (lib/makeupRules.js pickQuestion), and every
// output here is a recommendation: nothing changes a level on its own.
//
// Logs carry ids and counts only — never the work, the question or the transcript.

const Anthropic = require('@anthropic-ai/sdk');
const GradingEvent = require('../models/GradingEvent.js');
const { estimateCostUSD, extractUsage } = require('../utils/apiCost.js');
const { LEVELS, questionIsOnStep } = require('../lib/makeupRules.js');

const MODEL = 'claude-sonnet-4-6';
let _client = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function imageBlocks(pages) {
  return pages.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
}

function parseJson(text) {
  const t = String(text || '').replace(/```json|```/g, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI did not return JSON');
  return JSON.parse(t.slice(start, end + 1));
}

// One call + a cost record (identity-free, owner only). Never logs content.
async function call({ ownerId, system, content, maxTokens, temperature, purpose }) {
  const started = Date.now();
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content }],
  });
  const usage = extractUsage(response);
  GradingEvent.create({
    ownerId: ownerId || null,
    submissionCount: 0,
    gradingDurationMs: Date.now() - started,
    recordedVia: `makeup:${purpose}`,
    apiUsage: { ...usage, apiCalls: 1, estimatedCostUSD: estimateCostUSD(usage), model: response.model || MODEL },
  }).catch((err) => console.error('[makeup] cost record failed (ignored):', err.message));
  return response.content?.[0]?.text ?? '';
}

// ── 1. The steps the student wrote ──────────────────────────────────────────
const STEPS_SYSTEM = `You read photos of a student's handwritten math work. Respond with JSON only.

Transcribe the steps the student ACTUALLY WROTE, in the order they appear on the paper.
- One entry per written step (one line of work, one transformation, one computed value).
- "text" is what the student wrote, copied exactly (use plain text math, e.g. 2x + 3 = 7).
- "problem" is the problem number or label the step belongs to ("" if none is visible).
- Do NOT solve anything. Do NOT add steps the student did not write. Do NOT fix mistakes.
- Leave out printed instructions, problem statements and anything that is not student work.
- Mark a step "readable": false if you are not confident you read it correctly.
- If the page has a name or a blacked-out box, ignore it.

Format:
{"readable": true|false, "steps": [{"id": "1", "problem": "1a", "text": "2x + 3 = 7", "readable": true}]}
"readable" at the top is false when you cannot read the work reliably at all.`;

async function readSteps({ ownerId, pages }) {
  const text = await call({
    ownerId,
    system: STEPS_SYSTEM,
    content: [...imageBlocks(pages), { type: 'text', text: 'Transcribe the written steps as JSON.' }],
    maxTokens: 4000,
    temperature: 0,
    purpose: 'steps',
  });
  const out = parseJson(text);
  const steps = (Array.isArray(out.steps) ? out.steps : [])
    .slice(0, 200)
    .map((s, i) => ({
      id: String(s.id ?? i + 1).slice(0, 20),
      problem: String(s.problem ?? '').slice(0, 40),
      text: String(s.text ?? '').trim().slice(0, 300),
      readable: s.readable !== false,
    }))
    .filter((s) => s.text);
  return { readable: out.readable !== false && steps.some((s) => s.readable), steps };
}

// ── 2. One question about the chosen step ───────────────────────────────────
const QUESTION_SYSTEM = `You write ONE short follow-up question for a student about a step in their OWN written math work. Respond with JSON only.

Rules:
- The question is about the ONE step you are given, exactly as the student wrote it.
- Quote that step (or the key part of it) in double quotes inside the question, copied exactly.
- Never introduce a new problem, new numbers, or a step the student did not write.
- Ask in the style you are given (why / what if / how to check). Plain language, one sentence, under 40 words.
- Do not reveal whether the step is right or wrong. Do not mention any name.

Format: {"question": "...", "quote": "the exact text you quoted"}`;

async function writeQuestion({ ownerId, pages, step, type }) {
  const prompt = `The step (problem ${step.problem || '?'}): ${step.text}
Question style: ${type.label}
Write the question as JSON.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await call({
        ownerId,
        system: QUESTION_SYSTEM,
        content: [...imageBlocks(pages), { type: 'text', text: prompt }],
        maxTokens: 300,
        temperature: 1,
        purpose: 'question',
      });
      const out = parseJson(text);
      const quote = String(out.quote || '').trim();
      const question = String(out.question || '').trim();
      const squash = (s) => s.toLowerCase().replace(/\s+/g, '');
      // The quote must come from the student's step, and the question must contain it.
      if (quote.length >= 2 && squash(step.text).includes(squash(quote)) && questionIsOnStep(question, { quote })) {
        return question;
      }
    } catch (err) {
      console.error('[makeup] question attempt failed:', err.message);
    }
  }
  // Fallback: a fixed sentence built from the student's own step — always on-step.
  const ask = {
    why: 'why did you do this step?',
    what_if: 'what would change in your answer if this step were different, and why?',
    check: 'how could you check that this step is correct?',
  }[type.key];
  return `In your work on problem ${step.problem || 'this problem'}, you wrote "${step.text}" — ${ask}`;
}

// ── 3. The review card ──────────────────────────────────────────────────────
const SCRIPT_SIGNS = {
  polished_wording: 'Overly polished or textbook wording that does not match the written work',
  no_hesitation: 'No hesitation or self-correction anywhere',
  order_mismatch: 'The transcript does not follow the order of the steps on the paper',
};

const REVIEW_SYSTEM = `You prepare a review card for a math instructor who will WATCH the student's video and decide the grade. Respond with JSON only. You recommend; the instructor decides.

You get: photos of the student's written work (names blacked out), the follow-up question the student had to answer at the END of their video, and the video transcript (the student's name is replaced by [STUDENT]).

1. DRAFT LEVEL — grade the WRITTEN WORK with the DM3A mastery scale. Process matters more than the final answer.
   - P4 Mastery: correct, complete reasoning shown.
   - P3 Approaching: sound reasoning with a minor error or a small gap.
   - P2 Developing: partial understanding; significant errors or missing steps.
   - P1 Beginning: little correct reasoning shown.
   Read handwriting charitably; never lower a level because of unclear handwriting. The transcript may show understanding the paper does not, and you may mention that in the reason.
   "levelReason": one or two plain sentences naming what in the work earned or limited the level.

2. QUESTION — did the transcript actually answer the follow-up question?
   "answered": a real answer that fits the student's own step. "not_answered": no attempt, or it is about something else. "unclear": an attempt you cannot judge.
   "answerNote": one short sentence.

3. POSSIBLE SCRIPT READING — list only the signs you actually see, from:
   "polished_wording" (overly polished or textbook wording that doesn't match the written work),
   "no_hesitation" (no hesitation or self-correction anywhere),
   "order_mismatch" (the transcript doesn't follow the order of the steps on the paper).
   Use [] when none apply. These are flags for the instructor, not accusations.

Format:
{"aiLevel": "P1|P2|P3|P4", "levelReason": "...", "answerStatus": "answered|not_answered|unclear", "answerNote": "...", "scriptSigns": []}`;

async function reviewCard({ ownerId, pages, question, transcript }) {
  const text = await call({
    ownerId,
    system: REVIEW_SYSTEM,
    content: [
      ...imageBlocks(pages),
      { type: 'text', text: `Follow-up question:\n${question}\n\nVideo transcript:\n${transcript}\n\nReturn the review card as JSON.` },
    ],
    maxTokens: 1500,
    temperature: 0,
    purpose: 'review',
  });
  const out = parseJson(text);
  return {
    aiLevel: LEVELS.includes(out.aiLevel) ? out.aiLevel : null,
    levelReason: String(out.levelReason || '').slice(0, 600),
    answerStatus: ['answered', 'not_answered', 'unclear'].includes(out.answerStatus) ? out.answerStatus : 'unclear',
    answerNote: String(out.answerNote || '').slice(0, 300),
    scriptSigns: (Array.isArray(out.scriptSigns) ? out.scriptSigns : []).filter((s) => SCRIPT_SIGNS[s]),
  };
}

module.exports = { readSteps, writeQuestion, reviewCard, SCRIPT_SIGNS };
