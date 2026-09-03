"use server";

import { revalidatePath } from "next/cache";
import { sanitizeMultiline } from "@/lib/admin/sanitize";
import { UpdateQuestionReportSchema } from "@/lib/admin/schemas";
import type { AdminActionResult } from "@/lib/admin/types";
import { getAdminActionContext } from "@/lib/auth/admin";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import { createRateLimiter } from "@/lib/rate-limit";

const reviewLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  prefix: "admin-question-report",
});

export async function updateQuestionReportAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await reviewLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = UpdateQuestionReportSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: "Check the fields and try again." };
    }

    const adminNote = sanitizeMultiline(parsed.data.adminNote, 2000);
    const { data, error } = await context.supabase.rpc(
      "admin_update_question_report",
      {
        p_report_id: parsed.data.reportId,
        p_status: parsed.data.status,
        p_admin_note: adminNote === "" ? null : adminNote,
      },
    );

    if (error) {
      console.error(
        `[admin] question report update failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (data !== true) {
      return { status: "error", message: "That report no longer exists." };
    }

    revalidatePath("/admin", "layout");
    revalidatePath("/admin/question-reports");
    revalidatePath(`/admin/question-reports/${parsed.data.reportId}`);
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] question report update threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
