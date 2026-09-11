"use server";

/**
 * Server Actions for /admin/practice-tests: create a test, edit its front
 * matter, soft delete/restore, and manage its questions individually.
 *
 * Same doctrine as every other admin action: re-establish the admin context
 * server-side, rate limit per user, validate with Zod, sanitize what
 * persists, and let the `is_admin()` RLS policies be the enforcement
 * underneath. The client showing these controls to admins proves nothing —
 * a Server Action endpoint can be invoked directly.
 *
 * Validation failures return specific messages here because the reader is a
 * verified admin editing trusted content.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getAdminActionContext } from "@/lib/auth/admin";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import {
  CreatePracticeTestSchema,
  CreatePracticeTestQuestionSchema,
  EditPracticeTestSchema,
  MovePracticeTestQuestionSchema,
  PracticeTestQuestionMutationSchema,
  SetActiveSchema,
} from "@/lib/admin/schemas";
import { sanitizeLine, sanitizeMultiline } from "@/lib/admin/sanitize";
import type {
  AdminActionResult,
  CreateQuestionResult,
} from "@/lib/admin/types";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  QuestionContentBlocksSchema,
  contentBlocksToLegacyPrompt,
  normalizeCenteredMath,
  type QuestionContentBlock,
} from "@/lib/questions/content";

const editLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  prefix: "admin-test-edit",
});

/**
 * Sanitizes every string that will be stored. Runs after Zod (shape is known)
 * and before the RPC. A field that sanitizes to empty is caught by the
 * database function's own guards and rejected with a reason.
 */
