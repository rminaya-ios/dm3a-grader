// scripts/backfillOwner.js
// DM3A Hub Phase 2 — give every existing record an owner. DRY RUN by default.
//
//   node scripts/backfillOwner.js --default-owner you@gmail.com            # dry run
//   node scripts/backfillOwner.js --default-owner you@gmail.com --commit   # write
//
// What it assigns (only records whose owner field is empty — re-running is safe
// and a second run reports zero):
//   Submission / AtRiskFlag  .userId  ← the account whose primary or LINKED email
//                                       is the record's professorEmail
//   RosterVault              .ownerId ← the one account owning a Course with that
//                                       code; else --default-owner
//   GradingEvent             .ownerId ← --default-owner (these are identity-free,
//                                       with no professor on them at all)
// Course.userId is already required, so courses are only counted.
//
// Never touches a vault's blob: passphrases and aliases cannot change. Never
// deletes anything. --default-owner is refused when more than one account
// exists, because "everything unowned is mine" is only true with one instructor.
//
// Requires MONGODB_URI in environment (or server/.env).

require('dotenv/config');
const mongoose = require('mongoose');
const User = require('../models/User.js');
const Course = require('../models/Course.js');
const Submission = require('../models/Submission.js');
const AtRiskFlag = require('../models/AtRiskFlag.js');
const RosterVault = require('../models/RosterVault.js');
const GradingEvent = require('../models/GradingEvent.js');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

const UNOWNED = (field) => ({ $or: [{ [field]: null }, { [field]: { $exists: false } }] });

async function main() {
  const commit = process.argv.includes('--commit');
  const defaultEmail = String(arg('default-owner') || '').trim().toLowerCase();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI);

  const userCount = await User.countDocuments();
  let defaultOwner = null;
  if (defaultEmail) {
    if (userCount > 1) throw new Error(`--default-owner refused: ${userCount} accounts exist.`);
    defaultOwner = await User.findByLoginEmail(defaultEmail, { email: 1 });
    if (!defaultOwner) throw new Error(`No account signs in as ${defaultEmail}`);
  }

  console.log(`${commit ? 'COMMIT' : 'DRY RUN'} — ${userCount} account(s)` +
    (defaultOwner ? `, default owner ${defaultOwner.email} (${defaultOwner._id})` : ''));

  // ── Submission + AtRiskFlag, by professorEmail ─────────────────────────────
  for (const [label, Model] of [['submissions', Submission], ['atriskflags', AtRiskFlag]]) {
    const emails = await Model.distinct('professorEmail', UNOWNED('userId'));
    let assigned = 0;
    let unmatched = 0;
    for (const email of emails) {
      const filter = { ...UNOWNED('userId'), professorEmail: email };
      const n = await Model.countDocuments(filter);
      const owner = await User.findByLoginEmail(email, { email: 1 });
      if (!owner) { unmatched += n; console.log(`  ${label}: ${n} under ${email} → NO ACCOUNT (left unowned)`); continue; }
      console.log(`  ${label}: ${n} under ${email} → ${owner.email}`);
      assigned += n;
      if (commit) await Model.updateMany(filter, { $set: { userId: owner._id } });
    }
    const total = await Model.countDocuments();
    console.log(`  ${label}: total ${total}, to assign ${assigned}, unmatched ${unmatched}`);
  }

  // ── RosterVault ────────────────────────────────────────────────────────────
  const vaults = await RosterVault.find(UNOWNED('ownerId'), { courseId: 1 }).lean();
  for (const v of vaults) {
    const owners = await Course.distinct('userId', { courseCode: v.courseId });
    let ownerId = owners.length === 1 ? owners[0] : null;
    let why = owners.length === 1 ? 'owns that course' : `${owners.length} course owners`;
    if (!ownerId && defaultOwner && owners.length === 0) { ownerId = defaultOwner._id; why = 'no course with that code → default owner'; }
    console.log(`  rostervaults: ${v.courseId} → ${ownerId || 'LEFT UNOWNED'} (${why})`);
    // $set on ownerId ONLY — the encrypted blob is never read or rewritten.
    if (commit && ownerId) await RosterVault.updateOne({ _id: v._id, ...UNOWNED('ownerId') }, { $set: { ownerId } });
  }
  console.log(`  rostervaults: total ${await RosterVault.countDocuments()}, unowned ${vaults.length}`);

  // ── GradingEvent ───────────────────────────────────────────────────────────
  const events = await GradingEvent.countDocuments(UNOWNED('ownerId'));
  console.log(`  gradingevents: total ${await GradingEvent.countDocuments()}, unowned ${events}` +
    (defaultOwner ? ` → ${defaultOwner.email}` : ' (skipped: no --default-owner)'));
  if (commit && defaultOwner && events) {
    await GradingEvent.updateMany(UNOWNED('ownerId'), { $set: { ownerId: defaultOwner._id } });
  }

  // ── Course (already required) ──────────────────────────────────────────────
  console.log(`  courses: total ${await Course.countDocuments()}, without owner ${await Course.countDocuments(UNOWNED('userId'))}`);

  if (!commit) console.log('DRY RUN — nothing written. Re-run with --commit to apply.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
