import Link from "next/link";
import { links } from "@/lib/site";
import { sampleVideos, type VideoTone } from "@/lib/videos";

/**
 * Preview grid of sample explainers. Thumbnails are flat two-tone stripe
 * placeholders until real video art exists.
 */

const TONE = {
  accent: { stripe: "stripe-green", chip: "bg-accent-chip text-accent-hover" },
  insight: { stripe: "stripe-amber", chip: "bg-insight-chip text-insight-dark" },
} as const satisfies Record<VideoTone, { stripe: string; chip: string }>;

export function VideoLibrary() {
  return (
    <section id="library" className="mx-auto max-w-page px-5 pt-6 pb-10 sm:px-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[2rem] font-extrabold text-ink">The video library</h2>
          <p className="mt-2.5 max-w-[33.75rem] text-[1.0625rem] leading-normal text-muted">
            Short, specific explainers — Desmos shortcuts and mistake-type breakdowns you
            can search or get served automatically.
          </p>
        </div>
        <Link
          href={links.browseAll}
          className="font-semibold text-accent transition-colors hover:text-accent-hover"
        >
          Browse all &rarr;
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-4">
        {sampleVideos.map((video) => (
          <article
            key={video.title}
            className="overflow-hidden rounded-2xl border border-hairline bg-surface"
          >
            <div
              className={`relative flex aspect-video items-center justify-center ${TONE[video.tone].stripe}`}
            >
              <span
                className={`absolute top-2.5 left-2.5 rounded-[0.4375rem] px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.02em] ${TONE[video.tone].chip}`}
              >
                {video.tag}
              </span>

              <span className="flex size-11 items-center justify-center rounded-full bg-surface/90 shadow-play">
                <span className="play-triangle ml-[3px] text-base text-accent" />
              </span>

              <span className="absolute right-2.5 bottom-2 rounded-md bg-ink/80 px-1.5 py-0.5 text-[0.71875rem] font-semibold text-background">
                {video.length}
              </span>
            </div>

            <div className="px-4 pt-3 pb-4">
              <p className="text-[0.9375rem] leading-snug font-semibold text-ink">
                {video.title}
              </p>
              <p className="mt-1.5 font-mono text-[0.78125rem] text-muted">{video.meta}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
