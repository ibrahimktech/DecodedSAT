"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  passwordUpdateAuthFailure,
} from "@/lib/auth/error-messages";
import {
  fieldErrors,
  ResetPasswordSchema,
} from "@/lib/auth/schemas";
import type { AuthFormState } from "@/lib/auth/state";
import { describeError } from "@/lib/auth/describe-error";
import {
  CLEARED_PASSWORD_RECOVERY_COOKIE_OPTIONS,
  PASSWORD_RECOVERY_COOKIE,
} from "@/lib/auth/recovery-session";
import { createRateLimiter, getClientIp, limitFromEnv } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const resetUpdateLimiter = createRateLimiter({
  limit: limitFromEnv("PASSWORD_RESET_UPDATE", 10),
  windowMs: 15 * 60_000,
  prefix: "password-reset-update",
});

const INVALID_LINK_MESSAGE =
  "This password reset link is invalid or has already been used.";

export async function updateRecoveredPasswordAction(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const attempt = previous.attempt + 1;

  const rate = await resetUpdateLimiter.check(getClientIp(await headers()));
  if (!rate.ok) {
    return {
      status: "rate_limited",
      message: "Too many password update attempts. Please try again later.",
      attempt,
    };
  }

  const input = {
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };
  const parsed = ResetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "",
      fieldErrors: fieldErrors(ResetPasswordSchema, input),
      attempt,
    };
  }

  const cookieStore = await cookies();

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.error(
        `[auth] recovery session check failed: ${userError.code ?? "no_code"} ` +
          `(status ${userError.status ?? "?"}) — ${userError.message}`,
      );
      return { ...passwordUpdateAuthFailure(userError), attempt };
    }

    if (
      !user ||
      cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value !== user.id
    ) {
      return { status: "error", message: INVALID_LINK_MESSAGE, attempt };
    }

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error) {
      console.error(
        `[auth] recovered password update failed: ${error.code ?? "no_code"} ` +
          `(status ${error.status ?? "?"}) — ${error.message}`,
      );
      return { ...passwordUpdateAuthFailure(error), attempt };
    }

    // End the short-lived recovery session. The user signs in normally with
    // the new password, and cannot accidentally browse the app in a session
    // that was created only to authorize this one change.
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "local",
    });
    if (signOutError) {
      console.error(
        `[auth] recovery sign-out failed: ${signOutError.code ?? "no_code"} ` +
          `(status ${signOutError.status ?? "?"}) — ${signOutError.message}`,
      );
    }

    cookieStore.set(
      PASSWORD_RECOVERY_COOKIE,
      "",
      CLEARED_PASSWORD_RECOVERY_COOKIE_OPTIONS,
    );
  } catch (error) {
    console.error(`[auth] recovered password update threw: ${describeError(error)}`);
    return {
      ...passwordUpdateAuthFailure(error),
      attempt,
    };
  }

  // Outside the try block: Next implements redirect by throwing a control-flow
  // signal, which must not be folded into an auth failure.
  revalidatePath("/dashboard", "layout");
  redirect("/auth/login?password_reset=1");
}
