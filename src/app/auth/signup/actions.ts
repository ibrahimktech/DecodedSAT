"use server";

/**
 * Signup Server Action.
 *
 * Everything below runs on the server. The client never touches
 * `supabase.auth.signUp` — it posts a `FormData` and receives a status string,
 * so the browser bundle contains no Supabase auth calls at all.
 *
 * Order of operations, which is itself a security property:
 *
 *   1. Rate limit by IP — before any parsing, so a flood costs us nothing
 *   2. Re-validate every field against the same Zod schema the form used
 *   3. Sanitise the display name
 *   4. Hand off to Supabase with the captcha token
 *   5. Return one of a small set of generic outcomes
 */

import { headers } from "next/headers";
import { AUTH_CALLBACK_URL } from "@/lib/env";
import { sanitizeFullName } from "@/lib/auth/sanitize";
import { FULL_NAME_MAX, FULL_NAME_MIN, SignupSchema } from "@/lib/auth/schemas";
import {
  type AuthFormState,
  GENERIC_ERROR_MESSAGE,
  rateLimitedMessage,
} from "@/lib/auth/state";
import { describeError } from "@/lib/auth/describe-error";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Thirty accounts per IP per fifteen minutes.
 *
 * The honest ceiling for one person is one — nobody signs up twice by
 * accident. The headroom exists entirely for shared NATs, and it is sized by
 * the realistic worst case: a teacher demoing DecodedSAT to a class, where
 * thirty students behind a single school IP all sign up within a few minutes.
 * At a limit of five, twenty-five of them are locked out for a quarter of an
 * hour and the demo is over.
 *
 * Raising it costs little, because the per-IP window is not what stops abuse
 * here. Turnstile gates every submission and Supabase verifies the token
 * before an account can exist, and Supabase's own auth limits sit behind this
 * one. This is defence in depth, not the boundary.
 */
const signupLimiter = createRateLimiter({
  limit: 30,
  windowMs: 15 * 60_000,
  prefix: "signup",
});

export async function signUpAction(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const attempt = previous.attempt + 1;
  const failed: AuthFormState = {
    status: "error",
    message: GENERIC_ERROR_MESSAGE,
    attempt,
  };

  // 1. Rate limit ------------------------------------------------------------
  const rate = await signupLimiter.check(getClientIp(await headers()));
  if (!rate.ok) {
    return {
      status: "rate_limited",
      message: rateLimitedMessage(rate.retryAfterSeconds),
      attempt,
    };
  }

  // 2. Validate --------------------------------------------------------------
  // `FormData.get` yields `string | File | null`; the schema rejects all three
  // non-string cases without any pre-checking here.
  const parsed = SignupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    captchaToken: formData.get("captchaToken"),
  });

  if (!parsed.success) {
    // No field names, no issue list. The form already told the person what was
    // wrong client-side; a bot gets nothing it can iterate against.
    return failed;
  }

  // 3. Sanitise --------------------------------------------------------------
  const fullName = sanitizeFullName(parsed.data.fullName, FULL_NAME_MAX);
  if (fullName.length < FULL_NAME_MIN) {
    // The name was long enough to validate but consisted of characters that did
    // not survive sanitisation.
    return failed;
  }

  // 4. Sign up ---------------------------------------------------------------
  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: fullName },
        // Supabase holds the Turnstile secret and verifies this token itself.
        // Tokens are single-use, so we must not also call siteverify.
        captchaToken: parsed.data.captchaToken,
        // Never hardcoded — see `@/lib/env` for why this is SITE_URL-based.
        emailRedirectTo: AUTH_CALLBACK_URL,
      },
    });

    if (error) {
      // Interpolated, not passed as an object: Next's dev logger renders
      // object arguments as "{}", which is how the real cause of a broken
      // signup stays invisible while looking like it is being logged.
      //
      // `message` is included deliberately. It is the difference between
      // "signup is broken" and "captcha_failed: invalid-input-response", and
      // this is a server log — the client still receives only the generic
      // string below. Withholding it here buys no security and costs an hour.
      console.error(
        `[auth] signup failed: ${error.code ?? "no_code"} ` +
          `(status ${error.status ?? "?"}) — ${error.message}`,
      );

      // Supabase's own enumeration protection, when enabled in the dashboard,
      // returns success for an address that already exists. When it is off,
      // the same case arrives here as an error. Reporting "sent" either way
      // makes our surface behave identically regardless of that setting, so a
      // prober cannot use this action to test whether an address is registered.
      if (error.code === "user_already_exists") {
        return { status: "sent", message: "", attempt };
      }

      if (error.status === 429) {
        return {
          status: "rate_limited",
          message: rateLimitedMessage(60),
          attempt,
        };
      }

      return failed;
    }

    // With enumeration protection on, an existing address comes back as a user
    // with an empty `identities` array and no email is sent. Same response.
    if (data.user && data.user.identities?.length === 0) {
      return { status: "sent", message: "", attempt };
    }

    // 5. Generic success. No session and no redirect — the account does not
    // really exist until the confirmation link fires the profiles trigger.
    return { status: "sent", message: "", attempt };
  } catch (error) {
    // Missing env vars land here too, and get the same message as everything
    // else. Detail stays in the server log.
    console.error(`[auth] signup threw: ${describeError(error)}`);
    return failed;
  }
}
