"use client";

/**
 * The strip directly above a question: its number, the review flag, and the
 * answer-eliminator toggle.
 *
 * Laid out the way the digital SAT lays it out — solid number badge hard left,
 * "Mark for Review" beside it, tools hard right — because that is where a
 * student's eye will already be looking for them.
 */

import { BookmarkIcon } from "@/components/app/exam/icons";

type QuestionHeaderProps = {
  /** 1-based position within the module or batch. */
  number: number;
  marked: boolean;
  onToggleMark: () => void;
  eliminating: boolean;
  onToggleEliminating: () => void;
  /**
   * Hidden once a question is graded — there is nothing left to rule out, and
   * the strike buttons would sit beside choices that are already coloured by
   * their verdict.
   */
  showEliminate?: boolean;
  /** Question bank: the subtopic and difficulty chips. */
  meta?: React.ReactNode;
};

export function QuestionHeader({
  number,
  marked,
  onToggleMark,
  eliminating,
  onToggleEliminating,
  showEliminate = true,
  meta,
}: QuestionHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline pb-3">
      <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-ink px-2 font-display text-sm font-extrabold text-background">
        {number}
      </span>

      <button
        type="button"
        onClick={onToggleMark}
        aria-pressed={marked}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          marked
            ? "text-insight-dark"
            : "text-muted hover:bg-background hover:text-ink"
        }`}
      >
        <BookmarkIcon
          className={`h-4 w-4 ${marked ? "text-insight" : "text-hairline"}`}
        />
        Mark for Review
      </button>

      <div className="ml-auto flex items-center gap-2">
        {meta}

        {showEliminate && (
          <button
            type="button"
            onClick={onToggleEliminating}
            aria-pressed={eliminating}
            title="Cross out answer choices you've ruled out"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              eliminating
                ? "border-accent bg-accent-chip text-accent"
                : "border-hairline text-muted hover:border-accent hover:text-accent"
            }`}
          >
            <span className="relative font-display">
              ABC
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-current" />
            </span>
            <span className="sr-only">Toggle answer eliminator</span>
          </button>
        )}
      </div>
    </div>
  );
}
