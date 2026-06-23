// scripts/verifyRiskRules.js
// DM3A Grader — Risk rule verification (DRY RUN)
// Reads the seeded test students from MongoDB and runs the rule engine
// (runRules) against each student's history. Does NOT create flags and
// does NOT dispatch any alerts (no emails / no Telegram) — pure read + logic.
//
// Run AFTER seedRiskData.js:
//   node scripts/seedRiskData.js
//   node scripts/verifyRiskRules.js
//
// Requires: MONGODB_URI in environment (or server/.env)

require('dotenv/config');
const mongoose = require('mongoose');
const { getStudentHistory } = require('../services/submissionService.js');
const { runRules } = require('../services/riskEvaluator.js');

const COURSE = 'MATH110-03';

// Expected outcome per seeded student (see seedRiskData.js).
const expectations = [
  { email: 'test.r2@dm3a.dev', expect: 'R2', note: 'two consecutive P1s' },
  { email: 'test.r3@dm3a.dev', expect: 'R3', note: 'declining P3→P2→P1' },
  { email: 'test.r4@dm3a.dev', expect: 'R4', note: 'high-weight P1' },
  { email: 'test.r6@dm3a.dev', expect: 'R6', note: 'P1 on first assignment' },
  { email: 'test.r1@dm3a.dev', expect: 'R1', note: '7-day inactivity' },
  { email: 'test.ok@dm3a.dev', expect: null, note: 'on track — no flag' },
];

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB (dry-run verification — no flags, no alerts)\n');

    let pass = 0;
    for (const { email, expect, note } of expectations) {
      const history = await getStudentHistory(email, COURSE, 10);
      if (history.length === 0) {
        console.log(`❓ ${email} — no submissions found (did you run the seed?)`);
        continue;
      }
      const triggered = runRules(history, history[0]); // history[0] = most recent
      const actual = triggered ? triggered.rule : null;
      const ok = actual === expect;
      if (ok) pass++;
      const icon = ok ? '✅' : '❌';
      console.log(
        `${icon} ${email.padEnd(20)} expected ${String(expect).padEnd(4)} got ${String(actual).padEnd(4)}  (${note})` +
          (triggered ? `\n      → ${triggered.flagState} · ${triggered.description}` : '')
      );
    }

    console.log(`\n${pass}/${expectations.length} rules matched expectations.`);
    if (pass !== expectations.length) {
      console.log(
        'Note: rule precedence in runRules is R6 → R3 → R2 → R4 → R1. A case that\n' +
        'satisfies an earlier rule will report that rule first.'
      );
    }
  } catch (err) {
    console.error('❌ Verification error:', err.message);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed.');
  }
};

run();
