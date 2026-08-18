"use server";

/**
 * Actions for timed practice sections.
 *
 * Both are thin shells around the database functions that own the rules:
 * `start_practice_attempt` opens (or resumes) a run, and
 * `submit_practice_attempt` grades one. Score, per-question verdicts and
 * elapsed time are computed inside the database from its own clock and answer
 * key — the client's timer is presentation only, and nothing numeric a client
 * sends survives into a stored result.
 */

import { redirect } from "next/navigation";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import {
  StartPracticeSchema,
  SubmitPracticeSchema,
} from "@/lib/learn/schemas";
import type { PracticeSubmitFailure } from "@/lib/learn/types";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Keyed on user id. Ten section starts in ten minutes is already unhuman. */
const startLimiter = createRateLimiter({
  limit: 10,
  windowMs: 10 * 60_000,
  prefix: "practice-start",
});

const submitLimiter = createRateLimiter({
  limit: 10,
  windowMs: 10 * 60_000,
  prefix: "practice-submit",
});

/**
 * Posted by the plain "Start" forms on the practice pages. Ends in a redirect
 * either way: into the run on success, back to the list with a flag on
 * failure (a full-page form post has no channel for a returned message).
 */
export async function startPracticeAttemptAction(
  formData: FormData,
): Promise<void> {
  let destination = "/practice?error=1";

  try {
    const parsed = StartPracticeSchema.safeParse({
      sectionId: formData.get("sectionId"),
    });

    if (parsed.success) {
      const supabase = await createSupabaseServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const rate = await startLimiter.check(user.id);
        if (rate.ok) {
          const { error } = await supabase.rpc("start_practice_attempt", {
            p_section_id: parsed.data.sectionId,
          });

          if (error) {
            console.error(
              `[learn] start_practice_attempt failed: ${error.code ?? "no_code"} — ${error.message}`,
            );
          } else {
            destination = `/practice/${parsed.data.sectionId}`;
          }
        }
      }
    }
  } catch (error) {
    console.error(`[learn] start_practice_attempt threw: ${describeError(error)}`);
  }

  // Outside the try block: `redirect` signals by throwing.
  redirect(destination);
}

/**
 * Called by the test runner with the collected answers. On success the
 * database has already written the graded result, and this redirects into the
 * results page — which re-reads everything from the database, so a refresh
 * there costs nothing. On failure it returns a message for the runner to show
 * in place, leaving the run resumable.
 */
export async function submitPracticeAttemptAction(
  input: unknown,
): Promise<PracticeSubmitFailure | undefined> {
  const failed: PracticeSubmitFailure = {
    status: "error",
    message: GENERIC_ERROR_MESSAGE,
  };

  let resultsPath: string | null = null;

  try {
    const parsed = SubmitPracticeSchema.safeParse(input);
    if (!parsed.success) return failed;

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return failed;

    const rate = await submitLimiter.check(user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const { error } = await supabase.rpc("submit_practice_attempt", {
      p_attempt_id: parsed.data.attemptId,
      p_answers: parsed.data.answers,
    });

    if (error) {
      console.error(
        `[learn] submit_practice_attempt failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      // The one failure worth naming: the run's clock (plus grace) had
      // already expired server-side. Telling the person their own timer ran
      // out reveals nothing about anyone else.
      if (error.message.includes("attempt_expired")) {
        return {
          status: "error",
          message:
            "Time ran out before this reached us, so the run wasn't scored. Start the section again when you're ready.",
        };
      }
      return failed;
    }

    resultsPath = `/practice/results/${parsed.data.attemptId}`;
  } catch (error) {
    console.error(`[learn] submit_practice_attempt threw: ${describeError(error)}`);
    return failed;
  }

  redirect(resultsPath);
}
