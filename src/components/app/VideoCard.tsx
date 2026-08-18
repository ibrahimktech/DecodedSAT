/**
 * One explainer video in the library — a full-width horizontal row: small
 * thumbnail on the left, big title with the description under it on the
 * right. The thumbnail and the title both link to the watch page at
 * `/videos/[id]`; the player itself only ever loads there.
 *
 * Server component: the row costs one thumbnail image request and ships no
 * script. At this thumbnail size YouTube's always-present `hqdefault`
 * (480px) is plenty sharp, so no client-side fallback dance is needed.
 *
 * The thumbnail link is a duplicate of the title link, so it is hidden from
 * the tab order and the accessibility tree — keyboard and screen-reader
 * users get exactly one stop per video, on the title.
 */

import Link from "next/link";

type VideoCardProps = {
  id: string;
  title: string;
  youtubeId: string;
  description: string;
  subtopicName: string;
};

export function VideoCard({
  id,
  title,
  youtubeId,
  description,
  subtopicName,
}: VideoCardProps) {
  // Ids come from the seeded `videos` table, never from user input — the
  // encoding is belt-and-braces against a malformed row, not a trust boundary.
  const safeId = encodeURIComponent(youtubeId);
  const href = `/videos/${encodeURIComponent(id)}`;

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface p-4 sm:flex-row sm:gap-6 sm:p-5">
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden
        className="group relative block aspect-video w-full shrink-0 self-start overflow-hidden rounded-xl bg-background sm:w-60 md:w-72"
      >
        {/* Remote thumbnail at a fixed size — next/image would proxy it
            through this deployment for no gain. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface pl-0.5 text-insight-dark shadow-play transition-transform group-hover:scale-105">
            <span className="play-triangle text-[0.8125rem]" />
          </span>
        </span>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="font-display text-xl font-bold leading-snug sm:text-2xl">
          <Link
            href={href}
            className="text-ink transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {title}
          </Link>
        </h2>
        <p className="text-[0.9375rem] leading-relaxed text-muted">
          {description}
        </p>
        <p className="mt-auto self-start rounded-lg bg-accent-chip px-2.5 py-1 text-xs font-semibold text-accent">
          {subtopicName}
        </p>
      </div>
    </article>
  );
}
