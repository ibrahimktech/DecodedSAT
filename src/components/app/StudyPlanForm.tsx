"use client";

/**
 * Study plan editor for Settings.
 *
 * Onboarding runs once and closes; the numbers it captured are not frozen with
 * it. A student who improves has to be able to raise their target, and test
 * dates move.
 *
 * Same split as the auth forms: Zod here is feedback while typing, and
 * `update_study_plan()` in the database re-checks every range and refuses to
 * touch anything outside these three fields.
 *
 * Fields live in an inner component keyed on the attempt counter, the same
 * shape `PasswordForm` uses — except these are seeded from the saved values
 * rather than cleared, since the point is editing what is already there.
 */

import { useActionState, useState } from "react";
import { updateStudyPlanAction } from "@/app/(app)/settings/actions";
import { AuthField } from "@/components/auth/AuthField";
import { FormMessage } from "@/components/auth/FormMessage";
import { ctaClassName } from "@/components/CtaButton";
import { SelectField } from "@/components/onboarding/SelectField";
import { type AuthFormState, initialAuthFormState } from "@/lib/auth/state";
import {
  DAILY_GOAL_OPTIONS,
  SCORE_BUCKETS,
  StudyPlanSchema,
} from "@/lib/onboarding/schemas";

export type StudyPlan = {
  targetScore: number | null;
  dailyGoal: number;
  testDate: string | null;
};

const scoreOptions = SCORE_BUCKETS.map((score) => ({
  value: String(score),
  label: String(score),
}));

const goalOptions = DAILY_GOAL_OPTIONS.map((goal) => ({
  value: String(goal),
  label: `${goal} questions`,
}));

export function StudyPlanForm({ plan }: { plan: StudyPlan }) {
  const [state, formAction, pending] = useActionState(
    updateStudyPlanAction,
    initialAuthFormState,
  );

  return (
    <StudyPlanFields
      key={state.attempt}
      plan={plan}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
}

function StudyPlanFields({
  plan,
  state,
  formAction,
  pending,
}: {
  plan: StudyPlan;
  state: AuthFormState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const [values, setValues] = useState({
    targetScore: plan.targetScore === null ? "" : String(plan.targetScore),
    dailyGoal: String(plan.dailyGoal),
    testDate: plan.testDate ?? "",
  });
  const [touched, setTouched] = useState(false);

  const parsed = StudyPlanSchema.safeParse(values);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  const errorFor = (field: keyof typeof values) =>
    touched ? errors[field] : undefined;

  const set = (field: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // React honours preventDefault here and skips the action, so this
        // surfaces the problem without a round trip.
        if (!parsed.success) {
          event.preventDefault();
          setTouched(true);
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

      <SelectField
        label="Target Math score"
        name="targetScore"
        value={values.targetScore}
        onChange={set("targetScore")}
        options={scoreOptions}
        placeholder="Pick a score"
        error={errorFor("targetScore")}
        disabled={pending}
      />

      <SelectField
        label="Daily goal"
        name="dailyGoal"
        value={values.dailyGoal}
        onChange={set("dailyGoal")}
        options={goalOptions}
        error={errorFor("dailyGoal")}
        disabled={pending}
      />

      <AuthField
        label="Test date"
        name="testDate"
        type="date"
        autoComplete="off"
        required={false}
        value={values.testDate}
        onChange={set("testDate")}
        onBlur={() => setTouched(true)}
        error={errorFor("testDate")}
        hint="Leave blank if you haven't booked one."
        disabled={pending}
      />

      <div>
        <button
          type="submit"
          disabled={pending}
          className={ctaClassName("primary")}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
