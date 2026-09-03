/**
 * Onboarding input schemas, shared by the wizard and the Server Action.
 *
 * Same doctrine as the auth and learning schemas: the client parses these to
 * decide whether "Next" is enabled, which is a UX affordance and nothing else.
 * The Server Action re-parses the identical schema against the submitted
 * FormData, and `complete_onboarding()` re-validates every range a third time
 * inside the database — so a request that skips both TypeScript layers still
 * meets the same wall.
 */

import { z } from "zod";
import {
  isAvailableOfficialSatDate,
  isOfficialSatWeekendDate,
} from "@/lib/onboarding/sat-dates";

/** SAT section scores run 200–800 on a 10-point grid. */
export const SCORE_MIN = 200;
export const SCORE_MAX = 800;
export const SCORE_STEP = 10;

export function isValidSatScore(value: string | number): boolean {
  if (typeof value === "string" && value.trim() === "") return false;
  const score = Number(value);
  return (
    Number.isInteger(score) &&
    score >= SCORE_MIN &&
    score <= SCORE_MAX &&
    score % SCORE_STEP === 0
  );
}

/**
 * Targets retain the existing 50-point buckets. Baseline scores use the exact
 * 10-point input because a student may know or estimate any valid SAT score.
 */
export const SCORE_BUCKETS: readonly number[] = Array.from(
  { length: 13 },
  (_, index) => SCORE_MIN + index * 50,
);

/** What the daily-goal step offers. The column allows 1–200. */
export const DAILY_GOAL_OPTIONS = [10, 20, 30, 50] as const;

/** 0 = never sat it, 1 = once, 2 = twice or more. Stored as-is. */
export const SAT_ATTEMPT_OPTIONS = [
  { value: 0, label: "Not yet" },
  { value: 1, label: "Once" },
  { value: 2, label: "Two or more times" },
] as const;

/** How many domains someone may flag as weak. There are only four. */
export const MAX_FOCUS_DOMAINS = 4;

/**
 * `z.coerce.number()` throughout: FormData yields strings, and the wizard's
 * hidden inputs are no exception. Coercion here is not "repairing" bad input
 * — a non-numeric string still fails `.int()` and the whole parse is rejected.
 */
const scoreField = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce
    .number("Enter a SAT Math score.")
    .int("Enter a whole-number score.")
    .min(SCORE_MIN, `Scores start at ${SCORE_MIN}.`)
    .max(SCORE_MAX, `Scores top out at ${SCORE_MAX}.`)
    .refine((value) => value % SCORE_STEP === 0, {
      message: `Scores move in steps of ${SCORE_STEP}.`,
    }),
);

/** Only published, non-expired SAT Weekend dates may reach the database. */
const officialTestDateField = z
  .string()
  .refine(isOfficialSatWeekendDate, {
    message: "Select an official SAT Weekend date.",
  })
  .refine((value) => isAvailableOfficialSatDate(value), {
    message: "That SAT date has already passed.",
  });

const satAttemptsField = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce
    .number("Choose the option that fits you.")
    .int()
    .min(0)
    .max(10),
);

/**
 * The field shapes, with no refinements attached.
 *
 * Kept separate from `OnboardingSchema` below because Zod 4's `.pick()`
 * *throws at runtime* on a schema carrying refinements — and it type-checks
 * fine first, since `.refine()` now returns a `ZodObject`. The per-step
 * schemas at the bottom of this file pick from this base and re-attach only
 * the cross-field rules that apply to their own step.
 */
const OnboardingFields = z.object({
  satAttempts: satAttemptsField,
  /**
   * Absent when they have never sat the exam. `""` is what an unfilled hidden
   * input sends, so it has to mean "absent" rather than "invalid".
   */
  lastSatMathScore: z
    .union([z.literal(""), scoreField])
    .transform((value) => (value === "" ? null : value)),
  currentScoreEstimate: scoreField,
  targetScore: scoreField,
  /** `""` is the "not sure yet" answer, which is a real answer. */
  testDate: z
    .union([z.literal(""), officialTestDateField])
    .transform((value) => (value === "" ? null : value)),
  /**
   * Ids are checked for shape here and for existence in the database, where
   * the insert selects from `domains` — a forged uuid matches nothing.
   */
  focusDomainIds: z.array(z.uuid()).max(MAX_FOCUS_DOMAINS),
  dailyGoal: z.coerce.number().int().min(1).max(200),
});

/**
 * The pairing rule applied to the whole form:
 * a Math score for an exam they say they never sat is incoherent, and so is
 * having sat it with no score to report. `complete_onboarding()` enforces the
 * same pair independently.
 */
const satHistoryIsCoherent = (data: {
  satAttempts: number;
  lastSatMathScore: number | null;
}) =>
  data.satAttempts === 0
    ? data.lastSatMathScore === null
    : data.lastSatMathScore !== null;

/** A fresh object per call: Zod wants a mutable `path`, and the two refines
 *  below must not share one. */
const satHistoryIssue = () => ({
  path: ["lastSatMathScore"],
  message: "Add your most recent Math score.",
});

export const OnboardingSchema = OnboardingFields.refine(
  satHistoryIsCoherent,
  satHistoryIssue(),
).transform((data) => ({
  ...data,
  // A real recent result is the baseline. Ignore any stale or forged estimate
  // when the selected history path says the student has taken the SAT.
  currentScoreEstimate:
    data.satAttempts > 0
      ? (data.lastSatMathScore ?? data.currentScoreEstimate)
      : data.currentScoreEstimate,
}));

export type OnboardingAnswers = z.infer<typeof OnboardingSchema>;

/** The three fields Settings may edit after onboarding closes. */
export const StudyPlanSchema = z.object({
  targetScore: scoreField,
  dailyGoal: z.coerce.number().int().min(1).max(200),
  // Settings and onboarding share the same official-date allowlist. The
  // database format remains a nullable YYYY-MM-DD date.
  testDate: z
    .union([z.literal(""), officialTestDateField])
    .transform((value) => (value === "" ? null : value)),
});

export const RECENT_SCORE_STEP_SCHEMA = OnboardingFields.pick({
  lastSatMathScore: true,
}).refine((data) => data.lastSatMathScore !== null, satHistoryIssue());

/**
 * Per-step validation for the wizard's "Next" button.
 *
 * Each entry parses only the fields its step collects, so step 2 is not
 * blocked by a step 5 answer that has not been given yet. The full
 * `OnboardingSchema` is still what the action parses at submit time — this is
 * a subset of it for feedback, never a substitute.
 */
export const STEP_SCHEMAS = [
  // 0 — SAT history. The path-specific baseline is question 2.
  OnboardingFields.pick({ satAttempts: true }),
  // 1 — current estimate for students who have not taken the SAT. The wizard
  // swaps in RECENT_SCORE_STEP_SCHEMA at this index for students who have.
  OnboardingFields.pick({ currentScoreEstimate: true }),
  // 2 — target
  OnboardingFields.pick({ targetScore: true }),
  // 3 — test date
  OnboardingFields.pick({ testDate: true }),
  // 4 — weak domains (zero picks is a valid answer)
  OnboardingFields.pick({ focusDomainIds: true }),
  // 5 — daily goal
  OnboardingFields.pick({ dailyGoal: true }),
] as const;

/** Question steps, excluding the review panel that follows them. */
export const STEP_COUNT = STEP_SCHEMAS.length;
