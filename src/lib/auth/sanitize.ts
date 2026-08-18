/**
 * Normalisation applied to user-supplied text after validation, before it is
 * handed to Supabase and stored in `raw_user_meta_data`.
 *
 * Validation decides whether input is acceptable; this decides what gets
 * persisted. They are separate steps because a string can be perfectly valid
 * and still carry characters that cause trouble downstream.
 */

/**
 * Characters stripped from a display name:
 *
 * - `\p{Cc}` — C0/C1 control characters. A newline or NUL in a name breaks log
 *   lines and header values, and is never something a person typed on purpose.
 * - `\p{Cf}` — format characters, which includes the bidirectional overrides
 *   (U+202E and friends). Those let a name render as something other than what
 *   is stored, which is the classic display-spoofing trick.
 *
 * The tradeoff is that ZWNJ (U+200C) is also a format character, and a few
 * scripts use it meaningfully inside names. Dropping it degrades those names
 * slightly rather than rejecting them, which is the better failure.
 */
const DISALLOWED = /[\p{Cc}\p{Cf}]/gu;

/** Any run of whitespace collapses to a single space. */
const WHITESPACE_RUN = /\s+/g;

/**
 * Cleans a display name and caps its length.
 *
 * The cap is applied last, after stripping, so the limit counts characters that
 * actually survive rather than ones that were about to be removed.
 */
export function sanitizeFullName(value: string, maxLength: number): string {
  return value
    .replace(DISALLOWED, "")
    .replace(WHITESPACE_RUN, " ")
    .trim()
    .slice(0, maxLength);
}
