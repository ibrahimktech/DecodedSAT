/**
 * Read-side data layer for the Progress page and the dashboard heatmap.
 *
 * Both pull from the same two activity tables — `question_bank_sessions` and
 * `practice_test_attempts` — and both are scoped to the caller by RLS. The
 * explicit `user_id` filters here are belt-and-braces, not the boundary.
 *
 * Dates are bucketed in the VIEWER'S timezone rather than UTC, which is the
 * one place this project departs from its own convention. `@/lib/learn/timezone`
 * explains why, and what it costs.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeError } from "@/lib/auth/describe-error";
import { localDateKey, localDateLabel } from "./timezone";
import type { PracticeTestAttemptStatus, TestType } from "./tests";

function logQueryError(label: string, error: unknown): void {
  console.error(`[progress] ${label} failed: ${describeError(error)}`);
}

// --- History -----------------------------------------------------------------

export type QuestionBankEntry = {
  kind: "question_bank";
  id: string;
  at: string;
  questionCount: number;
  correctCount: number;
  durationSeconds: number;
};

export type PracticeTestEntry = {
  kind: "practice_test";
  id: string;
  at: string;
  title: string;
  testType: TestType;
  correct: number;
  total: number;
  totalTimeSeconds: number;
  status: PracticeTestAttemptStatus;
};

export type ProgressEntry = QuestionBankEntry | PracticeTestEntry;

export type ProgressDay = {
  /** `YYYY-MM-DD` in the viewer's zone. Sortable, and a stable React key. */
  dateKey: string;
  /** `"August 19"` — what the heading shows. */
  label: string;
  entries: ProgressEntry[];
};

/**
 * Both activity streams, merged, newest first, grouped by local day.
 *
 * Two queries rather than a SQL union: the two shapes have almost nothing in
 * common beyond a timestamp, so a union would mean a wide nullable result set
 * and a cast on every column. Merging two typed lists in TypeScript is
 * cheaper to read and to change.
 *
 * Only CLOSED items appear. An open session or an in-progress attempt has no
 * duration and no score yet, and listing it would put a row on Progress that
 * changes under the reader. Callers finalize stale rows before calling this.
 */
export async function getProgressHistory(
  supabase: SupabaseClient,
  userId: string,
  timeZone: string,
  limit = 200,
): Promise<ProgressDay[]> {
  const [sessionsResult, attemptsResult] = await Promise.all([
    supabase
      .from("question_bank_sessions")
      .select(
        "id, started_at, ended_at, duration_seconds, question_count, correct_count",
      )
      .eq("user_id", userId)
      .not("ended_at", "is", null)
      // A sitting that recorded nothing is not history. The close functions
      // delete these, so this only catches rows from before that existed.
      .gt("question_count", 0)
      .order("started_at", { ascending: false })
      .limit(limit),
    supabase
      .from("practice_test_attempts")
      .select(
        "id, started_at, ended_at, status, correct_count, wrong_count, total_time_seconds, practice_tests!inner(title, test_type)",
      )
      .eq("user_id", userId)
      .neq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(limit),
  ]);

  if (sessionsResult.error) {
    logQueryError("sessions", sessionsResult.error);
  }
  if (attemptsResult.error) {
    logQueryError("test_attempts", attemptsResult.error);
  }

  const entries: ProgressEntry[] = [];

  for (const row of (sessionsResult.data ?? []) as Array<{
    id: string;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    question_count: number;
    correct_count: number;
  }>) {
    entries.push({
      kind: "question_bank",
      id: row.id,
      at: row.started_at,
      questionCount: row.question_count,
      correctCount: row.correct_count,
      durationSeconds: row.duration_seconds ?? 0,
    });
  }

  for (const row of (attemptsResult.data ?? []) as unknown as Array<{
    id: string;
    started_at: string;
    status: PracticeTestAttemptStatus;
    correct_count: number | null;
    wrong_count: number | null;
    total_time_seconds: number | null;
    practice_tests: { title: string; test_type: TestType };
  }>) {
    const correct = row.correct_count ?? 0;
    const wrong = row.wrong_count ?? 0;
    entries.push({
      kind: "practice_test",
      id: row.id,
      at: row.started_at,
      title: row.practice_tests.title,
      testType: row.practice_tests.test_type,
      correct,
      total: correct + wrong,
      totalTimeSeconds: row.total_time_seconds ?? 0,
      status: row.status,
    });
  }

  entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const currentYear = Number.parseInt(
    localDateKey(new Date(), timeZone).slice(0, 4),
    10,
  );

  const days = new Map<string, ProgressDay>();
  for (const entry of entries) {
    const date = new Date(entry.at);
    const dateKey = localDateKey(date, timeZone);

    let day = days.get(dateKey);
    if (!day) {
      day = {
        dateKey,
        label: localDateLabel(date, timeZone, currentYear),
        entries: [],
      };
      days.set(dateKey, day);
    }
    day.entries.push(entry);
  }

  // The Map preserves insertion order, and `entries` was already sorted
  // newest-first, so the days come out newest-first and each day's bullets
  // are newest-first within it — exactly what the spec asks for.
  return [...days.values()];
}

// --- Heatmap -----------------------------------------------------------------

export type ActivityDay = {
  dateKey: string;
  total: number;
  correct: number;
  wrong: number;
};

/** Roughly twelve weeks, the window the dashboard heatmap draws. */
export const HEATMAP_DAYS = 84;

/**
 * Questions attempted per local day, question bank and practice tests
 * combined.
 *
 * The bucketing happens in SQL (`daily_activity`) rather than here because
 * the alternative is shipping every raw timestamp to the server component and
 * re-grouping thousands of rows in JavaScript to produce 84 numbers.
 */
export async function getDailyActivity(
  supabase: SupabaseClient,
  timeZone: string,
  days = HEATMAP_DAYS,
): Promise<Map<string, ActivityDay>> {
  const byDate = new Map<string, ActivityDay>();

  const { data, error } = await supabase.rpc("daily_activity", {
    p_timezone: timeZone,
    p_days: days,
  });

  if (error) {
    logQueryError("daily_activity", error);
    return byDate;
  }

  for (const row of (data ?? []) as Array<{
    activity_date: string;
    total: number;
    correct: number;
    wrong: number;
  }>) {
    // Postgres renders a `date` as `YYYY-MM-DD`, which is already the key
    // shape — no parsing through a Date, which would reintroduce a timezone.
    byDate.set(row.activity_date, {
      dateKey: row.activity_date,
      total: row.total,
      correct: row.correct,
      wrong: row.wrong,
    });
  }

  return byDate;
}

/**
 * The grid the heatmap renders: `days` calendar days ending today, in the
 * viewer's zone, oldest first and padded so each column is one week starting
 * Sunday.
 *
 * Built by stepping local date keys rather than by adding 86,400,000ms to a
 * timestamp — the arithmetic version silently produces a duplicate or a gap
 * on the two days a year a DST zone's day is not 24 hours long.
 */
export function buildHeatmapDays(
  timeZone: string,
  days = HEATMAP_DAYS,
): { dateKey: string; date: Date }[] {
  const cells: { dateKey: string; date: Date }[] = [];
  const now = Date.now();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    // Noon UTC keeps the sampled instant far from either midnight, so the
    // local date it lands on is unambiguous in every zone.
    const sample = new Date(now - offset * 86_400_000);
    sample.setUTCHours(12, 0, 0, 0);
    const dateKey = localDateKey(sample, timeZone);

    if (cells.length > 0 && cells[cells.length - 1].dateKey === dateKey) {
      continue;
    }
    cells.push({ dateKey, date: sample });
  }

  return cells;
}
