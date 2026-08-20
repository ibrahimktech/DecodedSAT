import type { Metadata } from "next";
import Link from "next/link";
import { QuestionPlayer } from "@/components/app/QuestionPlayer";
import { CtaButton } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import {
  finalizeOpenQuestionBankSessions,
  getDomainMastery,
  getQuestionBatch,
  getSubtopics,
  suggestFocusDomain,
} from "@/lib/learn/data";
import { QuestionFiltersSchema, type QuestionFilters } from "@/lib/learn/schemas";
import { DIFFICULTIES, DIFFICULTY_LABELS } from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Question bank",
};

/**
 * Topic-filtered practice, one question at a time.
 *
 * Filtering is plain links over query params — server-rendered, no client
 * state to desync. `?start=1` switches from the picker to the player, whose
 * batch is chosen server-side (never-attempted questions first). Invalid
 * filter values are dropped by the schema, not echoed or "fixed".
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await requireUser();

  const params = await searchParams;
  const filters = QuestionFiltersSchema.parse({
    domain: typeof params.domain === "string" ? params.domain : undefined,
    subtopic: typeof params.subtopic === "string" ? params.subtopic : undefined,
    difficulty:
      typeof params.difficulty === "string" ? params.difficulty : undefined,
  });
  const started = params.start === "1";

  const [subtopics, mastery] = await Promise.all([
    getSubtopics(supabase),
    getDomainMastery(supabase),
  ]);
  const domains = mastery.map((entry) => entry.domain);

  // A subtopic deep-link implies its domain; a domain switch drops a subtopic
  // that no longer belongs. Resolved once here so every chip link agrees.
  const activeSubtopic = subtopics.find(
    (subtopic) => subtopic.slug === filters.subtopic,
  );
  const activeDomain = activeSubtopic
    ? domains.find((domain) => domain.id === activeSubtopic.domainId)
    : domains.find((domain) => domain.slug === filters.domain);

  const resolved: QuestionFilters = {
    domain: activeDomain?.slug,
    subtopic: activeSubtopic?.slug,
    difficulty: filters.difficulty,
  };

  const focus = suggestFocusDomain(mastery);

  if (started) {
    const batch = await getQuestionBatch(supabase, user.id, resolved);
    const pickerHref = buildHref(resolved);

    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader />
        <p className="mt-6 flex flex-wrap items-center gap-2 text-[0.9375rem] text-muted">
          <span>
            Practicing:{" "}
            <strong className="text-ink">
              {activeSubtopic?.name ?? activeDomain?.name ?? "All domains"}
            </strong>
            {resolved.difficulty
              ? ` · ${DIFFICULTY_LABELS[resolved.difficulty]}`
              : ""}
          </span>
          <Link
            href={pickerHref}
            className="font-semibold text-accent transition-colors hover:text-accent-hover"
          >
            Change filters
          </Link>
        </p>

        <div className="mt-4">
          {batch.length === 0 ? (
            <p className="rounded-2xl border border-hairline bg-surface p-8 text-center text-[0.9375rem] text-muted">
              No questions match these filters yet.{" "}
              <Link
                href={pickerHref}
                className="font-semibold text-accent transition-colors hover:text-accent-hover"
              >
                Loosen them
              </Link>{" "}
              and try again.
            </p>
          ) : (
            // Keyed on the batch so "Practice more" (router.refresh) remounts
            // the player when the server hands back a different set.
            <QuestionPlayer
              key={batch.map((question) => question.id).join(":")}
              questions={batch}
              changeFiltersHref={pickerHref}
            />
          )}
        </div>
      </div>
    );
  }

  // The picker, not the player. Reaching it means any sitting that was open is
  // genuinely over — including one whose tab was closed without finishing — so
  // this is where dangling sessions get rolled up. Doing it in the player's
  // branch instead would close the session the student is currently in.
  await finalizeOpenQuestionBankSessions(supabase);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader />

      {/* Adaptive suggestion — deliberately simple: lowest mastery first. */}
      {focus && (
        <section className="mt-6 rounded-2xl border border-insight-hairline bg-insight-surface p-5">
          <h2 className="font-display text-lg font-bold text-ink">
            Recommended for you
          </h2>
          <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted">
            {focus.accuracy !== null ? (
              <>
                <strong className="text-ink">{focus.domain.name}</strong> is
                your lowest mastery right now ({focus.accuracy}% over recent
                attempts) — start there.
              </>
            ) : (
              <>
                You haven&apos;t tried{" "}
                <strong className="text-ink">{focus.domain.name}</strong> yet —
                start there.
              </>
            )}
          </p>
          <div className="mt-3">
            <CtaButton
              href={buildHref({ domain: focus.domain.slug }, true)}
              variant="secondary"
            >
              Practice {focus.domain.name}
            </CtaButton>
          </div>
        </section>
      )}

      {/* Filter picker: three rows of chips, all plain links. */}
      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-6">
        <h2 className="text-[0.9375rem] font-semibold text-muted">Domain</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip
            href={buildHref({ difficulty: resolved.difficulty })}
            active={!activeDomain}
          >
            All domains
          </Chip>
          {domains.map((domain) => (
            <Chip
              key={domain.id}
              href={buildHref({
                domain: domain.slug,
                difficulty: resolved.difficulty,
              })}
              active={activeDomain?.id === domain.id}
            >
              {domain.name}
            </Chip>
          ))}
        </div>

        {activeDomain && (
          <>
            <h2 className="mt-5 text-[0.9375rem] font-semibold text-muted">
              Subtopic
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <Chip
                href={buildHref({
                  domain: activeDomain.slug,
                  difficulty: resolved.difficulty,
                })}
                active={!activeSubtopic}
              >
                All of {activeDomain.name}
              </Chip>
              {subtopics
                .filter((subtopic) => subtopic.domainId === activeDomain.id)
                .map((subtopic) => (
                  <Chip
                    key={subtopic.id}
                    href={buildHref({
                      domain: activeDomain.slug,
                      subtopic: subtopic.slug,
                      difficulty: resolved.difficulty,
                    })}
                    active={activeSubtopic?.id === subtopic.id}
                  >
                    {subtopic.name}
                  </Chip>
                ))}
            </div>
          </>
        )}

        <h2 className="mt-5 text-[0.9375rem] font-semibold text-muted">
          Difficulty
        </h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Chip
            href={buildHref({ ...resolved, difficulty: undefined })}
            active={!resolved.difficulty}
          >
            Any
          </Chip>
          {DIFFICULTIES.map((difficulty) => (
            <Chip
              key={difficulty}
              href={buildHref({ ...resolved, difficulty })}
              active={resolved.difficulty === difficulty}
            >
              {DIFFICULTY_LABELS[difficulty]}
            </Chip>
          ))}
        </div>

        <div className="mt-6">
          <CtaButton href={buildHref(resolved, true)}>
            Start practicing
          </CtaButton>
        </div>
      </section>
    </div>
  );
}

function PageHeader() {
  return (
    <header>
      <h1 className="font-display text-3xl font-extrabold text-ink sm:text-4xl">
        Question bank
      </h1>
      <p className="mt-2 max-w-2xl text-[0.9375rem] leading-relaxed text-muted">
        Pick a topic and difficulty, answer one question at a time, and see the
        explanation the moment you submit.
      </p>
    </header>
  );
}

function buildHref(filters: QuestionFilters, start = false): string {
  const params = new URLSearchParams();
  if (filters.subtopic) params.set("subtopic", filters.subtopic);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (start) params.set("start", "1");
  const query = params.toString();
  return query ? `/questions?${query}` : "/questions";
}

function Chip({
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
      className={`rounded-xl border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? "border-transparent bg-accent text-surface"
          : "border-hairline bg-surface text-muted hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </Link>
  );
}
