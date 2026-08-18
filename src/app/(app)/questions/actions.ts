"use server";

/**
 * Grading action for the question bank.
 *
 * The client sends nothing but a question id and a choice index. The verdict,
 * the correct answer and the explanation all come back from the database's
 * `submit_question_attempt` function, which recomputes correctness against
 * the real answer key and records the attempt in the same transaction. The
 * answer key itself is unreadable by this connection (column grant), so there
 * is no code path — here or anywhere — that could leak it before an answer is
 * committed.
 */

import { describeError } from "@/lib/auth/describe-error";
import { GENERIC_ERROR_MESSAGE, rateLimitedMessage } from "@/lib/auth/state";
import { SubmitQuestionSchema } from "@/lib/learn/schemas";
import type { QuestionVerdict } from "@/lib/learn/types";
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
    }> | null)?.[0];
    if (!verdict) return failed;

    return {
      status: "ok",
      isCorrect: verdict.is_correct,
      correctChoice: verdict.correct_choice,
      explanation: verdict.explanation,
    };
  } catch (error) {
    console.error(`[learn] submit_question_attempt threw: ${describeError(error)}`);
    return failed;
  }
}
