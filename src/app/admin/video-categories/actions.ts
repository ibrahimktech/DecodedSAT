"use server";

/**
 * Server Actions for /admin/video-categories: create, rename, soft
 * delete/restore.
 *
 * Same shape as every other admin action: re-establish the admin context
 * server-side, rate limit per user, validate with Zod, sanitize what
 * persists, and let the `is_admin()` RLS policies on `video_categories` be
 * the enforcement underneath. Nothing here trusts that the caller came from
 * the admin UI.
 *
 * Categories apply to VIDEOS ONLY. There is deliberately no path from here to
 * questions or practice tests — those keep the fixed domain/subtopic
 * structure, per the locked decision in the step spec.
 */

import { revalidatePath } from "next/cache";
import { getAdminActionContext } from "@/lib/auth/admin";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import {
  CreateVideoCategorySchema,
  SetActiveSchema,
  UpdateVideoCategorySchema,
} from "@/lib/admin/schemas";
import { sanitizeLine } from "@/lib/admin/sanitize";
import type { AdminActionResult, CreateCategoryResult } from "@/lib/admin/types";
import { createRateLimiter } from "@/lib/rate-limit";

const categoryLimiter = createRateLimiter({
  limit: 40,
  windowMs: 60_000,
  prefix: "admin-video-category",
});

const DUPLICATE_SLUG_MESSAGE =
  "A category with that URL name already exists. Pick a different one.";

/** Postgres unique-violation. A taken slug is a fixable mistake, not a 500. */
const UNIQUE_VIOLATION = "23505";

/**
 * `"Desmos Tips & Tricks"` → `"desmos-tips-tricks"`.
 *
 * Only ever a starting suggestion: the form shows the result and lets it be
 * edited before saving, and the schema validates whatever is submitted. A
 * name with no slug-able characters at all falls back to a fixed word rather
 * than producing an empty slug the regex would then reject.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug === "" ? "category" : slug;
}

export async function createVideoCategoryAction(
  input: unknown,
): Promise<CreateCategoryResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await categoryLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = CreateVideoCategorySchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: "error",
        message:
          "Give the category a name, and a URL name of lowercase letters, numbers and hyphens.",
      };
    }

    const name = sanitizeLine(parsed.data.name, 60);
    if (name === "") {
      return { status: "error", message: "Give the category a name." };
    }

    const slug = parsed.data.slug === "" ? slugify(name) : parsed.data.slug;

    // `select()` after insert reads back through the same RLS policies, so a
    // non-admin could not learn the id even if the insert had somehow landed.
    const { data, error } = await context.supabase
      .from("video_categories")
      .insert({ name, slug })
      .select("id, name, slug")
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return { status: "error", message: DUPLICATE_SLUG_MESSAGE };
      }
      console.error(
        `[admin] video category insert failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/video-categories");
    revalidatePath("/admin/videos");
    return {
      status: "ok",
      id: data.id as string,
      name: data.name as string,
      slug: data.slug as string,
    };
  } catch (error) {
    console.error(`[admin] video category insert threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function updateVideoCategoryAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await categoryLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = UpdateVideoCategorySchema.safeParse(input);
    if (!parsed.success) {
      return {
        status: "error",
        message:
          "Give the category a name, and a URL name of lowercase letters, numbers and hyphens.",
      };
    }

    const name = sanitizeLine(parsed.data.name, 60);
    if (name === "") {
      return { status: "error", message: "Give the category a name." };
    }

    const { error, count } = await context.supabase
      .from("video_categories")
      .update({ name, slug: parsed.data.slug }, { count: "exact" })
      .eq("id", parsed.data.id);

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return { status: "error", message: DUPLICATE_SLUG_MESSAGE };
      }
      console.error(
        `[admin] video category update failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    revalidatePath("/admin/video-categories");
    revalidatePath("/admin/videos");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] video category update threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/**
 * Soft delete / restore.
 *
 * Deactivating hides the category and its shelf from the student library. The
 * videos under it are NOT touched — they keep their `video_category_id`, so
 * restoring the category brings its shelf back intact. Nothing in the admin
 * UI hard-deletes.
 */
export async function setVideoCategoryActiveAction(
  input: unknown,
): Promise<AdminActionResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await categoryLimiter.check(context.user.id);
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
      .from("video_categories")
      .update({ is_active: parsed.data.active }, { count: "exact" })
      .eq("id", parsed.data.id);

    if (error) {
      console.error(
        `[admin] video category toggle failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    revalidatePath("/admin/video-categories");
    revalidatePath("/admin/videos");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] video category toggle threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
