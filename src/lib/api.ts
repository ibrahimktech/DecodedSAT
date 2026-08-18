/**
 * Route handler wrapper: rate limiting, schema validation, CORS and safe error
 * responses, applied uniformly so no route can forget one of them.
 *
 * There are no API routes yet — this exists so that adding one is a single
 * import rather than a fresh security review. Usage once a route is needed:
 *
 * ```ts
 * // src/app/api/contact/route.ts
 * import { z } from "zod";
 * import { withApi } from "@/lib/api";
 *
 * const ContactSchema = z.object({
 *   email: z.string().email().max(254),
 *   message: z.string().min(1).max(2_000),
 * });
 *
 * export const POST = withApi(
 *   {
 *     schema: ContactSchema,
 *     rateLimit: { limit: 5, windowMs: 60_000 },
 *     rateLimitPrefix: "contact",
 *   },
 *   async ({ data }) => {
 *     await sendContactEmail(data);
 *     return Response.json({ ok: true });
 *   },
 * );
 * ```
 *
 * The `Validator` type is structural — anything exposing Zod's `safeParse`
 * shape fits, so this wrapper never imports Zod itself.
 *
 * The auth Server Actions deliberately do NOT go through here: a Server Action
 * is an RPC, not an HTTP endpoint, so it cannot return a 429 status line. They
 * call `createRateLimiter` directly and surface the limit in their return
 * value instead — see `src/app/auth/signup/actions.ts`.
 */

import "server-only";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

/** Structural subset of a Zod schema — anything `safeParse`-shaped fits. */
export type Validator<T> = {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
};

export type ApiContext<T> = {
  request: Request;
  /** Parsed, validated body. `undefined` when no schema was supplied. */
  data: T;
  /** Rate-limit key the request was counted against. */
  clientIp: string;
};

export type WithApiOptions<T> = {
  schema?: Validator<T>;
  /** Defaults to 30 requests per minute per IP. */
  rateLimit?: { limit: number; windowMs: number };
  /**
   * Rate-limit namespace. Defaults to `"api"`, which means every route sharing
   * the default also shares one budget per IP — pass a distinct value per route
   * so a burst on one cannot lock a caller out of another.
   */
  rateLimitPrefix?: string;
  /** Origins allowed to call this route. Never `*`. */
  allowedOrigins?: readonly string[];
};

const DEFAULT_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;

/** Same-origin in production, plus local dev. Extend per route if ever needed. */
const DEFAULT_ALLOWED_ORIGINS = [
  "https://decodedsat.com",
  "https://www.decodedsat.com",
  "http://localhost:3000",
] as const;

function jsonError(
  status: number,
  error: string,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json({ error, message }, { status, headers });
}

export function withApi<T = undefined>(
  options: WithApiOptions<T>,
  handler: (context: ApiContext<T>) => Promise<Response> | Response,
): (request: Request) => Promise<Response> {
  const { limit, windowMs } = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const limiter = createRateLimiter({
    limit,
    windowMs,
    prefix: options.rateLimitPrefix ?? "api",
  });

  return async function route(request: Request): Promise<Response> {
    // --- CORS: allowlist only, never `*`. -----------------------------------
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.includes(origin)) {
      return jsonError(403, "forbidden_origin", "This origin is not allowed.");
    }
    const corsHeaders: Record<string, string> = origin
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
      : {};

    // --- Rate limit: by IP, before any parsing work. -------------------------
    const clientIp = getClientIp(request);
    const rate = await limiter.check(clientIp);
    const rateHeaders = {
      ...corsHeaders,
      "RateLimit-Limit": String(rate.limit),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil((rate.resetAt - Date.now()) / 1000)),
    };

    if (!rate.ok) {
      return jsonError(
        429,
        "rate_limited",
        `Too many requests. Try again in ${rate.retryAfterSeconds}s.`,
        { ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) },
      );
    }

    // --- Validation: reject bad input, never coerce it. ----------------------
    let data = undefined as T;
    if (options.schema) {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonError(400, "invalid_json", "Request body must be valid JSON.", rateHeaders);
      }

      const parsed = options.schema.safeParse(body);
      if (!parsed.success) {
        // Field paths and messages only — never the raw input we rejected.
        return Response.json(
          {
            error: "invalid_request",
            message: "Request body failed validation.",
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.map(String).join("."),
              message: issue.message,
            })),
          },
          { status: 400, headers: rateHeaders },
        );
      }
      data = parsed.data;
    }

    // --- Handler: log detail server-side, return something generic. ----------
    try {
      const response = await handler({ request, data, clientIp });
      for (const [key, value] of Object.entries(rateHeaders)) {
        response.headers.set(key, value);
      }
      return response;
    } catch (error) {
      console.error("[api] unhandled error", {
        path: new URL(request.url).pathname,
        error,
      });
      return jsonError(
        500,
        "internal_error",
        "Something went wrong. Please try again.",
        rateHeaders,
      );
    }
  };
}
