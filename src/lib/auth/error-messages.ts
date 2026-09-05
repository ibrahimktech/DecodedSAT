/**
 * Safe, contextual messages for Supabase Auth failures.
 *
 * Supabase's stable `code` is the discriminator. Provider `message` text is
 * deliberately ignored: it is useful in server logs, but it is not a stable
 * API and can contain implementation detail that should not reach a user.
 */

import { PASSWORD_MIN } from "@/lib/auth/schemas";

export type AuthFailure = {
  status: "error" | "rate_limited";
  message: string;
};

export const NETWORK_ERROR_MESSAGE =
  "Unable to connect. Check your internet connection and try again.";
export const UNEXPECTED_AUTH_ERROR_MESSAGE =
  "Something went wrong. Please try again.";

type AuthErrorDetails = {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
  cause?: unknown;
};

function details(error: unknown): AuthErrorDetails {
  return error && typeof error === "object" ? (error as AuthErrorDetails) : {};
}

export function authErrorCode(error: unknown): string | undefined {
  return details(error).code;
}

export function isAuthRateLimit(error: unknown): boolean {
  const { code, status } = details(error);
  return (
    status === 429 ||
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    code === "over_sms_send_rate_limit"
  );
}

export function isNetworkError(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 3 && current; depth += 1) {
    const value = details(current);
    const text = `${value.name ?? ""} ${value.message ?? ""} ${value.code ?? ""}`;

    if (
      value.code === "request_timeout" ||
      value.name === "AuthRetryableFetchError" ||
      /failed to fetch|fetch failed|network|econn|enotfound|etimedout/i.test(text)
    ) {
      return true;
    }

    current = value.cause;
  }

  return false;
}

export function loginAuthFailure(error: unknown): AuthFailure {
  const code = authErrorCode(error);

  if (code === "invalid_credentials" || code === "user_not_found") {
    return { status: "error", message: "Incorrect email or password." };
  }
  if (code === "email_not_confirmed") {
    return {
      status: "error",
      message: "Please verify your email before signing in.",
    };
  }
  if (code === "email_address_invalid") {
    return { status: "error", message: "Enter a valid email address." };
  }
  if (isAuthRateLimit(error)) {
    return {
      status: "rate_limited",
      message: "Too many login attempts. Please try again later.",
    };
  }
  if (isNetworkError(error)) {
    return { status: "error", message: NETWORK_ERROR_MESSAGE };
  }
  return { status: "error", message: UNEXPECTED_AUTH_ERROR_MESSAGE };
}

export function signupAuthFailure(error: unknown): AuthFailure {
  const code = authErrorCode(error);

  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    code === "identity_already_exists"
  ) {
    return {
      status: "error",
      message: "An account with this email already exists.",
    };
  }
  if (code === "email_address_invalid") {
    return { status: "error", message: "Enter a valid email address." };
  }
  if (code === "weak_password") {
    return {
      status: "error",
      message: `Password must be at least ${PASSWORD_MIN} characters.`,
    };
  }
  if (isAuthRateLimit(error)) {
    return {
      status: "rate_limited",
      message: "Too many signup attempts. Please try again later.",
    };
  }
  if (isNetworkError(error)) {
    return { status: "error", message: NETWORK_ERROR_MESSAGE };
  }
  return { status: "error", message: UNEXPECTED_AUTH_ERROR_MESSAGE };
}

export function resetRequestAuthFailure(error: unknown): AuthFailure {
  if (isAuthRateLimit(error)) {
    return {
      status: "rate_limited",
      message: "Too many reset requests. Please try again later.",
    };
  }
  if (isNetworkError(error)) {
    return { status: "error", message: NETWORK_ERROR_MESSAGE };
  }
  return { status: "error", message: UNEXPECTED_AUTH_ERROR_MESSAGE };
}

const INVALID_SESSION_CODES = new Set([
  "bad_jwt",
  "no_authorization",
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
]);

export function passwordUpdateAuthFailure(error: unknown): AuthFailure {
  const code = authErrorCode(error);

  if (code === "weak_password") {
    return {
      status: "error",
      message: `Password must be at least ${PASSWORD_MIN} characters.`,
    };
  }
  if (code === "same_password") {
    return {
      status: "error",
      message: "Choose a password you haven't used for this account.",
    };
  }
  if (code === "otp_expired") {
    return {
      status: "error",
      message: "This password reset link has expired. Request a new one.",
    };
  }
  if (code && INVALID_SESSION_CODES.has(code)) {
    return {
      status: "error",
      message: "This password reset link is invalid or has already been used.",
    };
  }
  if (isAuthRateLimit(error)) {
    return {
      status: "rate_limited",
      message: "Too many password update attempts. Please try again later.",
    };
  }
  if (isNetworkError(error)) {
    return { status: "error", message: NETWORK_ERROR_MESSAGE };
  }
  return { status: "error", message: UNEXPECTED_AUTH_ERROR_MESSAGE };
}
