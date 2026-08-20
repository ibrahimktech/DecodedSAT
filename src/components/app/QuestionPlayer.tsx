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
 *
 * ## The sitting
 *
 * Mounting opens a `question_bank_sessions` row; finishing the set, or
 * navigating away, closes it. The session is created HERE rather than in the
 * page's server render because `/questions?start=1` is a prefetch target — a
 * link hover would otherwise write a sitting that never happened.
 *
 * If the tab is closed instead, nothing here runs. That is fine: the database
 * closes any dangling session the next time the student loads a page that is
 * not the player, and computes its counts from the attempts that exist. The
 * stopwatch is informational only — it counts up, has no limit, and submits
 * nothing (spec section 3).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closeQuestionBankSessionAction,
  startQuestionBankSessionAction,
  submitQuestionAttemptAction,
} from "@/app/(app)/questions/actions";
import { CalculatorPanel } from "@/components/app/CalculatorPanel";
import { MathText } from "@/components/app/MathText";
import { ctaClassName } from "@/components/CtaButton";
import {
  CHOICE_LETTERS,
  DIFFICULTY_LABELS,
  formatDuration,
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
  const [elapsed, setElapsed] = useState(0);

  /**
   * The live session id, held in a ref as well as state.
   *
   * The unmount cleanup below needs the CURRENT id, and a cleanup closed over
   * state would see whatever the value was when the effect ran — which, for a
   * mount-only effect, is always null.
   */
  const sessionRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  /**
   * When this sitting started, in client time.
   *
   * Stamped inside the effect below rather than in a `useRef` initialiser:
   * `Date.now()` during render is impure, gives the server and the client
   * different answers, and would make the first painted value a hydration
   * mismatch.
   */
  const startedAtRef = useRef<number | null>(null);

  const question = questions[index];
  const answered = verdict !== null;

  /** Closes the sitting once, and only once. */
  function endSession() {
    const id = sessionRef.current;
    sessionRef.current = null;
    if (id) void closeQuestionBankSessionAction({ sessionId: id });
  }

  // --- Session lifecycle ----------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    startQuestionBankSessionAction().then((id) => {
      if (!id) return;
      // React's development double-invoke tears the first effect down before
      // this resolves. Closing the orphan immediately keeps it off Progress —
      // and since it recorded nothing, the database deletes rather than keeps
      // it.
      if (cancelled) {
        void closeQuestionBankSessionAction({ sessionId: id });
        return;
      }
      sessionRef.current = id;
      setSessionId(id);
    });

    return () => {
      cancelled = true;
      endSession();
    };
  }, []);

  // --- Stopwatch ------------------------------------------------------------
  // Derived from a fixed start timestamp rather than incremented, so a tab
  // that gets throttled in the background resumes showing the real elapsed
  // time instead of however many ticks it was allowed to run.
  useEffect(() => {
    startedAtRef.current ??= Date.now();
    if (finished) return;

    const timer = window.setInterval(() => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [finished]);

  async function checkAnswer() {
    if (selected === null || answered || submitting) return;
    setSubmitting(true);
    setFailure(null);

    const result = await submitQuestionAttemptAction({
      questionId: question.id,
      choice: selected,
      sessionId,
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
      endSession();
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
          correct in <strong className="text-ink">{formatDuration(elapsed)}</strong>.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {/* refresh re-runs the server component, which picks the next batch
              (attempted questions rotate to the back) and remounts the player
              via its key — which in turn opens a fresh sitting */}
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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-muted">
          Question {index + 1} of {questions.length}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <p
            className="flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1 font-display text-sm font-bold tabular-nums text-muted"
            title="Time on this set"
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 2.5" />
              <path d="M9 2h6" />
            </svg>
            <span aria-label={`Elapsed time ${formatDuration(elapsed)}`}>
              {formatDuration(elapsed)}
            </span>
          </p>

          <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-xs font-semibold text-accent">
            {question.subtopicName}
          </span>
          <span className="rounded-lg bg-insight-chip px-2.5 py-1 text-xs font-semibold text-insight-dark">
            {DIFFICULTY_LABELS[question.difficulty]}
          </span>
        </div>
      </header>

      <MathText
        as="p"
        text={question.prompt}
        className="mt-4 text-lg leading-relaxed whitespace-pre-line text-ink"
      />

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
            <MathText text={choice} />
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
          <MathText
            as="p"
            text={verdict.explanation}
            className="mt-1.5 text-[0.9375rem] leading-relaxed whitespace-pre-line text-ink"
          />

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

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <CalculatorPanel />

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
