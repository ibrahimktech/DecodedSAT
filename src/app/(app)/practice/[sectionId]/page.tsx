import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TestRunner } from "@/components/app/TestRunner";
import { ctaClassName } from "@/components/CtaButton";
import { requireUser } from "@/lib/auth/require-user";
import {
  getActivePracticeAttempt,
  getSection,
  getSectionQuestions,
} from "@/lib/learn/data";
import { startPracticeAttemptAction } from "../actions";

export const metadata: Metadata = {
  title: "Practice section",
};

/**
 * One section's run page, in two states resolved server-side:
 *
 * - An unfinished, unexpired attempt exists → render the runner against that
 *   attempt's real deadline. Reaching this URL again mid-run (tab closed,
 *   Resume from the dashboard) picks the same attempt back up.
 * - Otherwise → a start panel. Starting posts to the action, which opens the
 *   attempt row (the server-side clock) and lands back here in state one.
 *
 * The questions handed to the runner carry no answer key — the grading
 * columns aren't readable on this connection at all.
 */
export default async function PracticeSectionPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { supabase, user } = await requireUser();

  const { sectionId } = await params;
  if (!z.uuid().safeParse(sectionId).success) notFound();

  const section = await getSection(supabase, sectionId);
  if (!section) notFound();

  const active = await getActivePracticeAttempt(
    supabase,
    user.id,
    section.id,
    section.timeLimitSeconds,
  );

  if (active) {
    const questions = await getSectionQuestions(supabase, section.id);

    return (
      <div className="mx-auto max-w-3xl">
        <TestRunner
          key={active.attemptId}
          attemptId={active.attemptId}
          sectionTitle={section.title}
          deadlineMs={active.deadlineMs}
          questions={questions}
        />
      </div>
    );
  }

  const minutes = Math.round(section.timeLimitSeconds / 60);

  return (
    <div className="mx-auto max-w-2xl">
      <article className="rounded-2xl border border-hairline bg-surface p-8">
        <p className="text-xs font-semibold">
          <span className="rounded-lg bg-accent-chip px-2.5 py-1 text-accent">
            {section.domainName}
          </span>
        </p>
        <h1 className="mt-3 font-display text-3xl font-extrabold text-ink">
          {section.title}
        </h1>
        {section.description && (
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
            {section.description}
          </p>
        )}

        <ul className="mt-5 flex flex-col gap-1.5 text-[0.9375rem] text-muted">
          <li>
            <strong className="text-ink">{minutes} minutes</strong> on the
            clock — it starts the moment you begin.
          </li>
          <li>
            Move freely between questions; submit when you&apos;re done or let
            the timer submit for you.
          </li>
          <li>Your score and time are saved to your history.</li>
        </ul>

        <form action={startPracticeAttemptAction} className="mt-6">
          <input type="hidden" name="sectionId" value={section.id} />
          <button type="submit" className={ctaClassName("primary")}>
            Start the clock
          </button>
        </form>
      </article>
    </div>
  );
}
