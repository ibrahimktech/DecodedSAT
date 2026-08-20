"use client";

/**
 * A selectable option card.
 *
 * The geometry and the selected/unselected treatment are lifted verbatim from
 * the answer choices in `TestRunner` and `QuestionPlayer`, so picking "Once"
 * in onboarding feels like picking an answer in practice. One definition here
 * rather than a third copy of the class string.
 *
 * `aria-pressed` rather than a radio: these are buttons that toggle, and the
 * multi-select step needs the same control as the single-select ones.
 */

type ChoiceCardProps = {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Supporting line under the label — the "20 questions ≈ 15 min" hint. */
  hint?: string;
};

export function ChoiceCard({
  selected,
  onSelect,
  disabled,
  children,
  hint,
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex w-full flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left text-[0.9375rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-accent bg-accent-chip text-ink"
          : "border-hairline bg-surface text-ink hover:border-accent"
      }`}
    >
      <span className="font-medium">{children}</span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </button>
  );
}
