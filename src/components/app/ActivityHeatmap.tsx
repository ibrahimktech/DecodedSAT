/**
 * Twelve weeks of practice, one square per day.
 *
 * A server component. Every date is formatted here and handed down as a
 * finished string, so the interactive grid below ships no date logic and there
 * is no timezone for the two sides to disagree about.
 *
 * Intensity is the total questions attempted that day — question bank and
 * practice test responses combined, which is why one full test lights a square
 * as brightly as a long question bank session.
 *
 * Days are the VIEWER'S days. `@/lib/learn/timezone` explains why this and
 * the Progress page depart from the project's UTC convention, and that the
 * streak card beside it may therefore disagree by one day for a late-night
 * session.
 */

import Link from "next/link";
import {
  HeatmapGrid,
  LEVEL_CLASS,
  type HeatmapCell,
  type HeatmapLevel,
} from "@/components/app/HeatmapGrid";
import type { ActivityDay } from "@/lib/learn/progress";

/**
 * Four filled steps plus empty.
 *
 * The thresholds are absolute rather than relative to the student's own
 * maximum: a scale that renormalises means a good week makes an ordinary day
 * look worse than it did yesterday, which is the opposite of what a streak
 * visual is for. Twenty is the schema's default daily goal, so the top step
 * reads as "hit the goal and then some".
 */
function levelFor(total: number): HeatmapLevel {
  if (total === 0) return 0;
  if (total < 5) return 1;
  if (total < 12) return 2;
  if (total < 25) return 3;
  return 4;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function ActivityHeatmap({
  cells,
  activity,
  timeZone,
}: {
  cells: { dateKey: string; date: Date }[];
  activity: Map<string, ActivityDay>;
  timeZone: string;
}) {
  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const described: HeatmapCell[] = cells.map((cell) => {
    const day = activity.get(cell.dateKey);
    const total = day?.total ?? 0;
    const label = dayFormatter.format(cell.date);

    return {
      dateKey: cell.dateKey,
      level: levelFor(total),
      summary:
        total === 0
          ? `${label}: nothing practised`
          : `${label}: ${total} question${total === 1 ? "" : "s"}, ${day?.correct ?? 0} correct, ${day?.wrong ?? 0} wrong`,
    };
  });

  /**
   * Lay out as columns of seven, starting on the Sunday at or before the first
   * cell — so rows line up with weekdays the way a calendar does. The leading
   * blanks are decorative padding, not days.
   */
  const firstWeekday = cells.length > 0 ? weekdayIn(cells[0].date, timeZone) : 0;
  const slots: (HeatmapCell | null)[] = [
    ...Array.from<HeatmapCell | null>({ length: firstWeekday }).fill(null),
    ...described,
  ];

  const weeks: (HeatmapCell | null)[][] = [];
  for (let start = 0; start < slots.length; start += 7) {
    weeks.push(slots.slice(start, start + 7));
  }

  const activeDays = described.filter((cell) => cell.level > 0).length;
  const totalQuestions = cells.reduce(
    (sum, cell) => sum + (activity.get(cell.dateKey)?.total ?? 0),
    0,
  );

  return (
    <section
      aria-label="Practice activity, last 12 weeks"
      className="min-w-0 rounded-2xl border border-hairline bg-surface px-3 py-5 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-ink">
          Last 12 weeks
        </h2>
        <p className="text-sm text-muted">
          {totalQuestions} question{totalQuestions === 1 ? "" : "s"} over{" "}
          {activeDays} day{activeDays === 1 ? "" : "s"}
        </p>
      </div>

      <HeatmapGrid weeks={weeks} weekdayLabels={WEEKDAY_LABELS} />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/progress"
          className="text-sm font-semibold text-accent transition-colors hover:text-accent-hover"
        >
          See full progress →
        </Link>

        <p aria-hidden className="flex items-center gap-1.5 text-xs text-muted">
          Less
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span
              key={level}
              className={`h-3 w-3 rounded-[0.1875rem] border ${LEVEL_CLASS[level]}`}
            />
          ))}
          More
        </p>
      </div>
    </section>
  );
}

/** 0 = Sunday, in the given zone. */
function weekdayIn(date: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const index = WEEKDAY_LABELS.indexOf(short as (typeof WEEKDAY_LABELS)[number]);
  return index === -1 ? 0 : index;
}
