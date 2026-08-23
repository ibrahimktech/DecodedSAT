import type { Metadata } from "next";
import { TopicPicker } from "@/components/app/TopicPicker";
import { requireUser } from "@/lib/auth/require-user";
import {
  finalizeOpenQuestionBankSessions,
  getDomains,
  getSubtopicProgress,
} from "@/lib/learn/data";
import { resolveSetSelection } from "@/lib/learn/question-sets";
import { QuestionSetSchema } from "@/lib/learn/schemas";
import type { Difficulty } from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Question bank",
};

/**
 * The question bank's topic picker.
 *
 * Server-renders the numbers — how many questions exist per subtopic, how many
 * the student has answered, and how accurate they have been — and hands them to
 * a client component that assembles a selection. See `TopicPicker` for why that
 * one piece is client-side when the rest of this surface is plain links.
 *
 * The player lives at `/questions/practice`, in the `(exam)` route group,
 * because it needs the opposite shell from this page: full-bleed, no nav rail.
 *
 * Query params are parsed here so a deep link — `?domain=algebra`, or the
 * "Change topics" link back out of the player — arrives with its topics already
 * ticked. Unknown slugs are dropped rather than erroring.
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await requireUser();

  const params = await searchParams;
  const parsed = QuestionSetSchema.parse({
    domain: firstValue(params.domain),
    subtopic: firstValue(params.subtopic),
    difficulty: firstValue(params.difficulty),
    shuffle: firstValue(params.shuffle),
  });

  // Reaching the picker means any sitting that was open is genuinely over —
  // including one whose tab was closed without finishing — so this is where
  // dangling sessions get rolled up. The player is a different route, which
  // makes that unconditional: there is no branch of this page that could close
  // the session a student is currently in.
  await finalizeOpenQuestionBankSessions(supabase);

  const [domains, progress] = await Promise.all([
    getDomains(supabase),
    getSubtopicProgress(supabase, user.id),
  ]);

  // The picker works in subtopic slugs, so a `?domain=` deep link is expanded
  // into its subtopics here — the same resolution the player does, from the
  // same helper, so the two cannot disagree about what a link means.
  const selection = resolveSetSelection(
    domains,
    progress.map((entry) => entry.subtopic),
    {
      domainSlugs: parsed.domain,
      subtopicSlugs: parsed.subtopic,
      difficulties: parsed.difficulty as Difficulty[],
    },
  );

  return (
    <div className="mx-auto max-w-3xl">
      <TopicPicker
        domains={domains}
        progress={progress}
        initialSubtopicSlugs={selection.filters.subtopicSlugs}
        initialDifficulties={selection.difficulties}
        initialShuffle={parsed.shuffle === "1"}
      />
    </div>
  );
}

/** A repeated query param is a client we did not write. Take the first. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
