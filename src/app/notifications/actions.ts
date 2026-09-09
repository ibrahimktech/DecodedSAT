"use server";

import { z } from "zod";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import type { AdminActionResult } from "@/lib/admin/types";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const NotificationIdSchema = z.object({ id: z.uuid() });
const notificationLimiter = createRateLimiter({
  limit: 120,
  windowMs: 60_000,
  prefix: "notification-read",
});

async function authenticatedContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const rate = await notificationLimiter.check(user.id);
  return { supabase, rate };
}

export async function markNotificationReadAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const parsed = NotificationIdSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const context = await authenticatedContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };
    if (!context.rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(context.rate.retryAfterSeconds),
      };
    }

    const { error, count } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", parsed.data.id)
      .is("read_at", null);

    if (error) {
      console.error(
        `[notifications] mark read failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    // Already-read rows are an idempotent success. RLS also makes another
    // user's id look like no matching row, without revealing that it exists.
    if (count === null) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    return { status: "ok" };
  } catch (error) {
    console.error(`[notifications] mark read threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function markAllNotificationsReadAction(): Promise<AdminActionResult> {
  try {
    const context = await authenticatedContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };
    if (!context.rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(context.rate.retryAfterSeconds),
      };
    }

    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);

    if (error) {
      console.error(
        `[notifications] mark all read failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    return { status: "ok" };
  } catch (error) {
    console.error(`[notifications] mark all read threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
