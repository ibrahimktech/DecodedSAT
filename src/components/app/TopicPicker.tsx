"use client";

/**
 * The question bank's front door: pick topics, pick difficulties, start.
 *
 * Replaces a row of chips that could hold exactly one domain, one subtopic and
 * one difficulty at a time. That shape could not express the thing students
 * actually want — hard questions from two Algebra subtopics plus one from
 * Geometry — so it is gone, and this is a set builder instead.
 *
 * It also answers a question the chips never did: how much of each topic have I
 * done, and how well? Those numbers come from `question_attempts`, which the
 * grading action has been writing all along; until now nothing displayed them.
 *
 * ## Why this one is a client component
 *
 * Everything else in the question bank is plain links over query params —
 * server-rendered, no client state to desync. That works when a click means
 * "show me this filter". Here a click means "add this to the set I am
 * assembling", and ticking six subtopics would be six round trips before
 * anything started. So the selection lives here until Start is pressed, and the
 * URL is built once at that point. The counts it renders are all server data,
 * passed down and never refetched.
 *
 * ## Canonical URLs
 *
 * A fully-ticked domain is emitted as `domain=algebra`, not as its eight
 * subtopic slugs. Both mean the same set to `resolveSetSelection`; the short
 * form is the one a person can read, and it keeps a wide selection from
 * producing an address bar full of slugs.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ctaClassName } from "@/components/CtaButton";
import type { CoverageCount, SubtopicProgress } from "@/lib/learn/data";
import { buildSetHref } from "@/lib/learn/question-sets";
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  type Difficulty,
  type Domain,
} from "@/lib/learn/types";

type TopicPickerProps = {
  domains: Domain[];
  progress: SubtopicProgress[];
  /** Parsed from the URL, so a deep link arrives with its topics ticked. */
  initialSubtopicSlugs: string[];
  initialDifficulties: Difficulty[];
  initialShuffle: boolean;
};

