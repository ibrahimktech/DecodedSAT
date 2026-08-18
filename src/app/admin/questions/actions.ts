"use server";

/**
 * Server Actions for /admin/questions: bulk JSON upload, inline edit, and
 * soft delete/restore.
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
  EditQuestionSchema,
  SetActiveSchema,
  UPLOAD_MAX_BYTES,
  UploadPayloadSchema,
  type UploadPayload,
} from "@/lib/admin/schemas";
import { sanitizeLine, sanitizeMultiline } from "@/lib/admin/sanitize";
import type { AdminActionResult, UploadState } from "@/lib/admin/types";
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
