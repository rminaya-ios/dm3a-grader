// src/levels.js
// DM3A Grader — the ONE rule for a result's overall mastery level.
//
// The overall level is DERIVED from the dimension levels shown next to it, never
// taken from the model. The model's own overall disagreed with its own dimensions
// (Overall P1 beside P2/P2, Overall P4 beside P3/P3), and an instructor or a
// student reading that card can't tell which number is the grade.
//
// Rule: average the selected dimensions on the DM3A scale (P1=1 … P4=4) and round
// to the nearest level. An exact half rounds DOWN — P3/P4 is P3 — because a level
// is awarded once it is shown, not halfway there. The result is then held between
// the lowest and the highest dimension, so it can never fall below the weakest
// dimension or rise above the strongest.
//
// Accuracy is the one dimension the model does not set: it is the DM3A band of the
// share of problems at P3/P4 (computeProblemBand), as before.
//
// Every surface that shows an overall level — results card, tabs, distribution,
// instructor report, Student Report PDF, CSV export, the student self-check —
// reads it through effectiveOverall(), so an instructor's dimension override moves
// the overall with it, and an explicit overall override still wins.
//
// Pure, no React: unit-tested in test/levels.test.js.

// Bumped when the rule changes. Rows graded before this rule have no
// `levelVersion` and keep the overall they were saved with.
export const LEVEL_VERSION = 2;

const SCORE = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const LEVEL = ["P1", "P1", "P2", "P3", "P4"]; // index = score; P0 floors at P1

// Dimension key on a result -> its key in the instructor's override object.
export const DIM_OVERRIDE_KEY = {
  conceptualUnderstanding: "conceptual",
  problemSolving: "problemSolving",
  workShown: "workShown",
  accuracy: "accuracy",
};

// DM3A published bands, applied to a percentage.
export const DM3A_BAND = (pct) => (pct >= 90 ? "P4" : pct >= 80 ? "P3" : pct >= 60 ? "P2" : "P1");

// Band of the share of problems at mastery (P3/P4), or null with nothing graded.
export function computeProblemBand(student) {
  const graded = (student?.problems || []).filter((p) => p && p.tier && p.tier !== "N/A" && p.tier !== "P0");
  if (!graded.length) return null;
  const mastery = graded.filter((p) => p.tier === "P3" || p.tier === "P4").length;
  return DM3A_BAND(Math.round((mastery / graded.length) * 100));
}

// Overall from a { key: "P1".."P4" } dimensions object. Values that are not a
// P-level ("N/A", missing) are ignored. null when there is nothing to derive from.
export function deriveOverall(dimensions) {
  const scores = Object.values(dimensions || {})
    .map((v) => SCORE[String(v || "").trim().toUpperCase()])
    .filter((n) => n !== undefined);
  if (!scores.length) return null;
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const rounded = Math.ceil(avg - 0.5); // nearest; exact half rounds down
  return LEVEL[Math.min(hi, Math.max(lo, rounded))];
}

// Sets accuracy and the overall on a freshly graded, gradeable row, and stamps
// LEVEL_VERSION. The model's values are kept as `modelTier` / `dimensionsModel` so
// a disagreement stays inspectable. Callers skip ungraded rows (ERROR/HEIC/DOCX).
export function applyLevelRule(r) {
  if (!r) return r;
  const out = { ...r, modelTier: r.modelTier ?? r.overallTier };
  const band = computeProblemBand(r);
  // Whether accuracy is enabled is read off `dimensions.accuracy` being present:
  // this runs after the switched-off dimensions have been dropped.
  if (band && r.dimensions && r.dimensions.accuracy != null) {
    out.dimensions = { ...r.dimensions, accuracy: band };
    out.dimensionsModel = { ...(r.dimensionsModel || {}), accuracy: r.dimensions.accuracy };
  }
  // No dimensions at all: fall back to the problem band — still arithmetic, never
  // the model's overall. With neither, the row is left as the model sent it.
  const overall = deriveOverall(out.dimensions) || band;
  if (!overall) return r;
  out.overallTier = overall;
  out.levelVersion = LEVEL_VERSION;
  return out;
}

// The dimensions as displayed: each present dimension, with an instructor
// override in place of the graded value.
export function effectiveDimensions(student, ov = {}) {
  const out = {};
  for (const [key, val] of Object.entries(student?.dimensions || {})) {
    if (val == null) continue;
    out[key] = ov[DIM_OVERRIDE_KEY[key]] || val;
  }
  return out;
}

// The overall level to show and export for a row. An explicit overall override
// wins. Rows graded under this rule re-derive from the displayed dimensions, so a
// dimension override moves the overall too. Older rows and ungraded rows (no
// levelVersion) show what they were saved with.
export function effectiveOverall(student, ov = {}) {
  if (ov.overall) return ov.overall;
  if (student && student.levelVersion >= LEVEL_VERSION) {
    return deriveOverall(effectiveDimensions(student, ov)) || student.overallTier;
  }
  return student ? student.overallTier : undefined;
}
