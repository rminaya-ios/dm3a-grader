// Unit tests for the roster-vault access rule (server/lib/vaultAccess.js).
// Node's built-in runner: `npm test`. No database, no network — the rule is pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vaultAccess from '../server/lib/vaultAccess.js';

const { decideVaultAccess } = vaultAccess;
const ME = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
const base = { method: 'GET', userId: ME, ownsCourse: true, vault: null, courseOwnerCount: 1 };

test('signed out is refused', () => {
  assert.equal(decideVaultAccess({ ...base, userId: undefined }).status, 401);
});

test('an account without the course gets 404, even if a vault exists', () => {
  const d = decideVaultAccess({ ...base, ownsCourse: false, vault: { ownerId: ME } });
  assert.deepEqual([d.allow, d.status], [false, 404]);
});

test('the owner reads, replaces and deletes their vault', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.deepEqual(decideVaultAccess({ ...base, method, vault: { ownerId: ME } }), { allow: true });
  }
});

test("another account with the same course code cannot touch the owner's vault", () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const d = decideVaultAccess({ ...base, method, userId: OTHER, vault: { ownerId: ME }, courseOwnerCount: 2 });
    assert.deepEqual([d.allow, d.status], [false, 404]);
  }
});

test('a legacy ownerless vault is claimed when exactly one account has the code', () => {
  assert.deepEqual(decideVaultAccess({ ...base, vault: { ownerId: null } }), { allow: true, claim: true });
});

test('a legacy vault is NOT claimable when two accounts share the code', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const d = decideVaultAccess({ ...base, method, vault: { ownerId: null }, courseOwnerCount: 2 });
    assert.deepEqual([d.allow, d.status], [false, 409]);
  }
});

test('no vault yet: GET is 404, PUT creates, DELETE is idempotent', () => {
  assert.equal(decideVaultAccess({ ...base, method: 'GET' }).status, 404);
  assert.deepEqual(decideVaultAccess({ ...base, method: 'PUT' }), { allow: true });
  assert.deepEqual(decideVaultAccess({ ...base, method: 'DELETE' }), { allow: true });
});
