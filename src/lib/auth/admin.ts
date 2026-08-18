/**
 * Server-side admin checks, all built on the database's `is_admin()`.
 *
 * The database function is the single source of admin truth: it reads
 * `admin_users`, a table no client can touch, through the caller's own
 * session. Nothing here consults a client-supplied flag, a profile column, or
 * an environment variable — and nothing here uses the service_role key,
 * because there isn't one anywhere in this codebase.
 *
 * Three call shapes for three contexts:
 *
 * - `getIsAdmin()`   — a boolean, for UI that renders differently for admins
 *                      (the "Back to admin" badge on student pages).
 * - `requireAdmin()` — for admin pages/layouts: redirects non-admins away.
 * - `getAdminActionContext()` — for Server Actions, which return state
 *                      instead of redirecting: null means "refuse silently".
 *
 * All of this is the convenience layer. The enforcement layer is RLS: every
 * admin-gated table policy re-checks `is_admin()` inside the database, so a
 * request that somehow skipped every function in this file still writes
 * nothing.
 */

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "./require-user";

/**
 * Whether the current session's user is an admin. Request-cached so the
 * layout and page share one RPC. Fails closed: any error reads as "not an
 * admin", never the other way around.
 */
export const getIsAdmin = cache(async (): Promise<boolean> => {
  const { supabase } = await requireUser();

  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error(`[admin] is_admin rpc failed: ${error.message}`);
    return false;
  }
  return data === true;
});

/**
 * The auth gate for everything under `/admin`. Signed-out visitors bounce to
 * login (via `requireUser`), signed-in non-admins to their dashboard — the
 * page they were probably looking for anyway.
 */
export const requireAdmin = cache(
  async (): Promise<{ supabase: SupabaseClient; user: User }> => {
    const { supabase, user } = await requireUser();

    if (!(await getIsAdmin())) redirect("/dashboard");

    return { supabase, user };
  },
);

/**
 * Admin check for Server Actions, which must return form state rather than
 * redirect. `null` = not signed in, not an admin, or Supabase unreachable —
 * callers treat all three identically (generic error), because a response
 * that distinguishes them tells a prober which wall they hit.
 */
export async function getAdminActionContext(): Promise<{
  supabase: SupabaseClient;
  user: User;
} | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error(`[admin] is_admin rpc failed: ${error.message}`);
    return null;
  }
  if (data !== true) return null;

  return { supabase, user };
}
