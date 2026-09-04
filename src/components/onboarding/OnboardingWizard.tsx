"use client";

/**
 * The onboarding wizard.
 *
 * Six questions and a review panel, all held in local state and submitted once
 * at the end. Nothing reaches the database until the final button, which is
 * what makes stepping backwards free and a mid-flow refresh harmless — there is
 * no half-finished row for the dashboard or the gate to reason about.
 *
 * Every answer is mirrored into a hidden input, so the submit is an ordinary
 * `FormData` post to a Server Action like every other form in this project.
 * The visible controls carry `*Visible` names: they live inside the same form
 * and would otherwise submit a second copy of each value under the real key.
 *
 * The Zod parsing here decides whether "Next" is enabled and nothing more. The
 * action re-parses the same schema, and `complete_onboarding()` re-checks every
 * range again inside the database.
 *
 * Question 2 is the only branch: a real recent Math score for students who
 * have sat the SAT, or an estimate for students who have not. Both routes
 * remain six questions long, so progress never jumps or lies.
 */

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { completeOnboardingAction } from "@/app/onboarding/actions";
import { ctaClassName } from "@/components/CtaButton";
import { FormMessage } from "@/components/auth/FormMessage";
import { ChoiceCard } from "@/components/onboarding/ChoiceCard";
import { OfficialSatDateField } from "@/components/onboarding/OfficialSatDateField";
import { SatScoreInput } from "@/components/onboarding/SatScoreInput";
import { SelectField } from "@/components/onboarding/SelectField";
import { initialAuthFormState } from "@/lib/auth/state";
import type { Domain } from "@/lib/learn/types";
import {
  DAILY_GOAL_OPTIONS,
  MAX_FOCUS_DOMAINS,
  RECENT_SCORE_STEP_SCHEMA,
  SAT_ATTEMPT_OPTIONS,
  SCORE_BUCKETS,
  STEP_COUNT,
  STEP_SCHEMAS,
} from "@/lib/onboarding/schemas";
import { formatOfficialSatDate } from "@/lib/onboarding/sat-dates";
import { trackProductEvent, trackStudentEvent } from "@/lib/analytics/client";

/**
 * Everything is a string, because that is what an input holds and what
 * `FormData` carries. The schema coerces; nothing is pre-converted here.
 */
type Answers = {
  satAttempts: string;
  lastSatMathScore: string;
  currentScoreEstimate: string;
  targetScore: string;
  testDate: string;
  focusDomainIds: string[];
  dailyGoal: string;
};

const EMPTY_ANSWERS: Answers = {
  satAttempts: "",
  lastSatMathScore: "",
  currentScoreEstimate: "",
  targetScore: "",
  testDate: "",
  focusDomainIds: [],
  dailyGoal: "",
};

/** The target retains the existing 50-point buckets. */
const BUCKET_OPTIONS = SCORE_BUCKETS.map((score) => ({
  value: String(score),
  label: String(score),
}));

const GOAL_HINTS: Record<number, string> = {
  10: "About 8 minutes a day",
  20: "About 15 minutes a day",
  30: "About 25 minutes a day",
  50: "About 40 minutes a day",
};

/** The review panel sits one past the last question. */
const REVIEW_STEP = STEP_COUNT;

