import type { Metadata } from "next";
import Link from "next/link";
import { CtaButton } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import {
  finalizeOpenQuestionBankSessions,
  finalizeStalePracticeTestAttempts,
} from "@/lib/learn/data";
import { getProgressHistory, type ProgressEntry } from "@/lib/learn/progress";
import { getViewerTimeZone } from "@/lib/learn/viewer-timezone";
import { formatDuration } from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Progress",
};

/**
 * Everything you've done, newest first, grouped by day.
 *
 * Question bank sittings are summary-only this step (per-question review for
 * them is explicitly deferred). Practice test bullets link to the full review,
 * where every question sits next to the right answer.
 *
 * Dates group in the viewer's timezone, so "August 19" means their August 19 —
 * see `@/lib/learn/timezone` for why this page departs from the project's UTC
 * convention and what it costs.
 */
export default async function ProgressPage() {
  const { supabase, user } = await requireUser();

  // This page is not the question player and not a live test, so anything
  // still open is genuinely over. Closing first means the history below never
  // shows a row that is still changing.
  //
  // `getViewerTimeZone` rides along rather than following: it is a cookie read
  // with no network behind it (see `@/lib/learn/viewer-timezone`), so there is
  // nothing to gain by making it queue. The history read still comes after,
  // because that is the ordering the paragraph above is about.
  const [, , timeZone] = await Promise.all([
    finalizeOpenQuestionBankSessions(supabase),
    finalizeStalePracticeTestAttempts(supabase),
    getViewerTimeZone(),
  ]);

  const days = await getProgressHistory(supabase, user.id, timeZone);

  return (
    <div className="mx-auto max-w-3xl">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Progress
        </h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
          Every question bank sitting and every practice test, most recent
          first.
        </p>
      </header>

      {days.length === 0 ? (
        <section className="mt-10 rounded-2xl border border-hairline bg-surface p-8 text-center">
          <h2 className="font-display text-xl font-bold text-ink">
            Nothing here yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[0.9375rem] leading-relaxed text-muted">
            Answer a few questions or sit a practice test, and this fills in
            with what you did and how long it took.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <CtaButton href="/questions">Open the question bank</CtaButton>
            <CtaButton href="/practice" variant="secondary">
              Take a practice test
            </CtaButton>
          </div>
        </section>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          {days.map((day) => (
            <section key={day.dateKey} aria-label={day.label}>
              <h2 className="font-display text-lg font-bold text-ink">
                {day.label}
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {day.entries.map((entry) => (
                  <li key={`${entry.kind}-${entry.id}`}>
                    <EntryRow entry={entry} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: ProgressEntry }) {
  if (entry.kind === "question_bank") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-hairline bg-surface px-5 py-3.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full bg-accent"
        />
        <span className="text-[0.9375rem] text-ink">
          <strong className="font-semibold">{entry.questionCount}</strong>{" "}
          question{entry.questionCount === 1 ? "" : "s"} from question bank
        </span>
        <span className="text-[0.9375rem] text-muted">
          · {entry.correctCount}/{entry.questionCount} correct ·{" "}
          {formatDuration(entry.durationSeconds)}
        </span>
      </div>
    );
  }

  return (
    <Link
      href={`/practice/tests/review/${entry.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-hairline bg-surface px-5 py-3.5 transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rounded-full bg-insight"
      />
      <span className="text-[0.9375rem] text-ink">
        <strong className="font-semibold">{entry.title}</strong> (
        {entry.testType === "full" ? "Full" : "Half"})
      </span>
      <span className="text-[0.9375rem] text-muted">
        · {entry.correct}/{entry.total} correct ·{" "}
        {formatDuration(entry.totalTimeSeconds)}
      </span>
      {entry.status === "abandoned_auto_submitted" && (
        <span className="rounded-lg bg-insight-chip px-2 py-0.5 text-xs font-semibold text-insight-dark">
          auto-submitted
        </span>
      )}
      <span className="ml-auto shrink-0 text-sm font-semibold text-accent">
        Review →
      </span>
    </Link>
  );
}
