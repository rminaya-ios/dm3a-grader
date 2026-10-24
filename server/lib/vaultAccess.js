// lib/vaultAccess.js
// DM3A Grader — who may read, replace or delete a course's roster vault.
//
// Until October 2026 the vault routes had no auth at all: anyone who guessed a
// course code could download, overwrite or delete a vault. The blob is
// encrypted, so a download alone leaks nothing quickly — but an overwrite or a
// delete destroys the alias mapping, and with no passphrase recovery that is
// permanent. So every vault route now needs a signed-in account, and only the
// vault's owner gets through.
//
// OWNERSHIP. A vault is keyed by course code, and course codes are only unique
// PER INSTRUCTOR (models/Course.js) — two accounts can both have "MATH11003". So
// "owns a course with that code" is not enough: the vault records its owner
// (RosterVault.ownerId) and that is what is checked.
//
// Vaults written before this change have no ownerId. One is CLAIMED by the first
// signed-in user who owns a course with that code — but only while exactly one
// account owns that code. If two do, nobody can claim it (409), because guessing
// would hand one instructor's students to another. That is a lockout, not a leak,
// and it is fixed by hand.
//
// Pure: no database, no Express. routes/courses.js gathers the facts and acts on
// the answer, so this rule is unit-tested on its own (test/vaultAccess.test.js).

// Facts:
//   method            'GET' | 'PUT' | 'DELETE'
//   userId            the signed-in account (string)
//   ownsCourse        that account has a Course with this code
//   vault             the existing vault doc, or null
//   courseOwnerCount  how many accounts have a Course with this code
//
// Answer: { allow: true, claim?: true } or { allow: false, status, error }.
function decideVaultAccess({ method, userId, ownsCourse, vault, courseOwnerCount }) {
  // Same answer for "not yours" and "doesn't exist", so the routes can't be used
  // to discover which course codes have vaults.
  const notFound = { allow: false, status: 404, error: 'no roster vault for this course in your account' };

  if (!userId) return { allow: false, status: 401, error: 'Not signed in.' };
  if (!ownsCourse) return notFound;

  if (!vault) {
    // Nothing to protect yet: creating (PUT) is the owner making their vault;
    // DELETE stays idempotent; GET is a plain 404.
    return method === 'GET' ? notFound : { allow: true };
  }

  if (vault.ownerId) {
    return String(vault.ownerId) === String(userId) ? { allow: true } : notFound;
  }

  // Legacy vault with no recorded owner.
  if (courseOwnerCount === 1) return { allow: true, claim: true };
  return {
    allow: false,
    status: 409,
    error: 'This vault has no recorded owner and more than one account uses this course code. Contact the administrator.',
  };
}

module.exports = { decideVaultAccess };
