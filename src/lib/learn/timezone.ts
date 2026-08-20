/**
 * The viewer's timezone, for the two surfaces that show a date as a date.
 *
 * ## Why this exists
 *
 * Every other date calculation in this project is UTC — `current_streak()`,
 * the daily goal, the section-drill timestamps. That is correct for arithmetic
 * nobody reads directly: it has no DST, no ambiguity, and it agrees with
 * itself everywhere.
 *
 * The Progress page and the dashboard heatmap are different. They print
 * "August 19" and expect the student to recognise their own August 19. A
 * student practising at 9pm in California is at 04:00 UTC the next day, so a
 * UTC heatmap files that session under tomorrow — visibly, repeatedly wrong to
 * a large share of the users this is built for.
 *
 * ## Why a cookie
 *
 * The server has no other way to know. The alternatives were:
 *
 *   * Store a timezone on the profile — a bigger change than this step wants,
 *     and it would need a UI and a migration to keep current.
 *   * Render the grouping on the client — that means shipping every raw
 *     timestamp to the browser and re-bucketing there, which is more data and
 *     a flash of the wrong layout.
 *
 * A cookie written once by `<TimeZoneSync />` costs one small header and lets
 * the grouping happen in SQL, where the rows already are.
 *
 * ## Where the halves live
 *
 * This module is PURE and importable from anywhere — `<TimeZoneSync />` is a
 * client component and needs the cookie's name and lifetime. Reading the
 * cookie needs `next/headers`, so it lives next door in
 * `@/lib/learn/viewer-timezone`, which is marked `server-only`. Keeping both
 * here is what makes `server-only` fire during the client build.
 *
 * ## Trust
 *
 * The value is client-supplied, so it is validated against a strict shape
 * here and checked against `pg_timezone_names` inside `daily_activity()`
 * before it reaches an `at time zone`. An unrecognised or malformed value
 * falls back to UTC rather than erroring — a browser reporting something odd
 * must not take the dashboard down. Nothing is authorised on the strength of
 * it; the worst a forged value can do is group the forger's own history
 * strangely.
 */

export const TIMEZONE_COOKIE = "dsat_tz";

/** One year. Re-set by `<TimeZoneSync />` whenever the browser disagrees. */
export const TIMEZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_TIME_ZONE = "UTC";

/**
 * IANA names look like `America/Los_Angeles`, `Europe/Kyiv`, `UTC`, or
 * `America/Argentina/Buenos_Aires` — up to three segments of letters, digits,
 * underscore, plus and minus. Anything else never reaches the database.
 */
const IANA_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

export function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  if (!IANA_PATTERN.test(value)) return false;

  // The runtime's own tz database is the real authority; the regex above only
  // keeps obvious junk out of it. `Intl` throws on a name it does not know.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * `2026-08-19` for a timestamp, in the given zone.
 *
 * `en-CA` because its short date format is already ISO-ordered, which makes
 * the result sortable as a string — the property the grouping depends on.
 * Building it from `formatToParts` instead would be the same work with more
 * moving pieces.
 */
export function localDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** `"August 19"`, or `"August 19, 2025"` once it is not this year. */
export function localDateLabel(
  date: Date,
  timeZone: string,
  currentYear: number,
): string {
  const year = Number.parseInt(localDateKey(date, timeZone).slice(0, 4), 10);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    ...(year === currentYear ? {} : { year: "numeric" }),
  }).format(date);
}
