import type { Metadata } from "next";
import Link from "next/link";
import { ManualQuestionForm } from "@/components/admin/ManualQuestionForm";
import { listAdminVideoOptions, listQuestionSets } from "@/lib/admin/data";
import { requireAdmin } from "@/lib/auth/admin";
import { getDomains, getSubtopics } from "@/lib/learn/data";

export const metadata: Metadata = {
  title: "Add Question",
};

export default async function AddQuestionPage() {
  const { supabase } = await requireAdmin();
  const [domains, subtopics, questionSets, videos] = await Promise.all([
    getDomains(supabase),
    getSubtopics(supabase),
    listQuestionSets(supabase),
    listAdminVideoOptions(supabase),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">
            Add Question
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Create one question in the same format used by JSON imports and the
            existing editor. The previews render LaTeX as students will see it.
          </p>
        </div>
        <Link
          href="/admin/questions"
          className="mt-1 text-sm font-semibold text-accent hover:text-accent-hover"
        >
          ← Questions
        </Link>
      </div>

      <ManualQuestionForm
        domains={domains}
        subtopics={subtopics}
        questionSets={questionSets}
        videos={videos}
      />
    </div>
  );
}
