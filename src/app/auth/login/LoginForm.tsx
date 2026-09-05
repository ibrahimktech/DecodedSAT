"use client";

/**
 * Sign-in form.
 *
 * Login validates presence and email shape locally. It deliberately does not
 * apply signup password-strength rules, so older valid accounts are not locked
 * out and the form does not disclose anything about an existing password.
 */

import { useActionState, useState } from "react";
import Link from "next/link";
import { ctaClassName } from "@/components/CtaButton";
import { AuthField } from "@/components/auth/AuthField";
import { FormMessage } from "@/components/auth/FormMessage";
import { FormSuccess } from "@/components/auth/FormSuccess";
import { EMAIL_MAX, LoginSchema, fieldErrors } from "@/lib/auth/schemas";
import { initialAuthFormState } from "@/lib/auth/state";
import { logInAction } from "./actions";

type LoginFormProps = {
  /** Set by `/auth/callback` when a confirmation link fails to redeem. */
  notice?: string;
  /** Set after a completed recovery flow. */
  successNotice?: string;
};

export function LoginForm({ notice, successNotice }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(
    logInAction,
    initialAuthFormState,
  );

  const [values, setValues] = useState({ email: "", password: "" });
  const [touched, setTouched] = useState({ email: false, password: false });
  const [dismissedAttempt, setDismissedAttempt] = useState<number | null>(null);

  const errors = fieldErrors(LoginSchema, values);
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
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        onSubmit={(event) => {
          setDismissedAttempt(state.attempt);
          if (Object.keys(errors).length > 0) {
            event.preventDefault();
            setTouched({ email: true, password: true });
          }
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        {notice && state.status === "idle" && <FormMessage>{notice}</FormMessage>}
        {successNotice && state.status === "idle" && (
          <FormSuccess>{successNotice}</FormSuccess>
        )}
        {showServerFeedback && state.status !== "idle" && state.message && (
          <FormMessage>{state.message}</FormMessage>
        )}

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
          autoComplete="current-password"
          value={values.password}
          onChange={setField("password")}
          onBlur={markTouched("password")}
          error={errorFor("password")}
          disabled={pending}
        />

        <div className="-mt-1 text-right">
          <Link
            href="/auth/forgot-password"
            className="text-sm font-semibold text-accent transition-colors hover:text-accent-hover"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={pending}
          className={ctaClassName("primary", "w-full")}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>

      </form>

      <p className="text-center text-[0.9375rem] text-muted">
        New to DecodedSAT?{" "}
        <Link
          href="/auth/signup"
          className="font-semibold text-accent transition-colors hover:text-accent-hover"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
