// lib/settingsRules.js
// DM3A Hub — validation for the per-owner Settings document (models/Settings.js).
//
// Pure: no database, no Express, so it is unit-tested on its own
// (test/settingsRules.test.js) and reusable by the Make-up module's late-policy
// engine next session.

const LEVELS = ['P1', 'P2', 'P3', 'P4'];
const BEYOND = ['instructor_review', ...LEVELS];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Takes the client's body; returns { ok: true, value } with ONLY known fields, or
// { ok: false, error } in plain language. Partial bodies are fine: a missing
// section is left out of `value` and stays as stored.
function validateSettings(body) {
  const b = body || {};
  const value = {};

  if (b.bands !== undefined) {
    const p4Min = num(b.bands?.p4Min);
    const p3Min = num(b.bands?.p3Min);
    const p2Min = num(b.bands?.p2Min);
    if ([p4Min, p3Min, p2Min].some((n) => Number.isNaN(n) || n < 0 || n > 100)) {
      return { ok: false, error: 'Band cut-offs must be numbers from 0 to 100.' };
    }
    if (!(p4Min > p3Min && p3Min > p2Min)) {
      return { ok: false, error: 'Band cut-offs must go down: P4 above P3 above P2.' };
    }
    value.bands = { p4Min, p3Min, p2Min };
  }

  if (b.bbPoints !== undefined) {
    const out = {};
    for (const k of ['P4', 'P3', 'P2', 'P1', 'talkToStudent']) {
      const n = num(b.bbPoints?.[k]);
      if (Number.isNaN(n) || n < 0 || n > 1000) {
        return { ok: false, error: `Blackboard points for ${k === 'talkToStudent' ? '"talk to student"' : k} must be a number from 0 to 1000.` };
      }
      out[k] = n;
    }
    value.bbPoints = out;
  }

  if (b.latePolicy !== undefined) {
    const rawWindows = Array.isArray(b.latePolicy?.windows) ? b.latePolicy.windows : null;
    if (!rawWindows || rawWindows.length > 10) {
      return { ok: false, error: 'Late policy needs a list of up to 10 windows.' };
    }
    const windows = [];
    for (const w of rawWindows) {
      const maxDaysLate = num(w?.maxDaysLate);
      if (Number.isNaN(maxDaysLate) || maxDaysLate < 0 || maxDaysLate > 365 || !Number.isInteger(maxDaysLate)) {
        return { ok: false, error: 'Each late window needs a whole number of days from 0 to 365.' };
      }
      if (!LEVELS.includes(w?.capLevel)) return { ok: false, error: 'Each late window needs a cap of P1, P2, P3 or P4.' };
      windows.push({ maxDaysLate, capLevel: w.capLevel });
    }
    for (let i = 1; i < windows.length; i++) {
      if (windows[i].maxDaysLate <= windows[i - 1].maxDaysLate) {
        return { ok: false, error: 'Late windows must be in order, shortest first.' };
      }
    }
    const beyond = b.latePolicy?.beyond ?? 'instructor_review';
    if (!BEYOND.includes(beyond)) return { ok: false, error: 'After the last window, choose instructor review or a level.' };
    value.latePolicy = { windows, beyond };
  }

  return { ok: true, value };
}

module.exports = { validateSettings, LEVELS };
