/**
 * `POST /api/practice-tests/sweep` — the abandonment beacon.
 *
 * The runner fires this with `navigator.sendBeacon()` on `pagehide`, so a
 * student who closes the tab mid-test has their attempt finalized promptly
 * rather than on their next visit.
 *
 * ## What it deliberately does not do
 *
 * It carries no body, no attempt id, and no scoring information. All it does
 * is run `finalize_stale_practice_test_attempts()` for whoever's session
 * cookie arrived — the same idempotent sweep that every page load already
 * runs. That function only touches attempts whose module deadline has
 * genuinely passed, so calling this the instant a tab is hidden cannot end a
 * test that is still live.
 *
 * That matters because `sendBeacon` is unreliable by construction: it may be
 * dropped, delayed, or never fire at all. Nothing may depend on it. The real
 * guarantee is the server-side sweep on the next page load (spec section 6);
 * this only makes the good case faster.
 *
 * Rate limiting, CORS allowlisting and safe error responses all come from
 * `withApi` — CLAUDE.md requires them on every route, and routing them
 * through the wrapper is what stops one being forgotten.
 */

import { withApi } from "@/lib/api";
import { APP_URL, SITE_URL } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Same-origin only, with both deployment URLs folded in so a preview
 * deployment is not silently 403'd. `APP_URL` may carry a path
 * (`http://localhost:3000/dashboard`), and an `Origin` header never does —
 * so it is reduced to its origin before comparison.
 */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const ALLOWED_ORIGINS = [
  ...new Set(
    [
      "https://decodedsat.com",
      "https://www.decodedsat.com",
      "http://localhost:3000",
      originOf(SITE_URL),
      originOf(APP_URL),
    ].filter((origin): origin is string => origin !== null),
  ),
];

export const POST = withApi(
  {
    // A beacon per page-hide, with room for a student flicking between tabs.
    rateLimit: { limit: 30, windowMs: 60_000 },
    rateLimitPrefix: "test-sweep",
    allowedOrigins: ALLOWED_ORIGINS,
  },
  async () => {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // No session, nothing to sweep. 204 rather than 401: a beacon has no one
    // to report an error to, and a signed-out caller learns nothing either way.
    if (!user) return new Response(null, { status: 204 });

    const { error } = await supabase.rpc(
      "finalize_stale_practice_test_attempts",
    );

    if (error) {
      // Logged, not surfaced. The next page load runs the same sweep.
      console.error(
        `[api] sweep failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
    }

    return new Response(null, { status: 204 });
  },
);
