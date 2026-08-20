/**
 * The onboarding wizard's page.
 *
 * This is layer two of the "no going back" rule. The proxy redirects finished
 * students to /dashboard before they get here, but a proxy is one mis-scoped
 * matcher away from not running, so the check is repeated where it cannot be
 * routed around — and `complete_onboarding()` in the database refuses a second
 * write even if both of these fail.
 */

import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { getIsAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/require-user";
import { getDomains, getProfile } from "@/lib/learn/data";
import { getOnboardingStatus } from "@/lib/onboarding/status";

export default async function OnboardingPage() {
  const { supabase, user } = await requireUser();

  // Admins skip onboarding, so the wizard has nothing to offer them. Matches
  // `session_flags()` and `requireOnboarded()`.
  if (await getIsAdmin()) redirect("/dashboard");

  // No profile row means the confirmation trigger has not run — the account
  // is not a DecodedSAT user yet, and `complete_onboarding()`'s foreign key
  // would reject it. The dashboard has the "Almost there" panel for this.
  const profile = await getProfile(supabase, user.id);
  if (!profile) redirect("/dashboard");

  const status = await getOnboardingStatus(supabase, user.id);

  // The gate. "unknown" deliberately falls through to the wizard: a failed
  // read must not lock someone out of onboarding they may genuinely need, and
  // if they have in fact already finished, the action's RPC returns false and
  // sends them to the dashboard without writing anything.
  if (status === "complete") redirect("/dashboard");

  const domains = await getDomains(supabase);

  return (
    <OnboardingWizard
      firstName={firstNameOf(profile.fullName)}
      domains={domains}
    />
  );
}

/** "Ibrahim Karimov" -> "Ibrahim". Blank names just drop the greeting. */
function firstNameOf(fullName: string | null): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}
