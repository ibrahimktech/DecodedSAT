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
import { QuestionAnswerInput } from "@/components/app/QuestionAnswerInput";
import { QuestionContent } from "@/components/app/QuestionContent";
import { ctaClassName } from "@/components/CtaButton";
import { trackStudentEvent } from "@/lib/analytics/client";
import { ANALYTICS_THRESHOLDS } from "@/lib/analytics/constants";
import { formatSeconds, type PracticeQuestion } from "@/lib/learn/types";
import { hasAnswer, isValidNumericAnswer } from "@/lib/questions/answers";

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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(() =>
    Math.floor((deadlineMs - Date.now()) / 1000),
  );
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submittedRef = useRef(false);
  const trackedAnswersRef = useRef(new Set<string>());
  const firstViewedAtRef = useRef(new Map<string, number>());
  const answerTimesRef = useRef(new Map<string, number>());
  const currentViewedAtRef = useRef(Date.now());
  const currentExitTrackedRef = useRef(false);
  const exitCallbackRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    trackStudentEvent("practice_started", {
      practice_session_id: attemptId,
      source: "timed_section",
    });
  }, [attemptId]);

  useEffect(() => {
    const current = questions[index];
    if (!current) return;
    currentViewedAtRef.current = Date.now();
    currentExitTrackedRef.current = false;
    if (!firstViewedAtRef.current.has(current.id)) {
      firstViewedAtRef.current.set(current.id, Date.now());
    }
    trackStudentEvent("question_viewed", {
      question_id: current.id,
      question_type: current.questionType,
      practice_session_id: attemptId,
      source: "timed_section",
    });
  }, [attemptId, index, questions]);

  async function submit(omitInvalidAnswers = false) {
    if (submittedRef.current) return;

    const invalidIndex = questions.findIndex(
      (entry) =>
        entry.questionType === "student_produced_response" &&
        hasAnswer(answers[entry.id]) &&
        !isValidNumericAnswer(answers[entry.id]),
    );
    if (invalidIndex >= 0 && !omitInvalidAnswers) {
      setIndex(invalidIndex);
      setConfirming(false);
      setError(
        `Question ${invalidIndex + 1} needs a valid integer, decimal, or fraction.`,
      );
      return;
    }

    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    recordCurrentExit();

    const payload = {
      attemptId,
      answers: Object.entries(answers)
        .filter(([questionId, answer]) => {
          if (!hasAnswer(answer)) return false;
          const answeredQuestion = questions.find(
            (item) => item.id === questionId,
          );
          return !(
            omitInvalidAnswers &&
            answeredQuestion?.questionType === "student_produced_response" &&
            !isValidNumericAnswer(answer)
          );
        })
        .map(([questionId, answer]) => ({
        questionId,
        answer,
      })),
    };

    for (const [questionId, answer] of Object.entries(answers)) {
      if (!hasAnswer(answer)) continue;
      const answeredQuestion = questions.find((item) => item.id === questionId);
      if (
        omitInvalidAnswers &&
        answeredQuestion?.questionType === "student_produced_response" &&
        !isValidNumericAnswer(answer)
      ) {
        continue;
      }
      if (trackedAnswersRef.current.has(questionId)) continue;
      trackedAnswersRef.current.add(questionId);
      trackStudentEvent("question_answered", {
        question_id: questionId,
        practice_session_id: attemptId,
        ...(answeredQuestion?.questionType === "multiple_choice"
          ? { selected_choice: Number(answer) }
          : {}),
        question_type: answeredQuestion?.questionType,
        answer_time_ms: answerTimesRef.current.get(questionId),
        source: "timed_section",
      });
      const answerTimeMs = answerTimesRef.current.get(questionId);
      if (
        answerTimeMs !== undefined &&
        answerTimeMs >= ANALYTICS_THRESHOLDS.struggleLongAnswerSeconds * 1_000
      ) {
        trackStudentEvent("question_struggled", {
          question_id: questionId,
          question_type: answeredQuestion?.questionType,
          practice_session_id: attemptId,
          answer_time_ms: answerTimeMs,
          source: "explainable_time_heuristic",
        });
      }
    }
    trackStudentEvent("practice_completed", {
      practice_session_id: attemptId,
      source: "timed_section",
    });

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
        // A half-typed numeric token is unanswered when time expires; it must
        // not prevent the rest of the section from being scored.
        void submitRef.current(true);
      }
    };
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [deadlineMs]);

  const question = questions[index];
  const answeredCount = Object.values(answers).filter(hasAnswer).length;
  const unansweredCount = questions.length - answeredCount;
  const timeExpired = remaining <= 0;

  function recordCurrentExit() {
    if (hasAnswer(answers[question.id]) || currentExitTrackedRef.current) return;
    currentExitTrackedRef.current = true;
    const answerTimeMs = Math.min(
      Math.max(0, Date.now() - currentViewedAtRef.current),
      7_200_000,
    );
    const eventName =
      answerTimeMs >= ANALYTICS_THRESHOLDS.giveUpMinimumSeconds * 1_000
        ? "question_gave_up"
        : answerTimeMs >= ANALYTICS_THRESHOLDS.skipMinimumSeconds * 1_000
          ? "question_skipped"
          : null;
    if (eventName) {
      trackStudentEvent(eventName, {
        question_id: question.id,
        question_type: question.questionType,
        practice_session_id: attemptId,
        answer_time_ms: answerTimeMs,
        source: "timed_section",
      });
    }
  }

  useEffect(() => {
    exitCallbackRef.current = recordCurrentExit;
  });

  useEffect(() => {
    const onPageHide = () => exitCallbackRef.current();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  function goToQuestion(nextIndex: number) {
    if (nextIndex !== index) recordCurrentExit();
    setIndex(nextIndex);
  }

  function answerQuestion(answer: string) {
    if (timeExpired || submitting) return;
    setConfirming(false);
    if (!answerTimesRef.current.has(question.id)) {
      const startedAt = firstViewedAtRef.current.get(question.id) ?? Date.now();
      answerTimesRef.current.set(
        question.id,
        Math.min(Math.max(0, Date.now() - startedAt), 7_200_000),
      );
    }
    setAnswers((current) => ({ ...current, [question.id]: answer }));
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
            onClick={() => goToQuestion(entryIndex)}
            aria-label={`Question ${entryIndex + 1}${
              hasAnswer(answers[entry.id]) ? ", answered" : ""
            }`}
            aria-current={entryIndex === index ? "true" : undefined}
            className={`h-9 w-9 rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              entryIndex === index
                ? "border-transparent bg-accent text-surface"
                : hasAnswer(answers[entry.id])
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
      <QuestionContent
        legacyText={question.prompt}
        contentBlocks={question.contentBlocks}
        className="mt-2"
      />

      <div className="mt-4">
        <QuestionAnswerInput
          questionType={question.questionType}
          choices={question.choices}
          value={answers[question.id] ?? null}
          onChange={answerQuestion}
          disabled={timeExpired || submitting}
        />
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
            if (index + 1 < questions.length) goToQuestion(index + 1);
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
            onClick={() => goToQuestion(Math.max(0, index - 1))}
            disabled={index === 0 || submitting}
            className={ctaClassName("secondary")}
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => goToQuestion(Math.min(questions.length - 1, index + 1))}
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
