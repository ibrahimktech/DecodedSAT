"use server";

/**
 * Server Actions for /admin/questions: manual creation, inline edit, and soft
 * delete/restore.
 *
 * Every action independently re-establishes the admin context — session plus
 * a server-side `is_admin()` RPC — before touching anything. The client only
 * *showing* these controls to admins proves nothing; anyone can invoke a
 * Server Action endpoint directly. And beneath even these checks, RLS
 * policies re-check `is_admin()` inside the database, so a bug here still
 * writes nothing.
 *
 * Unlike student-facing auth actions, validation failures can be specific:
 * the reader is a verified admin editing trusted content.
 */

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAdminActionContext } from "@/lib/auth/admin";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import {
  CreateQuestionSchema,
  EditQuestionSchema,
  SetActiveSchema,
} from "@/lib/admin/schemas";
import { sanitizeLine, sanitizeMultiline } from "@/lib/admin/sanitize";
import type {
  AdminActionResult,
  CreateQuestionResult,
  QuestionAssetActionResult,
} from "@/lib/admin/types";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  QUESTION_ASSET_BUCKET,
  QUESTION_ASSET_MAX_BYTES,
  QuestionContentBlocksSchema,
  contentBlocksToLegacyPrompt,
  normalizeCenteredMath,
  parseQuestionContentBlocks,
  questionContentAssetPaths,
  type QuestionContentBlock,
} from "@/lib/questions/content";
import { normalizeNumericAnswer } from "@/lib/questions/answers";

const editLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  prefix: "admin-edit",
});

const createLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  prefix: "admin-create-question",
});

const assetLimiter = createRateLimiter({
  limit: 40,
  windowMs: 10 * 60_000,
  prefix: "admin-question-asset",
});

function sanitizeContentBlocks(
  blocks: QuestionContentBlock[],
): QuestionContentBlock[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "text":
        return {
          ...block,
          content: sanitizeMultiline(block.content, 8000),
        };
      case "centered_math":
        return {
          ...block,
          content: normalizeCenteredMath(
            sanitizeMultiline(block.content, 4000),
          ),
        };
      case "image":
        return {
          ...block,
          alt: sanitizeLine(block.alt, 500),
          caption: sanitizeLine(block.caption, 500),
        };
      case "table":
        return {
          ...block,
          rows: block.rows.map((row) =>
            row.map((cell) => sanitizeLine(cell, 1000)),
          ),
        };
    }
  });
}

function prepareContentBlocks(
  value: QuestionContentBlock[] | null | undefined,
): { blocks: QuestionContentBlock[] | null; error?: string } {
  if (value === null || value === undefined) return { blocks: null };
  const sanitized = sanitizeContentBlocks(value);
  const parsed = QuestionContentBlocksSchema.safeParse(sanitized);
  if (!parsed.success) {
    return { blocks: null, error: parsed.error.issues[0]?.message };
  }
  return { blocks: parsed.data };
}

