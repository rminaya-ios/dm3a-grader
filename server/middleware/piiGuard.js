// middleware/piiGuard.js
// DM3A Grader — Blind Grading Mode, server-side PII guard (spec §3.2)
//
// Belt-and-suspenders enforcement for the alias-only pipeline: reject any request
// body that carries a name-like field or direct identifier. The client is
// supposed to send course-scoped aliases only; this guarantees the server/DB/Claude
// never receive student PII even if a client bug leaks it.
//
// Matching is by EXACT key name (case-insensitive) — never substring — so
// legitimate keys like `assignmentName`, `courseName`, `lastActive`, `filename`
// are unaffected. Only bodies are scanned (GET/HEAD have none).

// Direct-identifier / name-like field names that must not appear in an
// alias-only payload.
const PII_KEYS = new Set([
  'name', 'fullname', 'firstname', 'lastname', 'middlename',
  'email', 'emailaddress',
  'studentname', 'studentemail',
  'student_id', 'studentid', 'bbusername', 'ssn',
]);

// Recursively collect any object keys (across nested objects/arrays) that match
// the PII denylist. Depth-bounded to avoid pathological payloads.
function findPiiKeys(value, found, depth) {
  if (depth > 6 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) findPiiKeys(item, found, depth + 1);
    return;
  }
  for (const key of Object.keys(value)) {
    if (PII_KEYS.has(key.toLowerCase())) found.add(key);
    findPiiKeys(value[key], found, depth + 1);
  }
}

// Hard guard: 400 if any PII-like field is present anywhere in the body.
// Never echoes values — only the offending field names — so it can't itself leak.
function piiGuard(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== 'object') return next();
  const found = new Set();
  findPiiKeys(body, found, 0);
  if (found.size > 0) {
    console.warn(`[PII GUARD] rejected ${req.method} ${req.originalUrl} — PII-like field(s): ${[...found].join(', ')}`);
    return res.status(400).json({
      error: 'PII field(s) not allowed on alias-only routes',
      fields: [...found],
      hint: 'Blind Grading transmits course-scoped aliases only; strip name/email/id fields client-side.',
    });
  }
  return next();
}

module.exports = { piiGuard, PII_KEYS };
