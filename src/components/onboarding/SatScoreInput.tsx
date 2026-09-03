"use client";

/**
 * Direct-entry SAT Math score with explicit 10-point step controls.
 *
 * The raw string stays in the wizard so a temporarily invalid typed value can
 * receive a useful validation message rather than being silently rounded or
 * clamped. The buttons only step valid values and stop at the SAT bounds.
 */

import { useId } from "react";
import {
  isValidSatScore,
  SCORE_MAX,
  SCORE_MIN,
  SCORE_STEP,
} from "@/lib/onboarding/schemas";

type SatScoreInputProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  disabled?: boolean;
};

export function SatScoreInput({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  disabled,
}: SatScoreInputProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const numericValue = Number(value);
  const validValue = isValidSatScore(value);
  const hint = `Enter ${SCORE_MIN}–${SCORE_MAX} in steps of ${SCORE_STEP}.`;

  const stepBy = (direction: -1 | 1) => {
    if (value === "") {
      onChange(String(SCORE_MIN));
      return;
    }
    if (!validValue) return;

    const next = Math.min(
      SCORE_MAX,
      Math.max(SCORE_MIN, numericValue + direction * SCORE_STEP),
    );
    onChange(String(next));
  };

  const stepDisabled = disabled || (value !== "" && !validValue);

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[0.9375rem] font-medium text-ink"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={SCORE_MIN}
          max={SCORE_MAX}
          step={SCORE_STEP}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "" || /^\d+$/.test(next)) onChange(next);
          }}
          onKeyDown={(event) => {
            if (["e", "E", "+", "-", "."].includes(event.key)) {
              event.preventDefault();
            }
          }}
          onBlur={onBlur}
          autoComplete="off"
          disabled={disabled}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={messageId}
          className={`h-16 w-full rounded-xl border bg-surface pl-4 pr-16 text-lg font-semibold tabular-nums text-ink transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${
            error ? "border-miss-hairline" : "border-hairline"
          }`}
        />

        <div className="absolute inset-y-px right-px flex w-12 flex-col overflow-hidden rounded-r-[0.6875rem] border-l border-hairline bg-background">
          <button
            type="button"
            onClick={() => stepBy(1)}
            disabled={stepDisabled || (validValue && numericValue >= SCORE_MAX)}
            aria-label={`Increase ${label} by ${SCORE_STEP}`}
            title={`Increase by ${SCORE_STEP}`}
            className="flex min-h-0 flex-1 items-center justify-center border-b border-hairline text-ink transition-colors hover:bg-accent-chip hover:text-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-background disabled:hover:text-ink"
          >
            <Chevron direction="up" />
          </button>
          <button
            type="button"
            onClick={() => stepBy(-1)}
            disabled={stepDisabled || (validValue && numericValue <= SCORE_MIN)}
            aria-label={`Decrease ${label} by ${SCORE_STEP}`}
            title={`Decrease by ${SCORE_STEP}`}
            className="flex min-h-0 flex-1 items-center justify-center text-ink transition-colors hover:bg-accent-chip hover:text-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-background disabled:hover:text-ink"
          >
            <Chevron direction="down" />
          </button>
        </div>
      </div>

      <p
        id={messageId}
        className={`mt-1.5 text-sm ${error ? "text-miss-ink" : "text-muted"}`}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

function Chevron({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={direction === "up" ? "m7 14 5-5 5 5" : "m7 10 5 5 5-5"} />
    </svg>
  );
}
