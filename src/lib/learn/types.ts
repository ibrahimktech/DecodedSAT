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
  /**
   * How this student did the last time they saw this question, or null if they
   * never have.
   *
   * Reading it tells you nothing you could not learn by answering — it is this
   * student's own history, not the answer key, and it says whether they were
   * right rather than what the right answer was. `correct_choice` remains
   * unreadable by this connection.
   */
  previousResult: "correct" | "incorrect" | null;
};

/**
 * One question's place in a set, without its content.
 *
 * A set is now the whole filtered slice of the bank rather than a batch of ten,
 * so shipping every prompt up front would mean a payload that grows with the
 * question bank. The player gets this for every question — enough to draw the
 * navigator, key the review flags, and say what happened last time — and pulls
 * the prompts and choices in windows as the student moves.
 *
 * Roughly 40 bytes each, against roughly 300 for a full question.
 */
export type QuestionIndexEntry = {
  id: string;
  /** This student's own last result. Never the answer key. */
  previousResult: "correct" | "incorrect" | null;
};

/** How many questions one window request carries. */
export const QUESTION_WINDOW_SIZE = 25;

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

// --- Practice test action results --------------------------------------------

/** Generic outcome for the per-attempt control actions. */
export type TestActionResult =
  | { status: "ok" }
  | { status: "error" | "rate_limited"; message: string };

export type StartTestResult =
  | { status: "ok"; attemptId: string }
  | { status: "error" | "rate_limited"; message: string };

/**
 * What ending a module leads to. The database returns this, so the runner
 * never has to work out whether a full test still has a module left.
 */
export type TestSubmitResult =
  | { status: "ok"; next: "interstitial" | "completed" }
  | { status: "error" | "rate_limited"; message: string };

export const CHOICE_LETTERS = ["A", "B", "C", "D"] as const;

/** `615` → `"10:15"`. Used by the timer and the results summary. */
export function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * `615` → `"10:15"`, `4092` → `"1:08:12"`.
 *
 * Separate from `formatSeconds` because a full practice test runs past an
 * hour, where `formatSeconds` would render 70 minutes as "70:12" — readable,
 * but not what anyone writes down. Minutes are zero-padded only once an hour
 * is present, so a question bank sitting still reads "35:29".
 */
export function formatDuration(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  if (hours === 0) {
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Seconds per practice-test module. Mirrors `sat_module_seconds()` in SQL. */
export const MODULE_SECONDS = 2100;

/** Questions per module. Mirrors `sat_module_question_count()` in SQL. */
export const MODULE_QUESTION_COUNT = 22;
