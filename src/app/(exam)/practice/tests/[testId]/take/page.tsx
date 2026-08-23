import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { PracticeTestRunner } from "@/components/app/PracticeTestRunner";
import { requireUser } from "@/lib/auth/require-user";
import { finalizeStalePracticeTestAttempts } from "@/lib/learn/data";
import { getRunnerState } from "@/lib/learn/tests";

export const metadata: Metadata = {
  title: "Taking a practice test",
};

/**
 * The test itself.
 *
 * This page resolves WHICH attempt and which phase, then hands the runner a
 * finished description of what to render. The runner never works out whether
 * it is in module 1, module 2, or the interstitial — that answer comes from
 * the attempt's own server-side timestamps, here and again inside every write
 * function it calls.
 *
 * Landing here without an attempt bounces to the start screen rather than
 * silently opening one: starting a timed test is a decision, not a side effect
 * of a URL.
 */
export default async function TakePracticeTestPage({
  params,
}: {
  params: Promise<{ testId: string }>;
}) {
  const { supabase, user } = await requireUser();

  const { testId } = await params;
  const parsedId = z.uuid().safeParse(testId);
  if (!parsedId.success) notFound();

  // Runs first so a student who returns to this URL after their clock expired
  // gets a scored result rather than a live-looking module.
  await finalizeStalePracticeTestAttempts(supabase);

  const { data: attempt, error } = await supabase
    .from("practice_test_attempts")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("practice_test_id", parsedId.data)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      `[tests] take page attempt lookup failed: ${error.code ?? "no_code"} — ${error.message}`,
    );
    redirect(`/practice/tests/${parsedId.data}`);
  }

  if (!attempt) redirect(`/practice/tests/${parsedId.data}`);

  // Finished already — the sweep above, or another tab. The review is the
  // only useful destination.
  if (attempt.status !== "in_progress") {
    redirect(`/practice/tests/review/${attempt.id}`);
  }

  const state = await getRunnerState(supabase, attempt.id);
  if (!state) redirect(`/practice/tests/${parsedId.data}`);

  // Keyed on the phase and module so crossing either boundary REMOUNTS the
  // runner rather than reusing it. Without this, the "already ending" guard
  // that stops a double submit stays latched from module 1, and module 2's
  // timer hitting 0:00 would find it set and never submit.
  return (
    <PracticeTestRunner
      key={`${state.phase}-${state.moduleNumber}`}
      state={state}
    />
  );
}
