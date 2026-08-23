"use client";

/**
 * The "Question 5 of 22" pill in the bottom bar, and the grid it opens.
 *
 * Replaces a strip of numbered buttons that was always on screen. On a
 * 22-question module that strip cost a full row above every single question to
 * show information a student wants roughly twice a section — and it is not how
 * the real test does it either, where the same grid lives behind the question
 * counter. Folding it into a popup gives the prompt back its vertical space
 * without taking the capability away.
 *
 * Two shapes of the same control, differing only in what a cell can say:
 *
 * - `"answered"` — a timed module. Nothing is graded until the module ends, so
 *   a cell says only whether it has an answer.
 * - `"graded"` — the question bank, where each question is marked the moment it
 *   is submitted, so cells carry the verdict.
 *
 * Every cell is reachable in both. Skipping a hard question and coming back is
 * how the test is meant to be worked, and a navigator that would not let you do
 * it would be teaching the wrong habit.
 *
 * ## Why the grid pages
 *
 * A timed module holds 22 questions and could render them all. A question-bank
 * set is now the whole filtered slice of the bank, which can run to thousands —
 * and a popup that mounts three thousand buttons is slow to open and useless to
 * scan. So the grid shows one page at a time, opens on the page holding the
 * current question, and takes a number for a direct jump. Below one page's
 * worth the pager and the jump box are not rendered at all, which covers every
 * practice test and most sets.
 */

import { useEffect, useRef, useState } from "react";
import { BookmarkIcon } from "@/components/app/exam/icons";

/** Cells per page. Six columns, so this stays a whole number of rows. */
const PAGE_SIZE = 60;

export type NavigatorItem = {
  /** Question id — the key, and what the review flag is stored against. */
  id: string;
  state: "current" | "answered" | "correct" | "incorrect" | "unanswered";
  marked: boolean;
};

type QuestionNavigatorProps = {
  items: NavigatorItem[];
  currentIndex: number;
  onJump: (index: number) => void;
  variant: "answered" | "graded";
  /** Names the popup for assistive tech, e.g. "Questions in this module". */
  label: string;
};

function cellClassName(state: NavigatorItem["state"]): string {
  switch (state) {
    case "current":
      return "border-ink bg-ink text-background";
    case "correct":
    case "answered":
      return "border-accent bg-accent-chip text-accent";
    case "incorrect":
      return "border-miss-hairline bg-miss-surface text-miss-ink";
    default:
      return "border-hairline bg-surface text-muted";
  }
}

/** How a cell's state is read out to assistive tech. */
function stateLabel(state: NavigatorItem["state"]): string {
  switch (state) {
    case "current":
      return "current";
    case "correct":
      return "correct";
    case "incorrect":
      return "incorrect";
    case "answered":
      return "answered";
    default:
      return "not answered";
  }
}

export function QuestionNavigator({
  items,
  currentIndex,
  onJump,
  variant,
  label,
}: QuestionNavigatorProps) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(() => Math.floor(currentIndex / PAGE_SIZE));
  const [jumpTo, setJumpTo] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const paged = items.length > PAGE_SIZE;

  /**
   * Opening lands on the question you are actually on, however far the pager
   * was left from it. Adjusted during render rather than in an effect — an
   * effect would paint the stale page for a frame first.
   */
  const [openedAs, setOpenedAs] = useState(false);
  if (open !== openedAs) {
    setOpenedAs(open);
    if (open) setPage(Math.floor(currentIndex / PAGE_SIZE));
  }

  // Escape and an outside click both close it — the same two gestures that
  // dismiss the floating tool panels, so the whole surface behaves one way.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const legend: Array<{ state: NavigatorItem["state"]; text: string }> =
    variant === "graded"
      ? [
          { state: "correct", text: "Correct" },
          { state: "incorrect", text: "Incorrect" },
          { state: "unanswered", text: "Unanswered" },
        ]
      : [
          { state: "answered", text: "Answered" },
          { state: "unanswered", text: "Unanswered" },
        ];

  const from = page * PAGE_SIZE;
  const visible = items.slice(from, from + PAGE_SIZE);

  function jump(oneBased: string) {
    const parsed = Number.parseInt(oneBased, 10);
    if (!Number.isInteger(parsed)) return;
    const index = Math.min(Math.max(parsed, 1), items.length) - 1;
    onJump(index);
    setJumpTo("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      {open && (
        <div
          role="dialog"
          aria-label={label}
          // Anchored above the pill and centred on it. `bottom-full` keeps it
          // clear of the bar whatever the grid's height turns out to be.
          className="absolute bottom-full left-1/2 z-40 mb-3 w-80 -translate-x-1/2 rounded-2xl border border-hairline bg-surface p-4 shadow-nav"
        >
          <p className="font-display text-[0.9375rem] font-bold text-ink">
            {label}
          </p>

          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {legend.map((entry) => (
              <li
                key={entry.text}
                className="flex items-center gap-1.5 text-xs text-muted"
              >
                <span
                  aria-hidden
                  className={`h-3 w-3 rounded border ${cellClassName(entry.state)}`}
                />
                {entry.text}
              </li>
            ))}
            <li className="flex items-center gap-1.5 text-xs text-muted">
              <BookmarkIcon className="h-3 w-3 text-insight" />
              For review
            </li>
          </ul>

          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {visible.map((item, offset) => {
              const index = from + offset;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onJump(index);
                    setOpen(false);
                  }}
                  aria-current={index === currentIndex ? "true" : undefined}
                  aria-label={`Question ${index + 1}, ${stateLabel(item.state)}${
                    item.marked ? ", marked for review" : ""
                  }`}
                  className={`relative h-9 rounded-lg border text-sm font-semibold transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${cellClassName(
                    item.state,
                  )}`}
                >
                  {index + 1}
                  {item.marked && (
                    <BookmarkIcon className="absolute -top-1 -right-1 h-3.5 w-3.5 text-insight" />
                  )}
                </button>
              );
            })}
          </div>

          {paged && (
            <>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                  disabled={page === 0}
                  className={pagerClassName}
                >
                  ‹ Prev
                </button>
                <span className="text-xs font-medium text-muted">
                  {from + 1}–{Math.min(from + PAGE_SIZE, items.length)} of{" "}
                  {items.length}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPage((current) => Math.min(pageCount - 1, current + 1))
                  }
                  disabled={page >= pageCount - 1}
                  className={pagerClassName}
                >
                  Next ›
                </button>
              </div>

              {/* A pager alone would mean forty clicks to reach question 2,400. */}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  jump(jumpTo);
                }}
                className="mt-2 flex items-center gap-2"
              >
                <label htmlFor="navigator-jump" className="text-xs text-muted">
                  Go to
                </label>
                <input
                  id="navigator-jump"
                  type="number"
                  min={1}
                  max={items.length}
                  inputMode="numeric"
                  value={jumpTo}
                  onChange={(event) => setJumpTo(event.target.value)}
                  placeholder={String(currentIndex + 1)}
                  className="w-20 rounded-lg border border-hairline bg-surface px-2 py-1 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
                <button type="submit" className={pagerClassName}>
                  Jump
                </button>
              </form>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface px-4 py-2 text-[0.9375rem] font-semibold text-ink transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Question {currentIndex + 1} of {items.length}
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}

const pagerClassName =
  "rounded-lg border border-hairline px-2.5 py-1 text-xs font-semibold text-muted " +
  "transition-colors hover:border-accent hover:text-accent " +
  "disabled:cursor-not-allowed disabled:opacity-40 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