export function OnboardingWizard({
  firstName,
  domains,
}: {
  firstName: string | null;
  domains: Domain[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    completeOnboardingAction,
    initialAuthFormState,
  );

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const hasSatTheExam =
    answers.satAttempts !== "" && answers.satAttempts !== "0";
  const baselineScore = hasSatTheExam
    ? answers.lastSatMathScore
    : answers.currentScoreEstimate;

  /**
   * Errors stay hidden until they press Next. Showing "pick a score" on a step
   * someone has not answered yet reads as a scolding, not as help.
   */
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    trackStudentEvent("onboarding_started");
  }, []);

  useEffect(() => {
    trackProductEvent("onboarding_step_viewed", {
      step: Math.min(step + 1, STEP_COUNT),
      is_review: step === REVIEW_STEP,
      path: hasSatTheExam ? "taken_sat" : "not_taken_sat",
    });
  }, [hasSatTheExam, step]);

  useEffect(() => {
    if (state.status !== "sent") return;
    if (state.message === "completed_now") {
      trackStudentEvent("onboarding_completed");
    }
    router.replace("/dashboard");
  }, [router, state.message, state.status]);

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setShowErrors(false);
  };

  // Each step schema picks only its own fields, so the whole answers object
  // can be handed to any of them.
  const parsed =
    step < REVIEW_STEP
      ? (step === 1 && hasSatTheExam
          ? RECENT_SCORE_STEP_SCHEMA
          : STEP_SCHEMAS[step]
        ).safeParse(answers)
      : null;

  const errors: Record<string, string> = {};
  if (parsed && !parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  const errorFor = (field: keyof Answers) =>
    showErrors ? errors[field] : undefined;

  const stepIsValid = parsed?.success ?? true;

  const goNext = () => {
    if (!stepIsValid) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep((current) => Math.min(REVIEW_STEP, current + 1));
  };

  const goBack = () => {
    setShowErrors(false);
    setStep((current) => Math.max(0, current - 1));
  };

  const toggleDomain = (id: string) => {
    setShowErrors(false);
    setAnswers((current) => {
      if (current.focusDomainIds.includes(id)) {
        return {
          ...current,
          focusDomainIds: current.focusDomainIds.filter((entry) => entry !== id),
        };
      }
      if (current.focusDomainIds.length >= MAX_FOCUS_DOMAINS) return current;
      return { ...current, focusDomainIds: [...current.focusDomainIds, id] };
    });
  };

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      {/* The whole answer set travels with the submit, whichever step is on
          screen — the steps unmount, these do not. */}
      <input type="hidden" name="satAttempts" value={answers.satAttempts} />
      <input
        type="hidden"
        name="lastSatMathScore"
        value={hasSatTheExam ? answers.lastSatMathScore : ""}
      />
      <input
        type="hidden"
        name="currentScoreEstimate"
        value={
          hasSatTheExam
            ? answers.lastSatMathScore
            : answers.currentScoreEstimate
        }
      />
      <input type="hidden" name="targetScore" value={answers.targetScore} />
      <input type="hidden" name="testDate" value={answers.testDate} />
      <input type="hidden" name="dailyGoal" value={answers.dailyGoal} />
      {/* One input per id; the action reads them back with `getAll`. */}
      {answers.focusDomainIds.map((id) => (
        <input key={id} type="hidden" name="focusDomainIds" value={id} />
      ))}

      <ProgressBar step={step} />

      {state.status !== "idle" && state.status !== "sent" && state.message && (
        <FormMessage>{state.message}</FormMessage>
      )}

      {step === 0 && (
        <Step
          title={
            firstName
              ? `Welcome, ${firstName}. Have you taken the SAT yet?`
              : "Have you taken the SAT yet?"
          }
          subtitle="This sets your starting point — there's no wrong answer."
        >
          <div className="flex flex-col gap-2.5">
            {SAT_ATTEMPT_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.value}
                selected={answers.satAttempts === String(option.value)}
                onSelect={() => {
                  setShowErrors(false);
                  setAnswers((current) => ({
                    ...current,
                    satAttempts: String(option.value),
                    // Crossing between the never-taken and taken branches
                    // clears both baselines. Moving between "once" and "two
                    // or more" preserves the same most-recent score.
                    lastSatMathScore:
                      current.satAttempts !== "" &&
                      (current.satAttempts === "0") !== (option.value === 0)
                        ? ""
                        : current.lastSatMathScore,
                    currentScoreEstimate:
                      current.satAttempts !== "" &&
                      (current.satAttempts === "0") !== (option.value === 0)
                        ? ""
                        : current.currentScoreEstimate,
                  }));
                }}
                disabled={pending}
              >
                {option.label}
              </ChoiceCard>
            ))}
          </div>

          {errorFor("satAttempts") && (
            <p className="mt-2 text-sm text-miss-ink">
              {errorFor("satAttempts")}
            </p>
          )}

        </Step>
      )}

      {step === 1 && (
        <Step
          title={
            hasSatTheExam
              ? "What was your most recent SAT Math score?"
              : "Roughly where is your math now?"
          }
          subtitle={
            hasSatTheExam
              ? "Use the Math section score from your latest SAT."
              : "A practice test score, or your best guess. Being wrong is fine — this is a starting line, not a grade."
          }
        >
          <SatScoreInput
            label={
              hasSatTheExam
                ? "Most recent SAT Math score"
                : "Estimated SAT Math score"
            }
            name={
              hasSatTheExam
                ? "lastSatMathScoreVisible"
                : "currentScoreEstimateVisible"
            }
            value={
              hasSatTheExam
                ? answers.lastSatMathScore
                : answers.currentScoreEstimate
            }
            onChange={(value) =>
              set(
                hasSatTheExam
                  ? "lastSatMathScore"
                  : "currentScoreEstimate",
                value,
              )
            }
            onBlur={() => setShowErrors(true)}
            error={errorFor(
              hasSatTheExam
                ? "lastSatMathScore"
                : "currentScoreEstimate",
            )}
            disabled={pending}
          />
        </Step>
      )}

      {step === 2 && (
        <Step
          title="What are you aiming for?"
          subtitle="The score you'd be happy walking away with."
        >
          <SelectField
            label="Target Math score"
            name="targetScoreVisible"
            value={answers.targetScore}
            onChange={(value) => set("targetScore", value)}
            options={BUCKET_OPTIONS}
            placeholder="Pick a score"
            error={errorFor("targetScore")}
            disabled={pending}
          />
          {/* A note, not a block. Someone rebuilding after a bad test is
              allowed to aim below where they think they are. */}
          {answers.targetScore !== "" &&
            baselineScore !== "" &&
            Number(answers.targetScore) < Number(baselineScore) && (
              <p className="mt-3 rounded-xl border border-insight-hairline bg-insight-surface px-4 py-3 text-sm text-insight-dark">
                That&apos;s below your current baseline — fine if it&apos;s
                deliberate. Your target stays editable in Settings.
              </p>
            )}
        </Step>
      )}

      {step === 3 && (
        <Step
          title="When are you taking the SAT?"
          subtitle="Choose an official SAT Weekend date, or tell us you're not sure yet."
        >
          <OfficialSatDateField
            label="SAT Weekend date"
            name="testDateVisible"
            value={answers.testDate}
            onChange={(value) => set("testDate", value)}
            error={errorFor("testDate")}
            disabled={pending}
          />
        </Step>
      )}

      {step === 4 && (
        <Step
          title="Which topics trip you up most?"
          subtitle="Pick any that apply, or none — the rest gets worked out from how you answer."
        >
          <div className="flex flex-col gap-2.5">
            {domains.map((domain) => (
              <ChoiceCard
                key={domain.id}
                selected={answers.focusDomainIds.includes(domain.id)}
                onSelect={() => toggleDomain(domain.id)}
                disabled={pending}
              >
                {domain.name}
              </ChoiceCard>
            ))}
          </div>
        </Step>
      )}

      {step === 5 && (
        <Step
          title="How many questions a day?"
          subtitle="Pick something you would still do on a bad day. It stays editable."
        >
          <div className="flex flex-col gap-2.5">
            {DAILY_GOAL_OPTIONS.map((goal) => (
              <ChoiceCard
                key={goal}
                selected={answers.dailyGoal === String(goal)}
                onSelect={() => set("dailyGoal", String(goal))}
                disabled={pending}
                hint={GOAL_HINTS[goal]}
              >
                {goal} questions
              </ChoiceCard>
            ))}
          </div>
        </Step>
      )}

      {step === REVIEW_STEP && <Review answers={answers} domains={domains} />}

      <footer className="flex items-center justify-between gap-3 border-t border-hairline pt-5">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || pending}
          className={ctaClassName("secondary")}
        >
          Back
        </button>

        {step < REVIEW_STEP ? (
          <button
            key="next"
            type="button"
            onClick={goNext}
            disabled={pending}
            className={ctaClassName("primary")}
          >
            Next
          </button>
        ) : (
          <button
            key="submit"
            type="submit"
            disabled={pending}
            className={ctaClassName("primary")}
          >
            {pending ? "Setting up…" : "Start studying"}
          </button>
        )}
      </footer>
    </form>
  );
}

