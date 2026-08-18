"use client";

/**
 * One-at-a-time question flow for the question bank.
 *
 * The player holds no answer key. It ships questions without verdicts, sends
 * the chosen index to the grading action, and renders whatever comes back —
 * correctness, the right answer and the explanation only ever exist client-
 * side after an attempt is already recorded server-side.
 *
 * A miss shows the explanation plus a link to the subtopic's explainer video
 * when one exists — the decode loop this product is named after.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { submitQuestionAttemptAction } from "@/app/(app)/questions/actions";
import { ctaClassName } from "@/components/CtaButton";
import {
  CHOICE_LETTERS,
  DIFFICULTY_LABELS,
  type PlayableQuestion,
  type QuestionVerdict,
} from "@/lib/learn/types";

type OkVerdict = Extract<QuestionVerdict, { status: "ok" }>;

type QuestionPlayerProps = {
  questions: PlayableQuestion[];
  /** Back to the filter picker (current filters, minus `start`). */
  changeFiltersHref: string;
};

export function QuestionPlayer({
  questions,
  changeFiltersHref,
}: QuestionPlayerProps) {
  const router = useRouter();

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<OkVerdict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);

  const question = questions[index];
  const answered = verdict !== null;

  async function checkAnswer() {
    if (selected === null || answered || submitting) return;
    setSubmitting(true);
    setFailure(null);

    const result = await submitQuestionAttemptAction({
      questionId: question.id,
      choice: selected,
    });

    setSubmitting(false);

    if (result.status !== "ok") {
      // Rate limit or server trouble: keep the question live so the person
      // can retry — nothing was necessarily recorded.
      setFailure(result.message);
      return;
    }

    setVerdict(result);
    if (result.isCorrect) setCorrectCount((count) => count + 1);
  }

  function next() {
    if (index + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setIndex(index + 1);
    setSelected(null);
    setVerdict(null);
    setFailure(null);
  }

  if (finished) {
    return (
      <section className="rounded-2xl border border-hairline bg-surface p-8 text-center">
        <h2 className="font-display text-2xl font-bold text-ink">
          Set complete
        </h2>
        <p className="mt-2 text-lg text-muted">
          You got{" "}
          <strong className="text-ink">
            {correctCount} of {questions.length}
          </strong>{" "}
          correct.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {/* refresh re-runs the server component, which picks the next batch
              (attempted questions rotate to the back) and remounts the player
              via its key */}
          <button
            type="button"
            onClick={() => router.refresh()}
            className={ctaClassName("primary")}
          >
            Practice more
          </button>
          <Link href={changeFiltersHref} className={ctaClassName("secondary")}>
            Change filters
          </Link>
        </div>
      </section>
    );
  }

  function choiceClassName(choiceIndex: number): string {
    const base =
      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[0.9375rem] transition-colors " +
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default";

    if (!answered) {
      return `${base} ${
        selected === choiceIndex
          ? "border-accent bg-accent-chip text-ink"
          : "border-hairline bg-surface text-ink hover:border-accent"
      }`;
    }

    if (choiceIndex === verdict?.correctChoice) {
      return `${base} border-accent bg-accent-chip text-ink`;
    }
    if (choiceIndex === selected) {
      return `${base} border-miss-hairline bg-miss-surface text-miss-ink`;
    }
    return `${base} border-hairline bg-surface text-muted`;
  }

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted">
          Question {index + 1} of {questions.length}
        </p>
        <p className="flex gap-2 text-xs font-semibold">
          <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-accent">
            {question.subtopicName}
          </span>
          <span className="rounded-lg bg-insight-chip px-2.5 py-1 text-insight-dark">
            {DIFFICULTY_LABELS[question.difficulty]}
          </span>
        </p>
      </header>

      <p className="mt-4 text-lg leading-relaxed text-ink">{question.prompt}</p>

      <div className="mt-5 flex flex-col gap-2.5" role="group" aria-label="Answer choices">
        {question.choices.map((choice, choiceIndex) => (
          <button
            key={choiceIndex}
            type="button"
            disabled={answered || submitting}
            onClick={() => setSelected(choiceIndex)}
            aria-pressed={selected === choiceIndex}
            className={choiceClassName(choiceIndex)}
          >
            <span className="font-display font-bold">
              {CHOICE_LETTERS[choiceIndex]}
            </span>
            <span>{choice}</span>
          </button>
        ))}
      </div>

      {failure && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
        >
          {failure}
        </p>
      )}

      {answered && verdict && (
        <div
          role="status"
          className={`mt-5 rounded-xl border p-4 ${
            verdict.isCorrect
              ? "border-accent bg-accent-chip"
              : "border-miss-hairline bg-miss-surface"
          }`}
        >
          <p
            className={`font-display text-lg font-bold ${
              verdict.isCorrect ? "text-accent" : "text-miss-ink"
            }`}
          >
            {verdict.isCorrect
              ? "Correct!"
              : `Not quite — the answer is ${CHOICE_LETTERS[verdict.correctChoice]}.`}
          </p>
          <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink">
            {verdict.explanation}
          </p>

          {!verdict.isCorrect && question.subtopicHasVideo && (
            <p className="mt-3 rounded-lg bg-insight-chip px-3 py-2.5 text-[0.9375rem] text-insight-dark">
              This gap has an explainer:{" "}
              <Link
                href={`/videos?subtopic=${question.subtopicSlug}`}
                className="font-semibold underline"
              >
                watch the {question.subtopicName} video
              </Link>
            </p>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        {answered ? (
          <button type="button" onClick={next} className={ctaClassName("primary")}>
            {index + 1 >= questions.length ? "See summary" : "Next question"}
          </button>
        ) : (
          <button
            type="button"
            onClick={checkAnswer}
            disabled={selected === null || submitting}
            className={ctaClassName("primary")}
          >
            {submitting ? "Checking…" : "Check answer"}
          </button>
        )}
      </div>
    </section>
  );
}
