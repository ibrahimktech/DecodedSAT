import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/env";

/** Service-role client used only for operations Supabase Auth reserves to admins. */
export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!SUPABASE_URL || !serviceRoleKey) {
    throw new Error("Supabase admin credentials are not configured.");
  }
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

