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
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APP_URL, AUTH_CALLBACK_URL } from "@/lib/env";
import { sanitizeFullName } from "@/lib/auth/sanitize";
import {
  FULL_NAME_MAX,
  FULL_NAME_MIN,
  SignupSchema,
  captchaTokenMissing,
} from "@/lib/auth/schemas";
import {
  type AuthFormState,
  CAPTCHA_ERROR_MESSAGE,
  GENERIC_ERROR_MESSAGE,
  rateLimitedMessage,
} from "@/lib/auth/state";
import { describeError } from "@/lib/auth/describe-error";
import { createRateLimiter, getClientIp, limitFromEnv } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sixty submissions per IP per fifteen minutes.
 *
 * Note "submissions", not "accounts": the check runs before validation, so a
 * form that fails Zod, fails captcha, or fails at Supabase still spends one.
 * That is deliberate — an attacker's malformed floods must cost them budget —
 * but it means the real consumer of this window is *retries*, not signups.
 *
 * The honest ceiling for one person is one account. The headroom exists for
 * shared NATs, sized by the realistic worst case: a teacher demoing
 * DecodedSAT to a class, where thirty students behind a single school IP all
 * sign up within a few minutes, and some of them mistype and retry.
 *
 * Raising it costs little, because the per-IP window is not what stops abuse
 * here. Turnstile gates every submission and Supabase verifies the token
 * before an account can exist, and Supabase's own auth limits sit behind this
 * one. This is defence in depth, not the boundary.
 */
const signupLimiter = createRateLimiter({
  limit: limitFromEnv("SIGNUP", 60),
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

  // A configured captcha that produced no token means the widget never
  // completed. Checked here rather than in the schema, so that an unconfigured
  // captcha (no site key, no widget) is not treated as a failed one.
  if (captchaTokenMissing(parsed.data.captchaToken)) return failed;

  // 3. Sanitise --------------------------------------------------------------
  const fullName = sanitizeFullName(parsed.data.fullName, FULL_NAME_MAX);
  if (fullName.length < FULL_NAME_MIN) {
    // The name was long enough to validate but consisted of characters that did
    // not survive sanitisation.
    return failed;
  }

  // 4. Sign up ---------------------------------------------------------------
  // Only true when the project has email confirmation disabled; see below.
  let signedIn = false;

  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: fullName },
        // Supabase holds the Turnstile secret and verifies this token itself.
        // Tokens are single-use, so we must not also call siteverify.
        // Empty means no captcha is configured. Send undefined rather than an
        // empty string, so Supabase skips verification instead of trying to
        // verify "" and failing.
        captchaToken: parsed.data.captchaToken || undefined,
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
      // Recoverable, and the person can only fix it by retrying — which the
      // widget reset (driven by `attempt`) sets them up to do.
      if (error.code === "captcha_failed") {
        return { status: "error", message: CAPTCHA_ERROR_MESSAGE, attempt };
      }

      if (error.code === "user_already_exists") {
        return { status: "sent", message: "", attempt };
      }

      if (error.status === 429) {
        // Supabase's *email sending* cap is the one people actually hit, and
        // it resets on the hour — not in sixty seconds. Telling someone to
        // "wait a minute" here is worse than saying nothing: they retry
        // immediately, every retry fails the same way, and the retries spend
        // this app's own IP budget until the login form starts refusing them
        // too. The honest number is what stops that loop.
        //
        // Project-wide condition, not an account-specific one, so saying it
        // plainly leaks nothing about whether an address is registered.
        const retryAfterSeconds =
          error.code === "over_email_send_rate_limit" ? 60 * 60 : 60;

        return {
          status: "rate_limited",
          message: rateLimitedMessage(retryAfterSeconds),
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

    // Supabase returns a session here only when "Confirm email" is turned off
    // for the project — the account is live immediately, no link was mailed,
    // and the confirmation triggers have already created the profile and stats
    // rows. Showing "check your email" in that case sends someone to an inbox
    // that will stay empty forever.
    //
    // Set outside the return so the redirect can happen after the try block.
    if (data.session) {
      signedIn = true;
    } else {
      // 5. Generic success. No session and no redirect — the account does not
      // really exist until the confirmation link fires the profiles trigger.
      return { status: "sent", message: "", attempt };
    }
  } catch (error) {
    // Missing env vars land here too, and get the same message as everything
    // else. Detail stays in the server log.
    console.error(`[auth] signup threw: ${describeError(error)}`);
    return failed;
  }

  // Outside the try on purpose — `redirect` signals by throwing, and catching
  // it above would turn a completed signup into a generic error.
  if (signedIn) {
    revalidatePath("/dashboard", "layout");
    // Straight to the app. The proxy sends them on to /onboarding, since a
    // brand new account has not been through it.
    redirect(APP_URL);
  }

  return failed;
}
