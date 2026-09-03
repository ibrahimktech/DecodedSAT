"use client";

/**
 * Taking a full or half practice test.
 *
 * Mirrors the real digital SAT: full-bleed with no site navigation, one
 * question at a time, the clock centred at the top with a Hide control, the
 * docked calculator and floating reference sheet, a navigator behind the
 * question counter, a strict countdown, and — on a full test — a Continue
 * screen between the two modules whose clock does not start until it is
 * pressed.
 *
 * ## What this component is NOT trusted with
 *
 * Which module is live, when it ends, whether an answer was right, and what
 * the score is. All four are decided server-side; this renders the phase it
 * is handed and reports choices. `deadlineMs` is a server timestamp used to
 * draw a clock, not to enforce one — `save_practice_test_response()` refuses
 * a late answer whatever this component believes the time is.
 *
 * This is also why the timer can be hidden but not paused. Hiding is a fact
 * about this component; pausing would be a claim about the attempt, and the
 * attempt's clock is not this component's to move.
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
 *
 * Review marks and crossed-out choices are the one thing here that is neither
 * server state nor React state: they live in `sessionStorage` so a refresh
 * mid-module does not wipe a student's working notes. See `@/lib/learn/exam-flags`.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  savePracticeTestResponseAction,
  startModuleTwoAction,
  submitPracticeTestModuleAction,
} from "@/app/(app)/practice/tests/actions";
import {
  CalculatorPanel,
  CalculatorToggle,
} from "@/components/app/CalculatorPanel";
import { MathText } from "@/components/app/MathText";
import { ReportQuestionButton } from "@/components/app/ReportQuestionButton";
import { ChoiceList } from "@/components/app/exam/ChoiceList";
import { ExamShell, examButtonClassName } from "@/components/app/exam/ExamShell";
import { ExamTimer } from "@/components/app/exam/ExamTimer";
import { ExitButton } from "@/components/app/exam/ExitButton";
import { QuestionHeader } from "@/components/app/exam/QuestionHeader";
import {
  QuestionNavigator,
  type NavigatorItem,
} from "@/components/app/exam/QuestionNavigator";
import { ReferenceSheet } from "@/components/app/exam/ReferenceSheet";
import { ctaClassName } from "@/components/CtaButton";
import { useExamFlags } from "@/lib/learn/exam-flags";
import type { RunnerState } from "@/lib/learn/tests";
import { formatSeconds, MODULE_SECONDS } from "@/lib/learn/types";

/** How long to sit on a selection before writing it. */
const AUTOSAVE_DELAY_MS = 400;

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
  const [timerHidden, setTimerHidden] = useState(false);
  const [eliminating, setEliminating] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const calculatorId = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Per module: crossing into module 2 remounts this component (the page keys
  // it on the phase), so module 2 correctly opens with a clean sheet.
  const flags = useExamFlags(`test:${state.attemptId}:m${state.moduleNumber}`);

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
  // Stays here, not in `ExamTimer`. The tick is what decides a module is over,
  // and that decision does not belong in a component whose job is to draw a
  // number — hiding the clock must not be able to stop the test.
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
  // Kept as a plain centred card rather than exam chrome. It is the break
  // between modules — nothing is timed, there is nothing to answer, and the
  // one thing that should be on screen is the button that starts the clock.
  if (state.phase === "interstitial") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <section className="w-full max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
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
              {busy
                ? "Starting…"
                : `Continue to module 2 (${formatSeconds(MODULE_SECONDS)})`}
            </button>
          </div>
        </section>
      </div>
    );
  }

  // --- Completed ------------------------------------------------------------
  // Reached when the attempt was finalized elsewhere — the stale sweep on a
  // page load, or a second tab. Nothing to take; point at the result.
  if (state.phase === "completed" || !question) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <section className="w-full max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
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
      </div>
    );
  }

  // --- The module -----------------------------------------------------------
  const isLast = index + 1 >= state.questions.length;

  const navigatorItems: NavigatorItem[] = state.questions.map(
    (item, itemIndex) => ({
      id: item.id,
      state:
        itemIndex === index
          ? "current"
          : answers[item.id] !== undefined
            ? "answered"
            : "unanswered",
      marked: flags.isMarked(item.id),
    }),
  );

  return (
    <ExamShell
      left={
        <>
          <ExitButton
            href="/practice"
            label="Go back"
            confirm={{
              heading: "Leave this module?",
              body: "The clock keeps running while you're away, and it isn't paused by leaving. Your answers are already saved — you can come back to this test and pick up where the timer has got to.",
              confirmLabel: "Leave",
            }}
          />
          <div className="min-w-0">
            <p className="truncate font-display text-[0.9375rem] font-bold text-ink">
              {state.title}
            </p>
            <p className="truncate text-xs text-muted">
              {state.testType === "full"
                ? `Module ${state.moduleNumber} of ${state.moduleCount}`
                : "Single module"}{" "}
              · {answeredCount} of {state.questions.length} answered
            </p>
          </div>
        </>
      }
      timer={
        <ExamTimer
          seconds={remaining}
          mode="countdown"
          hidden={timerHidden}
          onToggleHidden={() => setTimerHidden((wasHidden) => !wasHidden)}
        />
      }
      tools={
        <>
          <CalculatorToggle
            open={calculatorOpen}
            onToggle={() => setCalculatorOpen((wasOpen) => !wasOpen)}
            controlsId={calculatorId}
          />
          <ReferenceSheet />
        </>
      }
      sidePanel={
        calculatorOpen ? (
          <CalculatorPanel
            id={calculatorId}
            onClose={() => setCalculatorOpen(false)}
          />
        ) : undefined
      }
      questionNav={
        <QuestionNavigator
          items={navigatorItems}
          currentIndex={index}
          onJump={setIndex}
          variant="answered"
          label="Questions in this module"
        />
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
            disabled={index === 0}
            className={examButtonClassName("secondary")}
          >
            Back
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className={examButtonClassName("primary")}
            >
              Submit module
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIndex((current) => current + 1)}
              className={examButtonClassName("primary")}
            >
              Next
            </button>
          )}
        </>
      }
    >
      <QuestionHeader
        number={index + 1}
        marked={flags.isMarked(question.id)}
        onToggleMark={() => flags.toggleMark(question.id)}
        eliminating={eliminating}
        onToggleEliminating={() =>
          setEliminating((wasEliminating) => !wasEliminating)
        }
      />

      <MathText
        as="p"
        text={question.prompt}
        className="mt-5 font-question text-lg leading-7 whitespace-pre-line text-ink"
      />

      <div className="mt-6">
        <ChoiceList
          choices={question.choices}
          selected={answers[question.id] ?? null}
          onSelect={(choice) => select(question.id, choice)}
          crossed={flags.crossedFor(question.id)}
          onToggleCross={(choice) => flags.toggleCross(question.id, choice)}
          eliminating={eliminating}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <ReportQuestionButton
          question={question}
          questionLabel={`Question ${index + 1} of ${state.questions.length}`}
          disabled={busy || remaining <= 0}
          onReported={() => {
            // Reporting never writes a response. Existing autosaves remain
            // authoritative if the student had already selected an answer;
            // otherwise the reported item stays unanswered and follows the
            // test's existing scoring rule at module submission.
            if (!isLast) setIndex((current) => current + 1);
          }}
        />
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

      {message && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
        >
          {message}
        </p>
      )}

      {!isLast && (
        <div className="mt-8 text-right">
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
                className={examButtonClassName("secondary")}
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
                className={examButtonClassName("primary")}
              >
                {busy ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ExamShell>
  );
}
