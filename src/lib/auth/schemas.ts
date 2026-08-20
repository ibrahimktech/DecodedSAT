/**
 * Auth input schemas, shared by the client forms and the Server Actions.
 *
 * The client parses these to give people useful, field-level feedback while
 * they type. That is a UX affordance and nothing else — the Server Action
 * re-parses the exact same schemas against the submitted `FormData`, and only
 * that second parse is a security boundary. Anything reaching the action is
 * assumed hostile regardless of what the form did.
 */

import { z } from "zod";
import { TURNSTILE_SITE_KEY } from "@/lib/env";

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 100;
export const PASSWORD_MIN = 8;
/**
 * bcrypt — which is what Supabase hashes with — silently truncates at 72
 * bytes. Rejecting longer input is honest; accepting it would mean characters
 * past the cutoff have no effect on the stored hash.
 */
export const PASSWORD_MAX = 72;
/** RFC 5321 caps an address at 254 characters. */
export const EMAIL_MAX = 254;

const fullNameField = z
  .string()
  .trim()
  .min(FULL_NAME_MIN, "Enter your full name.")
  .max(FULL_NAME_MAX, `Keep this under ${FULL_NAME_MAX} characters.`);

/**
 * Trim and lowercase *before* validating, so " Me@Example.com " is accepted and
 * stored in one canonical form rather than rejected on whitespace.
 */
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(EMAIL_MAX));

const passwordField = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Keep this under ${PASSWORD_MAX} characters.`);

/**
 * Turnstile tokens are opaque and Cloudflare documents no fixed length, so the
 * bound is only a sanity cap to stop an unbounded string reaching Supabase.
 *
 * Deliberately NOT `.min(1)`. Whether a token is *required* depends on whether
 * a widget exists to produce one, which a schema cannot know — with
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` unset there is no challenge to solve, the
 * form posts an empty string, and a `.min(1)` here rejects every submission
 * before it reaches Supabase. Worse, it rejects it as a plain parse failure,
 * so the generic error surfaces with nothing in the server log to explain it.
 *
 * The requirement lives in `captchaTokenMissing()` below, which the actions
 * call once they know whether a captcha is configured at all.
 */
const captchaTokenField = z.string().max(4096);

export const SignupSchema = z.object({
  fullName: fullNameField,
  email: emailField,
  password: passwordField,
  captchaToken: captchaTokenField,
});

/**
 * Sign-in must not re-apply the signup password rules. Someone who registered
 * before a rule tightened still has to be able to log in, and telling a caller
 * their guess was "too short" leaks the shape of real passwords.
 */
export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(PASSWORD_MAX),
  captchaToken: captchaTokenField,
});

/**
 * Whether a submission is missing a captcha token it was supposed to carry.
 *
 * Only meaningful when a site key is configured; with no key there is no
 * widget, so an empty token is the correct and expected state rather than a
 * failure.
 *
 * This is a UX gate, not a security boundary — the same thing the widget's own
 * doc comment says. Supabase holds the Turnstile secret and verifies the token
 * itself, so a project with captcha protection enabled rejects a tokenless
 * request no matter what this function returns. That is what makes keying this
 * off an environment variable safe: unsetting the key in production does not
 * disable captcha, it just stops this app from pre-rejecting.
 */
export function captchaTokenMissing(token: string): boolean {
  return TURNSTILE_SITE_KEY !== "" && token.length === 0;
}

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Field-level errors for the client forms only.
 *
 * Never call this on the server response path — surfacing which field failed
 * is exactly the signal that makes automated probing cheap.
 */
export function fieldErrors(
  schema: typeof SignupSchema | typeof LoginSchema,
  values: Record<string, unknown>,
): Record<string, string> {
  const parsed = schema.safeParse(values);
  if (parsed.success) return {};

  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}
