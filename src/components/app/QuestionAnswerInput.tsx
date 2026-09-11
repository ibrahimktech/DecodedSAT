"use client";

import { useId } from "react";
import { ChoiceList } from "@/components/app/exam/ChoiceList";
import type { QuestionType } from "@/lib/questions/answers";

export function QuestionAnswerInput({
  questionType,
  choices,
  value,
  onChange,
  crossed = [],
  onToggleCross = () => undefined,
  eliminating = false,
  correctChoice = null,
  isCorrect,
  disabled = false,
}: {
  questionType: QuestionType;
  choices: string[];
  value: string | null;
  onChange: (answer: string) => void;
  crossed?: readonly number[];
  onToggleCross?: (choice: number) => void;
  eliminating?: boolean;
  correctChoice?: number | null;
  isCorrect?: boolean;
  disabled?: boolean;
}) {
  const helpId = useId();

  if (questionType === "multiple_choice") {
    const selected = value !== null ? Number.parseInt(value, 10) : NaN;
    return (
      <ChoiceList
        choices={choices}
        selected={Number.isInteger(selected) ? selected : null}
        onSelect={(choice) => onChange(String(choice))}
        crossed={crossed}
        onToggleCross={onToggleCross}
        eliminating={eliminating}
        correctChoice={correctChoice}
        disabled={disabled}
      />
    );
  }

  return (
    <label className="block max-w-md">
      <span className="mb-2 block text-sm font-semibold text-muted">
        Your answer
      </span>
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || isCorrect !== undefined}
        placeholder="Integer, decimal, or fraction"
        aria-describedby={helpId}
        className={`w-full rounded-xl border bg-surface px-4 py-3 font-question text-lg text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default ${
          isCorrect === true
            ? "border-accent bg-accent-chip"
            : isCorrect === false
              ? "border-miss-hairline bg-miss-surface"
              : "border-hairline"
        }`}
      />
      <span id={helpId} className="mt-2 block text-sm text-muted">
        Fractions such as 3/4 and signed decimals such as -1.25 are accepted.
      </span>
    </label>
  );
}
