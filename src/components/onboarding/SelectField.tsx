"use client";

/**
 * Labelled native `<select>`.
 *
 * The class string was living as a local `fieldClass` const inside
 * `AddVideoPanel`, copied into the admin list panels. This is that treatment
 * with a label and an error slot attached, matching `AuthField`'s shape so the
 * two read the same way in a form.
 *
 * Native `<select>` on purpose: it is the control mobile browsers render as a
 * proper picker, which is the whole reason the score steps use a dropdown
 * rather than a text input.
 */

import { useId } from "react";

type SelectFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Shown as a disabled first entry until they pick something. */
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
};

export function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  placeholder,
  error,
  hint,
  disabled,
}: SelectFieldProps) {
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
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={`w-full rounded-xl border bg-surface px-4 py-3 text-base text-ink transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 ${
          error ? "border-miss-hairline" : "border-hairline"
        }`}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
