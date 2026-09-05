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
import { cookies } from "next/headers";
import { deletePostHogPerson } from "@/lib/analytics/posthog-server";
import { describeError } from "@/lib/auth/describe-error";
import { ONBOARDED_COOKIE } from "@/lib/auth/onboarded-cookie";
import {
  type AuthFormState,
  GENERIC_ERROR_MESSAGE,
  rateLimitedMessage,
} from "@/lib/auth/state";
import { PasswordChangeSchema } from "@/lib/learn/schemas";
import { StudyPlanSchema } from "@/lib/onboarding/schemas";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

const deleteAccountLimiter = createRateLimiter({
  limit: 3,
  windowMs: 60 * 60_000,
  prefix: "delete-account",
});

export type DeleteAccountState = {
  status: "idle" | "error" | "deleted";
  message: string;
  attempt: number;
  posthogCleanup?: "deleted" | "not_found" | "not_configured" | "failed";
};

/** Authenticated, self-only permanent account deletion. */
export async function deleteAccountAction(
  previous: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const attempt = previous.attempt + 1;
  const failed = (message = "We couldn't delete your account. Your account is still active.") => ({
    status: "error" as const,
    message,
    attempt,
  });

  try {
    if (formData.get("confirmation") !== "DELETE") {
      return failed("Type DELETE exactly to confirm permanent deletion.");
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return failed();

    const { data: isAdmin, error: roleError } = await supabase.rpc("is_admin");
    if (roleError || isAdmin === true) return failed();

    const rate = await deleteAccountLimiter.check(user.id);
    if (!rate.ok) return failed("Too many attempts. Please wait and try again.");

    // Remove the external identifiable history first. If PostHog collection is
    // enabled, missing/failed privacy credentials block Auth deletion instead
    // of leaving an unreachable PostHog identity behind.
    let posthogCleanup: DeleteAccountState["posthogCleanup"] = "not_configured";
    try {
      posthogCleanup = await deletePostHogPerson(user.id);
    } catch (error) {
      console.error("[settings] PostHog account cleanup failed", { error });
      return failed("Account deletion is temporarily unavailable. Please try again.");
    }
    if (
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
      posthogCleanup === "not_configured"
    ) {
      console.error("[settings] PostHog is enabled without privacy deletion credentials");
      return failed("Account deletion is temporarily unavailable. Please try again.");
    }

    // The user id comes exclusively from the verified session. No caller can
    // supply another account id. Profile-owned data cascades only if Auth
    // deletion succeeds, avoiding a partially emptied live account.
    const admin = createSupabaseAdminClient();
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error(`[settings] auth user deletion failed: ${deleteError.message}`);
      return failed();
    }

    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // The Auth account is already gone; cookie deletion below is sufficient.
    }
    (await cookies()).delete(ONBOARDED_COOKIE);
    revalidatePath("/dashboard", "layout");

    return {
      status: "deleted",
      message: "Your account was permanently deleted.",
      attempt,
      posthogCleanup,
    };
  } catch (error) {
    console.error(`[settings] account deletion threw: ${describeError(error)}`);
    return failed();
  }
}

/**
 * Edits the three fields onboarding captured that legitimately change: target
 * score, daily goal and test date.
 *
 * The current-score estimate and the SAT history are deliberately absent. They
 * are the baseline progress is measured against, and a baseline you can edit
 * measures nothing. `update_study_plan()` cannot write them, cannot write
 * `onboarding_completed_at`, and refuses to run before onboarding is finished
 * except for admins, who are deliberately exempt from onboarding — so this is
 * not a back door into the flow for students.
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
      // A native select whose disabled placeholder is selected can be absent
      // from FormData. In this form that state means "not sure yet".
      testDate: formData.get("testDate") ?? "",
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

    // `false` means the row was not matched: the caller is neither onboarded
    // nor an onboarding-exempt admin, so there is no plan to edit here.
    if (result.data !== true) return failed;

    revalidatePath("/dashboard", "layout");

    return { status: "sent", message: "Study plan updated.", attempt };
  } catch (error) {
    console.error(`[settings] study plan update threw: ${describeError(error)}`);
    return failed;
  }
}
