"use client";

/**
 * The question bank player.
 *
 * The player holds no answer key. It ships questions without verdicts, sends
 * the chosen index to the grading action, and renders whatever comes back —
 * correctness, the right answer and the explanation only ever exist client-
 * side after an attempt is already recorded server-side.
 *
 * A miss shows the explanation plus a link to the subtopic's explainer video
 * when one exists — the decode loop this product is named after.
 *
 * ## Why it wears the test chrome
 *
 * Same shell as the practice test runner: no nav rail, tools and clock up top,
 * navigator behind the question counter, mark-for-review and the answer
 * eliminator on every question. Drilling one question at a time is where a
 * student builds the habits they will use on test day, so the habits should be
 * built against the interface they will be using.
 *
 * Two things are deliberately different from the timed runner, because this
 * surface is not a test: the clock counts up and can genuinely be paused
 * (nothing here is enforced, submitted, or scored against it), and the
 * navigator carries verdicts rather than mere answered-ness.
 *
 * ## A set is the whole filtered bank
 *
 * It used to be ten questions, which quietly made the daily goal a ceiling: hit
 * ten and you were done whether or not you wanted to be. Now every question
 * matching the filters is in the set, reachable in any order, and the goal is
 * something the page mentions when you pass it rather than something that stops
 * you.
 *
 * ## Windowed loading
 *
 * Shipping a thousand prompts up front would be a payload that grows with the
 * bank. Instead the server sends an index — one id and one past result per
 * question, enough for the navigator and the review flags — and content arrives
 * twenty-five at a time, slightly ahead of where the student is. `loaded` is
 * the cache; `inFlightRef` stops two overlapping navigations asking for the
 * same window twice.
 *
 * ## State is keyed by question id, not position
 *
 * Selections and verdicts follow the question, not the slot it happens to sit
 * in. That matters because navigation is free: leaving a half-made choice on
 * question 4, wandering to 900 and coming back must find it exactly as it was.
 *
 * ## The sitting
 *
 * Mounting opens a `question_bank_sessions` row; finishing the set, or
 * navigating away, closes it. The session is created HERE rather than in the
 * page's server render because the player route is a prefetch target — a link
 * hover would otherwise write a sitting that never happened.
 *
 * If the tab is closed instead, nothing here runs. That is fine: the database
 * closes any dangling session the next time the student loads a page that is
 * not the player, and computes its counts from the attempts that exist. The
 * stopwatch is informational only — it counts up, has no limit, and submits
 * nothing.
 *
 * ## Idle timeout
 *
 * A tab left open is the case neither of those covers: nothing closes, and the
 * stopwatch keeps counting an empty room. So the player watches for signs of
 * life and, after `IDLE_LIMIT_MS` without one, ends the sitting itself — clock
 * rolled back to the last real activity, session finalized at its last recorded
 * attempt. A minute of warning comes first, because the alternative is yanking
 * a set out from under someone who was reading.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closeQuestionBankSessionAction,
  finalizeQuestionBankSessionsAction,
  loadQuestionsAction,
  startQuestionBankSessionAction,
  submitQuestionAttemptAction,
} from "@/app/(app)/questions/actions";
import {
  CalculatorPanel,
  CalculatorToggle,
} from "@/components/app/CalculatorPanel";
import { MathText } from "@/components/app/MathText";
import { ReportQuestionButton } from "@/components/app/ReportQuestionButton";
import { Skeleton } from "@/components/app/Skeleton";
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
import {
  CHOICE_LETTERS,
  DIFFICULTY_LABELS,
  formatDuration,
  QUESTION_WINDOW_SIZE,
  type PlayableQuestion,
  type QuestionIndexEntry,
  type QuestionVerdict,
} from "@/lib/learn/types";

type OkVerdict = Extract<QuestionVerdict, { status: "ok" }>;

/** What a question looks like once it has been answered and graded. */
type AnsweredRecord = { selected: number; verdict: OkVerdict };

/** How far behind and ahead of the cursor content is kept warm. */
const LOOK_BEHIND = 5;
const LOOK_AHEAD = 20;

/**
 * How long the page may sit untouched before the sitting ends itself, and how
 * much warning comes first.
 *
 * A set has no deadline, and should not have one — but "no deadline" used to
 * mean a tab left open all afternoon kept its session open and its stopwatch
 * running, and Progress then reported the whole afternoon as study time.
 * Fifteen minutes is longer than any one question takes and shorter than a walk
 * away from the desk, so a page that quiet means nobody is there.
 */
