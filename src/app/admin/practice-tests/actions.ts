"use server";

/**
 * Server Actions for /admin/practice-tests: create a test, edit its front
 * matter, soft delete/restore, and upload its questions.
 *
 * Same doctrine as every other admin action: re-establish the admin context
 * server-side, rate limit per user, validate with Zod, sanitize what
 * persists, and let the `is_admin()` RLS policies be the enforcement
 * underneath. The client showing these controls to admins proves nothing —
 * a Server Action endpoint can be invoked directly.
 *
 * Validation failures return SPECIFIC messages here, unlike the student-facing
 * actions: the reader is a verified admin fixing their own JSON file, not an
 * anonymous prober, so there is no oracle to protect.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActionContext } from "@/lib/auth/admin";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import {
  CreatePracticeTestSchema,
  EditPracticeTestSchema,
  SetActiveSchema,
  UPLOAD_MAX_BYTES,
  UploadTestPayloadSchema,
  type UploadTestPayload,
} from "@/lib/admin/schemas";
import { sanitizeLine, sanitizeMultiline } from "@/lib/admin/sanitize";
import type { AdminActionResult, TestUploadState } from "@/lib/admin/types";
import { createRateLimiter } from "@/lib/rate-limit";

const editLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  prefix: "admin-test-edit",
});

/** Uploads are heavy — 44 questions and their links, in one transaction. */
const uploadLimiter = createRateLimiter({
  limit: 10,
  windowMs: 10 * 60_000,
  prefix: "admin-test-upload",
});

/**
 * Sanitizes every string that will be stored. Runs after Zod (shape is known)
 * and before the RPC. A field that sanitizes to empty is caught by the
 * database function's own guards and rejected with a reason.
 */
function sanitizeTestPayload(payload: UploadTestPayload): UploadTestPayload {
  return {
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
      module_number: question.module_number,
    })),
  };
}

/**
 * Creates the test and sends the admin straight to its page, where the
 * questions get uploaded. Two steps rather than one form because the test has
 * to exist before there is anything to attach 44 questions to.
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

/**
 * The question upload.
 *
 * All-or-nothing, unlike the question-set upload: `admin_import_practice_test`
 * validates the whole payload first and imports nothing if any row is bad or
 * any module count is wrong. That is the right trade for a test — a partial
 * import would leave a test that looks ready and scores out of the wrong
 * denominator.
 *
 * Re-uploading replaces the question links. Questions already in the test's
 * set are found by `external_id` and reused rather than duplicated, so a
 * re-upload does not orphan the attempt history attached to them.
 */
export async function uploadTestQuestionsAction(
  _previous: TestUploadState,
  formData: FormData,
): Promise<TestUploadState> {
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

    const testId = formData.get("testId");
    if (typeof testId !== "string" || testId === "") {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { status: "error", message: "Choose a .json file to upload." };
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      return {
        status: "error",
        message: "That file is over 1 MB. A practice test should be well under.",
      };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      return { status: "error", message: "That file isn't valid JSON." };
    }

    const parsed = UploadTestPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
      return {
        status: "error",
        message: `That file doesn't match the expected format${where}: ${issue.message}`,
      };
    }

    const { data, error } = await context.supabase.rpc(
      "admin_import_practice_test",
      {
        p_test_id: testId,
        p_payload: sanitizeTestPayload(parsed.data),
      },
    );

    if (error) {
      console.error(
        `[admin] admin_import_practice_test failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const result = data as {
      ok?: boolean;
      errors?: string[];
      imported?: number;
      reused?: number;
      linked?: number;
    } | null;

    if (!result) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    if (result.ok !== true) {
      return {
        status: "rejected",
        errors: Array.isArray(result.errors)
          ? result.errors.map(String)
          : ["The upload was rejected but no reason came back."],
      };
    }

    revalidatePath("/admin/practice-tests");
    revalidatePath(`/admin/practice-tests/${testId}`);
    revalidatePath("/practice");

    return {
      status: "ok",
      imported: result.imported ?? 0,
      reused: result.reused ?? 0,
      linked: result.linked ?? 0,
    };
  } catch (error) {
    console.error(`[admin] test upload threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
