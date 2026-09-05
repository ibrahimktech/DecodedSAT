"use server";

/**
 * Sign-in Server Action.
 *
 * No Supabase call leaves the server. Stable provider error codes are mapped
 * to a small set of contextual messages; raw provider text remains server-only.
 * A nonexistent account and a wrong password deliberately share one response.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { APP_URL } from "@/lib/env";
import { loginAuthFailure } from "@/lib/auth/error-messages";
import { fieldErrors, LoginSchema } from "@/lib/auth/schemas";
import { type AuthFormState } from "@/lib/auth/state";
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
 * account-keyed limiter below exists and is kept tight.
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

  const rate = await loginIpLimiter.check(getClientIp(await headers()));
  if (!rate.ok) {
    return {
      status: "rate_limited",
      message: "Too many login attempts. Please try again later.",
      attempt,
    };
  }

  const input = {
    email: formData.get("email"),
    password: formData.get("password"),
  };
  const parsed = LoginSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "error",
      message: "",
      fieldErrors: fieldErrors(LoginSchema, input),
      attempt,
    };
  }

  const accountRate = await loginAccountLimiter.check(
    await accountKey(parsed.data.email),
  );
  if (!accountRate.ok) {
    return {
      status: "rate_limited",
      message: "Too many login attempts. Please try again later.",
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
    });

    if (error) {
      console.error(
        `[auth] sign-in failed: ${error.code ?? "no_code"} ` +
          `(status ${error.status ?? "?"}) — ${error.message}`,
      );

      return { ...loginAuthFailure(error), attempt };
    }

    const adminCheck = await supabase.rpc("is_admin");
    if (adminCheck.error) {
      console.error(`[auth] is_admin rpc failed: ${adminCheck.error.message}`);
    }
    isAdmin = adminCheck.data === true;
  } catch (error) {
    console.error(`[auth] sign-in threw: ${describeError(error)}`);
    return { ...loginAuthFailure(error), attempt };
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
