"use server";

/**
 * Sign-in Server Action.
 *
 * Same shape as signup: no Supabase call ever leaves the server, and every
 * failure returns one indistinguishable message. Sign-in is the more sensitive
 * of the two — a response that differs between "no such account" and "wrong
 * password" turns the form into an account-existence oracle — so the generic
 * message here is load-bearing, not politeness.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APP_URL } from "@/lib/env";
import { LoginSchema, captchaTokenMissing } from "@/lib/auth/schemas";
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
 * Guesses from one address, sized for a shared NAT rather than a single
 * person: a school computer lab or a class signing in together arrives as one
 * IP, and at a limit of ten most of that room is locked out.
 *
 * This is the weaker of the two login limits by design. An attacker willing to
 * rotate source addresses walks straight past it, which is exactly why the
 * account-keyed limiter below exists and is kept tight. Turnstile also gates
 * every submission before either limiter is consulted.
 */
const loginIpLimiter = createRateLimiter({
  limit: limitFromEnv("LOGIN_IP", 100),
  windowMs: 10 * 60_000,
  prefix: "login-ip",
});

/**
 * A second budget keyed on the account being targeted, because credential
 * stuffing rotates source IPs and would otherwise slip past the limiter above.
 *
 * The tradeoff is that someone can burn a specific account's budget on purpose.
 * That is why this is a rate limit and not a lockout: it expires on its own in
 * fifteen minutes, needs no support intervention, and the bound is set high
 * enough that a person mistyping their own password never reaches it.
 */
const loginAccountLimiter = createRateLimiter({
  limit: limitFromEnv("LOGIN_ACCOUNT", 25),
  windowMs: 15 * 60_000,
  prefix: "login-account",
});

/**
 * Keys the account limiter without writing anyone's address into Redis in
 * clear text. The limiter only needs a stable identifier, not a readable one.
 */
async function accountKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(email),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export async function logInAction(
  previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const attempt = previous.attempt + 1;
  const failed: AuthFormState = {
    status: "error",
    message: GENERIC_ERROR_MESSAGE,
    attempt,
  };

  const rate = await loginIpLimiter.check(getClientIp(await headers()));
  if (!rate.ok) {
    return {
      status: "rate_limited",
      message: rateLimitedMessage(rate.retryAfterSeconds),
      attempt,
    };
  }

  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    captchaToken: formData.get("captchaToken"),
  });

  if (!parsed.success) return failed;

  // See the signup action: required only when a captcha is actually configured.
  if (captchaTokenMissing(parsed.data.captchaToken)) return failed;

  const accountRate = await loginAccountLimiter.check(
    await accountKey(parsed.data.email),
  );
  if (!accountRate.ok) {
    return {
      status: "rate_limited",
      message: rateLimitedMessage(accountRate.retryAfterSeconds),
      attempt,
    };
  }

  // Whether this fresh session belongs to an admin, decided by the database's
  // `is_admin()` through the user's own session — never a client-supplied
  // flag. Fails closed: if the RPC errors, the admin lands on the student
  // dashboard and can still reach /admin by URL, rather than a student ever
  // landing on /admin.
  let isAdmin = false;

  try {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
      // Supabase verifies this against the secret held in its dashboard.
      // Empty means no captcha is configured; undefined skips verification
      // rather than asking Supabase to verify an empty string.
      options: { captchaToken: parsed.data.captchaToken || undefined },
    });

    if (error) {
      // `email_not_confirmed` is deliberately folded in with bad credentials:
      // distinguishing it would confirm the address is registered.
      console.error(
        `[auth] sign-in failed: ${error.code ?? "no_code"} ` +
          `(status ${error.status ?? "?"}) — ${error.message}`,
      );
      // Unlike bad credentials, this says nothing about whether the account
      // exists — so naming it costs no enumeration protection and saves the
      // person from re-typing a password that was never the problem.
      if (error.code === "captcha_failed") {
        return { status: "error", message: CAPTCHA_ERROR_MESSAGE, attempt };
      }

      return failed;
    }

    const adminCheck = await supabase.rpc("is_admin");
    if (adminCheck.error) {
      console.error(`[auth] is_admin rpc failed: ${adminCheck.error.message}`);
    }
    isAdmin = adminCheck.data === true;
  } catch (error) {
    console.error(`[auth] sign-in threw: ${describeError(error)}`);
    return failed;
  }

  // Outside the try block on purpose — `redirect` signals by throwing, and
  // catching it here would turn a successful sign-in into a generic error.
  //
  // Scoped to the signed-in subtree rather than "/": the landing page is
  // `force-static` and has no per-user content, so revalidating from the root
  // would discard its prerender on every single sign-in for no benefit.
  if (isAdmin) {
    revalidatePath("/admin", "layout");
    redirect("/admin");
  }
  revalidatePath("/dashboard", "layout");
  redirect(APP_URL);
}
