// scripts/linkEmails.js
// DM3A Grader — let extra addresses (e.g. school accounts) sign in to ONE existing
// account. DRY RUN by default.
//
//   node scripts/linkEmails.js --account you@gmail.com --link a@school.edu,b@college.edu
//   node scripts/linkEmails.js --account you@gmail.com --link a@school.edu,b@college.edu --commit
//
// Refuses an address that is already another account's primary email or link —
// linking must never fold two people's data together. Nothing is deleted, and
// course codes, vaults and aliases are not touched: only User.linkedEmails changes.
//
// Requires MONGODB_URI in environment (or server/.env).

require('dotenv/config');
const mongoose = require('mongoose');
const User = require('../models/User.js');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

async function main() {
  const account = String(arg('account') || '').trim().toLowerCase();
  const links = String(arg('link') || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const commit = process.argv.includes('--commit');
  if (!account || !links.length) {
    console.error('Usage: node scripts/linkEmails.js --account <email> --link <email,email> [--commit]');
    process.exit(2);
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ email: account });
  if (!user) throw new Error(`No account with primary email ${account}`);

  const toAdd = [];
  for (const e of links) {
    if (e === user.email || user.linkedEmails.includes(e)) {
      console.log(`  already signs in here: ${e}`);
      continue;
    }
    const other = await User.findByLoginEmail(e, { email: 1 });
    if (other) throw new Error(`${e} already belongs to another account (${other.email}) — refusing.`);
    toAdd.push(e);
  }

  console.log(`Account ${user.email} (${user._id})`);
  console.log(`  linked now : ${user.linkedEmails.join(', ') || '(none)'}`);
  console.log(`  will add   : ${toAdd.join(', ') || '(nothing)'}`);

  if (commit && toAdd.length) {
    await User.updateOne({ _id: user._id }, { $addToSet: { linkedEmails: { $each: toAdd } } });
    console.log('COMMITTED.');
  } else if (!commit) {
    console.log('DRY RUN — nothing written. Re-run with --commit to apply.');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('ERROR:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
