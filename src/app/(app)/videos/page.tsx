import type { Metadata } from "next";
import Link from "next/link";
import { VideoCard } from "@/components/app/VideoCard";
import { requireUser } from "@/lib/auth/require-user";
import { getDomains, getVideoCategories, getVideos } from "@/lib/learn/data";
import { VideoFiltersSchema } from "@/lib/learn/schemas";

export const metadata: Metadata = {
  title: "Explainer videos",
};

/**
 * The video library: full-width cards stacked one per row, filterable by
 * domain via plain links and searchable by title via a plain GET form — no
 * client state, and both survive reload/back/share as URLs.
 *
 * An invalid filter or search param is dropped (schema `.catch`), never
 * echoed back. `?subtopic=` deep-links from a missed question straight to
 * that gap's explainer, which is the product's core loop. Clicking a card
 * opens `/videos/[id]`, where the player actually loads.
 */
export default async function VideosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireUser();

  const params = await searchParams;
  const filters = VideoFiltersSchema.parse({
    domain: typeof params.domain === "string" ? params.domain : undefined,
    subtopic: typeof params.subtopic === "string" ? params.subtopic : undefined,
    category: typeof params.category === "string" ? params.category : undefined,
    q: typeof params.q === "string" ? params.q : undefined,
  });

  const [domains, categories] = await Promise.all([
    getDomains(supabase),
    getVideoCategories(supabase),
  ]);

  const activeDomain = domains.find((domain) => domain.slug === filters.domain);
  const activeCategory = categories.find(
    (category) => category.slug === filters.category,
  );

  // Domain and category are one axis with two kinds of value, not two
  // independent filters — a video is filed under one or the other, so
  // selecting both would always return nothing. A domain chip wins.
  const fetched = await getVideos(supabase, {
    domainId: activeDomain?.id,
    subtopicSlug: filters.subtopic,
    categorySlug: activeDomain || filters.subtopic ? undefined : activeCategory?.slug,
  });

  // Title-only search, matched in process against rows RLS already released —
  // the term never becomes part of a SQL pattern.
  const query = filters.q?.toLowerCase();
  const videos = query
    ? fetched.filter((video) => video.title.toLowerCase().includes(query))
    : fetched;

  return (
    <div className="mx-auto max-w-5xl">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Explainer videos
        </h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
          Short videos that target one specific gap each. When a question trips
          you up, this is where its fix lives.
        </p>
      </header>

      {/* Title search. A GET form keeps the term in the URL like every other
          filter; the hidden field carries the active domain chip across a
          search instead of silently resetting it. */}
      <form action="/videos" method="get" className="mt-6" role="search">
        {activeDomain && (
          <input type="hidden" name="domain" value={activeDomain.slug} />
        )}
        {!activeDomain && activeCategory && (
          <input type="hidden" name="category" value={activeCategory.slug} />
        )}
        <div className="flex max-w-xl items-center gap-2 rounded-xl border border-hairline bg-surface px-4 py-2.5 focus-within:border-accent">
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="shrink-0 text-muted"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            maxLength={80}
            placeholder="Search videos by title…"
            aria-label="Search videos by title"
            className="w-full bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-surface transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Search
          </button>
        </div>
      </form>

      {/* Domain filter chips. The subtopic deep-link filter, when present,
          narrows further; clicking any chip clears it but keeps the search. */}
      <nav aria-label="Filter by domain" className="mt-4 flex flex-wrap gap-2">
        <FilterChip
          href={videosHref({ q: filters.q })}
          active={!activeDomain && !filters.subtopic && !activeCategory}
        >
          Everything
        </FilterChip>
        {domains.map((domain) => (
          <FilterChip
            key={domain.id}
            href={videosHref({ domain: domain.slug, q: filters.q })}
            active={activeDomain?.id === domain.id && !filters.subtopic}
          >
            {domain.name}
          </FilterChip>
        ))}
      </nav>

      {/* Categories are the second kind of shelf: videos that fix a general
          gap rather than a specific subtopic. Admin-managed and fully
          dynamic, so this row is empty until categories exist — which is why
          it renders nothing at all rather than an empty heading. */}
      {categories.length > 0 && (
        <nav
          aria-label="Filter by category"
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <span className="text-sm font-semibold text-muted">Guides:</span>
          {categories.map((category) => (
            <FilterChip
              key={category.id}
              href={videosHref({ category: category.slug, q: filters.q })}
              active={activeCategory?.id === category.id && !activeDomain}
            >
              {category.name}
            </FilterChip>
          ))}
        </nav>
      )}

      {filters.subtopic && videos.length > 0 && (
        <p className="mt-4 rounded-xl bg-insight-chip px-4 py-3 text-[0.9375rem] text-insight-dark">
          Showing explainers for{" "}
          <strong>{videos[0].subtopicName ?? "this topic"}</strong> —{" "}
          <Link href="/videos" className="font-semibold underline">
            show all
          </Link>
        </p>
      )}

      {videos.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-hairline bg-surface p-8 text-center text-[0.9375rem] text-muted">
          {filters.q ? (
            <>
              No video titles match &ldquo;{filters.q}&rdquo;.{" "}
              <Link
                href={videosHref({
                  domain: activeDomain?.slug,
                  category: activeCategory?.slug,
                })}
                className="font-semibold text-accent transition-colors hover:text-accent-hover"
              >
                Clear the search
              </Link>
            </>
          ) : (
            <>
              No videos here yet.{" "}
              <Link
                href="/videos"
                className="font-semibold text-accent transition-colors hover:text-accent-hover"
              >
                Browse the full library
              </Link>
            </>
          )}
          .
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              id={video.id}
              title={video.title}
              youtubeId={video.youtubeId}
              description={video.description}
              subtopicName={video.subtopicName}
              categoryName={video.categoryName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** `/videos` URL with only the params that are actually set. */
function videosHref(params: {
  domain?: string;
  category?: string;
  q?: string;
}): string {
  const search = new URLSearchParams();
  if (params.domain) search.set("domain", params.domain);
  else if (params.category) search.set("category", params.category);
  if (params.q) search.set("q", params.q);
  const qs = search.toString();
  return qs ? `/videos?${qs}` : "/videos";
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-xl border px-4 py-2 text-[0.9375rem] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? "border-transparent bg-accent text-surface"
          : "border-hairline bg-surface text-muted hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </Link>
  );
}
