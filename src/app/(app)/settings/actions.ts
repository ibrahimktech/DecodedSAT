"use server";

/**
 * Settings actions — the password change, and the study plan onboarding
 * captured.
 *
 * Runs against the caller's own session (`updateUser` affects whoever the
 * cookie says is signed in, nobody else), re-validates the new password
 * server-side with the same bounds signup enforces, and answers every failure
 * with the shared generic message. Success is safe to name: "password
 * updated" reveals nothing about anyone but the caller.
 */

import { revalidatePath } from "next/cache";
import { describeError } from "@/lib/auth/describe-error";
import {
  type AuthFormState,
  GENERIC_ERROR_MESSAGE,
  rateLimitedMessage,
} from "@/lib/auth/state";
import { PasswordChangeSchema } from "@/lib/learn/schemas";
import { StudyPlanSchema } from "@/lib/onboarding/schemas";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Keyed on user id. Five changes an hour is generous for a person and a wall
 * for a script — and Supabase applies its own auth limits behind this one.
 */
const passwordLimiter = createRateLimiter({
  limit: 5,
  windowMs: 60 * 60_000,
  prefix: "password-change",
});

export async function changePasswordAction(
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
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return failed;

    const rate = await passwordLimiter.check(user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
        attempt,
      };
    }

    const parsed = PasswordChangeSchema.safeParse({
      password: formData.get("password"),
      confirm: formData.get("confirm"),
    });
    if (!parsed.success) return failed;

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (error) {
      // e.g. "same as old password" — logged for debugging, folded into the
      // generic message for the client.
      console.error(
        `[settings] password change failed: ${error.code ?? "no_code"} ` +
          `(status ${error.status ?? "?"}) — ${error.message}`,
      );
      return failed;
    }

    return {
      status: "sent",
      message: "Password updated.",
      attempt,
    };
  } catch (error) {
    console.error(`[settings] password change threw: ${describeError(error)}`);
    return failed;
  }
}


/**
 * Keyed on user id. Editing a target score is a once-in-a-while act; twenty an
 * hour is far past a person changing their mind and well short of useful for a
 * script.
 */
const studyPlanLimiter = createRateLimiter({
  limit: 20,
  windowMs: 60 * 60_000,
  prefix: "study-plan",
});

/**
 * Edits the three fields onboarding captured that legitimately change: target
 * score, daily goal and test date.
 *
 * The current-score estimate and the SAT history are deliberately absent. They
 * are the baseline progress is measured against, and a baseline you can edit
 * measures nothing. `update_study_plan()` cannot write them, cannot write
 * `onboarding_completed_at`, and refuses to run at all before onboarding is
 * finished — so this is not a back door into the flow.
 */
export async function updateStudyPlanAction(
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
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return failed;

    const rate = await studyPlanLimiter.check(user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
        attempt,
      };
    }

    const parsed = StudyPlanSchema.safeParse({
      targetScore: formData.get("targetScore"),
      dailyGoal: formData.get("dailyGoal"),
      testDate: formData.get("testDate"),
    });
    if (!parsed.success) return failed;

    // Same two failure shapes as the onboarding submit: `result.error` for a
    // PostgREST rejection (the function's own range guards land here, since a
    // direct call never met the schema above), and a throw for anything at the
    // transport layer. Both have to reach the generic message rather than a
    // 500 carrying a Postgres error string.
    const result = await supabase.rpc("update_study_plan", {
      p_target_score: parsed.data.targetScore,
      p_daily_goal: parsed.data.dailyGoal,
      p_test_date: parsed.data.testDate,
    });

    if (result.error) {
      console.error(
        `[settings] update_study_plan failed: ${result.error.code ?? "no_code"} — ${result.error.message}`,
      );
      return failed;
    }

    // `false` means the row was not matched — the caller has not onboarded, so
    // there is no plan to edit. Not something Settings can offer a fix for.
    if (result.data !== true) return failed;

    revalidatePath("/dashboard", "layout");

    return { status: "sent", message: "Study plan updated.", attempt };
  } catch (error) {
    console.error(`[settings] study plan update threw: ${describeError(error)}`);
    return failed;
  }
}
