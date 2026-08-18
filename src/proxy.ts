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
  "/settings",
];

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

  if (
    !user &&
    PROTECTED_PREFIXES.some(
      (prefix) =>
        pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
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
    if (!(await isAdminSession(supabase))) {
      return withCookiesFrom(
        response,
        NextResponse.redirect(new URL("/dashboard", request.url)),
      );
    }
  }

  if (user && AUTH_FORM_PATHS.includes(pathname)) {
    // Admins land on their panel, everyone else on the app.
    if (await isAdminSession(supabase)) {
      return withCookiesFrom(
        response,
        NextResponse.redirect(new URL("/admin", request.url)),
      );
    }
    return withCookiesFrom(response, NextResponse.redirect(APP_URL));
  }

  return response;
}

/**
 * The database's `is_admin()` via the visitor's own session. Fails closed:
 * an RPC error reads as "not an admin", never the reverse.
 */
async function isAdminSession(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error("[proxy] is_admin rpc failed", { error });
    return false;
  }
  return data === true;
}

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
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
