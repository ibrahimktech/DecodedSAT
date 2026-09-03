"use server";

/**
 * Shared student submission action for every question-solving surface.
 *
 * The browser supplies only the question id, selected reason, optional details,
 * and an idempotency id. The authenticated user and the question snapshot are
 * resolved server-side; the database function also re-validates all enum and
 * length constraints and refuses nonexistent questions.
 */

import { revalidatePath } from "next/cache";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import { sanitizeMultiline } from "@/lib/admin/sanitize";
import { ReportQuestionSchema } from "@/lib/learn/schemas";
import type { QuestionReportResult } from "@/lib/learn/types";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const reportLimiter = createRateLimiter({
  limit: 20,
  windowMs: 10 * 60_000,
  prefix: "question-report",
});

const sameQuestionLimiter = createRateLimiter({
  limit: 3,
  windowMs: 60 * 60_000,
  prefix: "question-report-same",
});

export async function submitQuestionReportAction(
  input: unknown,
): Promise<QuestionReportResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const rate = await reportLimiter.check(user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = ReportQuestionSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: "Choose a reason and try again." };
    }

    const questionRate = await sameQuestionLimiter.check(
      `${user.id}:${parsed.data.questionId}`,
    );
    if (!questionRate.ok) {
      return {
        status: "rate_limited",
        message: "You’ve already reported this question recently.",
      };
    }

    const details = sanitizeMultiline(parsed.data.details, 1000);
    const { data, error } = await supabase.rpc("submit_question_report", {
      p_request_id: parsed.data.requestId,
      p_question_id: parsed.data.questionId,
      p_reason: parsed.data.reason,
      p_details: details === "" ? null : details,
    });

    if (error) {
      if (error.message?.includes("question_not_found")) {
        return {
          status: "error",
          message: "This question is no longer available to report.",
        };
      }
      console.error(
        `[reports] submit_question_report failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    if (data !== true) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin", "layout");
    revalidatePath("/admin/question-reports");
    return { status: "ok" };
  } catch (error) {
    console.error(`[reports] submit threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
