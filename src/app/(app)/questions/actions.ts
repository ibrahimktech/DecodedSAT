"use server";

/**
 * Grading and session actions for the question bank.
 *
 * The client sends nothing but a question id, a choice index and the id of the
 * sitting it belongs to. The verdict, the correct answer and the explanation
 * all come back from the database's `submit_question_attempt` function, which
 * recomputes correctness against the real answer key and records the attempt
 * in the same transaction. The answer key itself is unreadable by this
 * connection (column grant), so there is no code path — here or anywhere —
 * that could leak it before an answer is committed.
 *
 * The session functions are equally thin: they name a session, and the
 * database decides whether the caller owns it. Every rollup count on the
 * session row is recomputed from the linked attempts on close, so nothing the
 * client sends can inflate a Progress entry.
 */

import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import { getQuestionsByIds } from "@/lib/learn/data";
import {
  CloseSessionSchema,
  LoadQuestionsSchema,
  SubmitQuestionSchema,
} from "@/lib/learn/schemas";
import type { PlayableQuestion, QuestionVerdict } from "@/lib/learn/types";
import { createRateLimiter } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Keyed on user id, not IP (CLAUDE.md: by user once auth exists). 40/minute
 * is far beyond any human answering pace — this exists to stop scripted
 * attempt-flooding, not to slow a person down.
 */
const submitLimiter = createRateLimiter({
  limit: 40,
  windowMs: 60_000,
  prefix: "question-submit",
});

/**
 * Session open/close is cheap but not free, and a loop that remounts the
 * player would call it repeatedly. Generous enough that a student switching
 * filters a dozen times never notices.
 */
const sessionLimiter = createRateLimiter({
  limit: 30,
  windowMs: 60_000,
  prefix: "question-session",
});

/**
 * Window loads.
 *
 * A set is now the whole filtered slice of the bank, paged in twenty-five
 * questions at a time as the student navigates. Someone jumping around the
 * navigator can pull several windows in quick succession, so this is loose
 * enough to feel instant and still bounded: 60 windows a minute is 1,500
 * questions, well past anything a person reads.
 */
const windowLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  prefix: "question-window",
});

export type LoadQuestionsResult =
  | { status: "ok"; questions: PlayableQuestion[] }
  | { status: "error" | "rate_limited"; message: string };

/**
 * Fetches full content for one window of a set.
 *
 * The ids come from an index this server built for this caller, so the
 * interesting question is not whether they are trustworthy but whether they are
 * well-formed and bounded — which the schema settles. Everything past that is
 * already enforced underneath: RLS scopes the read, and `correct_choice` and
 * `explanation` are unreadable on this connection, so a forged id buys a
 * prompt at most and an answer key never.
 */
export async function loadQuestionsAction(
  input: unknown,
): Promise<LoadQuestionsResult> {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "error", message: GENERIC_ERROR_MESSAGE };

    const rate = await windowLimiter.check(user.id);
    if (!rate.ok) {
      return {
        status: "rate_limited",
        message: rateLimitedMessage(rate.retryAfterSeconds),
      };
    }

    const parsed = LoadQuestionsSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "error", message: GENERIC_ERROR_MESSAGE };
    }

    const questions = await getQuestionsByIds(
      supabase,
      user.id,
      parsed.data.questionIds,
    );

    return { status: "ok", questions };
  } catch (error) {
    console.error(`[questions] window load threw: ${describeError(error)}`);
    return { status: "error", message: GENERIC_ERROR_MESSAGE };
  }
}

