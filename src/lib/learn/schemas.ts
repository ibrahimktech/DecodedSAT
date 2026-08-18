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
