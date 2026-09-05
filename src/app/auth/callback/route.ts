/**
 * Email confirmation and password-recovery callback.
 *
 * Where the link in the signup confirmation email lands. Supabase sends one of
 * two shapes depending on how the email template is written — an authorization
 * `code` (the PKCE default) or a `token_hash` + `type` pair — so both are
 * handled here. Supporting only one means a template edit in the dashboard
 * silently breaks every confirmation with no code change to blame.
 *
 * There is no `next` / `redirect_to` parameter. The destination is a constant
 * read from the environment, which means this route cannot be turned into an
 * open redirect by decorating the confirmation link.
 */

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { APP_URL, SITE_URL } from "@/lib/env";
import { isNetworkError } from "@/lib/auth/error-messages";
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_COOKIE_OPTIONS,
} from "@/lib/auth/recovery-session";
import { createRateLimiter, getClientIp, limitFromEnv } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Reads cookies and hits the network — never prerender or cache this. */
export const dynamic = "force-dynamic";

/**
 * Twenty redemptions per IP per ten minutes.
 *
 * This is an unauthenticated endpoint that makes a network call to Supabase on
 * every hit, so it is worth something to an attacker on two counts: guessing
 * token hashes, and using us to generate load against our own auth provider.
 *
 * The ceiling is set well above honest use. One person confirms once, but mail
 * clients prefetch links, people double-click, and a school NAT puts a whole
 * class behind one address — all of which have to fit under the limit.
 */
const callbackLimiter = createRateLimiter({
  limit: limitFromEnv("AUTH_CALLBACK", 20),
  windowMs: 10 * 60_000,
  prefix: "auth-callback",
});

/**
 * 429 with a body, per CLAUDE.md — not a silent failure and not a bare status.
 *
 * Unlike the JSON routes `withApi` wraps, someone reaches this URL by clicking
 * a link in their email, so the body is a page rather than a JSON envelope. It
 * says nothing about why, and offers the way back.
 */
function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Too many attempts</title>` +
      `<p>Too many email-link attempts. Please wait a few minutes, then ` +
      `<a href="${SITE_URL}/auth/login">sign in</a>.</p>`,
    {
      status: 429,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Only the email flows this app actually issues. The raw query-string value is
 * never passed through without allowlist validation.
 */
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "email",
  "recovery",
]);

/** One destination for every failure. The reason goes to the server log. */
function toLoginWithError(): NextResponse {
  return NextResponse.redirect(`${SITE_URL}/auth/login?error=confirm`);
}

function toResetWithError(code?: string | null): NextResponse {
  const reason =
    code === "otp_expired"
      ? "expired"
      : code === "request_timeout"
        ? "connection"
        : "invalid";
  return NextResponse.redirect(
    `${SITE_URL}/auth/reset-password?error=${reason}`,
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Before any parsing or network work, so a flood costs us nothing.
  const rate = await callbackLimiter.check(getClientIp(request));
  if (!rate.ok) {
    console.error("[auth] callback rate limited");
    return tooManyRequests(rate.retryAfterSeconds);
  }

  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const recoveryIntent =
    searchParams.get("intent") === "recovery" || type === "recovery";

  // How Supabase reports an expired or already-used confirmation link.
  const providerError = searchParams.get("error");
  const providerErrorDescription = searchParams.get("error_description");
  if (providerError || providerErrorDescription) {
    const providerErrorCode = searchParams.get("error_code");
    console.error(
      `[auth] callback received provider error: ${providerErrorCode ?? providerError ?? "no_code"}`,
    );
    return recoveryIntent
      ? toResetWithError(providerErrorCode)
      : toLoginWithError();
  }

  const code = searchParams.get("code");
  const flowId = searchParams.get("sb_flow_id");
  let recoveryUserId: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();

    if (code) {
      // PKCE: redeems the code against the verifier cookie set when signup
      // started. A code stolen in transit is useless without that cookie.
      const { data, error } = await supabase.auth.exchangeCodeForSession(
        code,
        flowId ? { flowId } : undefined,
      );
      if (error) {
        console.error(
          `[auth] code exchange failed: ${error.code ?? "no_code"} ` +
            `(status ${error.status ?? "?"})`,
        );
        return recoveryIntent
          ? toResetWithError(error.code)
          : toLoginWithError();
      }
      // auth-js returns this runtime discriminator for PKCE recovery exchanges,
      // though older public supabase-js wrapper types omit it.
      const redirectType = (
        data as typeof data & { redirectType?: string | null }
      ).redirectType;
      if (redirectType === "recovery" || recoveryIntent) {
        recoveryUserId = data.user.id;
      }
    } else if (tokenHash && type && ALLOWED_OTP_TYPES.has(type as EmailOtpType)) {
      const { data, error } = await supabase.auth.verifyOtp({
        type: type as EmailOtpType,
        token_hash: tokenHash,
      });
      if (error) {
        console.error(
          `[auth] otp verification failed: ${error.code ?? "no_code"} ` +
            `(status ${error.status ?? "?"})`,
        );
        return type === "recovery"
          ? toResetWithError(error.code)
          : toLoginWithError();
      }
      if (type === "recovery" && data.user) {
        recoveryUserId = data.user.id;
      }
    } else {
      // Someone opened /auth/callback directly, or the link was mangled.
      console.error("[auth] callback hit with no usable credential");
      return recoveryIntent ? toResetWithError() : toLoginWithError();
    }
  } catch (error) {
    const networkFailure = isNetworkError(error);
    // Never stringify this exception here: a recovery callback handles
    // credentials, and provider/runtime exceptions are not guaranteed to omit
    // request details. Classification is enough for an operational signal.
    console.error(
      `[auth] callback threw (${networkFailure ? "network" : "unexpected"})`,
    );
    return recoveryIntent
      ? toResetWithError(networkFailure ? "request_timeout" : undefined)
      : toLoginWithError();
  }

  if (recoveryUserId) {
    (await cookies()).set(
      PASSWORD_RECOVERY_COOKIE,
      recoveryUserId,
      PASSWORD_RECOVERY_COOKIE_OPTIONS,
    );
    return NextResponse.redirect(`${SITE_URL}/auth/reset-password`);
  }

  // The session cookies written during the exchange ride out on this response.
  //
  // Note for when the dashboard moves to app.<domain>.com: these cookies are
  // scoped to SITE_URL's host, so a cross-subdomain APP_URL will land the user
  // on a page that cannot see them. That split needs Supabase's cookie domain
  // set to `.<domain>.com` — see the notes in `@/lib/env`.
  return NextResponse.redirect(APP_URL);
}
