import type { Metadata } from "next";
import Link from "next/link";
import { ctaClassName, CtaButton } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import {
  finalizeStalePracticeTestAttempts,
  getPracticeSections,
} from "@/lib/learn/data";
import { listPracticeTests } from "@/lib/learn/tests";
import { DIFFICULTY_LABELS, formatSeconds } from "@/lib/learn/types";
import { startPracticeAttemptAction } from "./actions";

export const metadata: Metadata = {
  title: "Practice",
};

/**
 * The practice hub: two shelves under one nav item.
 *
 * **Full & half tests** are the real thing — two 35-minute modules of 22
 * questions (or one, for a half), with the module rules the digital SAT
 * actually has.
 *
 * **Section drills** are the shorter, single-timer runs from step 4. They are
 * untouched by this step and keep their own routes (`/practice/[sectionId]`,
 * `/practice/results/[attemptId]`); the tab below is just how you reach them
 * now that tests share the page.
 *
 * The tab is a query param rather than client state, so it survives reload,
 * back, and being linked to — the same doctrine as every other filter here.
 */
type Tab = "tests" | "drills";

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await requireUser();
  const params = await searchParams;

  // Anything abandoned gets scored before it is listed, so a test the student
  // walked out of shows its real result rather than a stale "in progress".
  await finalizeStalePracticeTestAttempts(supabase);

  const tab: Tab = params.tab === "drills" ? "drills" : "tests";

  const [tests, sections] = await Promise.all([
    listPracticeTests(supabase, user.id),
    getPracticeSections(supabase, user.id),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Practice
        </h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
          Full and half tests run on real SAT timing. Section drills are
          shorter, single-topic runs for when you have twenty minutes.
        </p>
      </header>

      <nav
        aria-label="Practice type"
        className="mt-6 flex gap-2 border-b border-hairline"
      >
        <TabLink href="/practice" active={tab === "tests"}>
          Full &amp; half tests
        </TabLink>
        <TabLink href="/practice?tab=drills" active={tab === "drills"}>
          Section drills
        </TabLink>
      </nav>

      {params.error === "1" && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
        >
          That section couldn&apos;t be started. Please try again.
        </p>
      )}

      {tab === "tests" ? (
        <section aria-label="Full and half practice tests" className="mt-6">
          {tests.length === 0 ? (
            <p className="rounded-2xl border border-hairline bg-surface p-8 text-center text-[0.9375rem] text-muted">
              No practice tests are available yet — check back soon. In the
              meantime,{" "}
              <Link
                href="/practice?tab=drills"
                className="font-semibold text-accent transition-colors hover:text-accent-hover"
              >
                the section drills
              </Link>{" "}
              are ready to go.
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
      ) : (
        <section aria-label="Section drills" className="mt-6">
          {sections.length === 0 ? (
            <p className="rounded-2xl border border-hairline bg-surface p-8 text-center text-[0.9375rem] text-muted">
              No section drills are available yet — check back soon.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {sections.map((section) => (
                <article
                  key={section.id}
                  className="rounded-2xl border border-hairline bg-surface p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">
                        <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-accent">
                          {section.domainName}
                        </span>
                      </p>
                      <h2 className="mt-2 font-display text-xl font-bold text-ink">
                        {section.title}
                      </h2>
                      {section.description && (
                        <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted">
                          {section.description}
                        </p>
                      )}
                      <p className="mt-2 text-sm text-muted">
                        {section.questionCount} questions ·{" "}
                        {Math.round(section.timeLimitSeconds / 60)} minute limit
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {section.active ? (
                        <>
                          <Link
                            href={`/practice/${section.id}`}
                            className={ctaClassName("primary")}
                          >
                            Resume
                          </Link>
                          <p className="text-sm font-medium text-insight-dark">
                            {formatSeconds(section.active.remainingSeconds)} left
                            on the clock
                          </p>
                        </>
                      ) : (
                        <form action={startPracticeAttemptAction}>
                          <input
                            type="hidden"
                            name="sectionId"
                            value={section.id}
                          />
                          <button
                            type="submit"
                            className={ctaClassName("primary")}
                          >
                            Start
                          </button>
                        </form>
                      )}
                    </div>
                  </div>

                  {(section.lastCompleted || section.bestScore) && (
                    <p className="mt-4 border-t border-hairline pt-3 text-sm text-muted">
                      {section.lastCompleted && (
                        <>
                          Last:{" "}
                          <strong className="text-ink">
                            {section.lastCompleted.score}/
                            {section.lastCompleted.total}
                          </strong>{" "}
                          on{" "}
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                          }).format(
                            new Date(section.lastCompleted.completedAt),
                          )}
                        </>
                      )}
                      {section.lastCompleted && section.bestScore && " · "}
                      {section.bestScore && (
                        <>
                          Best:{" "}
                          <strong className="text-ink">
                            {section.bestScore.score}/{section.bestScore.total}
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
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px border-b-2 px-4 py-2.5 text-[0.9375rem] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? "border-accent text-accent"
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
