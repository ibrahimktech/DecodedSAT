import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MathText } from "@/components/app/MathText";
import { CtaButton } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeTestReview } from "@/lib/learn/tests";
import { CHOICE_LETTERS, formatDuration } from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Practice test review",
};

/**
 * Every question in a finished test, with what was picked next to what was
 * right, and the explanation.
 *
 * The answer key arrives through `attempted_question_solutions`, which
 * releases a question's key only once the caller has actually finished a test
 * containing it. An attempt still in progress resolves to null and 404s here,
 * so there is no URL that opens the key early.
 *
 * Reached from the Progress page (practice test bullets are clickable, spec
 * section 8) and from the practice list.
 */
export default async function PracticeTestReviewPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { supabase } = await requireUser();

  const { attemptId } = await params;
  const parsedId = z.uuid().safeParse(attemptId);
  if (!parsedId.success) notFound();

  // RLS scopes this to the caller's own attempts, so someone else's id is
  // "not found" rather than "forbidden".
  const review = await getPracticeTestReview(supabase, parsedId.data);
  if (!review) notFound();

  const percent =
    review.total > 0 ? Math.round((review.correct / review.total) * 100) : 0;

  const modules = [
    ...new Set(review.items.map((item) => item.moduleNumber)),
  ].sort();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/progress"
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
        Back to progress
      </Link>

      <header className="mt-6 rounded-2xl border border-hairline bg-surface p-6 text-center">
        <p className="text-sm font-semibold text-muted">
          {review.testType === "full" ? "Full test" : "Half test"} ·{" "}
          {new Intl.DateTimeFormat("en-US", {
            month: "long",
            day: "numeric",
          }).format(new Date(review.endedAt))}
        </p>
        <h1 className="mt-1 font-display text-2xl font-extrabold text-ink sm:text-3xl">
          {review.title}
        </h1>
        <p className="mt-4 font-display text-5xl font-extrabold text-ink">
          {review.correct}
          <span className="text-3xl text-muted">/{review.total}</span>
        </p>
        <p className="mt-1 text-[0.9375rem] text-muted">
          {percent}% · {formatDuration(review.totalTimeSeconds)}
        </p>

        {review.status === "abandoned_auto_submitted" && (
          <p className="mt-4 rounded-xl bg-insight-chip px-4 py-3 text-[0.9375rem] text-insight-dark">
            This test was submitted automatically — the clock ran out while you
            were away. Everything you answered before that was scored normally.
          </p>
        )}

        <div className="mt-6">
          <CtaButton href={`/practice/tests/${review.testId}`} variant="secondary">
            Take it again
          </CtaButton>
        </div>
      </header>

      {modules.map((moduleNumber) => {
        const items = review.items.filter(
          (item) => item.moduleNumber === moduleNumber,
        );

        return (
          <section key={moduleNumber} className="mt-8">
            {review.testType === "full" && (
              <h2 className="font-display text-xl font-bold text-ink">
                Module {moduleNumber}
              </h2>
            )}

            <ol className="mt-3 flex flex-col gap-4">
              {items.map((item, itemIndex) => {
                const unanswered = item.selectedChoice === null;

                return (
                  <li
                    key={`${moduleNumber}-${item.position}-${itemIndex}`}
                    className={`rounded-2xl border p-5 ${
                      item.isCorrect
                        ? "border-accent bg-surface"
                        : unanswered
                          ? "border-hairline bg-surface"
                          : "border-miss-hairline bg-surface"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-muted">
                        Question {itemIndex + 1}
                      </p>
                      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-accent">
                          {item.subtopicName}
                        </span>
                        {item.isCorrect ? (
                          <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-accent">
                            Correct
                          </span>
                        ) : unanswered ? (
                          <span className="rounded-lg bg-background px-2.5 py-1 text-muted">
                            Not answered
                          </span>
                        ) : (
                          <span className="rounded-lg bg-miss-surface px-2.5 py-1 text-miss-ink">
                            Incorrect
                          </span>
                        )}
                      </p>
                    </div>

                    <MathText
                      as="p"
                      text={item.prompt}
                      className="mt-3 font-question text-base leading-7 whitespace-pre-line text-ink"
                    />

                    <ul className="mt-4 flex flex-col gap-2">
                      {item.choices.map((choice, choiceIndex) => {
                        const isCorrectChoice =
                          choiceIndex === item.correctChoice;
                        const isPicked = choiceIndex === item.selectedChoice;

                        return (
                          <li
                            key={choiceIndex}
                            className={`flex items-center gap-3 rounded-xl border px-4 py-3 font-question text-[1.0625rem] leading-7 ${
                              isCorrectChoice
                                ? "border-accent bg-accent-chip text-ink"
                                : isPicked
                                  ? "border-miss-hairline bg-miss-surface text-miss-ink"
                                  : "border-hairline bg-surface text-muted"
                            }`}
                          >
                            <span className="font-question font-bold">
                              {CHOICE_LETTERS[choiceIndex]}
                            </span>
                            <MathText text={choice} />
                            {isPicked && (
                              <span className="ml-auto shrink-0 text-xs font-semibold">
                                your answer
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {item.explanation && (
                      <MathText
                        as="p"
                        text={item.explanation}
                        className="mt-4 rounded-xl bg-background px-4 py-3 font-question text-base leading-7 whitespace-pre-line text-ink"
                      />
                    )}

                    {/* The decode loop: a miss points at the explainer for the
                        exact gap, not at more practice. */}
                    {!item.isCorrect && item.subtopicHasVideo && (
                      <p className="mt-3 rounded-lg bg-insight-chip px-3 py-2.5 text-[0.9375rem] text-insight-dark">
                        This gap has an explainer:{" "}
                        <Link
                          href={`/videos?subtopic=${item.subtopicSlug}`}
                          className="font-semibold underline"
                        >
                          watch the {item.subtopicName} video
                        </Link>
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
