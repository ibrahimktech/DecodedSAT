"use client";

/**
 * Shared picker for the official SAT Weekend calendar.
 *
 * The source values stay centralized in `sat-dates.ts`; this component owns
 * only the browser-time filtering and presentation. Refreshing once a minute
 * means a page left open overnight drops yesterday's test date without a
 * reload or a code change.
 */

import { useEffect, useRef, useState } from "react";
import { ChoiceCard } from "@/components/onboarding/ChoiceCard";
import { SelectField } from "@/components/onboarding/SelectField";
import {
  formatOfficialSatDate,
  getAvailableOfficialSatDates,
  type OfficialSatDateOption,
} from "@/lib/onboarding/sat-dates";

type OfficialSatDateFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
};

export function OfficialSatDateField({
  label,
  name,
  value,
  onChange,
  error,
  disabled,
}: OfficialSatDateFieldProps) {
  const [availableDates, setAvailableDates] = useState<
    OfficialSatDateOption[]
  >([]);
  const [clearedDate, setClearedDate] = useState<string | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [onChange, value]);

  useEffect(() => {
    const refreshDates = () => {
      const nextDates = getAvailableOfficialSatDates(new Date());
      setAvailableDates(nextDates);

      const currentValue = valueRef.current;
      if (
        currentValue !== "" &&
        !nextDates.some((date) => date.value === currentValue)
      ) {
        setClearedDate(currentValue);
        onChangeRef.current("");
      }
    };

    refreshDates();
    const interval = window.setInterval(refreshDates, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const choose = (nextValue: string) => {
    setClearedDate(null);
    onChange(nextValue);
  };

  return (
    <div>
      <SelectField
        label={label}
        name={name}
        value={value}
        onChange={choose}
        options={availableDates}
        placeholder={
          availableDates.length > 0
            ? "Select SAT date"
            : "No upcoming dates currently published"
        }
        error={error}
        hint="Only official SAT Weekend administrations are shown."
        disabled={disabled}
      />

      {clearedDate && (
        <p role="status" className="mt-2 text-sm text-miss-ink">
          {formatOfficialSatDate(clearedDate)} is not an upcoming official SAT
          Weekend date, so it was cleared from this form.
        </p>
      )}

      <div className="mt-3">
        <ChoiceCard
          selected={value === ""}
          onSelect={() => choose("")}
          disabled={disabled}
        >
          I&apos;m not sure yet
        </ChoiceCard>
      </div>
    </div>
  );
}
