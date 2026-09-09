"use server";

import { z } from "zod";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import type { AdminActionResult } from "@/lib/admin/types";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const DismissPopupSchema = z.object({ popupId: z.uuid() });
const popupDismissLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  prefix: "popup-dismiss",
});

export async function dismissPopupAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const parsed = DismissPopupSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await popupDismissLimiter.check(user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const { data, error } = await supabase.rpc("dismiss_popup", {
      p_popup_id: parsed.data.popupId,
    });
    if (error) {
      console.error(
        `[popups] dismiss failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (data !== true) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    return { status: "ok" };
  } catch (error) {
    console.error(`[popups] dismiss threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
