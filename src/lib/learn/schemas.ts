/**
 * Zod schemas for everything the learning actions accept.
 *
 * Same doctrine as the auth schemas: whatever a client sends is parsed
 * against these on the server before it is used, and anything that does not
 * match is rejected outright — never repaired. The database functions then
 * re-validate on their side, so even a request that skips the Server Action
 * entirely meets the same wall.
 */

import { z } from "zod";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/schemas";

const choiceField = z.number().int().min(0).max(3);

export const SubmitQuestionSchema = z.object({
  questionId: z.uuid(),
  choice: choiceField,
  /**
   * The question bank sitting this attempt belongs to, or null when there is
   * none (the session call failed, or the player was mounted before one
   * existed). Null is a real answer, not an error: the attempt still counts
   * for mastery and streak, it just does not appear grouped on Progress.
   *
   * The database re-checks that the id names a session the caller owns which
   * is still open, and silently downgrades anything else to null — so a
   * forged id can misattribute nothing.
   */
  sessionId: z.uuid().nullable().catch(null),
});

/** Closing a sitting. The id is re-checked against the caller server-side. */
export const CloseSessionSchema = z.object({
  sessionId: z.uuid(),
});

export const StartPracticeSchema = z.object({
  sectionId: z.uuid(),
});

export const SubmitPracticeSchema = z.object({
  attemptId: z.uuid(),
  /**
   * The cap matches the database function's own bound — a section holds at
   * most a few dozen questions, so anything larger is not a real submission.
   */
  answers: z
    .array(z.object({ questionId: z.uuid(), choice: choiceField }))
    .max(60),
});

// --- Practice tests (full / half) -------------------------------------------

export const StartPracticeTestSchema = z.object({
  testId: z.uuid(),
});

/** Every per-attempt control action takes exactly this. */
export const TestAttemptSchema = z.object({
  attemptId: z.uuid(),
});

/**
 * One autosaved answer.
 *
 * There is no `moduleNumber` here on purpose: which module is live is derived
 * server-side from the attempt's timestamps. Accepting it from the client
 * would be accepting an assertion the client has no business making — and it
 * is exactly the field someone would forge to answer module 2 during module 1.
 */
export const SavePracticeTestResponseSchema = z.object({
  attemptId: z.uuid(),
  questionId: z.uuid(),
  choice: choiceField,
});

/**
 * Password change reuses the signup bounds from `@/lib/auth/schemas` so the
 * two rules cannot drift: what signup accepts, settings accepts.
 */
export const PasswordChangeSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
      .max(PASSWORD_MAX, `Keep this under ${PASSWORD_MAX} characters.`),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "Passwords don't match.",
  });

/**
 * Question-bank filters arrive as URL query params. They are read-only
 * filters, not stored input, so an invalid value is simply dropped (treated
 * as "no filter") rather than producing an error page someone could link to.
 */
const slugField = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/)
  .optional()
  .catch(undefined);

export const QuestionFiltersSchema = z.object({
  domain: slugField,
  subtopic: slugField,
  difficulty: z.enum(["easy", "medium", "hard"]).optional().catch(undefined),
});

export type QuestionFilters = z.infer<typeof QuestionFiltersSchema>;

/**
 * The video library adds a free-text title search on top of the shared
 * filters. Same read-only doctrine: an oversized or control-character-laden
 * value is dropped, not truncated into something the sender never typed.
 * Matching happens in process against titles already fetched under RLS — the
 * value never reaches a SQL pattern, so wildcards need no escaping.
 */
export const VideoFiltersSchema = QuestionFiltersSchema.extend({
  /**
   * A dynamic video category slug. Videos only — the question bank and
   * practice tests keep the fixed domain/subtopic structure, so this field
   * deliberately does not exist on `QuestionFiltersSchema`.
   */
  category: slugField,
  q: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !/[\p{Cc}]/u.test(value))
    .optional()
    .catch(undefined),
});

export type VideoFilters = z.infer<typeof VideoFiltersSchema>;