function questionFieldErrors(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (key && errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

/** Creates one question through the admin-only, validating database RPC. */
export async function createQuestionAction(
  input: unknown,
): Promise<CreateQuestionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await createLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = CreateQuestionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: questionFieldErrors(parsed.error.issues),
      };
    }

    const preparedContent = prepareContentBlocks(parsed.data.contentBlocks);
    if (preparedContent.error) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: { contentBlocks: preparedContent.error },
      };
    }

    const choices =
      parsed.data.questionType === "multiple_choice"
        ? parsed.data.choices.map((choice) => sanitizeLine(choice, 1000))
        : null;
    const sprAnswers =
      parsed.data.questionType === "student_produced_response"
        ? parsed.data.sprAnswers.map((answer) => answer.trim())
        : null;
    const sprTolerance =
      parsed.data.questionType === "student_produced_response" &&
      parsed.data.sprAnswerMode === "tolerance"
        ? parsed.data.sprTolerance!.trim()
        : null;
    const prompt = sanitizeMultiline(
      preparedContent.blocks
        ? contentBlocksToLegacyPrompt(preparedContent.blocks)
        : parsed.data.prompt,
      4000,
    );
    const explanation = sanitizeMultiline(parsed.data.explanation, 4000);
    const externalId = sanitizeLine(parsed.data.externalId, 64);

    const sanitizedErrors: Record<string, string> = {};
    if (prompt === "") sanitizedErrors.prompt = "Enter the question prompt.";
    if (explanation === "") {
      sanitizedErrors.explanation = "Enter the answer explanation.";
    }
    choices?.forEach((choice, index) => {
      if (choice === "") {
        sanitizedErrors[`choices.${index}`] = `Enter choice ${"ABCD"[index]}.`;
      }
    });
    if (Object.keys(sanitizedErrors).length > 0) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: sanitizedErrors,
      };
    }

    // These read checks produce useful field-level errors. The RPC repeats
    // them to close the race between validation and insertion.
    const { data: subtopic, error: subtopicError } = await context.supabase
      .from("subtopics")
      .select("id")
      .eq("id", parsed.data.subtopicId)
      .eq("active", true)
      .maybeSingle();
    if (subtopicError) {
      console.error(
        `[admin] create question subtopic lookup failed: ${subtopicError.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!subtopic) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: { subtopicId: "Choose an existing skill." },
      };
    }

    const questionSetId = parsed.data.questionSetId || null;
    if (questionSetId) {
      const { data: questionSet, error: setError } = await context.supabase
        .from("question_sets")
        .select("id")
        .eq("id", questionSetId)
        .maybeSingle();
      if (setError) {
        console.error(
          `[admin] create question set lookup failed: ${setError.message}`,
        );
        return { status: "error", message: GENERIC_ERROR_MESSAGE };
      }
      if (!questionSet) {
        return {
          status: "error",
          message: "Check the highlighted fields and try again.",
          fieldErrors: { questionSetId: "Choose an existing question set." },
        };
      }
    }

    if (parsed.data.solutionVideoId) {
      const { data: video, error: videoError } = await context.supabase
        .from("videos")
        .select("id")
        .eq("id", parsed.data.solutionVideoId)
        .maybeSingle();
      if (videoError) {
        console.error(
          `[admin] create question video lookup failed: ${videoError.message}`,
        );
        return { status: "error", message: GENERIC_ERROR_MESSAGE };
      }
      if (!video) {
        return {
          status: "error",
          message: "Check the highlighted fields and try again.",
          fieldErrors: {
            solutionVideoId: "Choose an existing video or leave this empty.",
          },
        };
      }
    }

    const questionId = parsed.data.id ?? randomUUID();
    const { data, error } = await context.supabase.rpc(
      "admin_create_question",
      {
        p_question_id: questionId,
        p_subtopic_id: parsed.data.subtopicId,
        p_prompt: prompt,
        p_content_blocks: preparedContent.blocks,
        p_choices: choices,
        p_correct_choice: parsed.data.correctChoice,
        p_question_type: parsed.data.questionType,
        p_spr_answer_mode: parsed.data.sprAnswerMode,
        p_spr_answers: sprAnswers,
        p_spr_tolerance: sprTolerance,
        p_explanation: explanation,
        p_difficulty: parsed.data.difficulty,
        p_is_active: parsed.data.isActive,
        p_question_set_id: questionSetId,
        p_external_id: externalId || null,
        p_solution_video_id: parsed.data.solutionVideoId ?? null,
      },
    );

    if (error) {
      if (
        error.code === "23505" ||
        error.message.includes("duplicate_question_identity")
      ) {
        return {
          status: "error",
          message: "Check the highlighted fields and try again.",
          fieldErrors: {
            externalId: "That external ID already exists in this question set.",
          },
        };
      }
      if (error.message.includes("unknown_subtopic")) {
        return {
          status: "error",
          message: "Check the highlighted fields and try again.",
          fieldErrors: { subtopicId: "Choose an existing skill." },
        };
      }
      if (error.message.includes("unknown_question_set")) {
        return {
          status: "error",
          message: "Check the highlighted fields and try again.",
          fieldErrors: { questionSetId: "Choose an existing question set." },
        };
      }
      if (error.message.includes("unknown_solution_video")) {
        return {
          status: "error",
          message: "Check the highlighted fields and try again.",
          fieldErrors: {
            solutionVideoId: "Choose an existing video or leave this empty.",
          },
        };
      }
      console.error(
        `[admin] create question rpc failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const createdId = zUuid(data);
    if (!createdId) {
      console.error("[admin] create question rpc returned an invalid id");
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/questions");
    revalidatePath("/admin/practice-tests");
    revalidatePath("/practice");
    revalidatePath("/admin");
    return { status: "ok", id: createdId };
  } catch (error) {
    console.error(`[admin] create question threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

function zUuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

export async function updateQuestionAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await editLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = EditQuestionSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: "Check the fields and try again." };
    }

    const preparedContent = prepareContentBlocks(parsed.data.contentBlocks);
    if (preparedContent.error) {
      return { status: "error", message: preparedContent.error };
    }

    const choices =
      parsed.data.questionType === "multiple_choice"
        ? parsed.data.choices.map((text) => sanitizeLine(text, 1000))
        : null;
    const sprAnswers =
      parsed.data.questionType === "student_produced_response"
        ? parsed.data.sprAnswers.map((answer) => answer.trim())
        : null;
    const sprAnswerValues =
      parsed.data.questionType === "student_produced_response"
        ? sprAnswers!.map((answer) => normalizeNumericAnswer(answer)!)
        : null;
    const sprTolerance =
      parsed.data.questionType === "student_produced_response" &&
      parsed.data.sprAnswerMode === "tolerance"
        ? parsed.data.sprTolerance!.trim()
        : null;
    const prompt = sanitizeMultiline(
      preparedContent.blocks
        ? contentBlocksToLegacyPrompt(preparedContent.blocks)
        : parsed.data.prompt,
      4000,
    );
    const explanation = sanitizeMultiline(parsed.data.explanation, 4000);
    if (
      prompt === "" ||
      explanation === "" ||
      choices?.some((choice) => choice === "")
    ) {
      return { status: "error", message: "Check the fields and try again." };
    }

    const { data: skill, error: skillError } = await context.supabase
      .from("subtopics")
      .select("id")
      .eq("id", parsed.data.subtopicId)
      .eq("active", true)
      .maybeSingle();
    if (skillError) {
      console.error(
        `[admin] update question skill lookup failed: ${skillError.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!skill) {
      return { status: "error", message: "Choose an active skill." };
    }

    if (parsed.data.solutionVideoId) {
      const { data: video, error: videoError } = await context.supabase
        .from("videos")
        .select("id")
        .eq("id", parsed.data.solutionVideoId)
        .maybeSingle();
      if (videoError) {
        console.error(
          `[admin] update question video lookup failed: ${videoError.message}`,
        );
        return { status: "error", message: GENERIC_ERROR_MESSAGE };
      }
      if (!video) {
        return {
          status: "error",
          message: "The selected solution video no longer exists. Remove it or choose another.",
        };
      }
    }

    const { data: existing, error: existingError } = await context.supabase
      .from("questions")
      .select("content_blocks")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (existingError) {
      console.error(
        `[admin] question content lookup failed: ${existingError.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    // The admin's own session; RLS's update policy re-checks is_admin() and
    // the answer key columns are writable only through this grant.
    const { error, count } = await context.supabase
      .from("questions")
      .update(
        {
          subtopic_id: parsed.data.subtopicId,
          prompt,
          ...(parsed.data.contentBlocks !== undefined
            ? { content_blocks: preparedContent.blocks }
            : {}),
          question_type: parsed.data.questionType,
          choices,
          correct_choice: parsed.data.correctChoice,
          spr_answer_mode: parsed.data.sprAnswerMode,
          spr_answers: sprAnswers,
          spr_answer_values: sprAnswerValues,
          spr_tolerance: sprTolerance,
          spr_tolerance_value:
            sprTolerance === null ? null : normalizeNumericAnswer(sprTolerance),
          explanation,
          difficulty: parsed.data.difficulty,
          ...(parsed.data.solutionVideoId !== undefined
            ? { solution_video_id: parsed.data.solutionVideoId }
            : {}),
        },
        { count: "exact" },
      )
      .eq("id", parsed.data.id);

    if (error) {
      console.error(
        `[admin] question update failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const { error: reviewError } = await context.supabase.rpc(
      "admin_resolve_question_skill_review",
      {
        p_question_id: parsed.data.id,
        p_subtopic_id: parsed.data.subtopicId,
      },
    );
    if (reviewError) {
      console.error(
        `[admin] question skill review update failed: ${reviewError.message}`,
      );
    }

    if (parsed.data.contentBlocks !== undefined) {
      const oldPaths = questionContentAssetPaths(
        parseQuestionContentBlocks(existing?.content_blocks),
      );
      const nextPaths = new Set(questionContentAssetPaths(preparedContent.blocks));
      await removeUnreferencedAssets(
        context.supabase,
        parsed.data.id,
        oldPaths.filter((path) => !nextPaths.has(path)),
      );
    }

    revalidatePath("/admin/questions");
    revalidatePath("/admin/practice-tests");
    revalidatePath("/practice");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] question update threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

const ResolveQuestionSkillReviewSchema = z.object({
  questionId: z.uuid(),
  skillId: z.uuid(),
});

export async function resolveQuestionSkillReviewAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const parsed = ResolveQuestionSkillReviewSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: "Choose an active skill." };
    }

    const { data, error } = await context.supabase.rpc(
      "admin_resolve_question_skill_review",
      {
        p_question_id: parsed.data.questionId,
        p_subtopic_id: parsed.data.skillId,
      },
    );
    if (error || data !== true) {
      if (error) {
        console.error(`[admin] resolve skill review failed: ${error.message}`);
      }
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/questions");
    revalidatePath("/questions");
    return { status: "ok" };
  } catch (error) {
    console.error(
      `[admin] resolve skill review threw: ${describeError(error)}`,
    );
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

const DeleteQuestionAssetSchema = z.object({
  questionId: z.uuid(),
  storagePath: z.string().max(300),
});

function isQuestionAssetPath(questionId: string, storagePath: string): boolean {
  return new RegExp(
    `^questions/${questionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[0-9a-f-]{36}\\.(png|jpg|webp)$`,
    "i",
  ).test(storagePath);
}

function detectImageType(
  bytes: Uint8Array,
  file: File,
): { extension: "png" | "jpg" | "webp"; contentType: string } | null {
  const name = file.name.toLowerCase();
  if (
    file.type === "image/png" &&
    name.endsWith(".png") &&
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { extension: "png", contentType: "image/png" };
  }
  if (
    file.type === "image/jpeg" &&
    (name.endsWith(".jpg") || name.endsWith(".jpeg")) &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }
  if (
    file.type === "image/webp" &&
    name.endsWith(".webp") &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { extension: "webp", contentType: "image/webp" };
  }
  return null;
}

export async function uploadQuestionAssetAction(
  formData: FormData,
): Promise<QuestionAssetActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await assetLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const questionId = formData.get("questionId");
    const file = formData.get("file");
    if (!z.uuid().safeParse(questionId).success) {
      return { status: "error", message: "The question draft is invalid." };
    }
    if (!(file instanceof File) || file.size === 0) {
      return { status: "error", message: "Choose an image to upload." };
    }
    if (file.size > QUESTION_ASSET_MAX_BYTES) {
      return { status: "error", message: "Images must be 5 MB or smaller." };
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = detectImageType(bytes, file);
    if (!detected) {
      return {
        status: "error",
        message: "Use a genuine PNG, JPG/JPEG, or WebP image.",
      };
    }

    const storagePath = `questions/${questionId}/${randomUUID()}.${detected.extension}`;
    const { error } = await context.supabase.storage
      .from(QUESTION_ASSET_BUCKET)
      .upload(storagePath, bytes, {
        contentType: detected.contentType,
        cacheControl: "31536000",
        upsert: false,
      });
    if (error) {
      console.error(`[admin] question asset upload failed: ${error.message}`);
      return { status: "error", message: "The image could not be uploaded." };
    }
    return { status: "ok", storagePath };
  } catch (error) {
    console.error(`[admin] question asset upload threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

async function removeUnreferencedAssets(
  supabase: SupabaseClient,
  questionId: string,
  storagePaths: string[],
): Promise<void> {
  for (const storagePath of [...new Set(storagePaths)]) {
    if (!isQuestionAssetPath(questionId, storagePath)) continue;
    const { data, error } = await supabase.rpc(
      "admin_question_asset_reference_count",
      {
        p_storage_path: storagePath,
        p_exclude_question_id: null,
      },
    );
    if (error) {
      console.error(`[admin] asset reference check failed: ${error.message}`);
      continue;
    }
    if (Number(data) !== 0) continue;
    const { error: removeError } = await supabase.storage
      .from(QUESTION_ASSET_BUCKET)
      .remove([storagePath]);
    if (removeError) {
      console.error(`[admin] question asset cleanup failed: ${removeError.message}`);
    }
  }
}

export async function deleteQuestionAssetAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };
    const parsed = DeleteQuestionAssetSchema.safeParse(input);
    if (
      !parsed.success ||
      !isQuestionAssetPath(
        parsed.data.questionId,
        parsed.data.storagePath,
      )
    ) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    await removeUnreferencedAssets(
      context.supabase,
      parsed.data.questionId,
      [parsed.data.storagePath],
    );
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] question asset delete threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/** Soft delete / restore: flips `is_active`, never removes the row. */
export async function setQuestionActiveAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await editLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = SetActiveSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const { error, count } = await context.supabase
      .from("questions")
      .update({ is_active: parsed.data.active }, { count: "exact" })
      .eq("id", parsed.data.id);

    if (error) {
      console.error(
        `[admin] question active toggle failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/questions");
    revalidatePath("/admin/practice-tests");
    revalidatePath("/practice");
    revalidatePath("/admin");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] question toggle threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
