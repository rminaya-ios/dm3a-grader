// lib/clients.js
// Shared Upstash Redis + Resend clients for the accounts feature.
//
// index.js deliberately keeps its own instances (trial system, access codes) —
// they work and the accounts work is not going to churn them. Both clients are
// stateless HTTP wrappers, so a second instance costs nothing: no sockets, no
// pool, no connection limit.

const { Redis } = require('@upstash/redis');
const { Resend } = require('resend');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Resend THROWS from its constructor when the key is missing, so build it lazily
// — otherwise merely requiring this file takes the whole server down in any
// environment without RESEND_API_KEY (e.g. a local dev machine). Callers already
// check for the key before sending; this just makes the failure mode a no-send
// instead of a boot crash.
let _resend = null;
function getResend() {
  if (!_resend && process.env.RESEND_API_KEY) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// Best-effort fixed-window limiter. Returns true when the caller is OVER the
// limit. Never throws and never blocks on a Redis outage — same policy as the
// access-code limiter in index.js: a limiter failure must not lock people out.
async function overLimit(key, max, windowSeconds) {
  try {
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const k = `rl:${key}:${bucket}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSeconds + 5);
    return n > max;
  } catch {
    return false;
  }
}

// First forwarded hop is the real client on Railway.
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

module.exports = { redis, getResend, overLimit, clientIp };
