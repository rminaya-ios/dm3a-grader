// models/Settings.js
// DM3A Hub — one settings document per instructor, shared by every tool
// (Grader, the hub's Settings tile, and next the Make-up module's late-policy
// engine). Created with the defaults below on first read (routes/settings.js).
//
// PRIVACY: instructor preferences only. Never student data.

const mongoose = require('mongoose');

// Defaults live here so the schema, the API and the tests agree on one source.
const DEFAULT_SETTINGS = Object.freeze({
  // DM3A performance bands: minimum percentage for each level. P1 is below P2.
  bands: { p4Min: 90, p3Min: 80, p2Min: 60 },
  // Blackboard points posted for each level. talkToStudent is the placeholder
  // that means "grade withheld — talk to the student".
  bbPoints: { P4: 90, P3: 80, P2: 60, P1: 50, talkToStudent: 26 },
  // Late policy: days late → highest level allowed. Beyond the last window the
  // work goes to instructor review instead of being auto-capped.
  latePolicy: {
    windows: [
      { maxDaysLate: 7, capLevel: 'P3' },
      { maxDaysLate: 14, capLevel: 'P2' },
    ],
    beyond: 'instructor_review',
  },
});

const LEVELS = ['P1', 'P2', 'P3', 'P4'];

const lateWindowSchema = new mongoose.Schema(
  {
    maxDaysLate: { type: Number, required: true, min: 0, max: 365 },
    capLevel: { type: String, enum: LEVELS, required: true },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    // Owning account (models/User.js). One document per owner.
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    bands: {
      p4Min: { type: Number, min: 0, max: 100, default: DEFAULT_SETTINGS.bands.p4Min },
      p3Min: { type: Number, min: 0, max: 100, default: DEFAULT_SETTINGS.bands.p3Min },
      p2Min: { type: Number, min: 0, max: 100, default: DEFAULT_SETTINGS.bands.p2Min },
    },
    bbPoints: {
      P4: { type: Number, min: 0, max: 1000, default: DEFAULT_SETTINGS.bbPoints.P4 },
      P3: { type: Number, min: 0, max: 1000, default: DEFAULT_SETTINGS.bbPoints.P3 },
      P2: { type: Number, min: 0, max: 1000, default: DEFAULT_SETTINGS.bbPoints.P2 },
      P1: { type: Number, min: 0, max: 1000, default: DEFAULT_SETTINGS.bbPoints.P1 },
      talkToStudent: { type: Number, min: 0, max: 1000, default: DEFAULT_SETTINGS.bbPoints.talkToStudent },
    },
    latePolicy: {
      windows: {
        type: [lateWindowSchema],
        default: () => DEFAULT_SETTINGS.latePolicy.windows.map((w) => ({ ...w })),
      },
      beyond: { type: String, enum: ['instructor_review', ...LEVELS], default: DEFAULT_SETTINGS.latePolicy.beyond },
    },
  },
  { timestamps: true }
);

settingsSchema.methods.toPublic = function toPublic() {
  const o = this.toObject();
  return {
    bands: { p4Min: o.bands.p4Min, p3Min: o.bands.p3Min, p2Min: o.bands.p2Min },
    bbPoints: { P4: o.bbPoints.P4, P3: o.bbPoints.P3, P2: o.bbPoints.P2, P1: o.bbPoints.P1, talkToStudent: o.bbPoints.talkToStudent },
    latePolicy: {
      windows: (o.latePolicy.windows || []).map((w) => ({ maxDaysLate: w.maxDaysLate, capLevel: w.capLevel })),
      beyond: o.latePolicy.beyond,
    },
    updatedAt: o.updatedAt,
  };
};

module.exports = mongoose.model('Settings', settingsSchema);
module.exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
module.exports.LEVELS = LEVELS;
