/**
 * Normalisation for admin-supplied content text, applied after Zod validation
 * and before anything is stored.
 *
 * Same doctrine as `@/lib/auth/sanitize`: validation decides whether input is
 * acceptable, this decides what persists. Question prompts and explanations
 * legitimately contain newlines (worked examples read line by line), so there
 * are two flavours here where names only needed one.
 *
 * A string that is *all* control characters sanitizes to empty; callers do
 * not need to special-case that — the database import function re-checks for
 * empty fields and rejects the row with a reason.
 */

/**
 * Format characters (`\p{Cf}`) go entirely — that class includes the
 * bidirectional overrides that make text render as something other than what
 * is stored, which in a question prompt would be a way to display a different
 * question than the one being graded.
 */
const FORMAT_CHARS = /\p{Cf}/gu;

/** Control characters except newline (U+000A) and tab (U+0009). */
const CONTROL_EXCEPT_BREAKS = new RegExp("[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]", "g");

/**
 * Multi-line text: prompts, explanations, descriptions. Newlines survive;
 * `\r\n` collapses to `\n` because `\r` is in the stripped range.
 */
export function sanitizeMultiline(value: string, maxLength: number): string {
  return value
    .replace(FORMAT_CHARS, "")
    .replace(CONTROL_EXCEPT_BREAKS, "")
    .trim()
    .slice(0, maxLength);
}

/** Single-line text: titles, names, ids, choice texts. */
export function sanitizeLine(value: string, maxLength: number): string {
  return sanitizeMultiline(value, maxLength).replace(/\s+/g, " ").trim();
}
