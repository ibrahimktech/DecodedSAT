/**
 * Zod schemas for everything the admin actions accept.
 *
 * Same doctrine as the auth and learning schemas: whatever a client sends is
 * parsed against these on the server before it is used, and anything that
 * does not match is rejected outright — never repaired. The database write
 * functions independently enforce the same answer invariants.
 *
 * Free of server-only imports so the shared question editor can use the same
 * payload contract for immediate feedback (UX only — the server re-parses).
 */

import { z } from "zod";
import { QuestionContentBlocksSchema } from "@/lib/questions/content";
import {
  isNonnegativeNumericAnswer,
  normalizeNumericAnswer,
} from "@/lib/questions/answers";

const DifficultyEnum = z.enum(["easy", "medium", "hard"]);

/** Required text, trimmed, with an explicit ceiling. */
const contentText = (max: number) => z.string().trim().min(1).max(max);

// --- Question create / edit ------------------------------------------------------

/**
 * The fields shared by manual creation and inline editing. Keeping this as the
 * single contract means the new authoring flow cannot drift from the editor or
 * from the shape the player already renders.
 */
const SharedQuestionFieldsSchema = z.object({
  subtopicId: z
    .string()
    .trim()
    .min(1, "Choose a skill.")
    .pipe(z.uuid("Choose an existing skill.")),
  prompt: z
    .string()
    .trim()
    .min(1, "Enter the question prompt.")
    .max(4000, "Use 4,000 characters or fewer."),
  contentBlocks: QuestionContentBlocksSchema.nullable().optional(),
  explanation: z
    .string()
    .trim()
    .min(1, "Enter the answer explanation.")
    .max(4000, "Use 4,000 characters or fewer."),
  difficulty: DifficultyEnum,
  // Optional keeps cached pre-deploy editors from overwriting an existing
  // link. An explicit null is the deliberate "Remove" action.
  solutionVideoId: z.uuid().nullable().optional(),
});

const choiceText = z
  .string()
  .trim()
  .min(1, "Enter the answer choice.")
  .max(1000, "Use 1,000 characters or fewer.");

const numericAnswer = z
  .string()
  .trim()
  .min(1, "Enter a numeric answer.")
  .max(100, "Use 100 characters or fewer.")
  .refine((value) => normalizeNumericAnswer(value) !== null, {
    message: "Use an integer, decimal, or fraction with a nonzero denominator.",
  });

const MultipleChoiceQuestionFieldsSchema = SharedQuestionFieldsSchema.extend({
  questionType: z.literal("multiple_choice"),
  choices: z.array(choiceText).length(4, "Enter exactly four answer choices."),
  correctChoice: z.number().int().min(0).max(3),
  sprAnswerMode: z.null(),
  sprAnswers: z.array(z.string()).max(0),
  sprTolerance: z.null(),
});

const StudentProducedResponseFieldsSchema = SharedQuestionFieldsSchema.extend({
  questionType: z.literal("student_produced_response"),
  choices: z.array(z.string()).max(0),
  correctChoice: z.null(),
  sprAnswerMode: z.enum(["exact", "tolerance", "multiple"]),
  sprAnswers: z.array(numericAnswer).min(1).max(10),
  sprTolerance: z.string().nullable(),
});

export const QuestionFieldsSchema = z.discriminatedUnion("questionType", [
  MultipleChoiceQuestionFieldsSchema,
  StudentProducedResponseFieldsSchema,
]).superRefine((value, context) => {
  if (value.questionType !== "student_produced_response") return;

  const normalized = value.sprAnswers
    .map(normalizeNumericAnswer)
    .filter((answer): answer is string => answer !== null);

  if (value.sprAnswerMode === "multiple") {
    if (normalized.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["sprAnswers"],
        message: "Enter at least two accepted values.",
      });
    } else if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: ["sprAnswers"],
        message: "Accepted values must be mathematically distinct.",
      });
    }
  } else if (value.sprAnswers.length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["sprAnswers"],
      message: "Enter one correct value for this answer mode.",
    });
  }

  if (value.sprAnswerMode === "tolerance") {
    if (
      value.sprTolerance === null ||
      !isNonnegativeNumericAnswer(value.sprTolerance)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sprTolerance"],
        message: "Enter a non-negative numeric tolerance.",
      });
    }
  } else if (value.sprTolerance !== null) {
    context.addIssue({
      code: "custom",
      path: ["sprTolerance"],
      message: "Tolerance is only available in tolerance mode.",
    });
  }
});

export const EditQuestionSchema = z.intersection(
  QuestionFieldsSchema,
  z.object({ id: z.uuid() }),
);

/**
 * Question-set identity is optional for hand-authored questions, but it is a
 * pair when present: `externalId` is only unique and meaningful inside a set.
 */
