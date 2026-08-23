import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { QuestionPlayer } from "@/components/app/QuestionPlayer";
import { CtaButton } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import {
  getDomains,
  getQuestionSetIndex,
  getQuestionsByIds,
  getSubtopics,
  getTodayAttemptCount,
  getUserStats,
} from "@/lib/learn/data";
import { QuestionSetSchema } from "@/lib/learn/schemas";
import {
  QUESTION_WINDOW_SIZE,
  type Difficulty,
} from "@/lib/learn/types";
import {
  buildSetHref,
  newSetSeed,
  resolveSetSelection,
} from "@/lib/learn/question-sets";

export const metadata: Metadata = {
  title: "Practicing questions",
};

/**
 * The question bank player.
 *
 * Lives in the `(exam)` route group, not under `(app)`: a student answering
 * questions gets the same full-bleed, no-navigation shell the practice test
 * uses. The picker at `/questions` is a normal page and keeps the nav rail.
 *
 * ## What this page decides
 *
 * Which questions are in the set and in what order — resolved here, once, and
 * handed down as a fixed index. The player never re-derives it, and the window
 * action only ever fills in content for ids that came from this list.
 *
 * ## The seed
 *
 * A shuffled set without a pinned seed would deal itself a new order on every
 * reload, losing the student's place. So a shuffle arriving without a seed is
 * redirected to the same URL carrying one. That makes the shuffled URL
 * shareable and reload-stable, and it is why the seed is in the address bar
 * rather than in a cookie or in memory.
 */
export default async function QuestionsPracticePage({
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
    seed: firstValue(params.seed),
  });

  const shuffle = parsed.shuffle === "1";

  const [domains, subtopics] = await Promise.all([
    getDomains(supabase),
    getSubtopics(supabase),
  ]);
  const selection = resolveSetSelection(domains, subtopics, {
    domainSlugs: parsed.domain,
    subtopicSlugs: parsed.subtopic,
    difficulties: parsed.difficulty as Difficulty[],
  });

  // Pin the order before anything is rendered against it.
  if (shuffle && parsed.seed === undefined) {
    redirect(
      buildSetHref("/questions/practice", selection, {
        shuffle: true,
        seed: newSetSeed(),
      }),
    );
  }

  const pickerHref = buildSetHref("/questions", selection, { shuffle });

  const [entries, stats, answeredToday] = await Promise.all([
    getQuestionSetIndex(supabase, user.id, selection.filters, {
      shuffle,
      seed: parsed.seed,
    }),
    getUserStats(supabase, user.id),
    getTodayAttemptCount(supabase, user.id),
  ]);

  if (entries.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <section className="w-full max-w-xl rounded-2xl border border-hairline bg-surface p-8 text-center">
          <h1 className="font-display text-2xl font-bold text-ink">
            Nothing matches this selection
          </h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
            There are no questions in the bank for these topics and difficulties
            yet. Widen the selection and try again.
          </p>
          <div className="mt-6">
            <CtaButton href={pickerHref}>Change topics</CtaButton>
          </div>
        </section>
      </div>
    );
  }

  // The first window travels with the page, so the opening question paints
  // complete rather than as a skeleton that resolves a moment later.
  const initialQuestions = await getQuestionsByIds(
    supabase,
    user.id,
    entries.slice(0, QUESTION_WINDOW_SIZE).map((entry) => entry.id),
  );

  return (
    <QuestionPlayer
      // Keyed on the set's identity so "Keep practicing" (router.refresh) —
      // which re-derives the order against fresh attempt data — remounts the
      // player rather than reusing a cursor into a list that changed.
      key={`${entries.length}:${entries[0]?.id}:${parsed.seed ?? "rotate"}`}
      entries={entries}
      initialQuestions={initialQuestions}
      changeFiltersHref={pickerHref}
      shuffled={shuffle}
      dailyGoal={stats.dailyGoal}
      answeredToday={answeredToday}
    />
  );
}

/** A repeated query param is a client we did not write. Take the first. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