export function TopicPicker({
  domains,
  progress,
  initialSubtopicSlugs,
  initialDifficulties,
  initialShuffle,
}: TopicPickerProps) {
  const router = useRouter();

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSubtopicSlugs),
  );
  const [difficulties, setDifficulties] = useState<Set<Difficulty>>(
    () => new Set(initialDifficulties),
  );
  const [shuffle, setShuffle] = useState(initialShuffle);
  const [starting, setStarting] = useState(false);

  /** Subtopics grouped under their domain, in the tables' display order. */
  const groups = useMemo(
    () =>
      domains
        .map((domain) => ({
          domain,
          rows: progress.filter(
            (entry) => entry.subtopic.domainId === domain.id,
          ),
        }))
        .filter((group) => group.rows.length > 0),
    [domains, progress],
  );

  /**
   * Counts for a row under the active difficulty filter.
   *
   * No difficulty selected means all of them, which is the row's own totals.
   */
  const countsFor = useMemo(() => {
    return (entry: SubtopicProgress): CoverageCount => {
      if (difficulties.size === 0) {
        return { total: entry.total, answered: entry.answered };
      }
      let total = 0;
      let answered = 0;
      for (const difficulty of difficulties) {
        total += entry.byDifficulty[difficulty].total;
        answered += entry.byDifficulty[difficulty].answered;
      }
      return { total, answered };
    };
  }, [difficulties]);

  const selectedRows = progress.filter((entry) =>
    selected.has(entry.subtopic.slug),
  );
  const selectedQuestionCount = selectedRows.reduce(
    (sum, entry) => sum + countsFor(entry).total,
    0,
  );
  const everythingCount = progress.reduce(
    (sum, entry) => sum + countsFor(entry).total,
    0,
  );

  function toggleSubtopic(slug: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleDomain(domainId: string, allSelected: boolean) {
    const slugs = progress
      .filter((entry) => entry.subtopic.domainId === domainId)
      .map((entry) => entry.subtopic.slug);

    setSelected((current) => {
      const next = new Set(current);
      for (const slug of slugs) {
        if (allSelected) next.delete(slug);
        else next.add(slug);
      }
      return next;
    });
  }

  function toggleDifficulty(difficulty: Difficulty) {
    setDifficulties((current) => {
      const next = new Set(current);
      if (next.has(difficulty)) next.delete(difficulty);
      else next.add(difficulty);
      return next;
    });
  }

  /**
   * Collapses the ticked subtopics into the shortest equivalent selection: a
   * fully-ticked domain becomes the domain, and only the leftovers stay named.
   */
  function collapse(slugs: Set<string>) {
    const domainSlugs: string[] = [];
    const covered = new Set<string>();

    for (const group of groups) {
      const groupSlugs = group.rows.map((entry) => entry.subtopic.slug);
      if (groupSlugs.length > 0 && groupSlugs.every((slug) => slugs.has(slug))) {
        domainSlugs.push(group.domain.slug);
        for (const slug of groupSlugs) covered.add(slug);
      }
    }

    return {
      domainSlugs,
      subtopicSlugs: [...slugs].filter((slug) => !covered.has(slug)),
      difficulties: [...difficulties],
    };
  }

  function start(slugs: Set<string>) {
    setStarting(true);
    router.push(
      buildSetHref("/questions/practice", collapse(slugs), { shuffle }),
    );
  }

  const nothingSelected = selected.size === 0;

  return (
    <div className="pb-24">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
          Question bank
        </h1>
        <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
          Pick as many topics as you like — a whole domain, or three subtopics
          across two of them. Every question you choose is in the set; nothing
          cuts you off at ten.
        </p>
      </header>

      {/* Controls: difficulty is a filter over the set, order is how it's dealt. */}
      <section className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-muted">Difficulty</span>
          <Toggle
            active={difficulties.size === 0}
            onClick={() => setDifficulties(new Set())}
          >
            Any
          </Toggle>
          {DIFFICULTIES.map((difficulty) => (
            <Toggle
              key={difficulty}
              active={difficulties.has(difficulty)}
              onClick={() => toggleDifficulty(difficulty)}
            >
              {DIFFICULTY_LABELS[difficulty]}
            </Toggle>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-muted">Order</span>
          <Toggle active={!shuffle} onClick={() => setShuffle(false)}>
            Smart
          </Toggle>
          <Toggle active={shuffle} onClick={() => setShuffle(true)}>
            Shuffle
          </Toggle>
        </div>
      </section>

      <p className="mt-2 text-sm text-muted">
        {shuffle
          ? "Shuffle deals the whole selection in random order."
          : "Smart order puts questions you haven't seen first, then the ones you saw longest ago."}
      </p>

      {/* The zero-decision path: everything, right now. */}
      <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-hairline bg-surface p-5">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Practice everything
          </h2>
          <p className="mt-1 text-[0.9375rem] text-muted">
            {everythingCount.toLocaleString()}{" "}
            {everythingCount === 1 ? "question" : "questions"} across{" "}
            {progress.length} topics.
          </p>
        </div>
        <button
          type="button"
          disabled={starting || everythingCount === 0}
          onClick={() => start(new Set())}
          className={ctaClassName("secondary")}
        >
          Start practice
        </button>
      </section>

      {/* The topic table. */}
      <section className="mt-8">
        <div className="flex items-center gap-4 border-b border-hairline pb-2 text-sm font-semibold text-muted">
          <span className="flex-1">Topic</span>
          <span className="w-40 text-right sm:w-56">Progress</span>
          <span className="w-16 text-right">Accuracy</span>
        </div>

        {groups.map((group) => {
          const groupSlugs = group.rows.map((entry) => entry.subtopic.slug);
          const allSelected = groupSlugs.every((slug) => selected.has(slug));

          return (
            <div key={group.domain.id} className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg font-bold text-ink">
                  {group.domain.name}
                </h3>
                <button
                  type="button"
                  onClick={() => toggleDomain(group.domain.id, allSelected)}
                  className="rounded-lg px-2 py-1 text-sm font-semibold text-accent transition-colors hover:bg-accent-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {allSelected ? "Clear all" : "Select all"}
                </button>
              </div>

              <ul className="mt-2">
                {group.rows.map((entry) => {
                  const counts = countsFor(entry);
                  const isSelected = selected.has(entry.subtopic.slug);

                  return (
                    <li key={entry.subtopic.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-4 rounded-xl px-2 py-2.5 transition-colors ${
                          isSelected ? "bg-accent-chip" : "hover:bg-surface"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSubtopic(entry.subtopic.slug)}
                          className="h-4 w-4 shrink-0 accent-accent"
                        />
                        <span className="flex-1 text-[0.9375rem] text-ink">
                          {entry.subtopic.name}
                        </span>

                        <span className="flex w-40 items-center justify-end gap-2 sm:w-56">
                          <ProgressBar
                            answered={counts.answered}
                            total={counts.total}
                          />
                          <span className="w-16 text-right text-sm tabular-nums text-muted">
                            {counts.answered}/{counts.total}
                          </span>
                        </span>

                        <span className="w-16 text-right text-sm font-semibold tabular-nums">
                          {entry.accuracy === null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <span className={accuracyTone(entry.accuracy)}>
                              {entry.accuracy}%
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      {/* Stays in reach however far down the list you have scrolled. */}
      {!nothingSelected && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="text-[0.9375rem] text-muted">
              <strong className="text-ink">
                {selected.size} {selected.size === 1 ? "topic" : "topics"}
              </strong>{" "}
              · {selectedQuestionCount.toLocaleString()}{" "}
              {selectedQuestionCount === 1 ? "question" : "questions"}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={starting || selectedQuestionCount === 0}
                onClick={() => start(selected)}
                className={ctaClassName("primary")}
              >
                {starting ? "Starting…" : "Start practice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({
  answered,
  total,
}: {
  answered: number;
  total: number;
}) {
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
  return (
    <span
      role="progressbar"
      aria-valuenow={answered}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${answered} of ${total} answered`}
      className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-hairline sm:block"
    >
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

/** Green when solid, amber when shaky, red when it needs work. */
function accuracyTone(accuracy: number): string {
  if (accuracy >= 80) return "text-accent";
  if (accuracy >= 60) return "text-insight-dark";
  return "text-miss-ink";
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? "border-transparent bg-accent text-surface"
          : "border-hairline bg-surface text-muted hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
