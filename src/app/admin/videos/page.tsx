import type { Metadata } from "next";
import Link from "next/link";
import { AddVideoPanel } from "@/components/admin/AddVideoPanel";
import { VideoAdminList } from "@/components/admin/VideoAdminList";
import { listAdminVideos } from "@/lib/admin/data";
import { AdminVideoFiltersSchema } from "@/lib/admin/schemas";
import { requireAdmin } from "@/lib/auth/admin";
import { getDomains, getSubtopics } from "@/lib/learn/data";

export const metadata: Metadata = {
  title: "Videos",
};

/**
 * Explainer video management: add by pasting a YouTube link (title
 * pre-filled from oEmbed, description written by hand), edit in place, soft
 * delete/restore. Same GET-form filter doctrine as the questions page.
 */
export default async function AdminVideosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireAdmin();

  const params = await searchParams;
  const single = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;

  const filters = AdminVideoFiltersSchema.parse({
    domain: single("domain"),
    subtopic: single("subtopic"),
    status: single("status"),
  });

  const [domains, subtopics, videos] = await Promise.all([
    getDomains(supabase),
    getSubtopics(supabase),
    listAdminVideos(supabase, filters),
  ]);

  const status = filters.status ?? "active";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Explainer videos
        </h1>
        <Link
          href="/admin"
          className="text-sm font-semibold text-accent hover:text-accent-hover"
        >
          ← Overview
        </Link>
      </div>

      <AddVideoPanel domains={domains} subtopics={subtopics} />

      <section aria-label="Filters" className="mt-8">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-hairline bg-surface p-4"
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Domain
            <select
              name="domain"
              defaultValue={filters.domain ?? ""}
              className="rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              <option value="">All domains</option>
              {domains.map((domain) => (
                <option key={domain.id} value={domain.id}>
                  {domain.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Subtopic
            <select
              name="subtopic"
              defaultValue={filters.subtopic ?? ""}
              className="rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              <option value="">All subtopics</option>
              {domains.map((domain) => (
                <optgroup key={domain.id} label={domain.name}>
                  {subtopics
                    .filter((subtopic) => subtopic.domainId === domain.id)
                    .map((subtopic) => (
                      <option key={subtopic.id} value={subtopic.id}>
                        {subtopic.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-muted">
            Status
            <select
              name="status"
              defaultValue={status}
              className="rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-xl bg-accent px-4 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Apply
            </button>
            <Link
              href="/admin/videos"
              className="rounded-xl border border-hairline px-4 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:bg-background hover:text-ink"
            >
              Clear
            </Link>
          </div>
        </form>
      </section>

      <section aria-label="Video list" className="mt-6">
        <p className="mb-3 text-sm text-muted">
          {videos.length} video{videos.length === 1 ? "" : "s"}
          {status === "inactive" && " (inactive — restorable below)"}
        </p>
        <VideoAdminList
          videos={videos}
          domains={domains}
          subtopics={subtopics}
        />
      </section>
    </div>
  );
}
