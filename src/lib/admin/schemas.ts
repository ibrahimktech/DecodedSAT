/**
 * Zod schemas for everything the admin actions accept.
 *
 * Same doctrine as the auth and learning schemas: whatever a client sends is
 * parsed against these on the server before it is used, and anything that
 * does not match is rejected outright — never repaired. The upload schema is
 * additionally re-validated field by field inside the database function, so
 * even a call that reaches the RPC directly meets the same wall.
 *
 * Free of server-only imports so the upload panel can reuse the payload
 * schema for pre-submit feedback (UX only — the server re-parses).
 */

import { z } from "zod";

export const CHOICE_LABELS = ["A", "B", "C", "D"] as const;

const DifficultyEnum = z.enum(["easy", "medium", "hard"]);

/** Required text, trimmed, with an explicit ceiling. */
const contentText = (max: number) => z.string().trim().min(1).max(max);

// --- JSON upload ---------------------------------------------------------------

const UploadChoiceSchema = z.object({
  label: z.enum(CHOICE_LABELS),
  text: contentText(1000),
});

export const UploadQuestionSchema = z.object({
  external_id: contentText(64),
  domain: contentText(100),
  subtopic: contentText(120),
  prompt: contentText(4000),
  // Exactly four choices labelled exactly A–D (order in the file is
  // irrelevant; storage orders by label). `correct_answer` matching a label
  // follows automatically: with the full A–D set required, every enum value
  // is a label.
  choices: z
    .array(UploadChoiceSchema)
    .length(4)
    .refine(
      (choices) => new Set(choices.map((choice) => choice.label)).size === 4,
      { message: "Choice labels must be exactly A, B, C and D." },
    ),
  correct_answer: z.enum(CHOICE_LABELS),
  explanation: contentText(4000),
  difficulty: DifficultyEnum,
});

export const UploadPayloadSchema = z.object({
  set_name: contentText(120),
  set_description: z.string().trim().max(500).optional(),
  create_new_subtopics: z.boolean().optional().default(false),
  questions: z.array(UploadQuestionSchema).min(1).max(500),
});

export type UploadPayload = z.infer<typeof UploadPayloadSchema>;

/** Upload files above this are refused before parsing. */
export const UPLOAD_MAX_BYTES = 1_000_000;

// --- Inline question edit --------------------------------------------------------

export const EditQuestionSchema = z.object({
  id: z.uuid(),
  subtopicId: z.uuid(),
  prompt: contentText(4000),
  choices: z.array(contentText(1000)).length(4),
  correctChoice: z.number().int().min(0).max(3),
  explanation: contentText(4000),
  difficulty: DifficultyEnum,
});

/** Soft delete / restore — for questions and videos both. */
export const SetActiveSchema = z.object({
  id: z.uuid(),
  active: z.boolean(),
});

// --- Videos ----------------------------------------------------------------------

/** Eleven URL-safe characters — YouTube's id alphabet. */
export const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

/** A pasted URL or raw id, before extraction. */
export const VideoLookupSchema = z.object({
  input: contentText(200),
});

export const SaveVideoSchema = z.object({
  youtubeId: z.string().regex(YOUTUBE_ID_REGEX),
  title: contentText(200),
  description: z.string().trim().max(2000).default(""),
  subtopicId: z.uuid(),
});

export const EditVideoSchema = SaveVideoSchema.extend({
  id: z.uuid(),
});

// --- List filters (URL query params) ----------------------------------------------
// Read-only filters: an invalid value is dropped (no filter), not an error
// someone could link to. Matches the student pages' filter doctrine.

const uuidParam = z.uuid().optional().catch(undefined);

const statusParam = z
  .enum(["active", "inactive", "all"])
  .optional()
  .catch(undefined);

export const AdminQuestionFiltersSchema = z.object({
  domain: uuidParam,
  subtopic: uuidParam,
  set: uuidParam,
  difficulty: DifficultyEnum.optional().catch(undefined),
  status: statusParam,
  q: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => !/[\p{Cc}]/u.test(value))
    .optional()
    .catch(undefined),
});

export type AdminQuestionFilters = z.infer<typeof AdminQuestionFiltersSchema>;

export const AdminVideoFiltersSchema = z.object({
  domain: uuidParam,
  subtopic: uuidParam,
  status: statusParam,
});

export type AdminVideoFilters = z.infer<typeof AdminVideoFiltersSchema>;
