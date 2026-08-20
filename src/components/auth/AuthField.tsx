"use client";

/**
 * Labelled text input for the auth forms, and now for onboarding too.
 *
 * One definition so signup and sign-in cannot drift apart, and so the input
 * treatment matches the landing page's card and border conventions — flat
 * fills, hairline borders, the same focus ring the buttons use.
 *
 * `number` and `date` were added for the onboarding wizard. Widening the type
 * union here rather than writing a near-identical sibling component is what
 * keeps the promise in the paragraph above true.
 */

import { useId } from "react";

type AuthFieldProps = {
  label: string;
  name: string;
  type: "text" | "email" | "password" | "number" | "date";
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  /** Client-side validation message. UX only; the server re-checks everything. */
  error?: string;
  hint?: string;
  disabled?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  /** `number` and `date` inputs only; ignored by the text variants. */
  min?: string | number;
  max?: string | number;
  step?: number;
  /**
   * Auth fields are all mandatory, so `required` defaults on. Onboarding has
   * genuinely optional answers ("not sure yet" is an answer), which need it
   * off — otherwise the browser blocks a submit the schema would accept.
   */
  required?: boolean;
};

export function AuthField({
  label,
  name,
  type,
  autoComplete,
  value,
  onChange,
  onBlur,
  error,
  hint,
  disabled,
  maxLength,
  autoFocus,
  min,
  max,
  step,
  required = true,
}: AuthFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[0.9375rem] font-medium text-ink"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        disabled={disabled}
        maxLength={maxLength}
        autoFocus={autoFocus}
        min={min}
        max={max}
        step={step}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={`w-full rounded-xl border bg-surface px-4 py-3 text-base text-ink transition-colors placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${
          error ? "border-miss-hairline" : "border-hairline"
        }`}
      />
      {message && (
        <p
          id={messageId}
          className={`mt-1.5 text-sm ${error ? "text-miss-ink" : "text-muted"}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
