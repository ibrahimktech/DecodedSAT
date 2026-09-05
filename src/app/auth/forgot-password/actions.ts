"use server";

import { headers } from "next/headers";
import {
  authErrorCode,
  resetRequestAuthFailure,
} from "@/lib/auth/error-messages";
import { fieldErrors, ForgotPasswordSchema } from "@/lib/auth/schemas";
import type { AuthFormState } from "@/lib/auth/state";
import { describeError } from "@/lib/auth/describe-error";
import { PASSWORD_RECOVERY_CALLBACK_URL } from "@/lib/env";
import { createRateLimiter, getClientIp, limitFromEnv } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RESET_REQUEST_SUCCESS_MESSAGE =
  "If an account exists for that email, we've sent a password reset link.";

const resetRequestLimiter = createRateLimiter({
  limit: limitFromEnv("PASSWORD_RESET_REQUEST", 10),
  windowMs: 15 * 60_000,
  prefix: "password-reset-request",
});

export async function requestPasswordResetAction(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const attempt = previous.attempt + 1;

  const rate = await resetRequestLimiter.check(getClientIp(await headers()));
  if (!rate.ok) {
    return {
      status: "rate_limited",
      message: "Too many reset requests. Please try again later.",
      attempt,
    };
  }

  const input = { email: formData.get("email") };
  const parsed = ForgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: "",
      fieldErrors: fieldErrors(ForgotPasswordSchema, input),
      attempt,
    };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      { redirectTo: PASSWORD_RECOVERY_CALLBACK_URL },
    );

    if (error) {
      console.error(
        `[auth] password reset request failed: ${error.code ?? "no_code"} ` +
          `(status ${error.status ?? "?"}) — ${error.message}`,
      );

      // These account-specific outcomes must look exactly like success. A
      // reset form may not become an email-address existence oracle.
      if (
        authErrorCode(error) === "user_not_found" ||
        authErrorCode(error) === "over_email_send_rate_limit"
      ) {
        return {
          status: "sent",
          message: RESET_REQUEST_SUCCESS_MESSAGE,
          attempt,
        };
      }

      return { ...resetRequestAuthFailure(error), attempt };
    }

    return {
      status: "sent",
      message: RESET_REQUEST_SUCCESS_MESSAGE,
      attempt,
    };
  } catch (error) {
    console.error(
      `[auth] password reset request threw: ${describeError(error)}`,
    );
    return { ...resetRequestAuthFailure(error), attempt };
  }
}
