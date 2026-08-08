// scripts/migrateToAccounts.js
// DM3A Grader — assign existing data to an instructor account (DRY RUN by default).
//
// Backfills `userId` on Submission and AtRiskFlag records whose professorEmail
// matches the target account. Safe to re-run: it only touches records that don't
// already have a userId, so a second run reports zero changes.
//
//   node scripts/migrateToAccounts.js --email you@example.com              # dry run
//   node scripts/migrateToAccounts.js --email you@example.com --commit     # write
//   node scripts/migrateToAccounts.js --email you@example.com --create-user
//
// COURSES ARE NOT MIGRATED HERE. Until instructor accounts existed, courses lived
// only in the browser's localStorage (`dm3a-courses`) — there is no course data in
// MongoDB for this script to read. Import them with the one-time "Import courses
// from this browser" button in the app, once per browser that holds courses.
//
// Requires MONGODB_URI in environment (or server/.env).

require('dotenv/config');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User.js');
const Submission = require('../models/Submission.js');
const AtRiskFlag = require('../models/AtRiskFlag.js');
const Course = require('../models/Course.js');
const { hashPassword } = require('../lib/auth.js');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const EMAIL = String(arg('email') || '').trim().toLowerCase();
const COMMIT = hasFlag('commit');
const CREATE_USER = hasFlag('create-user');

async function main() {
  if (!EMAIL) {
    console.error('Usage: node scripts/migrateToAccounts.js --email you@example.com [--commit] [--create-user]');
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set (expected in environment or server/.env).');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`\nConnected to MongoDB.`);
  console.log(COMMIT ? '*** COMMIT MODE — changes WILL be written ***' : '--- DRY RUN — nothing will be written (add --commit to apply) ---');
  console.log(`Target account: ${EMAIL}\n`);

  // ── 1. Resolve the account ────────────────────────────────────────────────
  let user = await User.findOne({ email: EMAIL });

  if (!user && !CREATE_USER) {
    console.error(`No account exists for ${EMAIL}.`);
    console.error('Either sign up in the app first, or re-run with --create-user to create it here');
    console.error('(a random password is set; use "Forgot password" to choose your own).');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!user) {
    if (COMMIT) {
      const temp = crypto.randomBytes(24).toString('base64url');
      user = await User.create({ email: EMAIL, passwordHash: await hashPassword(temp), name: '' });
      console.log(`Created account ${EMAIL} with a random password.`);
      console.log('   -> Use "Forgot password" in the app to set your own. The random one is not saved anywhere.\n');
    } else {
      console.log(`Would CREATE account ${EMAIL} (random password; reset via "Forgot password").\n`);
    }
  } else {
    console.log(`Found account ${EMAIL} (id ${user._id}).\n`);
  }

  const userId = user ? user._id : null;

  // ── 2. Backfill ownership ─────────────────────────────────────────────────
  // AtRiskFlag stores courseCode uppercased but professorEmail lowercased; match
  // case-insensitively on the address so a legacy mixed-case record isn't missed.
  const emailMatch = { $regex: `^${EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };

  const targets = [
    { name: 'Submission', model: Submission },
    { name: 'AtRiskFlag', model: AtRiskFlag },
  ];

  for (const { name, model } of targets) {
    const total = await model.countDocuments({ professorEmail: emailMatch });
    const filter = { professorEmail: emailMatch, $or: [{ userId: null }, { userId: { $exists: false } }] };
    const pending = await model.countDocuments(filter);
    const alreadyOwned = total - pending;

    if (!COMMIT) {
      console.log(`${name}: ${total} record(s) for this address — ${pending} would be assigned, ${alreadyOwned} already assigned.`);
      continue;
    }
    if (!pending) {
      console.log(`${name}: nothing to do (${total} record(s), all assigned).`);
      continue;
    }
    const result = await model.updateMany(filter, { $set: { userId } });
    console.log(`${name}: assigned ${result.modifiedCount} of ${total} record(s).`);
  }

  // ── 3. Report on courses (informational — nothing to migrate server-side) ──
  const courseCount = userId ? await Course.countDocuments({ userId }) : 0;
  console.log(`\nCourses on this account: ${courseCount}.`);
  if (!courseCount) {
    console.log('   Courses live in the browser until imported. Sign in, then use');
    console.log('   "Import courses from this browser" — once in each browser that has courses.');
  }

  // Orphan check: data belonging to some OTHER professor address, which this run
  // deliberately did not touch. Worth seeing before assuming the migration is done.
  const allEmails = await Submission.distinct('professorEmail').catch(() => []);
  const others = (allEmails || []).filter((e) => e && e.toLowerCase() !== EMAIL);
  if (others.length) {
    console.log(`\nHeads up — submissions also exist under ${others.length} other professor address(es):`);
    others.slice(0, 10).forEach((e) => console.log(`   ${e}`));
    if (others.length > 10) console.log(`   ...and ${others.length - 10} more`);
    console.log('   These were NOT assigned. Re-run with that address if they are also yours.');
  }

  console.log(COMMIT ? '\nMigration complete.\n' : '\nDry run complete — re-run with --commit to apply.\n');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\nMigration failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
