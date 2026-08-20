/**
 * "Has this person finished onboarding?" — asked in exactly one place.
 *
 * Both callers that gate on the answer use this function: the `(app)` layout,
 * which redirects into the wizard, and the wizard's own page, which redirects
 * out of it. A second query answering the same question slightly differently
 * is how two redirects end up pointing at each other.
 *
 * It deliberately mirrors `session_flags()` in the database, which the proxy
 * uses for the same decision — including the profile check, which is the part
 * that is easy to leave out and expensive to leave out (see `"absent"` below).
 *
 * Deliberately not built on `getUserStats()` in `@/lib/learn/data`: that one
 * degrades to the schema defaults when a query fails, and a defaulted null
 * timestamp reads as "has not onboarded" — precisely the wrong direction for a
 * gate to fail in.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeError } from "@/lib/auth/describe-error";

/**
 * Only `"incomplete"` means "send them to the wizard". The other three all
 * mean "leave them alone", for three different reasons:
 *
 * - `"complete"` — they finished. The wizard is closed to them.
 *
 * - `"absent"` — no profile row, so the email is unconfirmed and this is not a
 *   DecodedSAT user yet. Gating them is a trap: the layout would send them to
 *   /onboarding, whose page finds no profile and sends them back, forever.
 *   They cannot finish the wizard either — `complete_onboarding()`'s foreign
 *   key needs the profile row that does not exist. The dashboard's "Almost
 *   there" panel is where they belong.
 *
 * - `"unknown"` — the read itself failed. Same trap, same reason: /onboarding
 *   runs this query too, gets the same failure, and bounces them back. Failing
 *   open costs nothing, because `complete_onboarding()`'s
 *   `where onboarding_completed_at is null` is the actual guarantee — someone
 *   waved through by a broken read still cannot onboard twice.
 */
export type OnboardingStatus = "complete" | "incomplete" | "absent" | "unknown";

export async function getOnboardingStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<OnboardingStatus> {
  // Two primary-key lookups, in parallel. The profile is what distinguishes
  // "has not onboarded" from "is not a user yet", and those two need opposite
  // handling.
  const [profile, stats] = await Promise.all([
    supabase.from("profiles").select("id").eq("id", userId).maybeSingle(),
    supabase
      .from("user_stats")
      .select("onboarding_completed_at")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (profile.error || stats.error) {
    console.error(
      `[onboarding] status read failed: ${describeError(profile.error ?? stats.error)}`,
    );
    return "unknown";
  }

  if (!profile.data) return "absent";

  // A profile with no stats row means the step 4 trigger has not run for this
  // account. They still need onboarding, and `complete_onboarding()` creates
  // the row itself before writing.
  if (!stats.data) return "incomplete";

  return stats.data.onboarding_completed_at ? "complete" : "incomplete";
}
