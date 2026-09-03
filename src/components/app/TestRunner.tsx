"use client";

/**
 * The in-progress view of a timed practice section.
 *
 * Holds the person's picks and a countdown, nothing more. The countdown is
 * presentation: the authoritative clock lives server-side on the attempt row,
 * and the submit function grades against that clock no matter what this timer
 * showed. At zero the runner auto-submits whatever is selected; the server
 * allows a short grace window for that request to land.
 */

import { useEffect, useRef, useState } from "react";
import { submitPracticeAttemptAction } from "@/app/(app)/practice/actions";
import { ReportQuestionButton } from "@/components/app/ReportQuestionButton";
import { ctaClassName } from "@/components/CtaButton";
import {
  CHOICE_LETTERS,
  formatSeconds,
  type PracticeQuestion,
} from "@/lib/learn/types";

type TestRunnerProps = {
  attemptId: string;
  sectionTitle: string;
  /** Epoch ms when the server-side clock hits zero. */
  deadlineMs: number;
  questions: PracticeQuestion[];
};

export function TestRunner({
  attemptId,
  sectionTitle,
  deadlineMs,
  questions,
}: TestRunnerProps) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [remaining, setRemaining] = useState(() =>
    Math.floor((deadlineMs - Date.now()) / 1000),
  );
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submittedRef = useRef(false);

  async function submit() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);

    const payload = {
      attemptId,
      answers: Object.entries(answers).map(([questionId, choice]) => ({
        questionId,
        choice,
      })),
    };

    // On success the action redirects and this promise never yields a value;
    // a returned object is always a failure to surface.
    const failure = await submitPracticeAttemptAction(payload);
    if (failure) {
      submittedRef.current = false;
      setSubmitting(false);
      setConfirming(false);
      setError(failure.message);
    }
  }

  // Keep the latest submit closure reachable from the interval without
  // re-registering it every second. Assigned in an effect (not during
  // render), which runs after every render and so always holds the freshest
  // answers.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    const tick = () => {
      const secondsLeft = Math.floor((deadlineMs - Date.now()) / 1000);
      setRemaining(secondsLeft);
      if (secondsLeft <= 0) {
        void submitRef.current();
      }
    };
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [deadlineMs]);

  const question = questions[index];
  const answeredCount = Object.keys(answers).length;
  const unansweredCount = questions.length - answeredCount;
  const timeExpired = remaining <= 0;

  function choose(choiceIndex: number) {
    if (timeExpired || submitting) return;
    setConfirming(false);
    setAnswers((current) => ({ ...current, [question.id]: choiceIndex }));
  }

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-ink">
          {sectionTitle}
        </h2>
        <p
          aria-live="polite"
          className={`rounded-xl px-4 py-1.5 font-mono text-lg font-semibold tabular-nums ${
            remaining <= 60
              ? "bg-miss-surface text-miss-ink"
              : "bg-background text-ink"
          }`}
        >
          {formatSeconds(remaining)}
        </p>
      </header>

      {/* Question palette: jump anywhere; answered questions fill in. */}
      <nav aria-label="Questions" className="mt-4 flex flex-wrap gap-1.5">
        {questions.map((entry, entryIndex) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setIndex(entryIndex)}
            aria-label={`Question ${entryIndex + 1}${
              answers[entry.id] !== undefined ? ", answered" : ""
            }`}
            aria-current={entryIndex === index ? "true" : undefined}
            className={`h-9 w-9 rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              entryIndex === index
                ? "border-transparent bg-accent text-surface"
                : answers[entry.id] !== undefined
                  ? "border-accent bg-accent-chip text-accent"
                  : "border-hairline bg-surface text-muted hover:border-accent"
            }`}
          >
            {entryIndex + 1}
          </button>
        ))}
      </nav>

      <p className="mt-5 text-sm font-semibold text-muted">
        Question {index + 1} of {questions.length}
      </p>
      <p className="mt-2 font-question text-lg leading-7 text-ink">
        {question.prompt}
      </p>

      <div className="mt-4 flex flex-col gap-2.5" role="group" aria-label="Answer choices">
        {question.choices.map((choice, choiceIndex) => (
          <button
            key={choiceIndex}
            type="button"
            disabled={timeExpired || submitting}
            onClick={() => choose(choiceIndex)}
            aria-pressed={answers[question.id] === choiceIndex}
            className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left font-question text-[1.0625rem] leading-7 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${
              answers[question.id] === choiceIndex
                ? "border-accent bg-accent-chip text-ink"
                : "border-hairline bg-surface text-ink hover:border-accent"
            }`}
          >
            <span className="font-question font-bold">
              {CHOICE_LETTERS[choiceIndex]}
            </span>
            <span>{choice}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <ReportQuestionButton
          question={question}
          questionLabel={`Question ${index + 1} of ${questions.length}`}
          disabled={submitting || timeExpired}
          onReported={() => {
            // Section attempts are submitted as one answer map. Removing a
            // preselected value makes this a genuine skip rather than a wrong
            // or correct attempt, then normal navigation advances once.
            setAnswers((current) => {
              const next = { ...current };
              delete next[question.id];
              return next;
            });
            if (index + 1 < questions.length) setIndex(index + 1);
          }}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
        >
          {error}
        </p>
      )}

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setIndex(Math.max(0, index - 1))}
            disabled={index === 0 || submitting}
            className={ctaClassName("secondary")}
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setIndex(Math.min(questions.length - 1, index + 1))}
            disabled={index === questions.length - 1 || submitting}
            className={ctaClassName("secondary")}
          >
            Next
          </button>
        </div>

        {confirming && unansweredCount > 0 ? (
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-miss-ink">
              {unansweredCount} unanswered — submit anyway?
            </p>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className={ctaClassName("primary")}
            >
              {submitting ? "Submitting…" : "Yes, submit"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              unansweredCount > 0 ? setConfirming(true) : void submit()
            }
            disabled={submitting}
            className={ctaClassName("primary")}
          >
            {submitting ? "Submitting…" : "Submit section"}
          </button>
        )}
      </footer>
    </section>
  );
}
