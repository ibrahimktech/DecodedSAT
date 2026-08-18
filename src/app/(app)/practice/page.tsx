import type { Metadata } from "next";
import Link from "next/link";
import { ctaClassName } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeSections } from "@/lib/learn/data";
import { formatSeconds } from "@/lib/learn/types";
import { startPracticeAttemptAction } from "./actions";

export const metadata: Metadata = {
  title: "Practice tests",
};

/**
 * Section-length, timed drills. Full-length adaptive tests are a later step,
 * deliberately absent here. Starting a section posts a plain form to the
 * start action; a section with an unfinished, unexpired run shows Resume
 * instead, pointing at the same run page that picks the attempt back up.
 */
export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await requireUser();
  const params = await searchParams;

  const sections = await getPracticeSections(supabase, user.id);

  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Practice tests
        </h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
          Timed, section-length drills. The clock starts when you do, and your
          score and time are saved when you submit.
        </p>
      </header>

      {params.error === "1" && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
        >
          That section couldn&apos;t be started. Please try again.
        </p>
      )}

      {sections.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-hairline bg-surface p-8 text-center text-[0.9375rem] text-muted">
          No practice sections are available yet — check back soon.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
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
                        {formatSeconds(section.active.remainingSeconds)} left on
                        the clock
                      </p>
                    </>
                  ) : (
                    <form action={startPracticeAttemptAction}>
                      <input
                        type="hidden"
                        name="sectionId"
                        value={section.id}
                      />
                      <button type="submit" className={ctaClassName("primary")}>
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
                      }).format(new Date(section.lastCompleted.completedAt))}
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
    </div>
  );
}
