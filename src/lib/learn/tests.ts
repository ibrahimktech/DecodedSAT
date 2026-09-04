/**
 * Read-side data layer for full and half practice tests.
 *
 * Same doctrine as `@/lib/learn/data`: every function takes the caller's own
 * Supabase server client, so Row Level Security scopes each query to them, and
 * a failure degrades to an empty result with a server-side log rather than a
 * 500.
 *
 * Separate from `practice_sections` / `practice_attempts` — the step 4 section
 * drills — on purpose. Those stay exactly as they are; these have real module
 * rules, two clocks, and an abandonment story, and folding the two together
 * would mean every drill query paying for machinery it does not use.
 *
 * ## What this module deliberately cannot see
 *
 * `questions.correct_choice` and `questions.explanation` are unreadable by
 * this connection (step 4's column grant). Nothing here can tell a student
 * whether they were right; `getPracticeTestReview` reads the key through
 * `attempted_question_solutions`, which releases it only for attempts that
 * are already over.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeError } from "@/lib/auth/describe-error";
import type { Difficulty, PracticeQuestion, SolutionVideo } from "./types";

function logQueryError(label: string, error: unknown): void {
  console.error(`[tests] ${label} failed: ${describeError(error)}`);
}

function toChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((choice) => String(choice));
}

export type TestType = "full" | "half";

export type PracticeTestAttemptStatus =
  | "in_progress"
  | "completed"
  | "abandoned_auto_submitted";

/** Which screen the runner should be on, derived server-side from the row. */
export type TestPhase = "module" | "interstitial" | "completed";

export type PracticeTestSummary = {
  id: string;
  title: string;
  description: string | null;
  difficulty: Difficulty;
  testType: TestType;
  moduleCount: number;
  questionCount: number;
  /** Total wall-clock budget across every module, in seconds. */
  totalSeconds: number;
  lastResult: {
    attemptId: string;
    correct: number;
    total: number;
    endedAt: string;
    status: PracticeTestAttemptStatus;
  } | null;
  bestScore: { correct: number; total: number } | null;
  /** An unfinished attempt. The start screen offers to resume it. */
  inProgressAttemptId: string | null;
};

const MODULE_SECONDS = 2100;

type TestRow = {
  id: string;
  title: string;
  description: string | null;
  difficulty: Difficulty;
  test_type: TestType;
  module_count: number;
  practice_test_questions: Array<{ question_id: string }>;
};

type AttemptRow = {
  id: string;
  practice_test_id: string;
  status: PracticeTestAttemptStatus;
  correct_count: number | null;
  wrong_count: number | null;
  started_at: string;
  ended_at: string | null;
};

/**
 * Every active test, with the caller's own history against each.
 *
 * Two queries rather than an embed: attempts are scoped by RLS to the caller
 * while tests are not, and PostgREST would turn that into an inner join that
 * hides every test the student has never sat.
 */
