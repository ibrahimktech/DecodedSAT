/**
 * Environment configuration, normalised once and read from here everywhere.
 *
 * Only `NEXT_PUBLIC_*` values live in this module, so it is safe to import from
 * client components. Server-only secrets are read where they are used, inside
 * modules marked `server-only` (see `@/lib/rate-limit`).
 *
 * Every `process.env.NEXT_PUBLIC_*` below is written as a literal member
 * expression on purpose — Next inlines those at build time by static analysis,
 * and a computed lookup (`process.env[name]`) would silently become
 * `undefined` in the browser bundle.
 *
 * ## Why two URLs
 *
 * The landing page and the dashboard are separate surfaces: the dashboard is
 * moving to `app.<domain>.com` once the domain is bought. So:
 *
 * - `SITE_URL` is *this* deployment's origin. Every `/auth/*` route lives here,
 *   which makes it the correct base for the email confirmation link.
 * - `APP_URL` is where a signed-in user is sent afterwards. It may carry a path
 *   (`http://localhost:3000/dashboard` today) or be a bare origin
 *   (`https://app.decodedsat.com` later). Nothing is ever appended to it.
 *
 * Collapsing these into one variable is what breaks when the split happens:
 * `${APP_URL}/auth/callback` would point at a deployment that has no callback
 * route. Neither value is hardcoded, so shipping the real domain is an env
 * change on Vercel and nothing else.
 */

/** Trailing slashes make every template literal below ambiguous. Drop them. */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Origin of this deployment — landing page, `/auth/*`, metadata. */
export const SITE_URL = trimTrailingSlash(
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
);

/** Post-authentication destination. Used verbatim; never appended to. */
export const APP_URL = trimTrailingSlash(
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000/dashboard",
);

/**
 * Where Supabase sends the user after they click the confirmation email. Must
 * also be listed in the Supabase dashboard's redirect allowlist — Supabase
 * rejects any redirect target that is not on it, which is what stops this being
 * an open redirect.
 */
export const AUTH_CALLBACK_URL = `${SITE_URL}/auth/callback`;

/**
 * The anon key is designed to ship to the browser: it carries no privileges of
 * its own, and Row Level Security — not the key — is the access boundary. The
 * `service_role` key is the opposite: it is read only by the server-only admin
 * client used for self-service account deletion and is never exported here.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** Browser-safe PostHog project settings. The token identifies a project; it is not a secret. */
export const POSTHOG_PROJECT_TOKEN =
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || "";
export const POSTHOG_HOST = trimTrailingSlash(
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
);


/** False until real project keys are in `.env.local`. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "";
}
