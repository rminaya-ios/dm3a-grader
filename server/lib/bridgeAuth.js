// lib/bridgeAuth.js
// DM3A Grader — server-to-server auth for the At-Risk Bridge (Phase 2).
//
// Guards POST /api/risk/bridge, the endpoint DM3A CheckPoint posts
// instructor-confirmed, alias-keyed levels to. Same policy as lib/adminAuth.js:
// read from env, trim both sides (Railway's variable editor likes to append a
// newline), constant-time compare, and FAIL CLOSED when unconfigured — an unset
// key means the endpoint is locked, never open.
//
// KNOWN LIMITATION (v1): a valid key authenticates *the sender*, not the
// instructor. The record's professorEmail is trusted as asserted, so anyone
// holding this key could attribute records to any instructor. Acceptable while
// both apps are operated by one person; the fix is SSO between the two apps.
// Documented in README.md and in CheckPoint's RUNBOOK §I.

const { safeEqual } = require('./adminAuth.js');

function requireBridgeKey(req, res, next) {
  const expected = String(process.env.RISK_BRIDGE_KEY || '').trim();
  if (!expected) {
    // Not configured => the bridge is off. Deliberately indistinguishable from
    // a bad key to a caller, but logged clearly on our side.
    console.warn('[RISK BRIDGE] rejected — RISK_BRIDGE_KEY is not configured on this server');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const provided = String(req.get('x-risk-bridge-key') || '').trim();
  if (!provided || !safeEqual(provided, expected)) {
    console.warn('[RISK BRIDGE] rejected — bad or missing x-risk-bridge-key'); // never log the key
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

module.exports = { requireBridgeKey };