export async function listPracticeTests(
  supabase: SupabaseClient,
  userId: string,
): Promise<PracticeTestSummary[]> {
  const [testsResult, attemptsResult] = await Promise.all([
    supabase
      .from("practice_tests")
      .select(
        "id, title, description, difficulty, test_type, module_count, practice_test_questions(question_id)",
      )
      .eq("is_active", true)
      .order("title"),
    supabase
      .from("practice_test_attempts")
      .select(
        "id, practice_test_id, status, correct_count, wrong_count, started_at, ended_at",
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(200),
  ]);

  if (testsResult.error) {
    logQueryError("practice_tests", testsResult.error);
    return [];
  }
  if (attemptsResult.error) {
    logQueryError("practice_test_attempts", attemptsResult.error);
  }

  const attempts = (attemptsResult.data ?? []) as AttemptRow[];

  return ((testsResult.data ?? []) as unknown as TestRow[]).map((test) => {
    const own = attempts.filter(
      (attempt) => attempt.practice_test_id === test.id,
    );

    const finished = own.filter(
      (attempt) =>
        attempt.status !== "in_progress" &&
        attempt.correct_count !== null &&
        attempt.wrong_count !== null,
    );

    const last = finished[0] ?? null;
    const best =
      finished.length > 0
        ? finished.reduce((a, b) =>
            (a.correct_count ?? 0) >= (b.correct_count ?? 0) ? a : b,
          )
        : null;

    const inProgress = own.find((attempt) => attempt.status === "in_progress");

    return {
      id: test.id,
      title: test.title,
      description: test.description,
      difficulty: test.difficulty,
      testType: test.test_type,
      moduleCount: test.module_count,
      questionCount: test.practice_test_questions.length,
      totalSeconds: test.module_count * MODULE_SECONDS,
      lastResult: last
        ? {
            attemptId: last.id,
            correct: last.correct_count as number,
            total: (last.correct_count as number) + (last.wrong_count as number),
            endedAt: last.ended_at ?? last.started_at,
            status: last.status,
          }
        : null,
      bestScore: best
        ? {
            correct: best.correct_count as number,
            total: (best.correct_count as number) + (best.wrong_count as number),
          }
        : null,
      inProgressAttemptId: inProgress?.id ?? null,
    };
  });
}

export type PracticeTestDetail = {
  id: string;
  title: string;
  description: string | null;
  difficulty: Difficulty;
  testType: TestType;
  moduleCount: number;
  questionCount: number;
  totalSeconds: number;
};

/** One test's front matter, for the start screen. Inactive/unknown → null. */
export async function getPracticeTest(
  supabase: SupabaseClient,
  testId: string,
): Promise<PracticeTestDetail | null> {
  const { data, error } = await supabase
    .from("practice_tests")
    .select(
      "id, title, description, difficulty, test_type, module_count, practice_test_questions(question_id)",
    )
    .eq("id", testId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    logQueryError("practice_test", error);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as TestRow;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    difficulty: row.difficulty,
    testType: row.test_type,
    moduleCount: row.module_count,
    questionCount: row.practice_test_questions.length,
    totalSeconds: row.module_count * MODULE_SECONDS,
  };
}

export type RunnerState = {
  attemptId: string;
  testId: string;
  title: string;
  testType: TestType;
  moduleCount: number;
  phase: TestPhase;
  /** The live module, or the one just finished when on the interstitial. */
  moduleNumber: 1 | 2;
  /** Epoch ms the live module's clock hits zero. Null off a live module. */
  deadlineMs: number | null;
  /**
   * Seconds left as of THIS render, computed server-side.
   *
   * The runner could derive it from `deadlineMs`, but only by calling
   * `Date.now()` in a `useState` initialiser — which runs during server
   * rendering too, with a different clock, and paints a hydration mismatch on
   * the most conspicuous element on the page. Handing down a fixed number
   * makes the first paint deterministic; the client then recomputes from
   * `deadlineMs` on every tick, so it stays accurate.
   */
  remainingSeconds: number;
  questions: PracticeQuestion[];
  /** Question id → chosen index, from whatever autosaved. */
  answers: Record<string, number>;
};

/**
 * Everything the runner needs, resolved server-side.
 *
 * Which module is live, and therefore which questions ship and which clock
 * runs, is derived from the attempt's own timestamps here and again inside
 * `save_practice_test_response()`. The client is told what to render; it is
 * never asked what state it is in.
 *
 * Only the LIVE module's questions are sent. Module 2 is not in the payload
 * during module 1 — no answer key is at stake either way, but a student
 * cannot preview what is coming, and the page stays half the size.
 */
export async function getRunnerState(
  supabase: SupabaseClient,
  attemptId: string,
): Promise<RunnerState | null> {
  const { data: attempt, error } = await supabase
    .from("practice_test_attempts")
    .select(
      "id, practice_test_id, status, module1_ends_at, module1_submitted_at, module2_started_at, module2_ends_at, practice_tests!inner(id, title, test_type, module_count)",
    )
    .eq("id", attemptId)
    .maybeSingle();

  if (error) {
    logQueryError("runner_attempt", error);
    return null;
  }
  if (!attempt) return null;

  const row = attempt as unknown as {
    id: string;
    practice_test_id: string;
    status: PracticeTestAttemptStatus;
    module1_ends_at: string | null;
    module1_submitted_at: string | null;
    module2_started_at: string | null;
    module2_ends_at: string | null;
    practice_tests: {
      id: string;
      title: string;
      test_type: TestType;
      module_count: number;
    };
  };

  const test = row.practice_tests;

  const base = {
    attemptId: row.id,
    testId: test.id,
    title: test.title,
    testType: test.test_type,
    moduleCount: test.module_count,
  };

  if (row.status !== "in_progress") {
    return {
      ...base,
      phase: "completed",
      moduleNumber: row.module2_started_at ? 2 : 1,
      deadlineMs: null,
      remainingSeconds: 0,
      questions: [],
      answers: {},
    };
  }

  const inModuleTwo = row.module2_started_at !== null;
  const moduleNumber: 1 | 2 = inModuleTwo ? 2 : 1;

  // Module 1 is over when its clock ran out or it was submitted early. On a
  // full test that means the interstitial; on a half test the stale sweep will
  // have finalized it, so this only shows in the moment between.
  const moduleOneEnded =
    row.module1_submitted_at !== null ||
    (row.module1_ends_at !== null &&
      new Date(row.module1_ends_at).getTime() <= Date.now());

  if (!inModuleTwo && moduleOneEnded && test.module_count === 2) {
    return {
      ...base,
      phase: "interstitial",
      moduleNumber: 1,
      deadlineMs: null,
      remainingSeconds: 0,
      questions: [],
      answers: {},
    };
  }

  const deadlineIso = inModuleTwo ? row.module2_ends_at : row.module1_ends_at;

  const [questionsResult, responsesResult] = await Promise.all([
    supabase
      .from("practice_test_questions")
      .select("order_index, questions!inner(id, prompt, choices)")
      .eq("practice_test_id", row.practice_test_id)
      .eq("module_number", moduleNumber)
      .order("order_index"),
    supabase
      .from("practice_test_responses")
      .select("question_id, student_answer")
      .eq("practice_test_attempt_id", row.id)
      .eq("module_number", moduleNumber),
  ]);

  if (questionsResult.error) {
    logQueryError("runner_questions", questionsResult.error);
    return null;
  }
  if (responsesResult.error) {
    logQueryError("runner_responses", responsesResult.error);
  }

  const questions = ((questionsResult.data ?? []) as unknown as Array<{
    questions: { id: string; prompt: string; choices: unknown };
  }>)
    .map((entry) => ({
      id: entry.questions.id,
      prompt: entry.questions.prompt,
      choices: toChoices(entry.questions.choices),
    }))
    .filter((question) => question.choices.length === 4);

  const answers: Record<string, number> = {};
  for (const response of (responsesResult.data ?? []) as Array<{
    question_id: string;
    student_answer: string | null;
  }>) {
    // `student_answer` is text so a future grid-in fits the same column. For
    // a four-choice question it holds the index; anything else is ignored
    // rather than coerced into a wrong selection.
    const parsed = Number.parseInt(response.student_answer ?? "", 10);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 3) {
      answers[response.question_id] = parsed;
    }
  }

  const deadlineMs = deadlineIso ? new Date(deadlineIso).getTime() : null;

  return {
    ...base,
    phase: "module",
    moduleNumber,
    deadlineMs,
    remainingSeconds:
      deadlineMs === null
        ? 0
        : Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)),
    questions,
    answers,
  };
}

