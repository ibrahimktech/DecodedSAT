/**
 * The value auth Server Actions return to their form, shared so the forms and
 * the actions cannot drift apart.
 *
 * Imported by client components, so this module must stay free of server-only
 * imports.
 */

export type AuthFormStatus =
  /** Nothing submitted yet. */
  | "idle"
  /** Signup accepted; the confirmation email is on its way. */
  | "sent"
  /** Anything that went wrong. Deliberately undifferentiated. */
  | "error"
  /** Too many attempts from this IP. */
  | "rate_limited";

export type AuthFormState = {
  status: AuthFormStatus;
  /** Safe to render. Never contains a provider message or a field name. */
  message: string;
  /**
   * Incremented by the action on every submission.
   *
   * The form feeds this to the Turnstile widget as a reset signal. Turnstile
   * tokens are single-use, so after any response the token in hand is spent —
   * without a reset, a retry submits a burnt token and fails for a reason the
   * person cannot see or fix.
   */
  attempt: number;
};

export const initialAuthFormState: AuthFormState = {
  status: "idle",
  message: "",
  attempt: 0,
};

/**
 * The only failure message the signup and login paths ever show.
 *
 * One string for every cause — bad password, malformed email, Supabase
 * unreachable, missing env vars — because a response that varies with the
 * cause is an oracle. Detail goes to `console.error` on the server instead.
 */
export const GENERIC_ERROR_MESSAGE =
  "We couldn't complete that request. Please check your details and try again.";

/** Shown when the caller has burnt their budget for the window. */
/**
 * Shown when Cloudflare rejects the token — almost always `timeout-or-duplicate`,
 * meaning it expired (they sat on the form) or was already redeemed (they came
 * back to a restored page).
 *
 * Deliberately NOT the generic message. Captcha state says nothing about
 * whether an account exists, so naming it leaks nothing — and the generic
 * "check your details" is actively misleading here, because their details are
 * fine and re-typing them changes nothing. The widget resets on the same
 * attempt counter, so a second try succeeds.
 */
export const CAPTCHA_ERROR_MESSAGE =
  "That verification check expired. We've reset it — please try again.";

export function rateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1
    ? "Too many attempts. Please wait a minute and try again."
    : `Too many attempts. Please try again in about ${minutes} minutes.`;
}
