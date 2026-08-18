import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ctaClassName } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeResults } from "@/lib/learn/data";
import { CHOICE_LETTERS, formatSeconds } from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Section results",
};

/**
 * Results for one completed run, read entirely from the database — the page
 * is refresh-safe and shareable-with-yourself; nothing depends on state from
 * the submit round trip. RLS makes another user's attempt id resolve to "not
 * found", and the solutions view only releases answer keys for runs that are
 * actually completed.
 */
export default async function PracticeResultsPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { supabase } = await requireUser();

  const { attemptId } = await params;
  if (!z.uuid().safeParse(attemptId).success) notFound();

  const results = await getPracticeResults(supabase, attemptId);
  if (!results) notFound();

  const missed = results.items.filter((item) => item.isCorrect === false);
  const unanswered = results.items.filter((item) => item.selectedChoice === null);

  return (
    <div className="mx-auto max-w-3xl">
      {/* --- Summary ------------------------------------------------------- */}
      <section className="rounded-2xl border border-hairline bg-surface p-8 text-center">
        <p className="text-[0.9375rem] font-semibold text-muted">
          {results.sectionTitle} · {results.domainName}
        </p>
        <p className="mt-3 font-display text-6xl font-extrabold text-ink">
          {results.score}
          <span className="text-3xl text-muted"> / {results.total}</span>
        </p>
        <p className="mt-2 text-[0.9375rem] text-muted">
          in {formatSeconds(results.timeTakenSeconds)} of a{" "}
          {formatSeconds(results.timeLimitSeconds)} limit
          {missed.length > 0 && ` · ${missed.length} missed`}
          {unanswered.length > 0 && ` · ${unanswered.length} unanswered`}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/practice" className={ctaClassName("primary")}>
            Back to practice tests
          </Link>
          <Link href="/dashboard" className={ctaClassName("secondary")}>
            Dashboard
          </Link>
        </div>
      </section>

      {/* --- Question review ----------------------------------------------- */}
      <section className="mt-6">
        <h2 className="font-display text-xl font-bold text-ink">
          Question review
        </h2>

        <ol className="mt-4 flex flex-col gap-4">
          {results.items.map((item) => {
            const wasCorrect = item.isCorrect === true;
            const wasAnswered = item.selectedChoice !== null;

            return (
              <li
                key={item.position}
                className={`rounded-2xl border bg-surface p-6 ${
                  wasCorrect
                    ? "border-hairline"
                    : "border-miss-hairline"
                }`}
              >
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-muted">
                    Question {item.position} · {item.subtopicName}
                  </p>
                  <p
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                      wasCorrect
                        ? "bg-accent-chip text-accent"
                        : wasAnswered
                          ? "bg-miss-surface text-miss-ink"
                          : "bg-background text-muted"
                    }`}
                  >
                    {wasCorrect
                      ? "Correct"
                      : wasAnswered
                        ? "Incorrect"
                        : "Not answered"}
                  </p>
                </header>

                <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink">
                  {item.prompt}
                </p>

                <ul className="mt-3 flex flex-col gap-1.5">
                  {item.choices.map((choice, choiceIndex) => {
                    const isYours = item.selectedChoice === choiceIndex;
                    const isRight = item.correctChoice === choiceIndex;
                    return (
                      <li
                        key={choiceIndex}
                        className={`flex items-center gap-3 rounded-lg border px-3.5 py-2 text-[0.9375rem] ${
                          isRight
                            ? "border-accent bg-accent-chip text-ink"
                            : isYours
                              ? "border-miss-hairline bg-miss-surface text-miss-ink"
                              : "border-transparent text-muted"
                        }`}
                      >
                        <span className="font-display font-bold">
                          {CHOICE_LETTERS[choiceIndex]}
                        </span>
                        <span>{choice}</span>
                        {isRight && (
                          <span className="ml-auto text-xs font-semibold text-accent">
                            correct answer
                          </span>
                        )}
                        {isYours && !isRight && (
                          <span className="ml-auto text-xs font-semibold">
                            your answer
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {!wasCorrect && item.explanation && (
                  <div className="mt-3 rounded-xl border border-insight-hairline bg-insight-surface p-4">
                    <p className="text-[0.9375rem] leading-relaxed text-ink">
                      {item.explanation}
                    </p>
                    {item.subtopicHasVideo && (
                      <p className="mt-2 text-[0.9375rem] text-insight-dark">
                        <Link
                          href={`/videos?subtopic=${item.subtopicSlug}`}
                          className="font-semibold underline"
                        >
                          Watch the {item.subtopicName} explainer
                        </Link>{" "}
                        to close this gap.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
