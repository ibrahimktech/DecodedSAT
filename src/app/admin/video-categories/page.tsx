import type { Metadata } from "next";
import Link from "next/link";
import { VideoCategoryAdmin } from "@/components/admin/VideoCategoryAdmin";
import { listAdminVideoCategories } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = {
  title: "Video categories",
};

/**
 * Dynamic categories for general explainer videos.
 *
 * Videos only, by decision: the question bank and practice tests keep the
 * fixed domain/subtopic structure, so nothing on this page can affect them.
 *
 * `requireAdmin()` here is the middle layer — the proxy bounced non-admins
 * already, and the `is_admin()` policies on `video_categories` are what
 * actually refuse a write.
 */
export default async function AdminVideoCategoriesPage() {
  const { supabase } = await requireAdmin();
  const categories = await listAdminVideoCategories(supabase);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Video categories
        </h1>
        <Link
          href="/admin/videos"
          className="text-sm font-semibold text-accent hover:text-accent-hover"
        >
          Videos →
        </Link>
      </div>

      <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
        A video is filed under either a subtopic — the targeted explainer that
        a missed question links to — or one of these categories, for the
        general material that doesn&apos;t belong to any one topic.
      </p>

      <VideoCategoryAdmin categories={categories} />
    </div>
  );
}