function sanitizeContentBlocks(
  blocks: QuestionContentBlock[],
): QuestionContentBlock[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "text":
        return { ...block, content: sanitizeMultiline(block.content, 8000) };
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

/**
 * Creates the test and sends the admin straight to its page, where the
 * questions are authored. Two steps rather than one form because the test has
 * to exist before there is anything to attach questions to.
 */
export async function createPracticeTestAction(
  formData: FormData,
): Promise<AdminActionResult> {
  let destination: string | null = null;

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

    const parsed = CreatePracticeTestSchema.safeParse({
      title: formData.get("title"),
      description: formData.get("description") ?? "",
      difficulty: formData.get("difficulty"),
      testType: formData.get("testType"),
    });

    if (!parsed.success) {
      return {
        status: "error",
        message:
          "Give the test a title, a difficulty, and a type (full or half).",
      };
    }

    const title = sanitizeLine(parsed.data.title, 120);
    if (title === "") {
      return { status: "error", message: "Give the test a title." };
    }

    const { data, error } = await context.supabase
      .from("practice_tests")
      .insert({
        title,
        description: sanitizeMultiline(parsed.data.description, 500) || null,
        difficulty: parsed.data.difficulty,
        test_type: parsed.data.testType,
        // Publish only after every required module has 22 active questions.
        // The database enforces the same rule when this flag is turned on.
        is_active: false,
        created_by: context.user.id,
      })
      .select("id")
      .single();

    if (error) {
      console.error(
        `[admin] practice test insert failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/practice-tests");
    revalidatePath("/practice");
    destination = `/admin/practice-tests/${data.id as string}`;
  } catch (error) {
    console.error(`[admin] practice test insert threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }

  // Outside the try block: `redirect` signals by throwing.
  redirect(destination);
}

export async function updatePracticeTestAction(
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

    const parsed = EditPracticeTestSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: "Check the fields and try again." };
    }

    const title = sanitizeLine(parsed.data.title, 120);
    if (title === "") {
      return { status: "error", message: "Give the test a title." };
    }

    // `test_type` is absent on purpose: the database has no UPDATE grant for
    // it, so including it here would fail the write rather than change it.
    const { error, count } = await context.supabase
      .from("practice_tests")
      .update(
        {
          title,
          description: sanitizeMultiline(parsed.data.description, 500) || null,
          difficulty: parsed.data.difficulty,
        },
        { count: "exact" },
      )
      .eq("id", parsed.data.id);

    if (error) {
      console.error(
        `[admin] practice test update failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    revalidatePath("/admin/practice-tests");
    revalidatePath("/practice");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] practice test update threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/**
 * Soft delete / restore.
 *
 * Hiding a test removes it from the student list and refuses new attempts.
 * Attempts already recorded against it are untouched and stay readable on
 * Progress — a student's history is not the admin's to erase.
 */
export async function setPracticeTestActiveAction(
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
      .from("practice_tests")
      .update({ is_active: parsed.data.active }, { count: "exact" })
      .eq("id", parsed.data.id);

    if (error) {
      if (error.message.includes("incomplete_practice_test")) {
        return {
          status: "error",
          message:
            "Add 22 active questions to every module before restoring this test.",
        };
      }
      console.error(
        `[admin] practice test toggle failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    revalidatePath("/admin/practice-tests");
    revalidatePath("/practice");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] practice test toggle threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
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

export async function createPracticeTestQuestionAction(
  input: unknown,
): Promise<CreateQuestionResult> {
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

    const parsed = CreatePracticeTestQuestionSchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: questionFieldErrors(parsed.error.issues),
      };
    }

    const sanitizedBlocks = parsed.data.contentBlocks
      ? sanitizeContentBlocks(parsed.data.contentBlocks)
      : null;
    const contentResult = QuestionContentBlocksSchema.nullable().safeParse(
      sanitizedBlocks,
    );
    if (!contentResult.success) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: {
          contentBlocks: contentResult.error.issues[0]?.message ?? "Check the question content.",
        },
      };
    }

    const prompt = sanitizeMultiline(
      contentResult.data
        ? contentBlocksToLegacyPrompt(contentResult.data)
        : parsed.data.prompt,
      4000,
    );
    const explanation = sanitizeMultiline(parsed.data.explanation, 4000);
    const choices =
      parsed.data.questionType === "multiple_choice"
        ? parsed.data.choices.map((choice) => sanitizeLine(choice, 1000))
        : null;
    const sprAnswers =
      parsed.data.questionType === "student_produced_response"
        ? parsed.data.sprAnswers.map((answer) => answer.trim())
        : null;

    if (
      prompt === "" ||
      explanation === "" ||
      choices?.some((choice) => choice === "")
    ) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
      };
    }

    const questionId = parsed.data.id ?? randomUUID();
    const { data, error } = await context.supabase.rpc(
      "admin_create_practice_test_question",
      {
        p_test_id: parsed.data.testId,
        p_module_number: parsed.data.moduleNumber,
        p_question_id: questionId,
        p_subtopic_id: parsed.data.subtopicId,
        p_prompt: prompt,
        p_content_blocks: contentResult.data,
        p_choices: choices,
        p_correct_choice: parsed.data.correctChoice,
        p_question_type: parsed.data.questionType,
        p_spr_answer_mode: parsed.data.sprAnswerMode,
        p_spr_answers: sprAnswers,
        p_spr_tolerance: parsed.data.sprTolerance,
        p_explanation: explanation,
        p_difficulty: parsed.data.difficulty,
        p_is_active: true,
        p_solution_video_id: parsed.data.solutionVideoId ?? null,
      },
    );

    if (error) {
      if (error.message.includes("module_full")) {
        return { status: "error", message: "That module already has 22 questions." };
      }
      if (error.message.includes("invalid_module")) {
        return { status: "error", message: "Choose a module used by this test." };
      }
      if (error.message.includes("unknown_subtopic")) {
        return {
          status: "error",
          message: "Check the highlighted fields and try again.",
          fieldErrors: { subtopicId: "Choose an existing skill." },
        };
      }
      console.error(
        `[admin] practice question create failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const createdId = typeof data === "string" ? data : null;
    if (!createdId) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    revalidatePath(`/admin/practice-tests/${parsed.data.testId}`);
    revalidatePath("/admin/practice-tests");
    revalidatePath("/practice");
    return { status: "ok", id: createdId };
  } catch (error) {
    console.error(`[admin] practice question create threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function removePracticeTestQuestionAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };
    const parsed = PracticeTestQuestionMutationSchema.safeParse(input);
    if (!parsed.success) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await editLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const { data, error } = await context.supabase.rpc(
      "admin_remove_practice_test_question",
      { p_test_id: parsed.data.testId, p_question_id: parsed.data.questionId },
    );
    if (error || data !== true) {
      if (error) console.error(`[admin] practice question remove failed: ${error.message}`);
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath(`/admin/practice-tests/${parsed.data.testId}`);
    revalidatePath("/admin/practice-tests");
    revalidatePath("/practice");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] practice question remove threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function movePracticeTestQuestionAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };
    const parsed = MovePracticeTestQuestionSchema.safeParse(input);
    if (!parsed.success) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await editLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const { data, error } = await context.supabase.rpc(
      "admin_move_practice_test_question",
      {
        p_test_id: parsed.data.testId,
        p_question_id: parsed.data.questionId,
        p_direction: parsed.data.direction,
      },
    );
    if (error || data !== true) {
      if (error) console.error(`[admin] practice question move failed: ${error.message}`);
      return { status: "error", message: "That question cannot move farther." };
    }

    revalidatePath(`/admin/practice-tests/${parsed.data.testId}`);
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] practice question move threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