export async function submitQuestionAttemptAction(
  input: unknown,
): Promise<QuestionVerdict> {
  const failed: QuestionVerdict = {
    status: "error",
    message: GENERIC_ERROR_MESSAGE,
  };

  try {
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

    const parsed = SubmitQuestionSchema.safeParse(input);
    if (!parsed.success) return failed;

    const { data, error } = await supabase.rpc("submit_question_attempt", {
      p_question_id: parsed.data.questionId,
      p_choice: parsed.data.choice,
      p_session_id: parsed.data.sessionId,
    });

    if (error) {
      console.error(
        `[learn] submit_question_attempt failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return failed;
    }

    const verdict = (data as Array<{
      is_correct: boolean;
      correct_choice: number;
      explanation: string;
      solution_video_id: string | null;
      solution_video_title: string | null;
    }> | null)?.[0];
    if (!verdict) return failed;

    return {
      status: "ok",
      isCorrect: verdict.is_correct,
      correctChoice: verdict.correct_choice,
      explanation: verdict.explanation,
      solutionVideo:
        typeof verdict.solution_video_id === "string" &&
        typeof verdict.solution_video_title === "string"
          ? {
              id: verdict.solution_video_id,
              title: verdict.solution_video_title,
            }
          : null,
    };
  } catch (error) {
    console.error(`[learn] submit_question_attempt threw: ${describeError(error)}`);
    return failed;
  }
}

/**
 * Opens a question bank sitting and returns its id.
 *
 * Called by the player on mount, not by the page on render. That distinction
 * matters: `/questions/practice` is a prefetch target, and a session created by
 * a link hover would show up on Progress as a sitting that never happened.
 *
 * Returns null on any failure. The player treats that as "practice without a
 * session" and carries on — losing the grouping is a reporting inconvenience,
 * while blocking practice over it would be a bug.
 */
export async function startQuestionBankSessionAction(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const rate = await sessionLimiter.check(user.id);
    if (!rate.ok) return null;

    const { data, error } = await supabase.rpc("start_question_bank_session");

    if (error) {
      console.error(
        `[learn] start_question_bank_session failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
      return null;
    }

    return typeof data === "string" ? data : null;
  } catch (error) {
    console.error(
      `[learn] start_question_bank_session threw: ${describeError(error)}`,
    );
    return null;
  }
}

/**
 * Ends the caller's open sitting the way an abandoned one is ended.
 *
 * Called by the player when it has sat untouched past the idle limit. It is
 * deliberately NOT `close_question_bank_session`: that one stamps `now()` as
 * the end, which for an idle timeout would bank the whole time the tab spent
 * unattended as study time — the very thing the timeout exists to prevent.
 * `finalize_open_question_bank_sessions()` ends the session at its last
 * recorded attempt instead, and deletes it outright if nothing was answered.
 *
 * Takes no input for the same reason it needs no schema: the database picks
 * the rows from `auth.uid()`, so there is nothing a caller could name.
 */
export async function finalizeQuestionBankSessionsAction(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const rate = await sessionLimiter.check(user.id);
    if (!rate.ok) return;

    const { error } = await supabase.rpc(
      "finalize_open_question_bank_sessions",
    );

    if (error) {
      console.error(
        `[learn] finalize_open_question_bank_sessions failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
    }
  } catch (error) {
    console.error(
      `[learn] finalize_open_question_bank_sessions threw: ${describeError(error)}`,
    );
  }
}

/**
 * Closes a sitting when the student finishes the set or leaves the player.
 *
 * Best-effort by design, and never awaited on a path the student is waiting
 * for. If it does not land — the tab was killed, the network dropped — the
 * database closes the session the next time the student loads any page that
 * is not the player. See `finalize_open_question_bank_sessions()`.
 */
export async function closeQuestionBankSessionAction(
  input: unknown,
): Promise<void> {
  try {
    const parsed = CloseSessionSchema.safeParse(input);
    if (!parsed.success) return;

    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const rate = await sessionLimiter.check(user.id);
    if (!rate.ok) return;

    const { error } = await supabase.rpc("close_question_bank_session", {
      p_session_id: parsed.data.sessionId,
    });

    if (error) {
      console.error(
        `[learn] close_question_bank_session failed: ${error.code ?? "no_code"} — ${error.message}`,
      );
    }
  } catch (error) {
    console.error(
      `[learn] close_question_bank_session threw: ${describeError(error)}`,
    );
  }
}
