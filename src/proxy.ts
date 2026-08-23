/**
 * Session refresh, and the coarse routing rule that goes with it.
 *
 * This project is on Next 16, where `middleware.ts` is named `proxy.ts`. Same
 * mechanics, new filename.
 *
 * ## What this is for
 *
 * Supabase access tokens are short-lived. Server Components cannot write
 * cookies, so a token that expires between requests has nowhere to store its
 * replacement and the person gets logged out mid-session. Running the refresh
 * here — where the response is writable — is what stops that.
 *
 * ## What this is NOT
 *
 * It is not the authorization check. Matchers are easy to mis-scope, and a
 * route that slips past this file must still be safe. So `/dashboard` calls
 * `getUser()` itself, and Row Level Security backstops both of them. Three
 * layers, and only the third one is authoritative.
 *
 * `getUser()` rather than `getSession()` on purpose: `getSession` reads the
 * cookie and trusts it, while `getUser` revalidates the token against Supabase.
 * A forged cookie passes the first and fails the second.
 */

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  ONBOARDED_COOKIE,
  ONBOARDED_COOKIE_OPTIONS,
} from "@/lib/auth/onboarded-cookie";
import { APP_URL, SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

/** Signed-in visitors have no use for these. */
const AUTH_FORM_PATHS = ["/auth/login", "/auth/signup"];

/**
 * The signed-in app's route prefixes. Keep in sync with the pages under
 * `src/app/(app)/` — though per the note above, a prefix missing here is a
 * UX bug, not a security hole: every page checks its own session and RLS
 * scopes every query regardless.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/videos",
  "/questions",
  "/practice",
  "/progress",
  "/settings",
  "/onboarding",
];

/**
 * The student surface the onboarding gate guards.
 *
 * Identical to PROTECTED_PREFIXES minus "/onboarding" itself, and the two
 * lists are kept separate rather than derived from one another because the
 * difference is the entire point: someone who has not onboarded must still be
 * able to reach the wizard. Folding these together is how /onboarding ends up
 * redirecting to itself.
 *
 * "/admin" is in neither list — it has its own branch below, and admins are
 * exempt from onboarding entirely.
 */
const STUDENT_PREFIXES = [
  "/dashboard",
  "/videos",
  "/questions",
  "/practice",
  "/progress",
  "/settings",
];

/** Shared by both lists, so "/settings-other" never matches "/settings". */
function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  // Without project keys there is no session to refresh and nothing to guard.
  // Bailing out keeps `npm run dev` working on a fresh clone.
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  // This response object is what the Supabase client writes refreshed cookies
  // onto. It has to be the object that is ultimately returned, or replaced by
  // one that copies its cookies across — see the redirect branches below.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  /**
   * `session_flags()` answers both routing questions in one round trip, and
   * this memoises it so a request that consults the flags twice still makes
   * one call. Net cost is unchanged from when this file called `is_admin()`.
   */
  let flags: SessionFlags | null = null;
  const getFlags = async (): Promise<SessionFlags> =>
    (flags ??= await loadSessionFlags(supabase));

  if (!user && matchesPrefix(pathname, PROTECTED_PREFIXES)) {
    return withCookiesFrom(
      response,
      NextResponse.redirect(new URL("/auth/login", request.url)),
    );
  }

  // /admin is admin-only: signed-out visitors go to login like any protected
  // page, signed-in non-admins go to their dashboard. Same caveat as above —
  // this is routing convenience; the admin layout re-checks, and every
  // admin-gated RLS policy re-checks is_admin() inside the database.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!user) {
      return withCookiesFrom(
        response,
        NextResponse.redirect(new URL("/auth/login", request.url)),
      );
    }
    if (!(await getFlags()).isAdmin) {
      return withCookiesFrom(
        response,
        NextResponse.redirect(new URL("/dashboard", request.url)),
      );
    }
  }

  /**
   * "Does this person still need the wizard?" — answered from a cookie once it
   * has been answered from the database.
   *
   * This is the hot path. Without the short-circuit, every navigation in the
   * signed-in app paid a `session_flags()` round trip to re-derive a one-way
   * latch: `complete_onboarding()` sets the timestamp and nothing un-sets it,
   * so once the answer is "no" it is "no" forever.
   *
   * Trusting the cookie is safe because it can only skip a redirect, and the
   * redirect is a convenience — see `@/lib/auth/onboarded-cookie` for the full
   * argument, and the header of this file for the three layers it rests on.
   *
   * The write happens after the await, never before: `getFlags()` can trigger
   * a token refresh, and a refresh reassigns `response` out from under us.
   */
  const getNeedsOnboarding = async (): Promise<boolean> => {
    if (user && request.cookies.get(ONBOARDED_COOKIE)?.value === user.id) {
      return false;
    }

    const { needsOnboarding } = await getFlags();

    if (needsOnboarding) {
      // Covers the account that has not finished yet, and clears a value that
      // no longer applies — a stale cookie from whoever used this browser last.
      response.cookies.delete(ONBOARDED_COOKIE);
    } else if (user) {
      response.cookies.set(ONBOARDED_COOKIE, user.id, ONBOARDED_COOKIE_OPTIONS);
    }

    return needsOnboarding;
  };

  // The onboarding gate. Same caveat as every rule in this file: the `(app)`
  // layout re-checks with `requireOnboarded()`, and `complete_onboarding()` in
  // the database refuses a second write no matter what routes past here.
  // Asked only on the two kinds of path where the answer changes what happens.
  // Anywhere else — the landing page, /admin, /auth/callback — the flag is not
  // consulted, so it is not fetched either.
  if (user) {
    if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) {
      // Finished, or exempt: the wizard is closed. This is the redirect people
      // hit when they try to go back to it.
      if (!(await getNeedsOnboarding())) {
        return withCookiesFrom(
          response,
          NextResponse.redirect(new URL("/dashboard", request.url)),
        );
      }
    } else if (
      matchesPrefix(pathname, STUDENT_PREFIXES) &&
      (await getNeedsOnboarding())
    ) {
      return withCookiesFrom(
        response,
        NextResponse.redirect(new URL("/onboarding", request.url)),
      );
    }
  }

  if (user && AUTH_FORM_PATHS.includes(pathname)) {
    // Admins land on their panel, new students in the wizard, everyone else
    // on the app.
    const { isAdmin, needsOnboarding } = await getFlags();
    if (isAdmin) {
      return withCookiesFrom(
        response,
        NextResponse.redirect(new URL("/admin", request.url)),
      );
    }
    if (needsOnboarding) {
      return withCookiesFrom(
        response,
        NextResponse.redirect(new URL("/onboarding", request.url)),
      );
    }
    return withCookiesFrom(response, NextResponse.redirect(APP_URL));
  }

  return response;
}

