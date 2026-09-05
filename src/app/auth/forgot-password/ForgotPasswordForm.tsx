"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { AuthField } from "@/components/auth/AuthField";
import { FormMessage } from "@/components/auth/FormMessage";
import { ctaClassName } from "@/components/CtaButton";
import {
  EMAIL_MAX,
  fieldErrors,
  ForgotPasswordSchema,
} from "@/lib/auth/schemas";
import { initialAuthFormState } from "@/lib/auth/state";
import { requestPasswordResetAction } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialAuthFormState,
  );
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [dismissedAttempt, setDismissedAttempt] = useState<number | null>(null);

  const errors = fieldErrors(ForgotPasswordSchema, { email });
  const showServerFeedback = dismissedAttempt !== state.attempt;
  const emailError =
    (touched ? errors.email : undefined) ??
    (showServerFeedback ? state.fieldErrors?.email : undefined);

  if (state.status === "sent") {
    return (
      <div
        role="status"
        className="flex flex-col gap-4 rounded-2xl border border-insight-hairline bg-insight-surface p-6 text-center"
      >
        <h2 className="font-display text-2xl font-bold text-ink">
          Check your email
        </h2>
        <p className="text-[0.9375rem] leading-relaxed text-muted">
          {state.message}
        </p>
        <p className="text-sm text-muted">
          The link expires in 30 minutes. Check your spam folder if it does not
          arrive shortly.
        </p>
        <Link
          href="/auth/login"
          className="font-semibold text-accent transition-colors hover:text-accent-hover"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        onSubmit={(event) => {
          setDismissedAttempt(state.attempt);
          if (errors.email) {
            event.preventDefault();
            setTouched(true);
          }
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        {showServerFeedback && state.status !== "idle" && state.message && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={EMAIL_MAX}
          value={email}
          onChange={(value) => {
            setEmail(value);
            if (state.status !== "idle") setDismissedAttempt(state.attempt);
          }}
          onBlur={() => setTouched(true)}
          error={emailError}
          disabled={pending}
          autoFocus
        />

        <button
          type="submit"
          disabled={pending}
          className={ctaClassName("primary", "w-full")}
        >
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="text-center text-[0.9375rem] text-muted">
        Remembered your password?{" "}
        <Link
          href="/auth/login"
          className="font-semibold text-accent transition-colors hover:text-accent-hover"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
