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

/**
 * Where a video is filed.
 *
 * A discriminated union rather than two optional ids, because "exactly one of
 * these" is the actual rule and optional fields cannot express it: a payload
 * with both set, or neither, has to be rejected, and `.optional()` on each
 * would accept both. The database's `videos_have_a_type` CHECK enforces the
 * same thing one layer down.
 */
const videoFields = {
  youtubeId: z.string().regex(YOUTUBE_ID_REGEX),
  title: contentText(200),
  description: z.string().trim().max(2000).default(""),
};

export const SaveVideoSchema = z.discriminatedUnion("kind", [
  z.object({
    ...videoFields,
    kind: z.literal("domain"),
    subtopicId: z.uuid(),
  }),
  z.object({
    ...videoFields,
    kind: z.literal("category"),
    videoCategoryId: z.uuid(),
  }),
]);

export const EditVideoSchema = z.discriminatedUnion("kind", [
  z.object({
    ...videoFields,
    kind: z.literal("domain"),
    id: z.uuid(),
    subtopicId: z.uuid(),
  }),
  z.object({
    ...videoFields,
    kind: z.literal("category"),
    id: z.uuid(),
    videoCategoryId: z.uuid(),
  }),
]);

// --- Video categories -------------------------------------------------------------

/**
 * Slugs are URL-visible and become a student-facing filter value, so they are
 * held to the same shape the student filter schema accepts
 * (`^[a-z0-9-]{1,64}$`). Left blank on create, one is derived from the name.
 */
export const CATEGORY_SLUG_REGEX = /^[a-z0-9-]{1,64}$/;

const categorySlugField = z
  .string()
  .trim()
  .regex(CATEGORY_SLUG_REGEX, "Use lowercase letters, numbers and hyphens.");

export const CreateVideoCategorySchema = z.object({
  name: contentText(60),
  /** Empty means "derive it from the name" — see `slugify` in the action. */
  slug: z.union([categorySlugField, z.literal("")]).default(""),
});

export const UpdateVideoCategorySchema = z.object({
  id: z.uuid(),
  name: contentText(60),
  slug: categorySlugField,
});

// --- Practice tests ---------------------------------------------------------------

const TestTypeEnum = z.enum(["full", "half"]);

/**
 * Timing is locked to the real digital SAT, so neither of these is a field on
 * the form. They are re-derived in SQL by `sat_module_seconds()` and
 * `sat_module_question_count()`; these constants exist so the admin UI can say
 * the same numbers out loud without a round trip.
 */
export const MODULE_SECONDS = 2100;
export const MODULE_QUESTION_COUNT = 22;

export const CreatePracticeTestSchema = z.object({
  title: contentText(120),
  description: z.string().trim().max(500).default(""),
  difficulty: DifficultyEnum,
  /**
   * Settable at creation and never again. Flipping full -> half after
   * questions are linked would strand 22 module-2 rows and silently change the
   * scoring denominator under attempts already recorded, so the database's
   * UPDATE grant deliberately omits this column.
   */
  testType: TestTypeEnum,
});

export const EditPracticeTestSchema = z.object({
  id: z.uuid(),
  title: contentText(120),
  description: z.string().trim().max(500).default(""),
  difficulty: DifficultyEnum,
});

/**
 * One practice-test question: the step 5 upload shape plus `module_number`.
 *
 * Reusing `UploadQuestionSchema` verbatim is the point — the same JSON a
 * question set takes, with one field added, so there is one authoring format
 * to learn and one validator to keep correct.
 */
export const UploadTestQuestionSchema = UploadQuestionSchema.extend({
  module_number: z.union([z.literal(1), z.literal(2)]),
});

export const UploadTestPayloadSchema = z.object({
  create_new_subtopics: z.boolean().optional().default(false),
  /**
   * A full test is 44 questions and a half is 22. The ceiling is generous so
   * a miscounted file is rejected by the database's exact per-module check
   * with a "found N, expected 22" message, rather than by a Zod length error
   * that says nothing about which module is short.
   */
  questions: z.array(UploadTestQuestionSchema).min(1).max(100),
});

export type UploadTestPayload = z.infer<typeof UploadTestPayloadSchema>;

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
  category: uuidParam,
  status: statusParam,
});

export type AdminVideoFilters = z.infer<typeof AdminVideoFiltersSchema>;
