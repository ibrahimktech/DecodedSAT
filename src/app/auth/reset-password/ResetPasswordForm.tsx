"use client";

import { useActionState, useState } from "react";
import { AuthField } from "@/components/auth/AuthField";
import { FormMessage } from "@/components/auth/FormMessage";
import { ctaClassName } from "@/components/CtaButton";
import {
  fieldErrors,
  PASSWORD_MIN,
  ResetPasswordSchema,
} from "@/lib/auth/schemas";
import { initialAuthFormState } from "@/lib/auth/state";
import { updateRecoveredPasswordAction } from "./actions";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    updateRecoveredPasswordAction,
    initialAuthFormState,
  );
  const [values, setValues] = useState({
    password: "",
    confirmPassword: "",
  });
  const [touched, setTouched] = useState({
    password: false,
    confirmPassword: false,
  });
  const [dismissedAttempt, setDismissedAttempt] = useState<number | null>(null);

  const errors = fieldErrors(ResetPasswordSchema, values);
  const showServerFeedback = dismissedAttempt !== state.attempt;
  const errorFor = (field: keyof typeof values) =>
    (touched[field] ? errors[field] : undefined) ??
    (showServerFeedback ? state.fieldErrors?.[field] : undefined);

  const setField = (field: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (state.status !== "idle") setDismissedAttempt(state.attempt);
  };

  const markTouched = (field: keyof typeof values) => () =>
    setTouched((current) => ({ ...current, [field]: true }));

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        setDismissedAttempt(state.attempt);
        if (Object.keys(errors).length > 0) {
          event.preventDefault();
          setTouched({ password: true, confirmPassword: true });
        }
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      {showServerFeedback && state.status !== "idle" && state.message && (
        <FormMessage>{state.message}</FormMessage>
      )}

      <AuthField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={values.password}
        onChange={setField("password")}
        onBlur={markTouched("password")}
        error={errorFor("password")}
        hint={`At least ${PASSWORD_MIN} characters.`}
        disabled={pending}
        autoFocus
      />

      <AuthField
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        value={values.confirmPassword}
        onChange={setField("confirmPassword")}
        onBlur={markTouched("confirmPassword")}
        error={errorFor("confirmPassword")}
        disabled={pending}
      />

      <button
        type="submit"
        disabled={pending}
        className={ctaClassName("primary", "w-full")}
      >
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
