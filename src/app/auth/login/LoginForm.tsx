"use client";

/**
 * Sign-in form.
 *
 * Deliberately thinner on client-side validation than signup: the only useful
 * check is that the email is shaped like an email. Grading the password as they
 * type would tell an attacker the rules a real password must satisfy, and would
 * block someone whose account predates a rule change from signing in at all.
 */

import { useActionState, useState } from "react";
import Link from "next/link";
import { ctaClassName } from "@/components/CtaButton";
import { AuthField } from "@/components/auth/AuthField";
import { FormMessage } from "@/components/auth/FormMessage";
import { EMAIL_MAX, LoginSchema, fieldErrors } from "@/lib/auth/schemas";
import { initialAuthFormState } from "@/lib/auth/state";
import { logInAction } from "./actions";

type LoginFormProps = {
  /** Set by `/auth/callback` when a confirmation link fails to redeem. */
  notice?: string;
};

export function LoginForm({ notice }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(
    logInAction,
    initialAuthFormState,
  );

  const [values, setValues] = useState({ email: "", password: "" });
  const [emailTouched, setEmailTouched] = useState(false);

  const errors = fieldErrors(LoginSchema, {
    ...values,
    password: values.password || "x",
  });
  const emailError = emailTouched ? errors.email : undefined;

  const setField = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  return (
    <div className="flex flex-col gap-6">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (errors.email) {
            event.preventDefault();
            setEmailTouched(true);
          }
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        {notice && state.status === "idle" && <FormMessage>{notice}</FormMessage>}
        {state.status !== "idle" && state.message && (
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
          onBlur={() => setEmailTouched(true)}
          error={emailError}
          disabled={pending}
        />

        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={setField("password")}
          onBlur={() => {}}
          disabled={pending}
        />


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