export type TestReviewItem = {
  id: string;
  moduleNumber: number;
  position: number;
  prompt: string;
  choices: string[];
  selectedChoice: number | null;
  isCorrect: boolean | null;
  correctChoice: number | null;
  explanation: string | null;
  subtopicName: string;
  subtopicSlug: string;
  subtopicHasVideo: boolean;
  solutionVideo: SolutionVideo | null;
};

export type TestReview = {
  attemptId: string;
  testId: string;
  title: string;
  testType: TestType;
  status: PracticeTestAttemptStatus;
  correct: number;
  total: number;
  totalTimeSeconds: number;
  endedAt: string;
  items: TestReviewItem[];
};

/**
 * The full answer review for a finished attempt.
 *
 * RLS restricts the attempt lookup to the caller's own rows, so someone
 * else's attempt id resolves to "not found" rather than "forbidden". An
 * attempt still in progress also returns null — the answer key stays sealed
 * until the test is over, which is exactly the condition
 * `attempted_question_solutions` checks on its own side.
 */
export async function getPracticeTestReview(
  supabase: SupabaseClient,
  attemptId: string,
): Promise<TestReview | null> {
  const { data: attempt, error } = await supabase
    .from("practice_test_attempts")
    .select(
      "id, practice_test_id, status, correct_count, wrong_count, total_time_seconds, started_at, ended_at, practice_tests!inner(id, title, test_type)",
    )
    .eq("id", attemptId)
    .maybeSingle();

  if (error) {
    logQueryError("review_attempt", error);
    return null;
  }
  if (!attempt) return null;

  const row = attempt as unknown as {
    id: string;
    practice_test_id: string;
    status: PracticeTestAttemptStatus;
    correct_count: number | null;
    wrong_count: number | null;
    total_time_seconds: number | null;
    started_at: string;
    ended_at: string | null;
    practice_tests: { id: string; title: string; test_type: TestType };
  };

  if (row.status === "in_progress") return null;

  const [questionsResult, responsesResult] = await Promise.all([
    supabase
      .from("practice_test_questions")
      .select(
        "module_number, order_index, questions!inner(id, prompt, choices, subtopics!inner(id, name, slug))",
      )
      .eq("practice_test_id", row.practice_test_id)
      .order("module_number")
      .order("order_index"),
    supabase
      .from("practice_test_responses")
      .select("question_id, student_answer, is_correct")
      .eq("practice_test_attempt_id", row.id),
  ]);

  if (questionsResult.error) {
    logQueryError("review_questions", questionsResult.error);
    return null;
  }
  if (responsesResult.error) {
    logQueryError("review_responses", responsesResult.error);
  }

  const questionRows = (questionsResult.data ?? []) as unknown as Array<{
    module_number: number;
    order_index: number;
    questions: {
      id: string;
      prompt: string;
      choices: unknown;
      subtopics: { id: string; name: string; slug: string };
    };
  }>;

  const questionIds = questionRows.map((entry) => entry.questions.id);
  const subtopicIds = [
    ...new Set(questionRows.map((entry) => entry.questions.subtopics.id)),
  ];

  const [solutionsResult, videosResult] = await Promise.all([
    supabase
      .from("attempted_question_solutions")
      .select(
        "question_id, correct_choice, explanation, solution_video_id, solution_video_title",
      )
      .in("question_id", questionIds),
    supabase
      .from("videos")
      .select("subtopic_id")
      .eq("is_active", true)
      .in("subtopic_id", subtopicIds),
  ]);

  if (solutionsResult.error) {
    logQueryError("review_solutions", solutionsResult.error);
  }
  if (videosResult.error) logQueryError("review_videos", videosResult.error);

  const responses = new Map<
    string,
    { selected: number | null; isCorrect: boolean | null }
  >();
  for (const response of (responsesResult.data ?? []) as Array<{
    question_id: string;
    student_answer: string | null;
    is_correct: boolean | null;
  }>) {
    const parsed = Number.parseInt(response.student_answer ?? "", 10);
    responses.set(response.question_id, {
      selected:
        Number.isInteger(parsed) && parsed >= 0 && parsed <= 3 ? parsed : null,
      isCorrect: response.is_correct,
    });
  }

  const solutions = new Map<
    string,
    {
      correct_choice: number;
      explanation: string;
      solution_video_id: string | null;
      solution_video_title: string | null;
    }
  >();
  for (const solution of (solutionsResult.data ?? []) as Array<{
    question_id: string;
    correct_choice: number;
    explanation: string;
    solution_video_id: string | null;
    solution_video_title: string | null;
  }>) {
    solutions.set(solution.question_id, solution);
  }

  const subtopicsWithVideo = new Set(
    ((videosResult.data ?? []) as Array<{ subtopic_id: string }>).map(
      (video) => video.subtopic_id,
    ),
  );

  const correct = row.correct_count ?? 0;
  const wrong = row.wrong_count ?? 0;

  return {
    attemptId: row.id,
    testId: row.practice_tests.id,
    title: row.practice_tests.title,
    testType: row.practice_tests.test_type,
    status: row.status,
    correct,
    total: correct + wrong,
    totalTimeSeconds: row.total_time_seconds ?? 0,
    endedAt: row.ended_at ?? row.started_at,
    items: questionRows.map((entry) => {
      const response = responses.get(entry.questions.id);
      const solution = solutions.get(entry.questions.id);
      return {
        id: entry.questions.id,
        moduleNumber: entry.module_number,
        position: entry.order_index,
        prompt: entry.questions.prompt,
        choices: toChoices(entry.questions.choices),
        selectedChoice: response?.selected ?? null,
        // A question never answered has no response row at all — that is
        // "unanswered", which the review shows as its own state rather than
        // as a wrong answer with no selection.
        isCorrect: response?.isCorrect ?? null,
        correctChoice: solution?.correct_choice ?? null,
        explanation: solution?.explanation ?? null,
        subtopicName: entry.questions.subtopics.name,
        subtopicSlug: entry.questions.subtopics.slug,
        subtopicHasVideo: subtopicsWithVideo.has(entry.questions.subtopics.id),
        solutionVideo:
          solution?.solution_video_id && solution.solution_video_title
            ? {
                id: solution.solution_video_id,
                title: solution.solution_video_title,
              }
            : null,
      };
    }),
  };
}
