// Updated: 2026-05-23
// lib/rate-limit.js
//
// Shared rate-limit helper backed by Upstash Redis.
//
// Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your Vercel
// environment to enable. If either var is missing (e.g. on local dev or a
// preview deploy without the integration wired up) the limiter fails OPEN —
// requests are allowed through and a warning is logged once per process.
//
// Install the SDKs:
//   npm install @upstash/ratelimit @upstash/redis
//
// Usage:
//   import { enforceRateLimit } from './lib/rate-limit.js';
//   if (await enforceRateLimit(req, res, {
//     name:  'create-party',
//     limit: 10,
//     window: '1 h',
//   })) return;
//
// `enforceRateLimit` writes the 429 response itself and returns true when the
// request was blocked. Use the lower-level `checkRateLimit` if you'd rather
// shape the error response yourself.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';

const url   = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (url && token) ? new Redis({ url, token }) : null;

let warned = false;
function warnDisabled() {
  if (warned) return;
  warned = true;
  console.warn(
    '[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set ' +
    '— rate limiting is DISABLED for this process'
  );
}

// Cache limiters by config so we don't recreate one per request.
const limiters = new Map();

function getLimiter({ name, limit, window }) {
  if (!redis) return null;
  const cacheKey = `${name}|${limit}|${window}`;
  if (!limiters.has(cacheKey)) {
    limiters.set(cacheKey, new Ratelimit({
      redis,
      limiter:   Ratelimit.slidingWindow(limit, window),
      analytics: false,
      prefix:    `rl:${name}`,
    }));
  }
  return limiters.get(cacheKey);
}

// Best-effort client identifier. Vercel sets x-forwarded-for; the first hop
// in the chain is the real client. Fall back to x-real-ip and then to the
// socket address.
function clientId(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers?.['x-real-ip']
      || req.socket?.remoteAddress
      || 'unknown';
}

/**
 * Check whether a request is within the configured limit.
 *
 * @param {object} req
 * @param {object} opts
 * @param {string} opts.name    Bucket name, e.g. "create-party".
 * @param {number} opts.limit   Max requests in the window.
 * @param {string} opts.window  Window expression — "10 s", "1 m", "1 h", "1 d".
 * @param {string} [opts.key]   Optional extra key (e.g. party_id) combined with the IP.
 * @returns {Promise<{ok:boolean, retryAfter?:number, remaining?:number, limit?:number}>}
 */
export async function checkRateLimit(req, { name, limit, window, key }) {
  const limiter = getLimiter({ name, limit, window });
  if (!limiter) { warnDisabled(); return { ok: true }; }

  const ip      = clientId(req);
  const subject = key ? `${ip}:${key}` : ip;

  try {
    const r = await limiter.limit(subject);
    if (r.success) {
      return { ok: true, remaining: r.remaining, limit: r.limit };
    }
    const retryAfter = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
    return { ok: false, retryAfter, remaining: 0, limit: r.limit };
  } catch (err) {
    // Fail open on Redis errors — don't take the whole API down because the
    // limiter had a bad day. Log so we notice in observability.
    console.error('[rate-limit] limiter error:', err.message);
    return { ok: true };
  }
}

/**
 * Convenience wrapper. Writes the 429 response itself and returns `true`
 * when the request was blocked.
 *
 * Sets X-RateLimit-Limit / X-RateLimit-Remaining headers on success and
 * Retry-After on 429s, so clients can back off intelligently.
 */
export async function enforceRateLimit(req, res, opts) {
  const result = await checkRateLimit(req, opts);

  if (result.ok) {
    if (result.limit !== undefined) {
      res.setHeader('X-RateLimit-Limit',     String(result.limit));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    }
    return false;
  }

  res.setHeader('Retry-After', String(result.retryAfter));
  res.status(429).json({
    error:      'Too many requests — please slow down and try again shortly.',
    retryAfter: result.retryAfter,
  });
  return true;
}
