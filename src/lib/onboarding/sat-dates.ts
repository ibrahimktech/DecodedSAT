/**
 * College Board SAT Weekend administrations currently published for the
 * 2026–27 testing year. Keep machine values here; labels are derived so adding
 * a newly announced date is one small, reviewable change.
 *
 * School Day and special Sunday administrations deliberately do not belong in
 * this list.
 */
export const OFFICIAL_SAT_WEEKEND_DATES = [
  "2026-09-12",
  "2026-10-03",
  "2026-11-07",
  "2026-12-05",
  "2027-03-06",
  "2027-05-01",
  "2027-06-05",
] as const;

export type OfficialSatDate = (typeof OFFICIAL_SAT_WEEKEND_DATES)[number];

export type OfficialSatDateOption = {
  value: OfficialSatDate;
  label: string;
};

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Converts a calendar date to an ordinal without interpreting it as midnight
 * in either the browser's or server's timezone. UTC is only arithmetic here:
 * the year/month/day values are preserved exactly.
 */
function calendarDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.floor(timestamp / DAY_MS);
}

/** Today's calendar day in the runtime's local timezone. */
function localToday(now: Date): number {
  return Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS,
  );
}

export function isOfficialSatWeekendDate(
  value: string,
): value is OfficialSatDate {
  return (OFFICIAL_SAT_WEEKEND_DATES as readonly string[]).includes(value);
}

/**
 * True through the whole local calendar date, then false from the next local
 * midnight onward. No parsing of a formatted display string is involved.
 */
export function isAvailableOfficialSatDate(
  value: string,
  now = new Date(),
): value is OfficialSatDate {
  const testDay = calendarDay(value);
  return (
    isOfficialSatWeekendDate(value) &&
    testDay !== null &&
    testDay >= localToday(now)
  );
}

export function formatOfficialSatDate(value: string): string {
  const day = calendarDay(value);
  if (day === null) return value;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(day * DAY_MS));
}

export function getAvailableOfficialSatDates(
  now = new Date(),
): OfficialSatDateOption[] {
  return OFFICIAL_SAT_WEEKEND_DATES.filter((value) =>
    isAvailableOfficialSatDate(value, now),
  ).map((value) => ({ value, label: formatOfficialSatDate(value) }));
}