const IDLE_LIMIT_MS = 15 * 60_000;
const IDLE_WARNING_MS = 60_000;

/**
 * What counts as a sign of life. Clicks, keys, scrolling and touches only —
 * deliberately not `mousemove`, which a nudged desk fires, and not
 * `visibilitychange`, since coming back to a tab is not the same as having
 * been there.
 */
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

/** The idle limit in prose: "15 minutes", or "45 seconds" under an override. */
function describeIdleLimit(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} seconds`;
}

type QuestionPlayerProps = {
  /** Every question in the set, in order, without content. */
  entries: QuestionIndexEntry[];
  /** The first window, already fetched so the page paints complete. */
  initialQuestions: PlayableQuestion[];
  /** Back to the topic picker, with the current selection intact. */
  changeFiltersHref: string;
  /** Whether this set was drawn at random, which the summary mentions. */
  shuffled?: boolean;
  /** The student's daily target, and how much of it today already had. */
  dailyGoal: number;
  answeredToday: number;
  /**
   * Development-only override of the inactivity limit, in milliseconds. Exists
   * so the timeout can be exercised in a minute rather than in fifteen; the
   * page only ever supplies it outside production.
   */
  idleLimitMs?: number;
};

export function QuestionPlayer({
  entries,
  initialQuestions,
  changeFiltersHref,
  shuffled = false,
  dailyGoal,
  answeredToday,
  idleLimitMs,
}: QuestionPlayerProps) {
  const router = useRouter();

  const idleLimit = idleLimitMs ?? IDLE_LIMIT_MS;
  // A shortened limit must not put the warning up before the sitting starts,
  // so the notice window can never be more than half of it.
  const idleWarning = Math.min(IDLE_WARNING_MS, Math.floor(idleLimit / 2));

  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, PlayableQuestion>>(() =>
    Object.fromEntries(
      initialQuestions.map((question) => [question.id, question]),
    ),
  );
  const [loadFailed, setLoadFailed] = useState(false);
  /**
   * Ids that were asked for and did not come back.
   *
   * A question deactivated between the index being built and the student
   * reaching it is gone for good. State rather than a ref for two reasons: the
   * loader effect must re-run so it stops asking, and the body has to be able
   * to tell "still loading" from "there is nothing here".
   */
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [history, setHistory] = useState<Record<string, AnsweredRecord>>({});
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [confirmingFinish, setConfirmingFinish] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [timerHidden, setTimerHidden] = useState(false);
  const [paused, setPaused] = useState(false);
  /** Set once the sitting has ended itself for inactivity. */
  const [timedOut, setTimedOut] = useState(false);
  /** Seconds left before that happens, while the warning is up; else null. */
  const [idleCountdown, setIdleCountdown] = useState<number | null>(null);
  const [eliminating, setEliminating] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const calculatorId = useId();
  /** The running total when the goal was passed, or null while it has not. */
  const [goalBanner, setGoalBanner] = useState<number | null>(null);

  const entry = entries[index];
  const question = entry ? loaded[entry.id] : undefined;

  // Scoped to the set, so a different filter selection starts with a clean
  // sheet. The first and last ids plus the length identify a set well enough
  // without putting three thousand uuids in a storage key.
  const flags = useExamFlags(
    `qbank:${entries.length}:${entries[0]?.id ?? "none"}:${
      entries[entries.length - 1]?.id ?? "none"
    }`,
  );

  const sessionRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  /** Ids already requested, so overlapping windows are not fetched twice. */
  const inFlightRef = useRef(new Set<string>());
  /** Attempts recorded by this player, on top of whatever today already had. */
  const sessionAnswersRef = useRef(0);
  /** The goal banner shows once per sitting, not once per question past it. */
  const goalAnnouncedRef = useRef(answeredToday >= dailyGoal);

  const startedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);

  /**
   * When the page was last touched, and the clock's reading at that moment.
   * Null until the idle effect seeds it on mount — reading a clock during
   * render is exactly the impurity that makes a re-render mean something.
   */
  const lastActivityRef = useRef<number | null>(null);
  const activeElapsedRef = useRef(0);
  /** Bumped to open a fresh sitting in place after an idle timeout. */
  const [sessionEpoch, setSessionEpoch] = useState(0);

  const record = entry ? history[entry.id] : undefined;
  const selected = entry ? (selections[entry.id] ?? null) : null;
  const answeredCount = Object.keys(history).length;
  const correctCount = Object.values(history).filter(
    (item) => item.verdict.isCorrect,
  ).length;
  const isLast = index + 1 >= entries.length;

  /** Closes the sitting once, and only once. */
  const endSession = useCallback(() => {
    const id = sessionRef.current;
    sessionRef.current = null;
    if (id) void closeQuestionBankSessionAction({ sessionId: id });
  }, []);

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
  }, [endSession, sessionEpoch]);

  // --- Keeping content ahead of the cursor ----------------------------------
  useEffect(() => {
    const from = Math.max(0, index - LOOK_BEHIND);
    const to = Math.min(entries.length, index + LOOK_AHEAD);

    const missing = entries
      .slice(from, to)
      .map((item) => item.id)
      .filter(
        (id) =>
          !loaded[id] && !inFlightRef.current.has(id) && !unavailable.has(id),
      )
      .slice(0, QUESTION_WINDOW_SIZE);

    if (missing.length === 0) return;

    for (const id of missing) inFlightRef.current.add(id);
    let cancelled = false;

    loadQuestionsAction({ questionIds: missing })
      .then((result) => {
        if (result.status !== "ok") {
          if (!cancelled) setLoadFailed(true);
          return;
        }

        // Results are kept even if the student has navigated on — the content
        // is just as valid wherever they are now, and throwing it away would
        // mean fetching it again the moment they came back.
        setLoadFailed(false);
        setLoaded((current) => {
          const next = { ...current };
          for (const item of result.questions) next[item.id] = item;
          return next;
        });

        // Anything asked for that did not come back has been deactivated since
        // the index was built. Recording that is what stops this effect asking
        // for it again on every subsequent change to `loaded` — an id that can
        // never arrive would otherwise be a request loop.
        const returned = new Set(result.questions.map((item) => item.id));
        const gone = missing.filter((id) => !returned.has(id));
        if (gone.length > 0) {
          setUnavailable((current) => new Set([...current, ...gone]));
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        for (const id of missing) inFlightRef.current.delete(id);
      });

    return () => {
      cancelled = true;
    };
  }, [index, entries, loaded, unavailable]);

  // --- Stopwatch ------------------------------------------------------------
  // Derived from a fixed start timestamp minus accumulated pause time, rather
  // than incremented, so a tab that gets throttled in the background resumes
  // showing the real elapsed time instead of however many ticks it was allowed
  // to run.
  /** What the clock reads now. Also what the idle timeout rolls back to. */
  const elapsedSecondsNow = useCallback(() => {
    const startedAt = startedAtRef.current;
    if (startedAt === null) return 0;
    const openPause =
      pausedAtRef.current === null ? 0 : Date.now() - pausedAtRef.current;
    return Math.max(
      0,
      Math.floor(
        (Date.now() - startedAt - pausedTotalRef.current - openPause) / 1000,
      ),
    );
  }, []);

  useEffect(() => {
    startedAtRef.current ??= Date.now();
    if (finished || timedOut || paused) return;

    const tick = () => setElapsed(elapsedSecondsNow());

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [elapsedSecondsNow, finished, timedOut, paused]);

  // --- Idle timeout ---------------------------------------------------------
  // Ends the sitting when nobody is there. `finalizeQuestionBankSessionsAction`
  // rather than the ordinary close: that one stamps `now()` as the end, which
  // would bank the idle stretch as study time — the thing this exists to stop.
  const endForIdle = useCallback(() => {
    sessionRef.current = null;
    setSessionId(null);
    setIdleCountdown(null);
    setElapsed(activeElapsedRef.current);
    setPaused(false);
    setTimedOut(true);
    void finalizeQuestionBankSessionsAction();
  }, []);

  useEffect(() => {
    if (finished || timedOut) return;

    const noteActivity = () => {
      lastActivityRef.current = Date.now();
      activeElapsedRef.current = elapsedSecondsNow();
      // Returns the same `null` while no warning is up, so React bails out
      // rather than re-rendering the player on every keystroke.
      setIdleCountdown((current) => (current === null ? current : null));
    };

    // Measured against a timestamp rather than counted down, so a backgrounded
    // tab whose interval is throttled still ends at the right moment instead of
    // whenever it was next allowed to run.
    const check = () => {
      const lastActivity = lastActivityRef.current;
      if (lastActivity === null) return;
      const idleFor = Date.now() - lastActivity;
      if (idleFor >= idleLimit) {
        endForIdle();
        return;
      }
      const untilEnd = idleLimit - idleFor;
      setIdleCountdown(
        untilEnd <= idleWarning ? Math.ceil(untilEnd / 1000) : null,
      );
    };

    noteActivity();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, noteActivity, { passive: true });
    }
    const timer = window.setInterval(check, 1000);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, noteActivity);
      }
      window.clearInterval(timer);
    };
  }, [elapsedSecondsNow, endForIdle, finished, idleLimit, idleWarning, timedOut]);

  /**
   * Picks the set back up after a timeout, in place.
   *
   * The clock resumes from where it froze rather than from zero — the work
   * before the break was real — and the epoch bump opens a new session row, so
   * the attempts either side of the gap are two sittings, which is what they
   * are.
   */
  function resumeAfterIdle() {
    const carried = activeElapsedRef.current;
    startedAtRef.current = Date.now() - carried * 1000;
    pausedTotalRef.current = 0;
    pausedAtRef.current = null;
    lastActivityRef.current = Date.now();
    setElapsed(carried);
    setTimedOut(false);
    setSessionEpoch((epoch) => epoch + 1);
  }

  function togglePaused() {
    if (pausedAtRef.current === null) {
      pausedAtRef.current = Date.now();
      setPaused(true);
    } else {
      pausedTotalRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
      setPaused(false);
    }
  }

  async function checkAnswer() {
    if (!entry || !question || selected === null || record || submitting) return;
    setSubmitting(true);
    setFailure(null);

    // Captured before the await: a student who navigates while the request is
    // in flight must not have the verdict land on whatever question they moved
    // to.
    const answeredId = entry.id;

    const result = await submitQuestionAttemptAction({
      questionId: answeredId,
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

    setHistory((current) => ({
      ...current,
      [answeredId]: { selected, verdict: result },
    }));

    // The goal is a milestone, not a gate: it says so and the set carries on.
    sessionAnswersRef.current += 1;
    if (
      !goalAnnouncedRef.current &&
      answeredToday + sessionAnswersRef.current >= dailyGoal
    ) {
      goalAnnouncedRef.current = true;
      setGoalBanner(answeredToday + sessionAnswersRef.current);
    }
  }

  function goTo(nextIndex: number) {
    setIndex(nextIndex);
    setFailure(null);
  }

  function finish() {
    setFinished(true);
    setConfirmingFinish(false);
    endSession();
  }

  if (timedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <section className="w-full max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
          <h2 className="font-display text-2xl font-bold text-ink">
            Stopped while you were away
          </h2>
          <p className="mt-2 text-lg text-muted">
            Nothing happened here for {describeIdleLimit(idleLimit)}, so this
            sitting ended and the clock stopped at{" "}
            <strong className="text-ink">{formatDuration(elapsed)}</strong> —
            the time you were actually working, not the time the tab was open.
          </p>
          <p className="mt-2 text-[0.9375rem] text-muted">
            {answeredCount === 0
              ? "Nothing was answered, so nothing was recorded."
              : `Your ${answeredCount} ${answeredCount === 1 ? "answer is" : "answers are"} saved, and the set is exactly where you left it.`}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={resumeAfterIdle}
              className={ctaClassName("primary")}
            >
              Resume practicing
            </button>
            <Link href={changeFiltersHref} className={ctaClassName("secondary")}>
              Change topics
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <section className="w-full max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
          <h2 className="font-display text-2xl font-bold text-ink">
            Session complete
          </h2>
          <p className="mt-2 text-lg text-muted">
            You answered{" "}
            <strong className="text-ink">{answeredCount}</strong>{" "}
            {answeredCount === 1 ? "question" : "questions"} and got{" "}
            <strong className="text-ink">{correctCount}</strong> right, in{" "}
            <strong className="text-ink">{formatDuration(elapsed)}</strong>.
          </p>
          <p className="mt-2 text-[0.9375rem] text-muted">
            {answeredToday + answeredCount >= dailyGoal
              ? `That's ${answeredToday + answeredCount} today — past your goal of ${dailyGoal}.`
              : `${answeredToday + answeredCount} of your ${dailyGoal} for today.`}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => router.refresh()}
              className={ctaClassName("primary")}
            >
              {shuffled ? "Reshuffle and continue" : "Keep practicing"}
            </button>
            <Link href={changeFiltersHref} className={ctaClassName("secondary")}>
              Change topics
            </Link>
          </div>
        </section>
      </div>
    );
  }

  const navigatorItems: NavigatorItem[] = entries.map(
    (item, itemIndex): NavigatorItem => {
      const answered = history[item.id] as AnsweredRecord | undefined;
      // This sitting's verdict wins, but a result from a previous sitting still
      // counts — the point of the grid is "how much of this have I done", and
      // that question does not reset when the tab closes.
      const outcome = answered
        ? answered.verdict.isCorrect
          ? "correct"
          : "incorrect"
        : item.previousResult;

      return {
        id: item.id,
        state:
          itemIndex === index ? "current" : (outcome ?? "unanswered"),
        marked: flags.isMarked(item.id),
      };
    },
  );

  // Rendered by `shell()` rather than beside the question, so it still appears
  // while a window is loading or a question turned out to be unavailable —
  // those states are just as capable of being walked away from.
  const idleWarningDialog =
    idleCountdown === null ? null : (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="idle-warning-heading"
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      >
        <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6">
          <h2
            id="idle-warning-heading"
            className="font-display text-xl font-bold text-ink"
          >
            Still there?
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
            This sitting ends in{" "}
            <strong className="tabular-nums text-ink">{idleCountdown}s</strong>{" "}
            because nothing has happened for a while — that keeps your study
            time honest. Press anything to carry on; everything you have
            answered is already saved either way.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={endForIdle}
              className={examButtonClassName("secondary")}
            >
              End it now
            </button>
            <button
              type="button"
              onClick={() => setIdleCountdown(null)}
              className={examButtonClassName("primary")}
            >
              I&apos;m still here
            </button>
          </div>
        </div>
      </div>
    );

  const shell = (children: React.ReactNode) => (
    <ExamShell
      left={
        <>
          <ExitButton href={changeFiltersHref} label="Change topics" />
          <p className="truncate text-xs text-muted">
            {answeredToday + answeredCount} of {dailyGoal} today
          </p>
        </>
      }
      timer={
        <ExamTimer
          seconds={elapsed}
          mode="stopwatch"
          hidden={timerHidden}
          onToggleHidden={() => setTimerHidden((wasHidden) => !wasHidden)}
          paused={paused}
          onTogglePaused={togglePaused}
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
          onJump={goTo}
          variant="graded"
          label="Questions in this set"
        />
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => goTo(Math.max(0, index - 1))}
            disabled={index === 0}
            className={examButtonClassName("secondary")}
          >
            Back
          </button>

          {question && !record && selected !== null ? (
            <button
              type="button"
              onClick={checkAnswer}
              disabled={submitting}
              className={examButtonClassName("primary")}
            >
              {submitting ? "Checking…" : "Check answer"}
            </button>
          ) : isLast ? (
            <button
              type="button"
              onClick={() => setConfirmingFinish(true)}
              className={examButtonClassName("primary")}
            >
              Finish
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className={examButtonClassName("primary")}
            >
              Next
            </button>
          )}
        </>
      }
    >
      {children}
      {idleWarningDialog}
    </ExamShell>
  );

  // Jumped somewhere whose content has not landed yet. The chrome stays put —
  // the navigator, the clock and the tools all still work — and only the
  // question body waits.
  if (!question && entry && unavailable.has(entry.id)) {
    return shell(
      <div className="rounded-2xl border border-hairline bg-surface p-8 text-center">
        <h2 className="font-display text-xl font-bold text-ink">
          This question is no longer available
        </h2>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
          It was removed from the bank after this set was built. Everything
          else in the set is unaffected.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => goTo(Math.max(0, index - 1))}
            disabled={index === 0}
            className={examButtonClassName("secondary")}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => goTo(Math.min(entries.length - 1, index + 1))}
            disabled={isLast}
            className={examButtonClassName("primary")}
          >
            Skip to next
          </button>
        </div>
      </div>,
    );
  }

  if (!question) {
    return shell(
      <div aria-busy="true">
        <span className="sr-only">Loading question {index + 1}…</span>
        <div className="flex items-center gap-3 border-b border-hairline pb-3">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="mt-5 h-6 w-full" />
        <Skeleton className="mt-2 h-6 w-5/6" />
        <div className="mt-6 flex flex-col gap-3">
          {[0, 1, 2, 3].map((choice) => (
            <Skeleton key={choice} className="h-14 w-full rounded-xl" />
          ))}
        </div>

        {loadFailed && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
          >
            This question didn&apos;t load. Check your connection, then move away
            and back to try again — everything you&apos;ve answered is saved.
          </p>
        )}
      </div>,
    );
  }

  return shell(
    <>
      {goalBanner !== null && (
        <div
          role="status"
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-insight-hairline bg-insight-surface px-4 py-3"
        >
          <p className="text-[0.9375rem] text-insight-dark">
            <strong>Daily goal reached</strong> — that&apos;s {goalBanner}{" "}
            questions today. Keep going as long as you like.
          </p>
          <button
            type="button"
            onClick={() => setGoalBanner(null)}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-insight-dark underline transition-colors hover:bg-insight-chip"
          >
            Dismiss
          </button>
        </div>
      )}

      <QuestionHeader
        number={index + 1}
        marked={flags.isMarked(question.id)}
        onToggleMark={() => flags.toggleMark(question.id)}
        eliminating={eliminating}
        onToggleEliminating={() =>
          setEliminating((wasEliminating) => !wasEliminating)
        }
        showEliminate={!record}
        meta={
          <>
            {question.previousResult && !record && (
              <span
                title="You've answered this question before"
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                  question.previousResult === "correct"
                    ? "bg-accent-chip text-accent"
                    : "bg-miss-surface text-miss-ink"
                }`}
              >
                {question.previousResult === "correct"
                  ? "Seen · got it"
                  : "Seen · missed it"}
              </span>
            )}
            <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-xs font-semibold text-accent">
              {question.subtopicName}
            </span>
            <span className="rounded-lg bg-insight-chip px-2.5 py-1 text-xs font-semibold text-insight-dark">
              {DIFFICULTY_LABELS[question.difficulty]}
            </span>
          </>
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
          selected={record ? record.selected : selected}
          onSelect={(choice) =>
            setSelections((current) => ({ ...current, [question.id]: choice }))
          }
          crossed={flags.crossedFor(question.id)}
          onToggleCross={(choice) => flags.toggleCross(question.id, choice)}
          eliminating={eliminating}
          correctChoice={record ? record.verdict.correctChoice : null}
          disabled={submitting}
        />
      </div>

      <div className="mt-4 flex justify-end">
        <ReportQuestionButton
          question={question}
          questionLabel={`Question ${index + 1} of ${entries.length}`}
          disabled={submitting}
          onReported={() => {
            // A report is a skip: no attempt row, verdict, goal progress, or
            // accuracy change. On the final item, the existing Finish control
            // remains the session-completion path rather than inventing an
            // out-of-range next question.
            if (!isLast) goTo(index + 1);
          }}
        />
      </div>

      {failure && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-miss-hairline bg-miss-surface px-4 py-3 text-[0.9375rem] text-miss-ink"
        >
          {failure}
        </p>
      )}

      {record && (
        <div
          role="status"
          className={`mt-5 rounded-xl border p-4 ${
            record.verdict.isCorrect
              ? "border-accent bg-accent-chip"
              : "border-miss-hairline bg-miss-surface"
          }`}
        >
          <p
            className={`font-display text-lg font-bold ${
              record.verdict.isCorrect ? "text-accent" : "text-miss-ink"
            }`}
          >
            {record.verdict.isCorrect
              ? "Correct!"
              : `Not quite — the answer is ${CHOICE_LETTERS[record.verdict.correctChoice]}.`}
          </p>
          <MathText
            as="p"
            text={record.verdict.explanation}
            className="mt-1.5 font-question text-base leading-7 whitespace-pre-line text-ink"
          />

          {!record.verdict.isCorrect && question.subtopicHasVideo && (
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

      {/* Available from anywhere in the set. With free navigation and a set
          that can run to thousands, the last question is not where a sitting
          normally ends. */}
      {!isLast && (
        <div className="mt-8 text-right">
          <button
            type="button"
            onClick={() => setConfirmingFinish(true)}
            className="text-[0.9375rem] font-semibold text-muted underline transition-colors hover:text-ink"
          >
            Finish for now
          </button>
        </div>
      )}

      {confirmingFinish && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-finish-heading"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6">
            <h2
              id="confirm-finish-heading"
              className="font-display text-xl font-bold text-ink"
            >
              Finish for now?
            </h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
              You&apos;ve answered {answeredCount} this sitting. Everything you
              answered is saved — the rest of the set stays where it is and will
              be here next time.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingFinish(false)}
                className={examButtonClassName("secondary")}
              >
                Keep going
              </button>
              <button
                type="button"
                onClick={finish}
                className={examButtonClassName("primary")}
              >
                Finish
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
  );
}
