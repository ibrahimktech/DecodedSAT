"use server";

/**
 * Server Actions for taking a practice test.
 *
 * Every one of these is a thin pass-through to a SECURITY DEFINER function
 * that re-derives the caller from `auth.uid()`, re-checks which module is
 * live against the attempt's own timestamps, and recomputes correctness
 * against an answer key this connection cannot read. Nothing numeric the
 * client sends is stored, and no action here can be talked into scoring an
 * attempt the caller does not own.
 *
 * The client sends: an attempt id, a question id, a choice index. That is the
 * whole vocabulary.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import {
  SavePracticeTestResponseSchema,
  StartPracticeTestSchema,
  TestAttemptSchema,
} from "@/lib/learn/schemas";
import type {
  StartTestResult,
  TestActionResult,
  TestSubmitResult,
} from "@/lib/learn/types";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Autosave fires on every answer selection, and a student changing their mind
 * three times on one question is normal. 22 questions in 35 minutes with room
 * to revise every one of them several times sits well under this; a script
 * hammering the endpoint does not.
 */
const saveLimiter = createRateLimiter({
  limit: 180,
  windowMs: 60_000,
  prefix: "test-save",
});

/** Starting, advancing and submitting are once-per-module operations. */
const controlLimiter = createRateLimiter({
  limit: 20,
  windowMs: 60_000,
  prefix: "test-control",
});

type Session = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function authenticated(): Promise<{
  supabase: Session;
  userId: string;
} | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, userId: user.id };
}

export async function startPracticeTestAction(
  input: unknown,
): Promise<StartTestResult> {
  try {
    const session = await authenticated();
    if (!session) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const rate = await controlLimiter.check(session.userId);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = StartPracticeTestSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    // Resumes an unfinished attempt rather than stacking a second one, and
    // sweeps anything stale first — so "resume" can never revive a test whose
    // clock ran out days ago.
    const { data, error } = await session.supabase.rpc(
      "start_practice_test_attempt",
      { p_test_id: parsed.data.testId },
    );

    if (error) {
      console.error(
        `[tests] start_practice_test_attempt failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }
    if (typeof data !== "string") {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    return { status: "ok", attemptId: data };
  } catch (error) {
    console.error(`[tests] start threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/**
 * Autosave one answer.
 *
 * This is what makes the abandonment handling safe (spec section 6): an
 * answer is durable the moment it is clicked, so nothing depends on an unload
 * event completing, or on the student pressing Submit at all.
 *
 * A failure returns `error` and the runner shows an unsaved marker on that
 * question rather than pretending it landed. It does not block moving on —
 * losing one answer is bad, freezing a timed test is worse.
 */
export async function savePracticeTestResponseAction(
  input: unknown,
): Promise<TestActionResult> {
  try {
    const session = await authenticated();
    if (!session) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const rate = await saveLimiter.check(session.userId);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = SavePracticeTestResponseSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const { error } = await session.supabase.rpc(
      "save_practice_test_response",
      {
        p_attempt_id: parsed.data.attemptId,
        p_question_id: parsed.data.questionId,
        p_choice: parsed.data.choice,
      },
    );

    if (error) {
      console.error(
        `[tests] save_practice_test_response failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    return { status: "ok" };
  } catch (error) {
    console.error(`[tests] save threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/**
 * End the live module — the Submit button and the timer hitting 0:00 both
 * call this, because which one fired is not something the server needs to
 * trust the client about.
 *
 * Returns what happens next: the interstitial (module 1 of a full test) or
 * completion (everything else). The database decides; the client renders.
 */
export async function submitPracticeTestModuleAction(
  input: unknown,
): Promise<TestSubmitResult> {
  try {
    const session = await authenticated();
    if (!session) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const rate = await controlLimiter.check(session.userId);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = TestAttemptSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const { data, error } = await session.supabase.rpc(
      "submit_practice_test_module",
      { p_attempt_id: parsed.data.attemptId },
    );

    if (error) {
      console.error(
        `[tests] submit_practice_test_module failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    revalidatePath("/practice");
    revalidatePath("/progress");

    return {
      status: "ok",
      next: data === "interstitial" ? "interstitial" : "completed",
    };
  } catch (error) {
    console.error(`[tests] submit threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/**
 * Start module 2 from the interstitial. The second clock begins here and
 * nowhere else — that is the entire point of the Continue screen.
 *
 * Idempotent on the database side, so a double-clicked Continue does not
 * reset the clock the student is already racing.
 */
export async function startModuleTwoAction(
  input: unknown,
): Promise<TestActionResult> {
  try {
    const session = await authenticated();
    if (!session) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const rate = await controlLimiter.check(session.userId);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = TestAttemptSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const { error } = await session.supabase.rpc(
      "start_practice_test_module_two",
      { p_attempt_id: parsed.data.attemptId },
    );

    if (error) {
      // `interstitial_expired` is the one failure worth naming: the student
      // sat on the Continue screen past the grace window, the attempt was
      // auto-submitted, and telling them so beats a generic error.
      if (error.message?.includes("interstitial_expired")) {
        return {
          status: "error",
          message:
            "This test was left too long between modules, so it was submitted automatically. Your module 1 answers were scored.",
        };
      }
      console.error(
        `[tests] start_practice_test_module_two failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    return { status: "ok" };
  } catch (error) {
    console.error(`[tests] module two threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

/**
 * Posted by the plain "Start"/"Resume" form on a test's start screen.
 *
 * A form post rather than a click handler so the flow works before hydration
 * — the same reason `startPracticeAttemptAction` is shaped this way. It ends
 * in a redirect either way: into the runner on success, back to the start
 * screen with a flag on failure, since a full-page post has no channel for a
 * returned message.
 */
export async function beginPracticeTestAction(
  formData: FormData,
): Promise<void> {
  const rawId = formData.get("testId");
  const testId = typeof rawId === "string" ? rawId : "";

  let destination = `/practice?error=1`;

  try {
    const result = await startPracticeTestAction({ testId });
    if (result.status === "ok") {
      destination = `/practice/tests/${testId}/take`;
    } else {
      destination = `/practice/tests/${encodeURIComponent(testId)}?error=1`;
    }
  } catch (error) {
    console.error(`[tests] begin threw: ${describeError(error)}`);
  }

  // Outside the try block: `redirect` signals by throwing.
  redirect(destination);
}
