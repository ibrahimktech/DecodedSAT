"use client";

/**
 * Password change form for Settings.
 *
 * Same split as the auth forms: Zod here is feedback while typing, the Server
 * Action re-parses the identical schema and is the boundary.
 *
 * The fields live in an inner component keyed on the attempt counter, so
 * every completed submission remounts them empty — a password must not
 * linger in the DOM after it has been sent, and remounting clears state
 * without an effect. The outcome message lives in the outer component and
 * survives the remount.
 */

import { useActionState, useState } from "react";
import { changePasswordAction } from "@/app/(app)/settings/actions";
import { ctaClassName } from "@/components/CtaButton";
import { AuthField } from "@/components/auth/AuthField";
import { FormMessage } from "@/components/auth/FormMessage";
import { PASSWORD_MIN } from "@/lib/auth/schemas";
import { type AuthFormState, initialAuthFormState } from "@/lib/auth/state";
import { PasswordChangeSchema } from "@/lib/learn/schemas";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    initialAuthFormState,
  );

  return (
    <PasswordFields
      key={state.attempt}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
}

function PasswordFields({
  state,
  formAction,
  pending,
}: {
  state: AuthFormState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const [values, setValues] = useState({ password: "", confirm: "" });
  const [touched, setTouched] = useState({ password: false, confirm: false });

  const parsed = PasswordChangeSchema.safeParse(values);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }

  const errorFor = (field: "password" | "confirm") =>
    touched[field] ? errors[field] : undefined;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (Object.keys(errors).length > 0) {
          event.preventDefault();
          setTouched({ password: true, confirm: true });
        }
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      {state.status === "sent" && (
        <p
          role="status"
          className="rounded-xl border border-accent bg-accent-chip px-4 py-3 text-[0.9375rem] font-medium text-accent"
        >
          {state.message}
        </p>
      )}
      {(state.status === "error" || state.status === "rate_limited") && (
        <FormMessage>{state.message}</FormMessage>
      )}

      <AuthField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={values.password}
        onChange={(value) =>
          setValues((current) => ({ ...current, password: value }))
        }
        onBlur={() => setTouched((current) => ({ ...current, password: true }))}
        error={errorFor("password")}
        hint={`At least ${PASSWORD_MIN} characters.`}
        disabled={pending}
      />

      <AuthField
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        value={values.confirm}
        onChange={(value) =>
          setValues((current) => ({ ...current, confirm: value }))
        }
        onBlur={() => setTouched((current) => ({ ...current, confirm: true }))}
        error={errorFor("confirm")}
        disabled={pending}
      />

      <div>
        <button
          type="submit"
          disabled={pending}
          className={ctaClassName("primary")}
        >
          {pending ? "Updating…" : "Update password"}
        </button>
      </div>
    </form>
  );
}
