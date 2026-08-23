"use client";

/**
 * The A/B/C/D answer rows, with the digital SAT's answer eliminator.
 *
 * Crossing out choices you have ruled out is the single most-taught SAT
 * technique there is, and doing it on paper is not an option on a screen test.
 * Bluebook gives every question a toggle that reveals a strike button beside
 * each choice; this is that.
 *
 * A struck choice stays clickable. That is not an oversight — it is how the
 * real thing behaves, and it is the right call regardless: a student who
 * eliminates a choice and then changes their mind should not have to hunt for
 * how to undo it. Clicking the row un-strikes and selects in one go.
 *
 * Shared by the test runner and the question bank, which is also where the
 * post-answer verdict colouring now lives — the two surfaces drew identical
 * rows before, and the bank's version had the grading states bolted on.
 */

import { MathText } from "@/components/app/MathText";
import { CHOICE_LETTERS } from "@/lib/learn/types";

type ChoiceListProps = {
  choices: string[];
  selected: number | null;
  onSelect: (choice: number) => void;
  /** Indexes the student has ruled out. */
  crossed: readonly number[];
  onToggleCross: (choice: number) => void;
  /** Whether the strike buttons are showing. */
  eliminating: boolean;
  /**
   * Set once the question is graded (question bank only). Its presence is what
   * switches the rows from "pick one" to "here is how it went", and freezes
   * them.
   */
  correctChoice?: number | null;
  disabled?: boolean;
};

export function ChoiceList({
  choices,
  selected,
  onSelect,
  crossed,
  onToggleCross,
  eliminating,
  correctChoice = null,
  disabled = false,
}: ChoiceListProps) {
  const graded = correctChoice !== null;
  const frozen = graded || disabled;

  function rowClassName(index: number): string {
    const base =
      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[0.9375rem] transition-colors " +
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default";

    if (graded) {
      if (index === correctChoice) {
        return `${base} border-accent bg-accent-chip text-ink`;
      }
      if (index === selected) {
        return `${base} border-miss-hairline bg-miss-surface text-miss-ink`;
      }
      return `${base} border-hairline bg-surface text-muted`;
    }

    if (selected === index) {
      return `${base} border-accent bg-accent-chip text-ink`;
    }
    return `${base} border-hairline bg-surface text-ink hover:border-accent`;
  }

  return (
    <div className="flex flex-col gap-2.5" role="group" aria-label="Answer choices">
      {choices.map((choice, index) => {
        const isCrossed = crossed.includes(index);

        return (
          <div key={index} className="flex items-center gap-2">
            <button
              type="button"
              disabled={frozen}
              onClick={() => {
                // Picking a ruled-out choice un-rules it. Leaving it struck
                // while also selected would show two contradictory states on
                // the same row.
                if (isCrossed) onToggleCross(index);
                onSelect(index);
              }}
              aria-pressed={selected === index}
              className={`${rowClassName(index)} ${
                isCrossed ? "opacity-45" : ""
              }`}
            >
              <span
                className={`font-display font-bold ${isCrossed ? "line-through" : ""}`}
              >
                {CHOICE_LETTERS[index]}
              </span>
              <MathText
                text={choice}
                className={isCrossed ? "line-through" : undefined}
              />
            </button>

            {eliminating && !frozen && (
              <button
                type="button"
                onClick={() => onToggleCross(index)}
                aria-pressed={isCrossed}
                aria-label={`${isCrossed ? "Restore" : "Cross out"} choice ${CHOICE_LETTERS[index]}`}
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-display text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  isCrossed
                    ? "border-muted text-muted"
                    : "border-hairline text-ink hover:border-accent hover:text-accent"
                }`}
              >
                {CHOICE_LETTERS[index]}
                {isCrossed && (
                  // Drawn across the button rather than as `line-through` on
                  // the glyph, so a one-character label still reads as struck.
                  <span
                    aria-hidden
                    className="absolute inset-x-1.5 h-px bg-current"
                  />
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
