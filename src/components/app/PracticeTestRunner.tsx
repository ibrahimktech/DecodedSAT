"use client";

/**
 * Taking a full or half practice test.
 *
 * Mirrors the real digital SAT: one question at a time, a navigator strip
 * across every question in the module, a strict countdown, and — on a full
 * test — a Continue screen between the two modules whose clock does not start
 * until it is pressed.
 *
 * ## What this component is NOT trusted with
 *
 * Which module is live, when it ends, whether an answer was right, and what
 * the score is. All four are decided server-side; this renders the phase it
 * is handed and reports choices. `deadlineMs` is a server timestamp used to
 * draw a clock, not to enforce one — `save_practice_test_response()` refuses
 * a late answer whatever this component believes the time is.
 *
 * ## Why the timer running out and pressing Submit are the same call
 *
 * Both end the module. Distinguishing them would mean telling the server
 * which happened, and the server would have to believe it. Instead both call
 * `submit_practice_test_module()`, which reads its own clock.
 *
 * ## Abandonment
 *
 * Answers autosave on selection, so nothing depends on this component getting
 * a chance to clean up. `beforeunload` warns, and `pagehide` fires a beacon
 * that nudges the server-side sweep — but the guarantee comes from the sweep
 * itself, which runs on the next page load and finalizes any attempt whose
 * module deadline has passed. A tab killed instantly still scores correctly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  savePracticeTestResponseAction,
  startModuleTwoAction,
  submitPracticeTestModuleAction,
} from "@/app/(app)/practice/tests/actions";
import { CalculatorPanel } from "@/components/app/CalculatorPanel";
import { MathText } from "@/components/app/MathText";
import { ctaClassName } from "@/components/CtaButton";
import type { RunnerState } from "@/lib/learn/tests";
import { CHOICE_LETTERS, formatSeconds, MODULE_SECONDS } from "@/lib/learn/types";

/** How long to sit on a selection before writing it. */
const AUTOSAVE_DELAY_MS = 400;

/** Below this the clock turns amber, then red — the usual SAT warning beats. */
const WARN_SECONDS = 300;
const URGENT_SECONDS = 60;

type SaveState = "saving" | "saved" | "failed";

