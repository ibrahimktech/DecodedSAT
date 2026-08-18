/**
 * Shared shapes for the learning surface.
 *
 * Imported by both Server Components and client components (the question
 * player, the test runner), so this module must stay free of server-only
 * imports — types, constants and pure helpers only.
 */

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export type Domain = {
  id: string;
  slug: string;
  name: string;
};

export type Subtopic = {
  id: string;
  domainId: string;
  slug: string;
  name: string;
};

/**
 * A question as the client is allowed to see it: no `correct_choice`, no
 * `explanation`. Those exist server-side behind a column grant and are only
 * released by the grading RPC after an answer is recorded.
 */
export type PlayableQuestion = {
  id: string;
  prompt: string;
  choices: string[];
  difficulty: Difficulty;
  subtopicName: string;
  /** For the "watch the explainer" callout after a miss. */
  subtopicSlug: string;
  subtopicHasVideo: boolean;
};

/** What the grading action returns to the question player. */
export type QuestionVerdict =
  | {
      status: "ok";
      isCorrect: boolean;
      correctChoice: number;
      explanation: string;
    }
  | { status: "error"; message: string }
  | { status: "rate_limited"; message: string };

/** A question inside a timed run — even the difficulty stays hidden. */
export type PracticeQuestion = {
  id: string;
  prompt: string;
  choices: string[];
};

/** Failure result from the practice submit action (success redirects). */
export type PracticeSubmitFailure = {
  status: "error" | "rate_limited";
  message: string;
};

export const CHOICE_LETTERS = ["A", "B", "C", "D"] as const;

/** `615` → `"10:15"`. Used by the timer and the results summary. */
export function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
