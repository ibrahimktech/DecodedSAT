import type { Metadata } from "next";
import Link from "next/link";
import { CtaButton } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import { finalizeStalePracticeTestAttempts } from "@/lib/learn/data";
import { listPracticeTests } from "@/lib/learn/tests";
import { DIFFICULTY_LABELS } from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Practice",
};

export default async function PracticePage() {
  const { supabase, user } = await requireUser();

  // Anything abandoned gets scored before it is listed, so a test the student
  // walked out of shows its real result rather than a stale "in progress".
  await finalizeStalePracticeTestAttempts(supabase);

  const tests = await listPracticeTests(supabase, user.id);

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Practice
        </h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
          Full and half tests run on real SAT timing.
        </p>
      </header>

      <nav
        aria-label="Practice type"
        className="mt-6 flex border-b border-hairline"
      >
        <Link
          href="/practice"
          aria-current="page"
          className="-mb-px border-b-2 border-accent px-4 py-2.5 text-[0.9375rem] font-semibold text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Full &amp; half tests
        </Link>
      </nav>

      <section aria-label="Full and half practice tests" className="mt-6">
        {tests.length === 0 ? (
          <p className="rounded-2xl border border-hairline bg-surface p-8 text-center text-[0.9375rem] text-muted">
            No practice tests are available yet — check back soon.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {tests.map((test) => (
              <article
                key={test.id}
                className="rounded-2xl border border-hairline bg-surface p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-accent">
                        {test.testType === "full" ? "Full test" : "Half test"}
                      </span>
                      <span className="rounded-lg bg-insight-chip px-2.5 py-1 text-insight-dark">
                        {DIFFICULTY_LABELS[test.difficulty]}
                      </span>
                    </p>
                    <h2 className="mt-2 font-display text-xl font-bold text-ink">
                      {test.title}
                    </h2>
                    {test.description && (
                      <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted">
                        {test.description}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-muted">
                      {test.questionCount} questions ·{" "}
                      {test.moduleCount === 2
                        ? "2 modules of 35 minutes"
                        : "1 module of 35 minutes"}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <CtaButton href={`/practice/tests/${test.id}`}>
                      {test.inProgressAttemptId ? "Resume" : "Start"}
                    </CtaButton>
                    {test.inProgressAttemptId && (
                      <p className="text-sm font-medium text-insight-dark">
                        In progress
                      </p>
                    )}
                  </div>
                </div>

                {(test.lastResult || test.bestScore) && (
                  <p className="mt-4 border-t border-hairline pt-3 text-sm text-muted">
                    {test.lastResult && (
                      <>
                        Last:{" "}
                        <Link
                          href={`/practice/tests/review/${test.lastResult.attemptId}`}
                          className="font-semibold text-accent transition-colors hover:text-accent-hover"
                        >
                          {test.lastResult.correct}/{test.lastResult.total}
                        </Link>{" "}
                        on{" "}
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                        }).format(new Date(test.lastResult.endedAt))}
                        {test.lastResult.status ===
                          "abandoned_auto_submitted" && (
                          <span className="text-insight-dark">
                            {" "}
                            (auto-submitted)
                          </span>
                        )}
                      </>
                    )}
                    {test.lastResult && test.bestScore && " · "}
                    {test.bestScore && (
                      <>
                        Best:{" "}
                        <strong className="text-ink">
                          {test.bestScore.correct}/{test.bestScore.total}
                        </strong>
                      </>
                    )}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
