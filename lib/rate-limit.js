/**
 * lib/rate-limit.js — In-memory token bucket.
 *
 * Zero-dependency, single-process. Fine for v1 scale and single replicas.
 * If the app ever runs multi-replica, swap this for Redis or a proper
 * distributed limiter.
 *
 * Usage:
 *   const rl = require('./lib/rate-limit');
 *   if (!rl.consume('createUser:' + ip, 5, 60 * 60 * 1000)) {
 *     return res.status(429).json({ error: 'rate_limited' });
 *   }
 */

const buckets = new Map();            // key → { count, resetAt }
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60 * 1000;  // prune stale buckets every minute

function sweep(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}

/**
 * Consume one token from the bucket identified by `key`.
 * Returns true if allowed, false if over the limit for the window.
 *
 *   limit  – max requests per window
 *   windowMs – rolling window size in milliseconds
 */
function consume(key, limit, windowMs) {
  const now = Date.now();
  sweep(now);
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 1, resetAt: now + windowMs };
    buckets.set(key, b);
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Get current bucket state for observability. */
function inspect(key) {
  const b = buckets.get(key);
  if (!b) return null;
  const now = Date.now();
  if (b.resetAt <= now) return null;
  return { count: b.count, resetInMs: b.resetAt - now };
}

/** Reset a specific key (test support). */
function reset(key) { buckets.delete(key); }

/** Clear all buckets (test support). */
function clearAll() { buckets.clear(); }

function size() { return buckets.size; }

module.exports = { consume, inspect, reset, clearAll, size };