function ProgressBar({ step }: { step: number }) {
  const total = REVIEW_STEP + 1;
  const percent = Math.round(((step + 1) / total) * 100);

  return (
    <div>
      <p className="text-sm font-semibold text-muted">
        {step === REVIEW_STEP
          ? "Last look"
          : `Question ${step + 1} of ${STEP_COUNT}`}
      </p>
      <div
        role="progressbar"
        aria-valuenow={step + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label="Setup progress"
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-background"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function Step({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="font-display text-2xl font-extrabold text-ink sm:text-3xl">
        {title}
      </h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
        {subtitle}
      </p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Review({ answers, domains }: { answers: Answers; domains: Domain[] }) {
  const attempts = SAT_ATTEMPT_OPTIONS.find(
    (option) => String(option.value) === answers.satAttempts,
  );
  const picked = domains.filter((domain) =>
    answers.focusDomainIds.includes(domain.id),
  );
  const hasTakenSat = answers.satAttempts !== "0";

  const rows: Array<[string, string]> = [
    ["Taken the SAT", attempts?.label ?? "—"],
    hasTakenSat
      ? ["Most recent Math score", answers.lastSatMathScore]
      : ["Estimated Math score", answers.currentScoreEstimate],
  ];
  rows.push(
    ["Where you're headed", answers.targetScore],
    [
      "Test date",
      answers.testDate
        ? formatOfficialSatDate(answers.testDate)
        : "Not sure yet",
    ],
    [
      "Topics to focus on",
      picked.length > 0 ? picked.map((d) => d.name).join(", ") : "None picked",
    ],
    ["Questions a day", answers.dailyGoal],
  );

  return (
    <section>
      <h1 className="font-display text-2xl font-extrabold text-ink sm:text-3xl">
        Does this look right?
      </h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
        Last chance to change anything with the Back button.
      </p>

      <dl className="mt-5 divide-y divide-hairline rounded-xl border border-hairline">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 px-4 py-3"
          >
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-right text-[0.9375rem] font-medium text-ink">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 rounded-xl border border-insight-hairline bg-insight-surface px-4 py-3 text-[0.9375rem] text-insight-dark">
        This setup runs once — you won&apos;t come back to it. Your target
        score, daily goal and test date stay editable in Settings.
      </p>
    </section>
  );
}