export const CreateQuestionSchema = z.intersection(
  QuestionFieldsSchema,
  z.object({
    id: z.uuid().optional(),
    questionSetId: z.union([z.uuid(), z.literal("")]),
    externalId: z.string().trim().max(64, "Use 64 characters or fewer."),
    isActive: z.boolean(),
  }),
).superRefine((value, context) => {
  if (value.questionSetId !== "" && value.externalId === "") {
    context.addIssue({
      code: "custom",
      path: ["externalId"],
      message: "Enter an external ID for this question set.",
    });
  }
  if (value.questionSetId === "" && value.externalId !== "") {
    context.addIssue({
      code: "custom",
      path: ["questionSetId"],
      message: "Choose a question set for this external ID.",
    });
  }
});

export const CreatePracticeTestQuestionSchema = z.intersection(
  QuestionFieldsSchema,
  z.object({
    id: z.uuid().optional(),
    testId: z.uuid(),
    moduleNumber: z.union([z.literal(1), z.literal(2)]),
    isActive: z.boolean(),
  }),
);

export const PracticeTestQuestionMutationSchema = z.object({
  testId: z.uuid(),
  questionId: z.uuid(),
});

export const MovePracticeTestQuestionSchema =
  PracticeTestQuestionMutationSchema.extend({
    direction: z.enum(["up", "down"]),
  });

/** Soft delete / restore — for questions and videos both. */
export const SetActiveSchema = z.object({
  id: z.uuid(),
  active: z.boolean(),
});

// --- Question reports -------------------------------------------------------

const QuestionReportStatusEnum = z.enum([
  "open",
  "reviewed",
  "resolved",
  "dismissed",
]);

const QuestionReportReasonEnum = z.enum(["incorrect", "unclear_or_broken"]);

export const UpdateQuestionReportSchema = z.object({
  reportId: z.uuid(),
  status: QuestionReportStatusEnum,
  adminNote: z.string().max(2000),
});

// --- Popups -----------------------------------------------------------------

const safePopupUrl = z
  .string()
  .trim()
  .max(1000)
  .refine(
    (value) => {
      if (value.startsWith("/") && !value.startsWith("//")) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Use an app path or an http(s) URL." },
  );

const PopupFieldsSchema = z
  .object({
    title: contentText(120),
    message: contentText(2000),
    buttonText: z.string().trim().max(60),
    buttonUrl: z.string().trim().max(1000),
    isActive: z.boolean(),
    startsAt: z.iso.datetime(),
    endsAt: z.union([z.iso.datetime(), z.literal("")]),
    showOnce: z.boolean(),
    minAnsweredQuestions: z.number().int().min(1).max(1_000_000).nullable(),
    minAccountAgeDays: z.number().int().min(1).max(36_500).nullable(),
  })
  .superRefine((value, context) => {
    if ((value.buttonText === "") !== (value.buttonUrl === "")) {
      context.addIssue({
        code: "custom",
        path: value.buttonText === "" ? ["buttonText"] : ["buttonUrl"],
        message: "Button text and URL must be provided together.",
      });
    }
    if (value.buttonUrl !== "") {
      const result = safePopupUrl.safeParse(value.buttonUrl);
      if (!result.success) {
        context.addIssue({
          code: "custom",
          path: ["buttonUrl"],
          message: "Use an app path or an http(s) URL.",
        });
      }
    }
    if (value.endsAt !== "" && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "End date must be after the start date.",
      });
    }
  });

export const CreatePopupSchema = PopupFieldsSchema;
export const UpdatePopupSchema = PopupFieldsSchema.and(
  z.object({ id: z.uuid() }),
);
export const SetPopupActiveSchema = z.object({
  id: z.uuid(),
  active: z.boolean(),
});

export const AdminQuestionReportFiltersSchema = z.object({
  status: z
    .enum(["open", "reviewed", "resolved", "dismissed", "all"])
    .optional()
    .catch(undefined),
  reason: QuestionReportReasonEnum.optional().catch(undefined),
  q: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => !/[\p{Cc}]/u.test(value))
    .optional()
    .catch(undefined),
});

export type AdminQuestionReportFilters = z.infer<
  typeof AdminQuestionReportFiltersSchema
>;

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

// --- List filters (URL query params) ----------------------------------------------
// Read-only filters: an invalid value is dropped (no filter), not an error
// someone could link to. Matches the student pages' filter doctrine.

const uuidParam = z.uuid().optional().catch(undefined);

const statusParam = z
  .enum(["active", "inactive", "all"])
  .optional()
  .catch(undefined);

export const AdminQuestionFiltersSchema = z.object({
  id: uuidParam,
  domain: uuidParam,
  subtopic: uuidParam,
  set: uuidParam,
  difficulty: DifficultyEnum.optional().catch(undefined),
  type: z
    .enum(["multiple_choice", "student_produced_response"])
    .optional()
    .catch(undefined),
  status: statusParam,
  review: z
    .enum(["needs-review", "uncategorized"])
    .optional()
    .catch(undefined),
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
