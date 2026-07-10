// models/GradingEvent.js
// DM3A Grader — Grading Event (API cost / volume attribution)
//
// A lightweight, IDENTITY-FREE record written UNCONDITIONALLY on every
// successful Anthropic call in the backend (main /grade call + the Student
// Mode gatekeeper). It deliberately carries NO student identity, so it does
// not touch the Submission schema's required identity fields.
//
// Dashboard usage:
//   - Volume + cost AGGREGATES (overview, activity time series, cost-by-day,
//     cost-by-recordedVia, avg cost per submission, avg grading duration)
//     come from THIS collection.
//   - Mastery + per-student / per-course detail comes from Submission.

const mongoose = require('mongoose');

const apiUsageSchema = new mongoose.Schema(
  {
    inputTokens:         { type: Number, default: 0 },
    outputTokens:        { type: Number, default: 0 },
    cacheCreationTokens: { type: Number, default: 0 },
    cacheReadTokens:     { type: Number, default: 0 },
    apiCalls:            { type: Number, default: 0 },
    estimatedCostUSD:    { type: Number, default: 0 },
    model:               { type: String, default: '' }, // e.g. 'claude-sonnet-4-6'
  },
  { _id: false }
);

const gradingEventSchema = new mongoose.Schema(
  {
    // Number of students in the graded batch (0 for gatekeeper detection calls,
    // which grade nothing). Best-effort; derived from the parsed AI result.
    submissionCount: { type: Number, default: 0 },

    // Wall-clock duration of the request handler up to the response, in ms.
    gradingDurationMs: { type: Number, default: 0 },

    // Full token usage + estimated cost for the Anthropic call(s) this event
    // represents.
    apiUsage: { type: apiUsageSchema, default: () => ({}) },

    // Which backend path produced this event:
    //   'auto'       -> main /grade grading call
    //   'gatekeeper' -> Student Mode /detect-work work-detection call
    recordedVia: { type: String, default: 'auto', index: true },
  },
  {
    timestamps: true, // createdAt is the event timestamp used by all time-series
  }
);

// Time-series aggregations group/sort on createdAt.
gradingEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('GradingEvent', gradingEventSchema);
