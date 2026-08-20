/**
 * The onboarding gate for the signed-in student app.
 *
 * Sits alongside `requireUser()` as the second of the three layers described
 * in `src/proxy.ts`: the proxy redirects as a routing convenience, this check
 * travels with the pages, and `complete_onboarding()`'s guarded UPDATE in the
 * database is the one that cannot be bypassed.
 *
 * Wrapped in React's `cache()` for the same reason `requireUser()` is — the
 * layout calls it once per request no matter how many pages compose under it.
 * `requireUser()` and `getIsAdmin()` are both already cached, so the only new
 * cost here is a single primary-key lookup.
 */

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getOnboardingStatus } from "@/lib/onboarding/status";
import { getIsAdmin } from "./admin";
import { requireUser } from "./require-user";

export const requireOnboarded = cache(async (): Promise<void> => {
  const { supabase, user } = await requireUser();

  // Admins are exempt, matching `session_flags()` in the database. Being
  // trapped in the student wizard while trying to check the student app is a
  // worse failure than skipping a questionnaire.
  if (await getIsAdmin()) return;

  const status = await getOnboardingStatus(supabase, user.id);

  // Only "incomplete" gates. "absent" (unconfirmed account) and "unknown"
  // (failed read) both fall through on purpose — redirecting either one is a
  // loop, since /onboarding sends them straight back. See OnboardingStatus.
  if (status === "incomplete") redirect("/onboarding");
});
