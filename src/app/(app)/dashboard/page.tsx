import type { Metadata } from "next";
import Link from "next/link";
import { CtaButton } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import {
  getContinueTarget,
  getCurrentStreak,
  getDomainMastery,
  getProfile,
  getTodayAttemptCount,
  getUserStats,
  suggestFocusDomain,
} from "@/lib/learn/data";
import { formatSeconds } from "@/lib/learn/types";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Overview page. Every number on it is computed server-side from the activity
 * tables at request time — streak from activity dates, mastery from a rolling
 * last-50-attempts window per domain, today's goal from today's attempts.
 * Nothing here trusts a stored counter, so nothing here can drift.
 */
export default async function DashboardPage() {
  const { supabase, user } = await requireUser();

  const profile = await getProfile(supabase, user.id);

  // No profile row means the confirmation trigger has not fired for this
  // account — the "not a real user until verified" state from the migration.
  if (!profile) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center">
        <h1 className="font-display text-3xl font-extrabold text-ink">
          Almost there
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-muted">
          Your account is still being confirmed. Open the link in your
          confirmation email, then come back.
        </p>
      </div>
    );
  }

  const [stats, streak, todayCount, mastery, continueTarget] =
    await Promise.all([
      getUserStats(supabase, user.id),
      getCurrentStreak(supabase),
      getTodayAttemptCount(supabase, user.id),
      getDomainMastery(supabase),
      getContinueTarget(supabase, user.id),
    ]);

  const focus = suggestFocusDomain(mastery);
  const firstName = profile.fullName?.split(" ")[0] ?? null;
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const goalProgress = Math.min(
    100,
    Math.round((todayCount / stats.dailyGoal) * 100),
  );

  return (
    <div className="mx-auto max-w-5xl">
      {/* --- Greeting ------------------------------------------------------ */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[0.9375rem] text-muted">{today}</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold text-ink sm:text-4xl">
            {firstName ? `Hi, ${firstName}.` : "Welcome back."}
          </h1>
        </div>

        <p
          className="flex items-center gap-2 rounded-xl bg-insight-chip px-4 py-2 font-semibold text-insight-dark"
          title="Days in a row with at least one question or practice run"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M12 2c.7 3.2-.6 5-2.2 6.6C8 10.4 6 12.2 6 15a6 6 0 0 0 12 0c0-1.9-.8-3.4-1.8-4.8-.5.9-1.1 1.5-1.9 2C14.6 9.6 14.8 5.4 12 2z" />
          </svg>
          {streak === 1 ? "1-day streak" : `${streak}-day streak`}
        </p>
      </header>

      {/* --- Stat cards ---------------------------------------------------- */}
      <section
        aria-label="Your stats"
        className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <article className="rounded-2xl border border-hairline bg-surface p-6">
          <h2 className="text-[0.9375rem] font-semibold text-muted">
            Score estimate
          </h2>
          {stats.currentScoreEstimate !== null ? (
            <>
              <p className="mt-2 font-display text-5xl font-extrabold text-ink">
                {stats.currentScoreEstimate}
              </p>
              <p className="mt-1 text-sm text-muted">
                out of 800 · refined as you practice
              </p>
            </>
          ) : (
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
              No estimate yet — it appears once you&apos;ve done some practice.
            </p>
          )}
        </article>

        {/* Deliberately empty until onboarding ships: no fake number. */}
        <article className="rounded-2xl border border-dashed border-hairline p-6">
          <h2 className="text-[0.9375rem] font-semibold text-muted">
            Target score
          </h2>
          <p className="mt-2 font-display text-5xl font-extrabold text-hairline">
            —
          </p>
          <p className="mt-1 text-sm text-muted">
            You&apos;ll set a target during onboarding — coming soon.
          </p>
        </article>

        <article className="rounded-2xl border border-hairline bg-surface p-6 sm:col-span-2 lg:col-span-1">
          <h2 className="text-[0.9375rem] font-semibold text-muted">
            Today&apos;s goal
          </h2>
          <p className="mt-2 font-display text-5xl font-extrabold text-ink">
            {todayCount}
            <span className="text-2xl text-muted"> / {stats.dailyGoal}</span>
          </p>
          <div
            role="progressbar"
            aria-valuenow={todayCount}
            aria-valuemin={0}
            aria-valuemax={stats.dailyGoal}
            aria-label="Questions answered today"
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-background"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${goalProgress}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted">questions answered today</p>
        </article>
      </section>

      {/* --- Continue where you left off ----------------------------------- */}
      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">
          Continue where you left off
        </h2>

        {continueTarget?.kind === "practice" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="text-[0.9375rem] leading-relaxed text-muted">
              You have an unfinished run of{" "}
              <strong className="text-ink">{continueTarget.sectionTitle}</strong>{" "}
              with {formatSeconds(continueTarget.remainingSeconds)} left on the
              clock.
            </p>
            <CtaButton href={`/practice/${continueTarget.sectionId}`}>
              Resume
            </CtaButton>
          </div>
        ) : continueTarget?.kind === "subtopic" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="text-[0.9375rem] leading-relaxed text-muted">
              You were last working on{" "}
              <strong className="text-ink">{continueTarget.subtopicName}</strong>.
            </p>
            <CtaButton
              href={`/questions?subtopic=${continueTarget.subtopicSlug}&start=1`}
            >
              Keep practicing
            </CtaButton>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="text-[0.9375rem] leading-relaxed text-muted">
              Nothing in progress yet — pick a topic and answer your first
              questions.
            </p>
            <CtaButton href="/questions">Start practicing</CtaButton>
          </div>
        )}
      </section>

      {/* --- Domain mastery ------------------------------------------------ */}
      <section className="mt-6 rounded-2xl border border-hairline bg-surface p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl font-bold text-ink">
            Domain mastery
          </h2>
          <p className="text-sm text-muted">
            accuracy over your last 50 attempts per domain
          </p>
        </div>

        <ul className="mt-4 flex flex-col gap-4">
          {mastery.map((entry) => (
            <li key={entry.domain.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[0.9375rem] font-medium text-ink">
                  {entry.domain.name}
                </span>
                <span className="text-sm text-muted">
                  {entry.accuracy !== null
                    ? `${entry.accuracy}% · ${entry.attempts} attempt${entry.attempts === 1 ? "" : "s"}`
                    : "No attempts yet"}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${entry.accuracy ?? 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>

        {focus && (
          <p className="mt-5 rounded-xl bg-accent-chip px-4 py-3 text-[0.9375rem] text-ink">
            Focus next:{" "}
            <Link
              href={`/questions?domain=${focus.domain.slug}`}
              className="font-semibold text-accent transition-colors hover:text-accent-hover"
            >
              {focus.domain.name}
            </Link>
            {focus.accuracy !== null
              ? ` — your lowest mastery right now (${focus.accuracy}%).`
              : " — you haven't tried it yet."}
          </p>
        )}
      </section>
    </div>
  );
}
