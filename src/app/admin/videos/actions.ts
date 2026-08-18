"use server";

/**
 * Server Actions for /admin/videos: oEmbed lookup, add, edit, and soft
 * delete/restore.
 *
 * Same shape as the questions actions: every one re-establishes the admin
 * context server-side, rate limits per user, validates with Zod, and lets
 * RLS's own `is_admin()` policies be the enforcement underneath.
 *
 * The save paths re-verify the video against oEmbed even though the UI ran a
 * lookup already — the lookup gates the *form*, but nothing stops a direct
 * caller from skipping it, and a broken id must never save silently.
 */

import { revalidatePath } from "next/cache";
import { getAdminActionContext } from "@/lib/auth/admin";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import {
  EditVideoSchema,
  SaveVideoSchema,
  SetActiveSchema,
  VideoLookupSchema,
} from "@/lib/admin/schemas";
import { sanitizeLine, sanitizeMultiline } from "@/lib/admin/sanitize";
import type { AdminActionResult, VideoLookupResult } from "@/lib/admin/types";
import { extractYoutubeId, fetchYoutubeOembed } from "@/lib/admin/youtube";
import { createRateLimiter } from "@/lib/rate-limit";

/** Lookups hit YouTube; a budget keeps a stuck form from hammering it. */
const lookupLimiter = createRateLimiter({
  limit: 20,
  windowMs: 60_000,
  prefix: "admin-video-lookup",
});

const editLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  prefix: "admin-video-edit",
});

const LOOKUP_FAILED_MESSAGE =
  "YouTube couldn't serve that video — it may be private, deleted, or the id is wrong.";

export async function lookupVideoAction(
  input: unknown,
): Promise<VideoLookupResult> {
  try {
    const context = await getAdminActionContext();
    if (!context) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await lookupLimiter.check(context.user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = VideoLookupSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: "Paste a YouTube URL or video id." };
    }

    const videoId = extractYoutubeId(parsed.data.input);
    if (!videoId) {
      return {
        status: "error",
        message:
          "Couldn't read a video id from that. Paste a youtube.com/watch link, a youtu.be link, or the 11-character id.",
      };
    }

    const info = await fetchYoutubeOembed(videoId);
    if (!info) {
      return { status: "error", message: LOOKUP_FAILED_MESSAGE };
    }

    return {
      status: "ok",
      youtubeId: videoId,
      title: info.title,
      authorName: info.authorName,
      thumbnailUrl: info.thumbnailUrl,
    };
  } catch (error) {
    console.error(`[admin] video lookup threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function addVideoAction(
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

    const parsed = SaveVideoSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: "Check the fields and try again." };
    }

    if (!(await fetchYoutubeOembed(parsed.data.youtubeId))) {
      return { status: "error", message: LOOKUP_FAILED_MESSAGE };
    }

    const title = sanitizeLine(parsed.data.title, 200);
    if (title === "") {
      return { status: "error", message: "Check the fields and try again." };
    }

    const { error } = await context.supabase.from("videos").insert({
      subtopic_id: parsed.data.subtopicId,
      title,
      youtube_id: parsed.data.youtubeId,
      description: sanitizeMultiline(parsed.data.description, 2000),
    });

    if (error) {
      console.error(
        `[admin] video insert failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/videos");
    revalidatePath("/admin");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] video insert threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function updateVideoAction(
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

    const parsed = EditVideoSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: "Check the fields and try again." };
    }

    if (!(await fetchYoutubeOembed(parsed.data.youtubeId))) {
      return { status: "error", message: LOOKUP_FAILED_MESSAGE };
    }

    const title = sanitizeLine(parsed.data.title, 200);
    if (title === "") {
      return { status: "error", message: "Check the fields and try again." };
    }

    const { error, count } = await context.supabase
      .from("videos")
      .update(
        {
          subtopic_id: parsed.data.subtopicId,
          title,
          youtube_id: parsed.data.youtubeId,
          description: sanitizeMultiline(parsed.data.description, 2000),
        },
        { count: "exact" },
      )
      .eq("id", parsed.data.id);

    if (error) {
      console.error(
        `[admin] video update failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/videos");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] video update threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/** Soft delete / restore, same pattern as questions. */
export async function setVideoActiveAction(
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
      .from("videos")
      .update({ is_active: parsed.data.active }, { count: "exact" })
      .eq("id", parsed.data.id);

    if (error) {
      console.error(
        `[admin] video active toggle failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (!count) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/admin/videos");
    revalidatePath("/admin");
    return { status: "ok" };
  } catch (error) {
    console.error(`[admin] video toggle threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}
