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
  /** Safe to render. Never contains a raw provider message. */
  message: string;
  /** Safe, contextual validation errors keyed to the associated form field. */
  fieldErrors?: Record<string, string>;
  /**
   * Incremented by the action on every submission. Forms key their field
   * subtree on it so a completed attempt remounts cleanly.
   */
  attempt: number;
};

export const initialAuthFormState: AuthFormState = {
  status: "idle",
  message: "",
  attempt: 0,
};

/**
 * Generic failure for non-auth forms that share this state shape.
 *
 * Login, signup and password recovery use contextual, provider-code-based
 * messages. Raw provider text still never reaches the browser.
 */
export const GENERIC_ERROR_MESSAGE =
  "We couldn't complete that request. Please check your details and try again.";

/** Shown when the caller has burnt their budget for the window. */
export function rateLimitedMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1
    ? "Too many attempts. Please wait a minute and try again."
    : `Too many attempts. Please try again in about ${minutes} minutes.`;
}
