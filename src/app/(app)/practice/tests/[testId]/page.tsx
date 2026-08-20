import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ctaClassName } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import { finalizeStalePracticeTestAttempts } from "@/lib/learn/data";
import { getPracticeTest, listPracticeTests } from "@/lib/learn/tests";
import { DIFFICULTY_LABELS, formatDuration } from "@/lib/learn/types";
import { beginPracticeTestAction } from "../actions";

export const metadata: Metadata = {
  title: "Practice test",
};

/**
 * The start screen: what this test is, how long it takes, and one button.
 *
 * The rules are spelled out before the clock exists, because every one of them
 * is irreversible once it does — a submitted module cannot be reopened, and a
 * module 2 that has started cannot be paused.
 *
 * The route param is untrusted URL input: anything that is not a UUID is a 404
 * before it reaches a query, and RLS scopes the query itself.
 */
export default async function PracticeTestStartPage({
  params,
  searchParams,
}: {
  params: Promise<{ testId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await requireUser();

  const { testId } = await params;
  const parsedId = z.uuid().safeParse(testId);
  if (!parsedId.success) notFound();

  // Before reading "is there an attempt in progress", make sure any abandoned
  // one has been scored — otherwise this offers to resume a test whose clock
  // ran out hours ago.
  await finalizeStalePracticeTestAttempts(supabase);

  const [test, summaries, resolvedSearch] = await Promise.all([
    getPracticeTest(supabase, parsedId.data),
    listPracticeTests(supabase, user.id),
    searchParams,
  ]);

  if (!test) notFound();

  const summary = summaries.find((entry) => entry.id === test.id);
  const resuming = Boolean(summary?.inProgressAttemptId);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/practice"
        className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface px-4 py-2 text-[0.9375rem] font-medium text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M19 12H5" />
          <path d="m11 18-6-6 6-6" />
        </svg>
        Back to practice
      </Link>

      <header className="mt-6">
        <p className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-accent">
            {test.testType === "full" ? "Full test" : "Half test"}
          </span>
          <span className="rounded-lg bg-insight-chip px-2.5 py-1 text-insight-dark">
            {DIFFICULTY_LABELS[test.difficulty]}
          </span>
        </p>
        <h1 className="mt-3 font-display text-3xl font-extrabold text-ink sm:text-4xl">
          {test.title}
        </h1>
        {test.description && (
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
            {test.description}
          </p>
        )}
      </header>

      {resolvedSearch.error === "1" && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
        >
          That test couldn&apos;t be started. Please try again.
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-semibold text-muted">Questions</dt>
            <dd className="mt-1 font-display text-2xl font-extrabold text-ink">
              {test.questionCount}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">Modules</dt>
            <dd className="mt-1 font-display text-2xl font-extrabold text-ink">
              {test.moduleCount}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-muted">Total time</dt>
            <dd className="mt-1 font-display text-2xl font-extrabold text-ink">
              {formatDuration(test.totalSeconds)}
            </dd>
          </div>
        </dl>

        <div className="mt-6 border-t border-hairline pt-5">
          <h2 className="font-display text-lg font-bold text-ink">
            Before you start
          </h2>
          <ul className="mt-2 flex flex-col gap-2 text-[0.9375rem] leading-relaxed text-muted">
            <li>
              Each module is 35 minutes for 22 questions. When the clock hits
              zero the module submits itself with whatever you&apos;ve
              answered.
            </li>
            {test.moduleCount === 2 && (
              <li>
                After module 1 you get a Continue screen. Module 2&apos;s clock
                doesn&apos;t start until you press it — but don&apos;t wander
                off, since the test auto-submits if you sit there too long.
              </li>
            )}
            <li>
              Answers save as you pick them, so a closed tab won&apos;t lose
              your work — though the test will submit itself if you don&apos;t
              come back.
            </li>
            <li>
              Submitting a module is final. You can&apos;t go back to it.
            </li>
            <li>Unanswered questions count as wrong.</li>
          </ul>
        </div>

        <form action={beginPracticeTestAction} className="mt-6">
          <input type="hidden" name="testId" value={test.id} />
          <button type="submit" className={ctaClassName("primary")}>
            {resuming ? "Resume test" : "Start test"}
          </button>
        </form>

        {resuming && (
          <p className="mt-3 text-sm font-medium text-insight-dark">
            You have this test in progress — resuming picks up the module and
            clock you left.
          </p>
        )}
      </section>

      {summary?.lastResult && (
        <p className="mt-4 text-center text-[0.9375rem] text-muted">
          Last time:{" "}
          <Link
            href={`/practice/tests/review/${summary.lastResult.attemptId}`}
            className="font-semibold text-accent transition-colors hover:text-accent-hover"
          >
            {summary.lastResult.correct}/{summary.lastResult.total} — see the
            review
          </Link>
        </p>
      )}
    </div>
  );
}
