"use client";

/**
 * Signup form.
 *
 * The Zod parsing here exists to tell someone their password is short before
 * they wait on a round trip. It is not a check — `signUpAction` re-parses the
 * identical schemas server-side and treats whatever arrives as hostile. Both
 * import from `@/lib/auth/schemas`, so the two can't drift.
 *
 * On success the form is replaced by the "check your email" panel rather than
 * redirecting: there is no session yet, and there should not be one. The
 * account is not real until the confirmation link fires the `profiles` trigger.
 */

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ctaClassName } from "@/components/CtaButton";
import { AuthField } from "@/components/auth/AuthField";
import { FormMessage } from "@/components/auth/FormMessage";
import {
  EMAIL_MAX,
  FULL_NAME_MAX,
  PASSWORD_MIN,
  SignupSchema,
  fieldErrors,
} from "@/lib/auth/schemas";
import { initialAuthFormState } from "@/lib/auth/state";
import { trackProductEvent } from "@/lib/analytics/client";
import { signUpAction } from "./actions";

type Touched = { fullName: boolean; email: boolean; password: boolean };

const NOTHING_TOUCHED: Touched = {
  fullName: false,
  email: false,
  password: false,
};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(
    signUpAction,
    initialAuthFormState,
  );

  const [values, setValues] = useState({
    fullName: "",
    email: "",
    password: "",
  });
  const [touched, setTouched] = useState(NOTHING_TOUCHED);

  useEffect(() => {
    if (state.status === "sent") trackProductEvent("signup_requested");
  }, [state.status]);

  // Validated against the same object the server will parse, minus the token —
  // that one is gated by the disabled submit button instead.
  const errors = fieldErrors(SignupSchema, values);

  const setField = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const markTouched = (field: keyof Touched) => () =>
    setTouched((current) => ({ ...current, [field]: true }));

  const errorFor = (field: keyof Touched) =>
    touched[field] ? errors[field] : undefined;

  if (state.status === "sent") {
    return <CheckYourEmail email={values.email} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        onSubmit={(event) => {
          // React honours preventDefault here and skips the action, so this
          // surfaces every field error at once instead of bouncing off the
          // server for something the browser already knew.
          if (Object.keys(errors).length > 0) {
            event.preventDefault();
            setTouched({ fullName: true, email: true, password: true });
          }
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        {state.status !== "idle" && state.message && (
          <FormMessage>{state.message}</FormMessage>
        )}

        <AuthField
          label="Full name"
          name="fullName"
          type="text"
          autoComplete="name"
          maxLength={FULL_NAME_MAX}
          value={values.fullName}
          onChange={setField("fullName")}
          onBlur={markTouched("fullName")}
          error={errorFor("fullName")}
          disabled={pending}
        />

        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={EMAIL_MAX}
          value={values.email}
          onChange={setField("email")}
          onBlur={markTouched("email")}
          error={errorFor("email")}
          disabled={pending}
        />

        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={setField("password")}
          onBlur={markTouched("password")}
          error={errorFor("password")}
          hint={`At least ${PASSWORD_MIN} characters.`}
          disabled={pending}
        />


        <button
          type="submit"
          disabled={pending}
          className={ctaClassName("primary", "w-full")}
        >
          {pending ? "Creating account…" : "Create account"}
        </button>

      </form>

      <p className="text-center text-[0.9375rem] text-muted">
        Already have an account?{" "}
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

function CheckYourEmail({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-insight-hairline bg-insight-surface p-6 text-center">
      <h2 className="font-display text-2xl font-bold text-ink">
        Check your email
      </h2>
      <p className="text-[0.9375rem] leading-relaxed text-muted">
        If {email ? <strong className="text-ink">{email}</strong> : "that address"}{" "}
        can be used to create an account, a confirmation link is on its way.
        Open it to finish setting up — the link expires in 30 minutes.
      </p>
      <p className="text-sm text-muted">
        Nothing arrived? Check your spam folder before trying again.
      </p>
    </div>
  );
}
