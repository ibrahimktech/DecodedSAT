"use server";

/**
 * Server Actions for /admin/questions: manual creation, bulk JSON upload,
 * inline edit, and soft delete/restore.
 *
 * Every action independently re-establishes the admin context — session plus
 * a server-side `is_admin()` RPC — before touching anything. The client only
 * *showing* these controls to admins proves nothing; anyone can invoke a
 * Server Action endpoint directly. And beneath even these checks, RLS
 * policies re-check `is_admin()` inside the database, so a bug here still
 * writes nothing.
 *
 * Unlike the student-facing auth actions, validation failures return
 * *specific* messages: the reader is a verified admin fixing their own JSON
 * file, not an anonymous prober — there is no oracle to protect.
 */

import { revalidatePath } from "next/cache";
import { getAdminActionContext } from "@/lib/auth/admin";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import {
  CreateQuestionSchema,
  EditQuestionSchema,
  SetActiveSchema,
  UPLOAD_MAX_BYTES,
  UploadPayloadSchema,
  type UploadPayload,
} from "@/lib/admin/schemas";
import { sanitizeLine, sanitizeMultiline } from "@/lib/admin/sanitize";
import type {
  AdminActionResult,
  CreateQuestionResult,
  UploadState,
} from "@/lib/admin/types";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Keyed on user id (CLAUDE.md: by user once auth exists). Uploads are heavy
 * (up to 500 inserts each), edits are one row — separate budgets.
 */
const uploadLimiter = createRateLimiter({
  limit: 10,
  windowMs: 10 * 60_000,
  prefix: "admin-upload",
});

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

/**
 * Sanitizes every string that will be stored. Runs *after* Zod (shape is
 * known) and *before* the RPC. A field that sanitizes to empty is caught by
 * the database function's own guards and rejected with a per-row reason.
 */
function sanitizePayload(payload: UploadPayload): UploadPayload {
  return {
    set_name: sanitizeLine(payload.set_name, 120),
    set_description:
      payload.set_description === undefined
        ? undefined
        : sanitizeLine(payload.set_description, 500),
    create_new_subtopics: payload.create_new_subtopics,
    questions: payload.questions.map((question) => ({
      external_id: sanitizeLine(question.external_id, 64),
      domain: sanitizeLine(question.domain, 100),
      subtopic: sanitizeLine(question.subtopic, 120),
      prompt: sanitizeMultiline(question.prompt, 4000),
      choices: question.choices.map((choice) => ({
        label: choice.label,
        text: sanitizeLine(choice.text, 1000),
      })),
      correct_answer: question.correct_answer,
      explanation: sanitizeMultiline(question.explanation, 4000),
      difficulty: question.difficulty,
    })),
  };
}

export async function uploadQuestionSetAction(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await uploadLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { status: "error", message: "Choose a .json file to upload." };
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      return {
        status: "error",
        message: "That file is over 1 MB. Split the upload into smaller sets.",
      };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return { status: "error", message: "That file isn't valid JSON." };
    }

    const parsed = UploadPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      // The first issue is almost always the actionable one; path included so
      // the admin can find the offending field in their file.
      const issue = parsed.error.issues[0];
      const where = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
      return {
        status: "error",
        message: `The JSON doesn't match the expected shape${where}: ${issue.message}`,
      };
    }

    const { data, error } = await context.supabase.rpc(
      "admin_import_question_set",
      { p_payload: sanitizePayload(parsed.data) },
    );

    if (error) {
      console.error(
        `[admin] import rpc failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const summary = data as {
      imported?: number;
      skipped_duplicates?: number;
      rejected?: Array<{ external_id?: string; reason?: string }>;
    } | null;
    if (!summary || typeof summary.imported !== "number") {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/questions");
    revalidatePath("/admin");

    return {
      status: "ok",
      imported: summary.imported,
      skippedDuplicates: summary.skipped_duplicates ?? 0,
      rejected: (summary.rejected ?? []).map((entry) => ({
        externalId: entry.external_id ?? "(unknown)",
        reason: entry.reason ?? "rejected",
      })),
    };
  } catch (error) {
    console.error(`[admin] upload threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/**
 * Creates one question through the same database model as the JSON importer.
 * The RPC is required because authenticated clients intentionally have no
 * INSERT grant on `questions`; it independently checks `is_admin()` and every
 * field before inserting atomically.
 */
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

    const choices = parsed.data.choices.map((choice) =>
      sanitizeLine(choice, 1000),
    );
    const prompt = sanitizeMultiline(parsed.data.prompt, 4000);
    const explanation = sanitizeMultiline(parsed.data.explanation, 4000);
    const externalId = sanitizeLine(parsed.data.externalId, 64);

    const sanitizedErrors: Record<string, string> = {};
    if (prompt === "") sanitizedErrors.prompt = "Enter the question prompt.";
    if (explanation === "") {
      sanitizedErrors.explanation = "Enter the answer explanation.";
    }
    choices.forEach((choice, index) => {
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
        fieldErrors: { subtopicId: "Choose an existing skill / subtopic." },
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

    const { data, error } = await context.supabase.rpc(
      "admin_create_question",
      {
        p_subtopic_id: parsed.data.subtopicId,
        p_prompt: prompt,
        p_choices: choices,
        p_correct_choice: parsed.data.correctChoice,
        p_explanation: explanation,
        p_difficulty: parsed.data.difficulty,
        p_is_active: parsed.data.isActive,
        p_question_set_id: questionSetId,
        p_external_id: externalId || null,
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
          fieldErrors: { subtopicId: "Choose an existing skill / subtopic." },
        };
      }
      if (error.message.includes("unknown_question_set")) {
        return {
          status: "error",
          message: "Check the highlighted fields and try again.",
          fieldErrors: { questionSetId: "Choose an existing question set." },
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

    const choices = parsed.data.choices.map((text) => sanitizeLine(text, 1000));
    const prompt = sanitizeMultiline(parsed.data.prompt, 4000);
    const explanation = sanitizeMultiline(parsed.data.explanation, 4000);
    if (prompt === "" || explanation === "" || choices.some((c) => c === "")) {
      return { status: "error", message: "Check the fields and try again." };
    }

    // The admin's own session; RLS's update policy re-checks is_admin() and
    // the answer key columns are writable only through this grant.
    const { error, count } = await context.supabase
      .from("questions")
      .update(
        {
          subtopic_id: parsed.data.subtopicId,
          prompt,
          choices,
          correct_choice: parsed.data.correctChoice,
          explanation,
          difficulty: parsed.data.difficulty,
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

    revalidatePath("/admin/questions");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] question update threw: ${describeError(error)}`);
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
    revalidatePath("/admin");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] question toggle threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
