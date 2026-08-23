/**
 * A cookie that records "this person has already finished onboarding", so the
 * proxy can stop asking the database on every single request.
 *
 * ## Why this exists
 *
 * `src/proxy.ts` runs on every navigation, including the RSC requests behind
 * client-side page switches. It was calling `session_flags()` on each one — a
 * full network round trip to Postgres — to answer a question whose answer
 * cannot change back. `complete_onboarding()` sets `onboarding_completed_at`
 * and nothing un-sets it, so "has onboarded" is a one-way latch. Re-asking it
 * on every click was pure latency on the critical path.
 *
 * ## Why trusting it is safe
 *
 * Because it is not trusted for anything. This cookie can only cause a
 * redirect to be *skipped*, and the redirect it skips is a convenience, not a
 * boundary — exactly the three-layer model documented at the top of
 * `src/proxy.ts`. Someone who forges it reaches the student app, where:
 *
 *   - `requireOnboarded()` in the `(app)` layout re-reads the real status from
 *     the database and redirects them into the wizard,
 *   - `complete_onboarding()`'s `where onboarding_completed_at is null` refuses
 *     a second write no matter how they arrived, and
 *   - Row Level Security scopes every query to their own rows regardless.
 *
 * So the worst a forged value achieves is seeing the wizard a moment later
 * than they otherwise would have. Nothing is authorised on the strength of it.
 *
 * ## Why the value is the user id
 *
 * A bare `"1"` would survive a sign-out and be read back for whoever signs in
 * next on that browser — a shared school laptop is the normal case here, not
 * the exotic one. Storing the id means a cookie belonging to someone else
 * simply fails the comparison and the RPC runs as it always did. Sign-out
 * clears it too, but this is what makes that a tidy-up rather than the thing
 * correctness depends on.
 *
 * Deliberately not `server-only`, for the same reason as
 * `@/lib/supabase/cookie-options`: `src/proxy.ts` runs in its own runtime and
 * has to import it. It holds no secret — a user id is not one, and the cookie
 * is `httpOnly` regardless.
 */

import { SITE_URL } from "@/lib/env";

export const ONBOARDED_COOKIE = "ds_onboarded";

/**
 * Same policy as the Supabase auth cookies in `@/lib/supabase/cookie-options`,
 * and for the same reasons: `httpOnly` because nothing client-side reads it,
 * `secure` derived from the deployment's own origin so `next dev` on plain
 * HTTP still works, `sameSite: "lax"` so it survives the cross-site landing
 * from a confirmation email.
 */
export const ONBOARDED_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: SITE_URL.startsWith("https://"),
  sameSite: "lax",
  path: "/",
  /** A year. The latch never flips back, so there is nothing to expire for. */
  maxAge: 60 * 60 * 24 * 365,
} as const;
