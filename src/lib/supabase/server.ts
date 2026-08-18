/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * There is deliberately no browser client in this project. Every Supabase call
 * — signup, sign-in, sign-out, profile reads — happens on the server, so the
 * client bundle never talks to Supabase directly and the auth cookies can be
 * `httpOnly`.
 *
 * The anon key used here is the correct key. It is public by design and grants
 * nothing on its own; Row Level Security is the access boundary. The
 * `service_role` key bypasses RLS entirely and is not used anywhere in this
 * flow — signup needs no admin bypass.
 */

import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";

/**
 * Thrown when the project keys are missing. Callers catch this and return the
 * same generic message they return for any other failure — a misconfigured
 * deployment must not announce itself to visitors.
 */
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}

export async function createSupabaseServerClient() {
  if (!isSupabaseConfigured()) {
    throw new SupabaseNotConfiguredError();
  }

  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. Ignoring is safe: the
          // token refresh that triggered this write is redone by `src/proxy.ts`
          // on the next request, where the response *is* writable.
        }
      },
    },
  });
}
