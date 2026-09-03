import type { Metadata } from "next";
import Link from "next/link";
import { QuestionAdminList } from "@/components/admin/QuestionAdminList";
import { UploadQuestionsPanel } from "@/components/admin/UploadQuestionsPanel";
import { listAdminQuestions, listQuestionSets } from "@/lib/admin/data";
import { AdminQuestionFiltersSchema } from "@/lib/admin/schemas";
import { requireAdmin } from "@/lib/auth/admin";
import { getDomains, getSubtopics } from "@/lib/learn/data";
import { DIFFICULTIES, DIFFICULTY_LABELS } from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Questions",
};

/**
 * The content pipeline's home: bulk JSON upload at the top, then the full
 * question list — answer key included — filterable by domain, subtopic, set,
 * difficulty, active state, and prompt text.
 *
 * Filters are a plain GET form: server-rendered, shareable URLs, no client
 * state to desync. Invalid filter values are dropped by the schema.
 */
export default async function AdminQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireAdmin();

  const params = await searchParams;
  const single = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;

  const filters = AdminQuestionFiltersSchema.parse({
    id: single("id"),
    domain: single("domain"),
    subtopic: single("subtopic"),
    set: single("set"),
    difficulty: single("difficulty"),
    status: single("status"),
    q: single("q"),
  });

  const initialEditingId =
    single("edit") === filters.id ? filters.id : undefined;
  const returnTo = safeReportReturnPath(single("returnTo"));
  const wasCreated = single("created") === "1" && Boolean(filters.id);

  const [domains, subtopics, sets, questions] = await Promise.all([
    getDomains(supabase),
    getSubtopics(supabase),
    listQuestionSets(supabase),
    listAdminQuestions(supabase, filters),
  ]);

  const status = filters.status ?? "active";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Questions
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/questions/new"
            className="rounded-xl bg-accent px-4 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Add Question
          </Link>
          <Link
            href="/admin"
            className="text-sm font-semibold text-accent hover:text-accent-hover"
          >
            ← Overview
          </Link>
        </div>
      </div>

      {wasCreated && (
        <div
          role="status"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent bg-accent-chip px-4 py-3 text-sm font-medium text-accent"
        >
          <span>Question created. It appears below and is ready to edit.</span>
          <Link
            href="/admin/questions/new"
            className="font-bold underline underline-offset-2 hover:text-accent-hover"
          >
            Add another question
          </Link>
        </div>
      )}

      <UploadQuestionsPanel />

      <section aria-label="Filters" className="mt-8">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-hairline bg-surface p-4"
        >
          <FilterSelect label="Domain" name="domain" value={filters.domain}>
            <option value="">All domains</option>
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Subtopic"
            name="subtopic"
            value={filters.subtopic}
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
          </FilterSelect>

          <FilterSelect label="Set" name="set" value={filters.set}>
            <option value="">All sets</option>
            {sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Difficulty"
            name="difficulty"
            value={filters.difficulty}
          >
            <option value="">Any difficulty</option>
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {DIFFICULTY_LABELS[difficulty]}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect label="Status" name="status" value={status}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </FilterSelect>

          <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm font-medium text-muted">
            Search prompts
            <input
              type="text"
              name="q"
              defaultValue={filters.q ?? ""}
              maxLength={80}
              placeholder="e.g. slope"
              className="rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-xl bg-accent px-4 py-2 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Apply
            </button>
            <Link
              href="/admin/questions"
              className="rounded-xl border border-hairline px-4 py-2 text-[0.9375rem] font-semibold text-muted transition-colors hover:bg-background hover:text-ink"
            >
              Clear
            </Link>
          </div>
        </form>
      </section>

      <section aria-label="Question list" className="mt-6">
        <p className="mb-3 text-sm text-muted">
          {questions.length === 500
            ? "Showing the first 500 matches — narrow the filters to see the rest."
            : `${questions.length} question${questions.length === 1 ? "" : "s"}`}
          {status === "inactive" && " (inactive — restorable below)"}
        </p>
        <QuestionAdminList
          questions={questions}
          domains={domains}
          subtopics={subtopics}
          initialEditingId={initialEditingId}
          returnTo={returnTo}
        />
      </section>
    </div>
  );
}

function safeReportReturnPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\/admin\/question-reports\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : undefined;
}

function FilterSelect({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-muted">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className="rounded-xl border border-hairline bg-surface px-3 py-2 text-[0.9375rem] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        {children}
      </select>
    </label>
  );
}
