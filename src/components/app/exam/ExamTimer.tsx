"use client";

/**
 * The clock at the top of a question surface, with the Hide control the real
 * digital SAT puts under it.
 *
 * Hiding matters more than it sounds: for a lot of students a visible countdown
 * is the thing that turns a hard question into a panic, and Bluebook lets them
 * put it away. What it does not let them do is stop it — and neither does this,
 * on a timed module.
 *
 * ## What this component is not
 *
 * It does not own the countdown. `PracticeTestRunner` derives the remaining
 * seconds from the server's `deadlineMs` and decides when the module ends; this
 * draws the number it is handed. Moving the tick in here would put the decision
 * to end a module inside a presentational component, which is exactly the
 * boundary the runner's header comment is about.
 *
 * Pause is offered only where there is nothing to cheat: the question bank's
 * stopwatch counts up, submits nothing, and enforces nothing.
 */

import { formatDuration, formatSeconds } from "@/lib/learn/types";

/** Below these the countdown turns amber, then red — the usual SAT warnings. */
const WARN_SECONDS = 300;
const URGENT_SECONDS = 60;

type ExamTimerProps = {
  seconds: number;
  /** Countdown reads `12:04`; stopwatch grows past an hour to `1:08:12`. */
  mode: "countdown" | "stopwatch";
  hidden: boolean;
  onToggleHidden: () => void;
  /** Question bank only. Omitted on a timed module, where pause has no meaning. */
  paused?: boolean;
  onTogglePaused?: () => void;
};

export function ExamTimer({
  seconds,
  mode,
  hidden,
  onToggleHidden,
  paused,
  onTogglePaused,
}: ExamTimerProps) {
  const label =
    mode === "countdown" ? formatSeconds(seconds) : formatDuration(seconds);

  const tone =
    mode === "stopwatch"
      ? "text-ink"
      : seconds <= URGENT_SECONDS
        ? "text-miss-ink"
        : seconds <= WARN_SECONDS
          ? "text-insight-dark"
          : "text-ink";

  return (
    <div className="flex flex-col items-center gap-0.5">
      {/* Fixed height in both states so showing and hiding the clock never
          moves the row beneath it. */}
      <div className="flex h-8 items-center">
        {hidden ? (
          <span className="text-sm font-medium text-muted">Timer hidden</span>
        ) : (
          <p
            role="timer"
            // Off, not "polite": a screen reader announcing every second of a
            // 35-minute module would make the page unusable. The value is
            // readable on demand; the warnings are carried by colour and by the
            // runner's own messaging.
            aria-live="off"
            className={`font-display text-2xl font-extrabold tabular-nums ${tone}`}
          >
            {label}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        {onTogglePaused && (
          <button
            type="button"
            onClick={onTogglePaused}
            aria-pressed={paused}
            className={controlClassName}
          >
            {paused ? "Resume" : "Pause"}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleHidden}
          aria-pressed={hidden}
          className={controlClassName}
        >
          {hidden ? "Show" : "Hide"}
        </button>
      </div>
    </div>
  );
}

const controlClassName =
  "rounded-lg border border-hairline px-2.5 py-0.5 text-xs font-semibold text-muted " +
  "transition-colors hover:border-accent hover:text-accent " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
