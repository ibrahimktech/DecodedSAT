/**
 * YouTube id extraction and oEmbed metadata lookup for /admin/videos.
 *
 * oEmbed is the keyless endpoint — no API key exists for this feature, so
 * there is nothing to leak. The call happens server-side only (this module is
 * `server-only`): the admin's browser never talks to YouTube directly, and
 * the page CSP stays untouched.
 *
 * A failed lookup returns null rather than throwing: the callers' job is to
 * show a clear inline error ("video is private, deleted, or the id is
 * wrong") *before* anything saves — a broken id must never save silently.
 */

import "server-only";
import { YOUTUBE_ID_REGEX } from "./schemas";

/**
 * Accepts the shapes people actually paste: a full watch URL, a share link
 * (`youtu.be/…`), a shorts/embed/live URL, or the bare 11-character id.
 * Anything else is null — never a guess.
 */
export function extractYoutubeId(input: string): string | null {
  const trimmed = input.trim();

  if (YOUTUBE_ID_REGEX.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // A pasted URL missing its scheme ("youtube.com/watch?v=…") still counts.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return YOUTUBE_ID_REGEX.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && YOUTUBE_ID_REGEX.test(fromQuery)) return fromQuery;

    const fromPath = url.pathname.match(
      /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:$|\/)/,
    );
    if (fromPath) return fromPath[1];
  }

  return null;
}

export type OembedInfo = {
  title: string;
  authorName: string;
  thumbnailUrl: string;
};

/**
 * Fetches title/author/thumbnail for a video id. Null means "YouTube would
 * not serve it": private, deleted, or never existed — the endpoint returns
 * 400/404 for all three.
 */
export async function fetchYoutubeOembed(
  videoId: string,
): Promise<OembedInfo | null> {
  if (!YOUTUBE_ID_REGEX.test(videoId)) return null;

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      // A metadata lookup must never hang the action that called it.
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      title?: unknown;
      author_name?: unknown;
      thumbnail_url?: unknown;
    };
    if (typeof body.title !== "string" || body.title.trim() === "") return null;

    return {
      title: body.title.trim().slice(0, 200),
      authorName:
        typeof body.author_name === "string"
          ? body.author_name.trim().slice(0, 120)
          : "",
      thumbnailUrl:
        typeof body.thumbnail_url === "string" ? body.thumbnail_url : "",
    };
  } catch (error) {
    console.error(`[admin] oembed lookup failed for ${videoId}:`, error);
    return null;
  }
}
