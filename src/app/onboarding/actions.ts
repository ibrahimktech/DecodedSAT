"use server";

/**
 * The onboarding submit.
 *
 * Same order as every other action in this project: rate limit, parse, call
 * the database, answer failures with the shared generic message. The only
 * unusual part is what "already done" means here — it is not an error, it is
 * someone arriving at a flow they finished, so it redirects rather than
 * complaining.
 *
 * This action is the second of three checks, not the check. `/onboarding`'s
 * page redirects finished students before the form ever renders, and
 * `complete_onboarding()` refuses to write a second time regardless of what
 * reaches it.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { describeError } from "@/lib/auth/describe-error";
import {
  type AuthFormState,
  GENERIC_ERROR_MESSAGE,
  rateLimitedMessage,
} from "@/lib/auth/state";
import { OnboardingSchema } from "@/lib/onboarding/schemas";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Keyed on user id. Onboarding succeeds once per account, so anything past a
 * handful of attempts is a script or a stuck form — but the limit is generous
 * enough to survive a person fixing a rejected date a few times.
 */
const onboardingLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60 * 60_000,
  prefix: "onboarding",
});

/**
 * A second limiter keyed on IP, because the one above needs a session to key
 * on and an unauthenticated flood would never reach it.
 */
const onboardingIpLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60 * 60_000,
  prefix: "onboarding-ip",
});

export async function completeOnboardingAction(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const attempt = previous.attempt + 1;
  const failed: AuthFormState = {
    status: "error",
    message: GENERIC_ERROR_MESSAGE,
    attempt,
  };

  try {
    const ipRate = await onboardingIpLimiter.check(
      getClientIp(await headers()),
    );
    if (!ipRate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(ipRate.retryAfterSeconds),
        attempt,
      };
    }

    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return failed;

    const rate = await onboardingLimiter.check(user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
        attempt,
      };
    }

    // `FormData.get` yields `string | File | null`; the schema rejects all
    // three non-string cases without any pre-checking here.
    const satAttempts = formData.get("satAttempts");
    const lastSatMathScore = formData.get("lastSatMathScore");
    const numericAttempts = Number(satAttempts);

    const parsed = OnboardingSchema.safeParse({
      satAttempts,
      lastSatMathScore,
      // A recent real score replaces an estimate as the baseline. Deriving it
      // here means a stale or hand-written hidden value cannot win.
      currentScoreEstimate:
        Number.isInteger(numericAttempts) && numericAttempts > 0
          ? lastSatMathScore
          : formData.get("currentScoreEstimate"),
      targetScore: formData.get("targetScore"),
      testDate: formData.get("testDate"),
      // One hidden input per selected domain.
      focusDomainIds: formData.getAll("focusDomainIds"),
      dailyGoal: formData.get("dailyGoal"),
    });
    if (!parsed.success) return failed;

    const answers = parsed.data;

    /**
     * `.rpc()` reports failure two different ways and both have to land on the
     * same generic state:
     *
     *   - `result.error`, for a PostgREST-level rejection. The function's own
     *     `raise exception` guards arrive here — reachable by anything holding
     *     a token, since a direct call never met the schema above.
     *   - a throw, for a transport failure, and for the foreign key violation
     *     when no profile row exists yet (an account whose confirmation
     *     trigger has not landed).
     *
     * The surrounding try/catch covers the second. Unhandled, either one is a
     * 500 with a Postgres constraint name in the body.
     */
    const result = await supabase.rpc("complete_onboarding", {
      p_current_score: answers.currentScoreEstimate,
      p_target_score: answers.targetScore,
      p_sat_attempts: answers.satAttempts,
      p_last_sat_math: answers.lastSatMathScore,
      p_test_date: answers.testDate,
      p_daily_goal: answers.dailyGoal,
      p_focus_domains: answers.focusDomainIds,
    });

    if (result.error) {
      console.error(
        `[onboarding] complete_onboarding failed: ${result.error.code ?? "no_code"} — ${result.error.message}`,
      );
      return failed;
    }

    // The boolean the function returns is deliberately not branched on. `false`
    // means the guard held — they had already onboarded and nothing was
    // written — which is not a failure to report, just someone arriving at a
    // flow they finished. Both outcomes end at the dashboard.
  } catch (error) {
    console.error(`[onboarding] submit threw: ${describeError(error)}`);
    return failed;
  }

  // Outside the try on purpose: `redirect` signals by throwing, and catching
  // it above would turn a successful setup into a generic error.
  //
  // Scoped to the signed-in subtree: the dashboard, the nav and Settings all
  // render values this just wrote.
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
