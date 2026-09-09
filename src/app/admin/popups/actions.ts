"use server";

import { revalidatePath } from "next/cache";
import {
  CreatePopupSchema,
  SetPopupActiveSchema,
  UpdatePopupSchema,
} from "@/lib/admin/schemas";
import { sanitizeLine, sanitizeMultiline } from "@/lib/admin/sanitize";
import type { AdminActionResult } from "@/lib/admin/types";
import { getAdminActionContext } from "@/lib/auth/admin";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import { createRateLimiter } from "@/lib/rate-limit";

const popupLimiter = createRateLimiter({
  limit: 40,
  windowMs: 60_000,
  prefix: "admin-popup",
});

function validationMessage(): AdminActionResult {
  return {
    status: "error",
    message:
      "Check the title, message, dates, button, and eligibility values.",
  };
}

async function getContext() {
  const context = await getAdminActionContext();
  if (!context) return { error: GENERIC_ERROR_MESSAGE } as const;

  const rate = await popupLimiter.check(context.user.id);
  if (!rate.ok) {
    return { error: rateLimitedMessage(rate.retryAfterSeconds) } as const;
  }
  return { context } as const;
}

function popupRow(value: {
  title: string;
  message: string;
  buttonText: string;
  buttonUrl: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  showOnce: boolean;
  minAnsweredQuestions: number | null;
  minAccountAgeDays: number | null;
}) {
  const buttonText = sanitizeLine(value.buttonText, 60);
  return {
    title: sanitizeLine(value.title, 120),
    message: sanitizeMultiline(value.message, 2000),
    button_text: buttonText === "" ? null : buttonText,
    button_url: value.buttonUrl === "" ? null : value.buttonUrl.trim(),
    is_active: value.isActive,
    starts_at: value.startsAt,
    ends_at: value.endsAt === "" ? null : value.endsAt,
    show_once: value.showOnce,
    min_answered_questions: value.minAnsweredQuestions,
    min_account_age_days: value.minAccountAgeDays,
    updated_at: new Date().toISOString(),
  };
}

export async function createPopupAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const checked = await getContext();
    if ("error" in checked) {
      return {
        status: "error",
        message: checked.error ?? GENERIC_ERROR_MESSAGE,
      };
    }

    const parsed = CreatePopupSchema.safeParse(input);
    if (!parsed.success) return validationMessage();

    const row = popupRow(parsed.data);
    if (row.title === "" || row.message === "") return validationMessage();

    const { error } = await checked.context.supabase.from("popups").insert({
      ...row,
      created_by: checked.context.user.id,
    });

    if (error) {
      console.error(
        `[admin] popup insert failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/popups");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] popup insert threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function updatePopupAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const checked = await getContext();
    if ("error" in checked) {
      return {
        status: "error",
        message: checked.error ?? GENERIC_ERROR_MESSAGE,
      };
    }

    const parsed = UpdatePopupSchema.safeParse(input);
    if (!parsed.success) return validationMessage();

    const row = popupRow(parsed.data);
    if (row.title === "" || row.message === "") return validationMessage();

    const { error, count } = await checked.context.supabase
      .from("popups")
      .update(row, { count: "exact" })
      .eq("id", parsed.data.id);

    if (error) {
      console.error(
        `[admin] popup update failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    revalidatePath("/admin/popups");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] popup update threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function setPopupActiveAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const checked = await getContext();
    if ("error" in checked) {
      return {
        status: "error",
        message: checked.error ?? GENERIC_ERROR_MESSAGE,
      };
    }

    const parsed = SetPopupActiveSchema.safeParse(input);
    if (!parsed.success) return validationMessage();

    const { error, count } = await checked.context.supabase
      .from("popups")
      .update(
        { is_active: parsed.data.active, updated_at: new Date().toISOString() },
        { count: "exact" },
      )
      .eq("id", parsed.data.id);

    if (error) {
      console.error(
        `[admin] popup toggle failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    revalidatePath("/admin/popups");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] popup toggle threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