type SessionFlags = { isAdmin: boolean; needsOnboarding: boolean };

/**
 * Both routing flags, from the database, via the visitor's own session.
 *
 * The two fields fail in OPPOSITE directions, which is deliberate:
 *
 *   - `isAdmin` fails closed. An RPC error reads as "not an admin", never the
 *     reverse — the same rule `getIsAdmin()` follows.
 *
 *   - `needsOnboarding` fails OPEN. If it failed closed we would redirect to
 *     /onboarding, whose page runs the same query, gets the same failure, and
 *     redirects back: a loop that takes the whole app down over a transient
 *     database blip. Waving someone through costs nothing, because
 *     `complete_onboarding()` still refuses a second write.
 */
async function loadSessionFlags(
  supabase: SupabaseClient,
): Promise<SessionFlags> {
  const { data, error } = await supabase.rpc("session_flags").maybeSingle();

  if (error) {
    console.error("[proxy] session_flags rpc failed", { error });
    return { isAdmin: false, needsOnboarding: false };
  }

  const row = data as SessionFlagsRow | null;
  return {
    isAdmin: row?.is_admin === true,
    needsOnboarding: row?.needs_onboarding === true,
  };
}

type SessionFlagsRow = { is_admin: boolean; needs_onboarding: boolean };

/**
 * Moves refreshed auth cookies onto a redirect response.
 *
 * Dropping this step is the classic `@supabase/ssr` bug: the refresh happens,
 * the redirect discards the new cookies, and the next request refreshes again
 * with a token that was already rotated — an infinite redirect loop.
 */
function withCookiesFrom(
  source: NextResponse,
  target: NextResponse,
): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and image files.
     *
     * `/auth/callback` is intentionally inside the matcher: it is a normal
     * route and the exclusions below do not touch it. It never redirects here
     * because it is not in AUTH_FORM_PATHS and not under /dashboard.
     *
     * `/onboarding` and every STUDENT_PREFIXES entry are inside it too — none
     * contains a dot and none sits under `_next/`, so the negative lookahead
     * lets all of them through. Worth re-confirming by observation rather
     * than by reading this regex whenever a prefix is added.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
