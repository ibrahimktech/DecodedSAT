/**
 * IP rate limiting for API routes.
 *
 * Server-only. Never import this from a client component.
 *
 * Storage is an in-process sliding-window log. That is correct and sufficient
 * for a single instance, but it does NOT share state across serverless
 * instances or regions — under real traffic each instance enforces its own
 * budget. When the site gets meaningful volume, swap `RateLimiter.check` for a
 * shared store (Upstash Redis, Vercel KV). Every call site goes through
 * `withApi`, so that swap happens here and nowhere else.
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
};

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

export function createRateLimiter({ limit, windowMs }: RateLimiterOptions) {
  return {
    /**
     * Records a hit for `key` and reports whether it is allowed.
     * Call once per request — it mutates the window.
     */
    check(key: string): RateLimitResult {
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
    },
  };
}

/**
 * Best-effort client IP.
 *
 * `x-vercel-forwarded-for` is set by Vercel's edge and cannot be spoofed by the
 * client, so it is preferred. `x-forwarded-for` is the standard fallback: take
 * the leftmost entry, which is the original client on a trusted proxy chain.
 * Never trust either header when running behind an untrusted proxy.
 *
 * Returns `"unknown"` rather than throwing — an unidentifiable caller shares
 * one bucket, which fails closed rather than granting an unlimited budget.
 */
export function getClientIp(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
