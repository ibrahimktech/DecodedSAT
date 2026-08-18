/**
 * IP rate limiting for API routes and auth Server Actions.
 *
 * Server-only. Never import this from a client component.
 *
 * ## Storage
 *
 * A sliding-window log behind a swappable store:
 *
 * - **Upstash Redis** when `UPSTASH_REDIS_REST_URL` and
 *   `UPSTASH_REDIS_REST_TOKEN` are set. This is the only correct option on
 *   Vercel: serverless invocations do not share memory, so a per-process
 *   counter gives an attacker one full budget per cold instance.
 * - **In-process memory** otherwise, so `npm run dev` works with no external
 *   service. It is announced with a startup warning because it is not a real
 *   limit in production.
 *
 * Upstash is reached over its REST API with `fetch` rather than the
 * `@upstash/redis` SDK — one HTTP call against a documented endpoint is not
 * worth a dependency (CLAUDE.md), and `fetch` works on both the Node and Edge
 * runtimes without a bundler shim.
 *
 * If Upstash is configured but unreachable, calls fall back to the memory store
 * rather than failing open. A degraded limit beats no limit, and Supabase's own
 * auth rate limits still sit behind this one.
 */

import "server-only";

export type RateLimitResult = {
  ok: boolean;
  /** Requests permitted per window. */
  limit: number;
  /** Requests left in the current window. */
  remaining: number;
  /** Epoch ms at which the oldest hit ages out and capacity frees up. */
  resetAt: number;
  /** Seconds the caller should wait before retrying. Only set when `ok` is false. */
  retryAfterSeconds: number;
};

export type RateLimiterOptions = {
  /** Max requests allowed per key per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Namespace for the key, so two limiters sharing one Redis (and one client
   * IP) do not consume each other's budget.
   */
  prefix: string;
};

// --- Shared store: Upstash Redis over REST ----------------------------------

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(
  /\/+$/,
  "",
);
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

/** True when a store that actually works across serverless instances exists. */
export const hasSharedRateLimitStore = UPSTASH_URL !== "" && UPSTASH_TOKEN !== "";

/**
 * Sliding window as a sorted set of hit timestamps.
 *
 * Runs as one Lua script so the trim/count/insert sequence is atomic — with
 * three separate round trips, concurrent requests race and can both observe a
 * count below the limit.
 *
 * Returns `{ allowed, count, oldestScore }`.
 */
