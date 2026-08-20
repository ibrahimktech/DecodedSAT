import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { getVideo } from "@/lib/learn/data";

export const metadata: Metadata = {
  title: "Watch explainer",
};

/**
 * The watch page a library card opens. The player is sized to fill the
 * screen: full width, capped by viewport height (the `max-w` calc keeps the
 * 16:9 box inside the fold instead of forcing a scroll on wide monitors).
 *
 * The player iframe loads here and only here — via the privacy-enhanced
 * `youtube-nocookie.com` host, the sole embed origin the CSP allows. The
 * card click that led here is the play gesture, so the embed autoplays.
 *
 * The route param is untrusted URL input: anything that is not a UUID is a
 * 404 before it ever reaches a query, and RLS scopes the query itself.
 */
export default async function WatchVideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { supabase } = await requireUser();

  const { id } = await params;
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) notFound();

  const video = await getVideo(supabase, parsedId.data);
  if (!video) notFound();

  // Ids come from the seeded `videos` table, never from user input — the
  // encoding is belt-and-braces against a malformed row, not a trust boundary.
  const safeId = encodeURIComponent(video.youtubeId);

  return (
    <div className="mx-auto max-w-[max(20rem,calc((100vh-16rem)*16/9))] min-w-0">
      <Link
        href="/videos"
        className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface px-4 py-2 text-[0.9375rem] font-medium text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M19 12H5" />
          <path d="m11 18-6-6 6-6" />
        </svg>
        Back to videos
      </Link>

      <div className="mt-4 aspect-video w-full overflow-hidden rounded-2xl border border-hairline bg-ink">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${safeId}?autoplay=1&rel=0`}
          title={video.title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {video.subtopicName ? (
          <p className="self-start rounded-lg bg-accent-chip px-2.5 py-1 text-xs font-semibold text-accent">
            {video.subtopicName}
          </p>
        ) : video.categoryName ? (
          <p className="self-start rounded-lg bg-insight-chip px-2.5 py-1 text-xs font-semibold text-insight-dark">
            {video.categoryName}
          </p>
        ) : null}
        <h1 className="font-display text-2xl font-extrabold text-ink sm:text-3xl">
          {video.title}
        </h1>
        <p className="max-w-3xl text-[0.9375rem] leading-relaxed text-muted">
          {video.description}
        </p>
      </div>
    </div>
  );
}