export function PracticeTestRunner({ state }: { state: RunnerState }) {
  const router = useRouter();

  const [answers, setAnswers] = useState<Record<string, number>>(state.answers);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [index, setIndex] = useState(0);
  // Seeded from the server's own count so the first paint is identical on
  // both sides; the countdown effect below recomputes it from `deadlineMs`
  // every second thereafter.
  const [remaining, setRemaining] = useState(state.remainingSeconds);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** One pending autosave per question; a re-selection replaces its own. */
  const saveTimers = useRef(new Map<string, number>());
  /** Ends the module exactly once, however many ways it gets triggered. */
  const endingRef = useRef(false);

  const question = state.questions[index];
  const answeredCount = state.questions.filter(
    (item) => answers[item.id] !== undefined,
  ).length;

  // --- Ending the module ----------------------------------------------------
  const endModule = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setBusy(true);
    setMessage(null);

    // Flush anything still waiting on its debounce, so a Submit pressed a
    // quarter-second after the last click does not drop that answer.
    for (const timer of saveTimers.current.values()) {
      window.clearTimeout(timer);
    }
    saveTimers.current.clear();

    const result = await submitPracticeTestModuleAction({
      attemptId: state.attemptId,
    });

    if (result.status !== "ok") {
      endingRef.current = false;
      setBusy(false);
      setMessage(result.message);
      return;
    }

    if (result.next === "completed") {
      router.replace(`/practice/tests/review/${state.attemptId}`);
    } else {
      // Back to the server for the interstitial: the phase, and later module
      // 2's questions and deadline, all come from there.
      router.refresh();
    }
  }, [router, state.attemptId]);

  // --- The countdown --------------------------------------------------------
  useEffect(() => {
    if (state.phase !== "module" || state.deadlineMs === null) return;

    const deadline = state.deadlineMs;

    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) void endModule();
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [state.phase, state.deadlineMs, endModule]);

  // --- Leave-page warning ---------------------------------------------------
  useEffect(() => {
    if (state.phase !== "module") return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers ignore custom text now and show their own wording; assigning
      // returnValue is still what triggers the dialog at all.
      event.returnValue = "";
    };

    // Best-effort nudge so an abandoned attempt is swept sooner rather than on
    // the student's next visit. Deliberately carries no scoring information —
    // it cannot be trusted to arrive, so nothing may depend on it.
    const onPageHide = () => {
      navigator.sendBeacon?.("/api/practice-tests/sweep");
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [state.phase]);

  // --- Autosave -------------------------------------------------------------
  const select = (questionId: string, choice: number) => {
    setAnswers((current) => ({ ...current, [questionId]: choice }));
    setSaveStates((current) => ({ ...current, [questionId]: "saving" }));

    const existing = saveTimers.current.get(questionId);
    if (existing !== undefined) window.clearTimeout(existing);

    saveTimers.current.set(
      questionId,
      window.setTimeout(async () => {
        saveTimers.current.delete(questionId);
        const result = await savePracticeTestResponseAction({
          attemptId: state.attemptId,
          questionId,
          choice,
        });
        setSaveStates((current) => ({
          ...current,
          [questionId]: result.status === "ok" ? "saved" : "failed",
        }));
      }, AUTOSAVE_DELAY_MS),
    );
  };

  useEffect(
    () => () => {
      for (const timer of saveTimers.current.values()) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  // --- Interstitial ---------------------------------------------------------
  if (state.phase === "interstitial") {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
        <h1 className="font-display text-2xl font-extrabold text-ink">
          Module 1 complete
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          Take a moment. Module 2 is another {state.questions.length || 22}{" "}
          questions in {formatSeconds(MODULE_SECONDS)} — its clock starts when
          you press Continue, not before.
        </p>

        {message && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
          >
            {message}
          </p>
        )}

        <div className="mt-6">
          <button
            type="button"
            disabled={busy}
            className={ctaClassName("primary")}
            onClick={async () => {
              setBusy(true);
              setMessage(null);
              const result = await startModuleTwoAction({
                attemptId: state.attemptId,
              });
              if (result.status === "ok") {
                router.refresh();
              } else {
                setBusy(false);
                setMessage(result.message);
              }
            }}
          >
            {busy ? "Starting…" : `Continue to module 2 (${formatSeconds(MODULE_SECONDS)})`}
          </button>
        </div>
      </section>
    );
  }

  // --- Completed ------------------------------------------------------------
  // Reached when the attempt was finalized elsewhere — the stale sweep on a
  // page load, or a second tab. Nothing to take; point at the result.
  if (state.phase === "completed" || !question) {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
        <h1 className="font-display text-2xl font-extrabold text-ink">
          This test is finished
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          It was submitted and scored. Open the review to see every question
          alongside the right answer.
        </p>
        <div className="mt-6">
          <button
            type="button"
            className={ctaClassName("primary")}
            onClick={() =>
              router.replace(`/practice/tests/review/${state.attemptId}`)
            }
          >
            See the review
          </button>
        </div>
      </section>
    );
  }

  // --- The module -----------------------------------------------------------
  const clockTone =
    remaining <= URGENT_SECONDS
      ? "bg-miss-surface text-miss-ink"
      : remaining <= WARN_SECONDS
        ? "bg-insight-chip text-insight-dark"
        : "bg-background text-ink";

  return (
    <div className="mx-auto max-w-3xl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-extrabold text-ink">
            {state.title}
          </h1>
          <p className="text-sm text-muted">
            {state.testType === "full"
              ? `Module ${state.moduleNumber} of ${state.moduleCount}`
              : "Single module"}{" "}
            · {answeredCount} of {state.questions.length} answered
          </p>
        </div>

        <p
          role="timer"
          aria-live="off"
          className={`rounded-xl px-4 py-2 font-display text-xl font-extrabold tabular-nums ${clockTone}`}
        >
          {formatSeconds(remaining)}
        </p>
      </header>

      {/* Navigator. `aria-current` marks where you are; the fill marks what is
          answered — the two things the real test's navigator shows. */}
      <nav
        aria-label="Questions in this module"
        className="mt-4 flex flex-wrap gap-1.5"
      >
        {state.questions.map((item, itemIndex) => {
          const isAnswered = answers[item.id] !== undefined;
          const isCurrent = itemIndex === index;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setIndex(itemIndex)}
              aria-current={isCurrent ? "true" : undefined}
              aria-label={`Question ${itemIndex + 1}${isAnswered ? ", answered" : ", not answered"}`}
              className={`h-8 w-8 rounded-lg border text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                isCurrent
                  ? "border-ink bg-ink text-background"
                  : isAnswered
                    ? "border-accent bg-accent-chip text-accent"
                    : "border-hairline bg-surface text-muted hover:border-accent"
              }`}
            >
              {itemIndex + 1}
            </button>
          );
        })}
      </nav>

      <section className="mt-4 rounded-2xl border border-hairline bg-surface p-6 sm:p-8">
        <p className="text-sm font-semibold text-muted">
          Question {index + 1} of {state.questions.length}
        </p>

        <MathText
          as="p"
          text={question.prompt}
          className="mt-3 text-lg leading-relaxed whitespace-pre-line text-ink"
        />

        <div
          className="mt-5 flex flex-col gap-2.5"
          role="group"
          aria-label="Answer choices"
        >
          {question.choices.map((choice, choiceIndex) => {
            const chosen = answers[question.id] === choiceIndex;
            return (
              <button
                key={choiceIndex}
                type="button"
                onClick={() => select(question.id, choiceIndex)}
                aria-pressed={chosen}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[0.9375rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  chosen
                    ? "border-accent bg-accent-chip text-ink"
                    : "border-hairline bg-surface text-ink hover:border-accent"
                }`}
              >
                <span className="font-display font-bold">
                  {CHOICE_LETTERS[choiceIndex]}
                </span>
                <MathText text={choice} />
              </button>
            );
          })}
        </div>

        {/* Only ever shown on failure. A "saved" tick on every question would
            be noise on a test where saving is supposed to be invisible. */}
        {saveStates[question.id] === "failed" && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-sm text-miss-ink"
          >
            That answer didn&apos;t save. Pick it again — if it keeps failing,
            your answers so far are still recorded.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <CalculatorPanel />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
              className={`${ctaClassName("secondary")} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Back
            </button>

            {index + 1 < state.questions.length ? (
              <button
                type="button"
                onClick={() => setIndex((current) => current + 1)}
                className={ctaClassName("primary")}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={busy}
                className={ctaClassName("primary")}
              >
                Submit module
              </button>
            )}
          </div>
        </div>
      </section>

      {index + 1 < state.questions.length && (
        <div className="mt-4 text-right">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="text-[0.9375rem] font-semibold text-muted underline transition-colors hover:text-ink"
          >
            Submit module early
          </button>
        </div>
      )}

      {message && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
        >
          {message}
        </p>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-submit-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6">
            <h2
              id="confirm-submit-heading"
              className="font-display text-xl font-bold text-ink"
            >
              Submit module {state.moduleNumber}?
            </h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
              You&apos;ve answered {answeredCount} of {state.questions.length}.
              {answeredCount < state.questions.length && (
                <>
                  {" "}
                  The {state.questions.length - answeredCount} you haven&apos;t
                  answered will be marked wrong.
                </>
              )}{" "}
              This can&apos;t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={ctaClassName("secondary")}
              >
                Keep working
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  void endModule();
                }}
                className={ctaClassName("primary")}
              >
                {busy ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