const SLIDING_WINDOW_SCRIPT = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return { 0, count, tonumber(oldest[2]) }
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
return { 1, count + 1, tonumber(oldest[2]) }
`.trim();

async function upstashHit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();

  const response = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      "EVAL",
      SLIDING_WINDOW_SCRIPT,
      "1",
      key,
      String(now),
      String(windowMs),
      String(limit),
      // Unique per hit: two requests in the same millisecond must be two
      // members, or ZADD overwrites and one of them is not counted.
      `${now}-${crypto.randomUUID()}`,
    ]),
    cache: "no-store",
    // A rate limiter must never become the slowest part of a request.
    signal: AbortSignal.timeout(2_000),
  });

  if (!response.ok) {
    throw new Error(`Upstash responded ${response.status}`);
  }

  const body = (await response.json()) as {
    result?: [number, number, number];
    error?: string;
  };
  if (!body.result) {
    throw new Error(body.error ?? "Upstash returned no result");
  }

  const [allowed, count, oldest] = body.result;
  const resetAt = oldest + windowMs;

  return {
    ok: allowed === 1,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    retryAfterSeconds:
      allowed === 1 ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}

// --- Fallback store: in-process memory --------------------------------------

/** Hit timestamps per key. Trimmed on read; swept periodically. */
const buckets = new Map<string, number[]>();

/** Drop keys whose entire window has expired so the map cannot grow forever. */
function sweep(now: number, windowMs: number): void {
  for (const [key, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] <= now - windowMs) {
      buckets.delete(key);
    }
  }
}

let lastSweep = 0;

function memoryHit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  if (now - lastSweep > windowMs) {
    sweep(now, windowMs);
    lastSweep = now;
  }

  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);

  if (hits.length >= limit) {
    const resetAt = hits[0] + windowMs;
    buckets.set(key, hits);
    return {
      ok: false,
      limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(key, hits);

  return {
    ok: true,
    limit,
    remaining: limit - hits.length,
    resetAt: hits[0] + windowMs,
    retryAfterSeconds: 0,
  };
}

// --- Public API --------------------------------------------------------------

/**
 * Production refuses to start without a shared store.
 *
 * The memory fallback is a development convenience and nothing more: on Vercel
 * each serverless invocation gets its own module instance, so a per-process
 * counter hands an attacker one full budget per cold start. That is not a
 * degraded limit, it is the absence of one — and the failure is silent, which
 * is the worst property a security control can have.
 *
 * So this throws at import time rather than warning. A deployment that cannot
 * rate limit does not boot.
 *
 * `NEXT_PHASE` excludes `next build`, which sets NODE_ENV to "production" and
 * evaluates this module while collecting pages. Without that exclusion, a build
 * would fail on a machine that has no reason to hold production credentials.
 * The check still runs on every real request path.
 */
const IS_PRODUCTION_RUNTIME =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

if (IS_PRODUCTION_RUNTIME && !hasSharedRateLimitStore) {
  throw new Error(
    "[rate-limit] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are " +
      "required in production. The in-process fallback does not share state " +
      "across serverless instances and would leave signup and sign-in " +
      "effectively unlimited. Set both, or do not deploy.",
  );
}

export function createRateLimiter({ limit, windowMs, prefix }: RateLimiterOptions) {
  return {
    /**
     * Records a hit for `key` and reports whether it is allowed.
     * Call once per request — it mutates the window.
     */
    async check(key: string): Promise<RateLimitResult> {
      const namespaced = `rl:${prefix}:${key}`;

      // Development only — the guard above means production never gets here
      // with an unconfigured store.
      if (!hasSharedRateLimitStore) {
        return memoryHit(namespaced, limit, windowMs);
      }

      try {
        return await upstashHit(namespaced, limit, windowMs);
      } catch (error) {
        // Degrade to the local window rather than letting everything through.
        console.error("[rate-limit] Upstash unavailable, using memory store", {
          error,
        });
        return memoryHit(namespaced, limit, windowMs);
      }
    },
  };
}

/**
 * Best-effort client IP, from a `Request` or a bare `Headers` (Server Actions
 * have no `Request`, only `headers()`).
 *
 * `x-vercel-forwarded-for` is set by Vercel's edge and cannot be spoofed by the
 * client, so it is preferred. `x-forwarded-for` is the standard fallback: take
 * the leftmost entry, which is the original client on a trusted proxy chain.
 * Never trust either header when running behind an untrusted proxy.
 *
 * Returns `"unknown"` rather than throwing — an unidentifiable caller shares
 * one bucket, which fails closed rather than granting an unlimited budget.
 */
export function getClientIp(source: Request | Headers): string {
  // Probe for the Headers *interface*, not for a `.headers` property.
  //
  // The obvious test — `"headers" in source`, on the theory that only a
  // `Request` has one — is wrong on Next 16 and throws. `headers()` returns a
  // `HeadersAdapter`, which extends `Headers` but also assigns its own
  // `this.headers`: a Proxy over a plain object, with no `.get` on it. So the
  // `in` check passes for the very case it was meant to exclude and hands back
  // something that is not a Headers at all.
  //
  // `instanceof Headers` is no better — the adapter is sealed behind another
  // Proxy, and a caller that ever slipped past would silently fall into the
  // "unknown" bucket instead of failing loudly. Duck-typing on `.get` is what
  // actually distinguishes the two: `Headers` has it, `Request` does not.
  const headers =
    typeof (source as Headers).get === "function"
      ? (source as Headers)
      : (source as Request).headers;

  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return headers.get("x-real-ip")?.trim() || "unknown";
}
