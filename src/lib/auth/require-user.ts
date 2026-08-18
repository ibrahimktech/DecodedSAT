/**
 * The per-request auth gate for the signed-in app.
 *
 * Every page and layout under `(app)` calls this instead of repeating the
 * getUser/redirect dance. Wrapped in React's `cache()` so the layout and the
 * page it renders share one `getUser()` round trip per request instead of
 * paying for it twice.
 *
 * This is the middle of the three layers described in `src/proxy.ts`: the
 * proxy is a routing convenience, this check travels with the pages, and Row
 * Level Security underneath is the one that cannot be bypassed.
 */

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const requireUser = cache(
  async (): Promise<{ supabase: SupabaseClient; user: User }> => {
    // Without project keys there is no session anywhere, so this is the same
    // outcome as a signed-out visitor — just reached without a stack trace.
    if (!isSupabaseConfigured()) redirect("/auth/login");

    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/auth/login");

    return { supabase, user };
  },
);
