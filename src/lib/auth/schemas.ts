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

export const SignupSchema = z.object({
  fullName: fullNameField,
  email: emailField,
  password: passwordField,
});

/**
 * Sign-in must not re-apply the signup password rules. Someone who registered
 * before a rule tightened still has to be able to log in, and telling a caller
 * their guess was "too short" leaks the shape of real passwords.
 */
export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(PASSWORD_MAX),
});

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
