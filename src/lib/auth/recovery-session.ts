/**
 * Short-lived server-readable marker for a Supabase password-recovery session.
 *
 * The value is the authenticated Supabase user id, never a recovery token.
 * Supabase remains the authority: reset actions also call `getUser()` and only
 * update that authenticated account. This cookie keeps a recovery session on
 * the reset screen and prevents an ordinary signed-in session from opening it.
 */

import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

export const PASSWORD_RECOVERY_COOKIE = "decoded-password-recovery";
export const PASSWORD_RECOVERY_WINDOW_SECONDS = 30 * 60;

export const PASSWORD_RECOVERY_COOKIE_OPTIONS = {
  ...AUTH_COOKIE_OPTIONS,
  maxAge: PASSWORD_RECOVERY_WINDOW_SECONDS,
} as const;

export const CLEARED_PASSWORD_RECOVERY_COOKIE_OPTIONS = {
  ...AUTH_COOKIE_OPTIONS,
  maxAge: 0,
} as const;
