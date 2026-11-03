// lib/owner.js
// DM3A Grader — the ONE place that says who owns a request or a record.
//
// Every owner-scoped read and write goes through these helpers, so "which
// account is this?" has exactly one answer across the app. The owner is an
// account _id (models/User.js). Collections spell the field two ways for
// historical reasons — `userId` (Course, Submission, AtRiskFlag) and `ownerId`
// (RosterVault, GradingEvent, Settings) — and that is the only difference.
//
// Rule: a request with no owner, or a record that isn't the caller's, is a 404
// (never a 403), so the API can't be used to discover other accounts' data.

const User = require('../models/User.js');

// The signed-in account for this request (set by lib/auth.js requireAuth /
// attachSession), or null.
function getOwnerId(req) {
  const id = req && req.user && req.user.id;
  return id ? String(id) : null;
}

// Mongo filter limiting a query to the caller's records. Throws if there is no
// owner, so a route that forgot requireAuth fails loudly instead of matching
// every record whose owner field is null.
function ownerFilter(req, field = 'userId') {
  const id = getOwnerId(req);
  if (!id) throw new Error('ownerFilter called without a signed-in owner');
  return { [field]: id };
}

// Owner for a record that arrives WITHOUT a session (the grading recorder and
// the CheckPoint bridge send no cookie): the account whose primary or linked
// email is the record's professorEmail. Cached briefly — one lookup per batch,
// not per student. null when no account matches (the record stays unowned and
// invisible to every account, which is the safe direction).
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // email -> { id, at }

async function ownerIdForProfessorEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const hit = cache.get(e);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.id;
  const user = await User.findByLoginEmail(e, { _id: 1 });
  const id = user ? String(user._id) : null;
  cache.set(e, { id, at: Date.now() });
  return id;
}

function clearOwnerCache() {
  cache.clear();
}

module.exports = { getOwnerId, ownerFilter, ownerIdForProfessorEmail, clearOwnerCache };
