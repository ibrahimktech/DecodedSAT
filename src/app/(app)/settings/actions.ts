"use server";

/**
 * Settings actions — just the password change for now.
 *
 * Runs against the caller's own session (`updateUser` affects whoever the
 * cookie says is signed in, nobody else), re-validates the new password
 * server-side with the same bounds signup enforces, and answers every failure
 * with the shared generic message. Success is safe to name: "password
 * updated" reveals nothing about anyone but the caller.
 */

import { describeError } from "@/lib/auth/describe-error";
import {
  type AuthFormState,
  GENERIC_ERROR_MESSAGE,
  rateLimitedMessage,
} from "@/lib/auth/state";
import { PasswordChangeSchema } from "@/lib/learn/schemas";
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
