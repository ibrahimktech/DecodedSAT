/**
 * Cookie policy for the Supabase auth session.
 *
 * Imported by both places that construct a Supabase client — the request-time
 * client in `./server` and the session refresh in `src/proxy.ts` — because the
 * two must agree exactly. Cookies written under one policy and rewritten under
 * another produce duplicates that the browser sends together, and the session
 * that wins is whichever the server happens to read first.
 *
 * Deliberately not marked `server-only`: it holds no secret, and `src/proxy.ts`
 * runs in its own runtime.
 */

import { SITE_URL } from "@/lib/env";

/**
 * `@supabase/ssr` ships `httpOnly: false` in its defaults, because its usual
 * setup pairs a server client with a browser client that reads the session out
 * of `document.cookie`.
 *
 * This project has no browser client — every Supabase call is a Server Action,
 * Server Component or Route Handler, and nothing in `src/` touches
 * `document.cookie`. So the flag costs nothing here and removes the session
 * token from reach of any script that ever executes on the page. That is the
 * difference between an XSS that defaces a page and one that walks away with
 * a logged-in session.
 *
 * `secure` is derived from the deployment's own origin rather than NODE_ENV:
 * a Secure cookie is discarded over plain HTTP, which would silently break
 * `next dev` on localhost, while any real https deployment gets the flag with
 * no extra configuration.
 */
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: SITE_URL.startsWith("https://"),
  // Lax, not Strict: the confirmation link in the email is a cross-site
  // navigation, and Strict would withhold the cookie on that first landing.
  sameSite: "lax",
  path: "/",
} as const;
