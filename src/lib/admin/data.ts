/**
 * Read-side data layer for the admin panel.
 *
 * Every function takes the admin's own Supabase server client — anon key,
 * their session cookie — so Row Level Security applies everywhere. The
 * answer-key read goes through the `admin_questions` view, whose own
 * `is_admin()` filter returns zero rows to anyone else; the users list goes
 * through the `admin_list_users()` function, which errors for anyone else.
 * There is no service_role anywhere in this feature.
 *
 * Failures degrade to empty results with a server-side log, matching
 * `@/lib/learn/data`: an admin page with an empty table and a logged cause
 * beats a 500.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeError } from "@/lib/auth/describe-error";
import type { Difficulty } from "@/lib/learn/types";
import type {
  AdminPracticeTest,
  AdminQuestion,
  AdminQuestionReport,
  AdminQuestionReportSummary,
  AdminUserRow,
  AdminVideo,
  AdminVideoCategory,
  AdminVideoOption,
  QuestionSetOption,
} from "./types";
import type {
  AdminQuestionFilters,
  AdminQuestionReportFilters,
  AdminVideoFilters,
} from "./schemas";

function logQueryError(label: string, error: unknown): void {
  console.error(`[admin] ${label} failed: ${describeError(error)}`);
}

/** `choices` is jsonb; same shape-check-before-trust as the student pages. */
function toChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((choice) => String(choice));
}

/**
 * PostgREST's `ilike` treats `%`, `_` and `\` as pattern syntax; escaping
 * them makes the admin's search text match literally.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`);
}

// --- Overview ------------------------------------------------------------------

export type AdminOverviewCounts = {
  activeQuestions: number;
  activeVideos: number;
  activePracticeTests: number;
  totalUsers: number;
};

export async function getAdminOverviewCounts(
  supabase: SupabaseClient,
): Promise<AdminOverviewCounts> {
  const [questions, videos, tests, users] = await Promise.all([
    supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("videos")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("practice_tests")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  if (questions.error) logQueryError("count_questions", questions.error);
  if (videos.error) logQueryError("count_videos", videos.error);
  if (tests.error) logQueryError("count_tests", tests.error);
  if (users.error) logQueryError("count_users", users.error);

  return {
    activeQuestions: questions.count ?? 0,
    activeVideos: videos.count ?? 0,
    activePracticeTests: tests.count ?? 0,
    totalUsers: users.count ?? 0,
  };
}

// --- Question sets ---------------------------------------------------------------

export async function listQuestionSets(
  supabase: SupabaseClient,
): Promise<QuestionSetOption[]> {
  const { data, error } = await supabase
    .from("question_sets")
    .select("id, name")
    .order("name");

  if (error) {
    logQueryError("question_sets", error);
    return [];
  }
  return (data ?? []) as QuestionSetOption[];
}

// --- Questions -------------------------------------------------------------------

/**
 * Admin question list, answer key included, via the `admin_questions` view.
 * Status defaults to "active"; "all" applies no filter. Capped at 500 rows —
 * plenty for now, and the filters exist precisely so nobody browses
 * unfiltered thousands.
 */
export async function listAdminQuestions(
  supabase: SupabaseClient,
  filters: AdminQuestionFilters,
): Promise<AdminQuestion[]> {
  let query = supabase
    .from("admin_questions")
    .select(
      "id, prompt, choices, correct_choice, explanation, difficulty, " +
        "is_active, external_id, subtopic_id, subtopic_name, domain_id, " +
        "domain_name, question_set_id, set_name, solution_video_id, " +
        "solution_video_title, solution_video_is_active",
    )
    .order("domain_name")
    .order("subtopic_name")
    .order("external_id", { nullsFirst: false })
    .limit(500);

  const status = filters.status ?? "active";
  if (status !== "all") query = query.eq("is_active", status === "active");

  if (filters.id) {
    query = query.eq("id", filters.id);
  } else if (filters.subtopic) {
    query = query.eq("subtopic_id", filters.subtopic);
  } else if (filters.domain) {
    query = query.eq("domain_id", filters.domain);
  }
  if (filters.set) query = query.eq("question_set_id", filters.set);
  if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);
  if (filters.q) {
    query = query.ilike("prompt", `%${escapeLikePattern(filters.q)}%`);
  }

  const { data, error } = await query;
  if (error) {
    logQueryError("admin_questions", error);
    return [];
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    prompt: string;
    choices: unknown;
    correct_choice: number;
    explanation: string;
    difficulty: Difficulty;
    is_active: boolean;
    external_id: string | null;
    subtopic_id: string;
    subtopic_name: string;
    domain_id: string;
    domain_name: string;
    set_name: string | null;
    solution_video_id: string | null;
    solution_video_title: string | null;
    solution_video_is_active: boolean | null;
  }>)
    .map((row) => ({
      id: row.id,
      prompt: row.prompt,
      choices: toChoices(row.choices),
      correctChoice: row.correct_choice,
      explanation: row.explanation,
      difficulty: row.difficulty,
      isActive: row.is_active,
      externalId: row.external_id,
      subtopicId: row.subtopic_id,
      subtopicName: row.subtopic_name,
      domainId: row.domain_id,
      domainName: row.domain_name,
      setName: row.set_name,
      solutionVideo:
        row.solution_video_id && row.solution_video_title
          ? {
              id: row.solution_video_id,
              title: row.solution_video_title,
              isActive: row.solution_video_is_active ?? false,
            }
          : null,
    }))
    .filter((question) => question.choices.length === 4);
}

// --- Question reports -------------------------------------------------------

type QuestionReportSummaryRow = {
  id: string;
  question_id: string;
  reason: AdminQuestionReportSummary["reason"];
  details: string | null;
  status: AdminQuestionReportSummary["status"];
  created_at: string;
  reporter_name: string | null;
  reporter_email: string | null;
  current_prompt: string;
  current_is_active: boolean;
  external_id: string | null;
  question_report_count: number | string;
  open_question_report_count: number | string;
};

function mapQuestionReportSummary(
  row: QuestionReportSummaryRow,
): AdminQuestionReportSummary {
  return {
    id: row.id,
    questionId: row.question_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
    reporterName: row.reporter_name,
    reporterEmail: row.reporter_email,
    currentPrompt: row.current_prompt,
    currentIsActive: row.current_is_active,
    externalId: row.external_id,
    questionReportCount: Number(row.question_report_count),
    openQuestionReportCount: Number(row.open_question_report_count),
  };
}

const REPORT_SUMMARY_COLUMNS =
  "id, question_id, reason, details, status, created_at, reporter_name, " +
  "reporter_email, current_prompt, current_is_active, external_id, " +
  "question_report_count, open_question_report_count";

export async function listAdminQuestionReports(
  supabase: SupabaseClient,
  filters: AdminQuestionReportFilters,
): Promise<AdminQuestionReportSummary[]> {
  let query = supabase
    .from("admin_question_reports")
    .select(REPORT_SUMMARY_COLUMNS)
    .limit(200);

  const status = filters.status ?? "open";
  if (status !== "all") query = query.eq("status", status);
  if (filters.reason) query = query.eq("reason", filters.reason);

  if (filters.q) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filters.q)) {
      query = query.eq("question_id", filters.q);
    } else {
      query = query.ilike(
        "current_prompt",
        `%${escapeLikePattern(filters.q)}%`,
      );
    }
  }

  if (status === "all") query = query.order("status_sort");
  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) {
    logQueryError("admin_question_reports", error);
    return [];
  }

  return ((data ?? []) as unknown as QuestionReportSummaryRow[]).map(
    mapQuestionReportSummary,
  );
}

export async function getAdminQuestionReport(
  supabase: SupabaseClient,
  reportId: string,
): Promise<AdminQuestionReport | null> {
  const { data, error } = await supabase
    .from("admin_question_reports")
    .select(
      REPORT_SUMMARY_COLUMNS +
        ", user_id, updated_at, admin_note, reviewed_at, reviewed_by, " +
        "reviewer_name, question_snapshot, current_choices, " +
        "current_correct_choice, current_explanation, current_difficulty, " +
        "subtopic_id, subtopic_name, domain_id, domain_name, set_name",
    )
    .eq("id", reportId)
    .maybeSingle();

  if (error) {
    logQueryError("admin_question_report", error);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as QuestionReportSummaryRow & {
    user_id: string;
    updated_at: string;
    admin_note: string | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
    reviewer_name: string | null;
    question_snapshot: {
      prompt?: unknown;
      choices?: unknown;
      correct_choice?: unknown;
    };
    current_choices: unknown;
    current_correct_choice: number;
    current_explanation: string;
    current_difficulty: Difficulty;
    subtopic_id: string;
    subtopic_name: string;
    domain_id: string;
    domain_name: string;
    set_name: string | null;
  };

  const snapshotChoices = toChoices(row.question_snapshot.choices);
  const currentChoices = toChoices(row.current_choices);
  if (
    typeof row.question_snapshot.prompt !== "string" ||
    !Number.isInteger(row.question_snapshot.correct_choice) ||
    snapshotChoices.length !== 4 ||
    currentChoices.length !== 4
  ) {
    logQueryError("admin_question_report_shape", "invalid question snapshot");
    return null;
  }

  const { data: solutionLink, error: solutionLinkError } = await supabase
    .from("admin_questions")
    .select(
      "solution_video_id, solution_video_title, solution_video_is_active",
    )
    .eq("id", row.question_id)
    .maybeSingle();
  if (solutionLinkError) {
    logQueryError("admin_question_report_solution_video", solutionLinkError);
  }
  const linkedVideo = solutionLink as {
    solution_video_id: string | null;
    solution_video_title: string | null;
    solution_video_is_active: boolean | null;
  } | null;

  return {
    ...mapQuestionReportSummary(row),
    userId: row.user_id,
    updatedAt: row.updated_at,
    adminNote: row.admin_note,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewerName: row.reviewer_name,
    snapshot: {
      prompt: row.question_snapshot.prompt,
      choices: snapshotChoices,
      correctChoice: Number(row.question_snapshot.correct_choice),
    },
    currentQuestion: {
      id: row.question_id,
      prompt: row.current_prompt,
      choices: currentChoices,
      correctChoice: row.current_correct_choice,
      explanation: row.current_explanation,
      difficulty: row.current_difficulty,
      isActive: row.current_is_active,
      externalId: row.external_id,
      subtopicId: row.subtopic_id,
      subtopicName: row.subtopic_name,
      domainId: row.domain_id,
      domainName: row.domain_name,
      setName: row.set_name,
      solutionVideo:
        linkedVideo?.solution_video_id && linkedVideo.solution_video_title
          ? {
              id: linkedVideo.solution_video_id,
              title: linkedVideo.solution_video_title,
              isActive: linkedVideo.solution_video_is_active ?? false,
            }
          : null,
    },
  };
}

export async function listOtherOpenQuestionReports(
  supabase: SupabaseClient,
  questionId: string,
  excludingReportId: string,
): Promise<AdminQuestionReportSummary[]> {
  const { data, error } = await supabase
    .from("admin_question_reports")
    .select(REPORT_SUMMARY_COLUMNS)
    .eq("question_id", questionId)
    .eq("status", "open")
    .neq("id", excludingReportId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    logQueryError("other_open_question_reports", error);
    return [];
  }

  return ((data ?? []) as unknown as QuestionReportSummaryRow[]).map(
    mapQuestionReportSummary,
  );
}

export type QuestionReportCounts = {
  openReports: number;
  uniqueOpenQuestions: number;
};

export async function getQuestionReportCounts(
  supabase: SupabaseClient,
): Promise<QuestionReportCounts> {
  const { data, error } = await supabase.rpc("admin_question_report_counts");
  if (error) {
    logQueryError("admin_question_report_counts", error);
    return { openReports: 0, uniqueOpenQuestions: 0 };
  }

  const row = (data as Array<{
    open_reports: number | string;
    unique_open_questions: number | string;
  }> | null)?.[0];

  return {
    openReports: Number(row?.open_reports ?? 0),
    uniqueOpenQuestions: Number(row?.unique_open_questions ?? 0),
  };
}

// --- Videos ----------------------------------------------------------------------

/**
 * Minimal rows for the question editor's searchable picker. Inactive videos
 * remain present so an existing soft-deleted link is visible and removable;
 * the picker marks them and prevents choosing them as a new link.
 */
export async function listAdminVideoOptions(
  supabase: SupabaseClient,
): Promise<AdminVideoOption[]> {
  const { data, error } = await supabase
    .from("videos")
    .select("id, title, is_active, subtopics(name), video_categories(name)")
    .order("title");

  if (error) {
    logQueryError("admin_video_options", error);
    return [];
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    title: string;
    is_active: boolean;
    subtopics: { name: string } | null;
    video_categories: { name: string } | null;
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    isActive: row.is_active,
    subtopicName: row.subtopics?.name ?? null,
    categoryName: row.video_categories?.name ?? null,
  }));
}

/**
 * Both embeds are LEFT joins so a category video is not dropped from the
 * list. Filtering on an embed needs it to be inner, so the select string is
 * picked per filter rather than concatenated — the client infers the row type
 * from a string literal and `+` would collapse it to `string`.
 */
const ADMIN_VIDEO_SELECT_OPEN =
  "id, title, youtube_id, description, is_active, subtopics(id, name, domain_id), video_categories(id, name)";
const ADMIN_VIDEO_SELECT_BY_SUBTOPIC =
  "id, title, youtube_id, description, is_active, subtopics!inner(id, name, domain_id), video_categories(id, name)";

export async function listAdminVideos(
  supabase: SupabaseClient,
  filters: AdminVideoFilters,
): Promise<AdminVideo[]> {
  const bySubtopic = Boolean(filters.subtopic || filters.domain);

  let query = supabase
    .from("videos")
    .select(bySubtopic ? ADMIN_VIDEO_SELECT_BY_SUBTOPIC : ADMIN_VIDEO_SELECT_OPEN)
    .order("title");

  const status = filters.status ?? "active";
  if (status !== "all") query = query.eq("is_active", status === "active");

  if (filters.subtopic) {
    query = query.eq("subtopic_id", filters.subtopic);
  } else if (filters.domain) {
    query = query.eq("subtopics.domain_id", filters.domain);
  } else if (filters.category) {
    // A plain column filter, not an embed filter, so the left joins stay left.
    query = query.eq("video_category_id", filters.category);
  }

  const { data, error } = await query;
  if (error) {
    logQueryError("admin_videos", error);
    return [];
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    title: string;
    youtube_id: string;
    description: string;
    is_active: boolean;
    subtopics: { id: string; name: string; domain_id: string } | null;
    video_categories: { id: string; name: string } | null;
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    youtubeId: row.youtube_id,
    description: row.description,
    isActive: row.is_active,
    subtopicId: row.subtopics?.id ?? null,
    subtopicName: row.subtopics?.name ?? null,
    domainId: row.subtopics?.domain_id ?? null,
    categoryId: row.video_categories?.id ?? null,
    categoryName: row.video_categories?.name ?? null,
  }));
}

// --- Video categories ------------------------------------------------------------

/**
 * Every category, active and soft-deleted alike — the admin list offers
 * restore, so it cannot filter inactive ones out. The `video_categories`
 * SELECT policy releases inactive rows only to admins.
 */
export async function listAdminVideoCategories(
  supabase: SupabaseClient,
): Promise<AdminVideoCategory[]> {
  const { data, error } = await supabase
    .from("video_categories")
    .select("id, name, slug, is_active, videos(count)")
    .order("position")
    .order("name");

  if (error) {
    logQueryError("admin_video_categories", error);
    return [];
  }

  return ((data ?? []) as unknown as Array<{
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    videos: Array<{ count: number }>;
  }>).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    isActive: row.is_active,
    videoCount: row.videos?.[0]?.count ?? 0,
  }));
}

// --- Practice tests ---------------------------------------------------------------

/**
 * Reads through `admin_practice_tests`, whose own `is_admin()` filter returns
 * zero rows to anyone else — the same construct as `admin_questions`. The
 * per-module counts come from the view so the list can show at a glance which
 * tests are still missing their questions.
 */
export async function listAdminPracticeTests(
  supabase: SupabaseClient,
): Promise<AdminPracticeTest[]> {
  const { data, error } = await supabase
    .from("admin_practice_tests")
    .select(
      "id, title, description, difficulty, test_type, module_count, is_active, created_at, module1_count, module2_count, attempt_count",
    )
    .order("created_at", { ascending: false });

  if (error) {
    logQueryError("admin_practice_tests", error);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    difficulty: row.difficulty as Difficulty,
    testType: row.test_type as "full" | "half",
    moduleCount: Number(row.module_count ?? 1),
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    module1Count: Number(row.module1_count ?? 0),
    module2Count: Number(row.module2_count ?? 0),
    attemptCount: Number(row.attempt_count ?? 0),
  }));
}

export async function getAdminPracticeTest(
  supabase: SupabaseClient,
  testId: string,
): Promise<AdminPracticeTest | null> {
  const tests = await listAdminPracticeTests(supabase);
  return tests.find((test) => test.id === testId) ?? null;
}

// --- Users -----------------------------------------------------------------------

export async function listAdminUsers(
  supabase: SupabaseClient,
): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc("admin_list_users");

  if (error) {
    logQueryError("admin_list_users", error);
    return [];
  }

  return ((data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    created_at: string;
    is_admin: boolean;
    attempts_count: number;
  }>).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    createdAt: row.created_at,
    isAdmin: row.is_admin,
    attemptsCount: Number(row.attempts_count ?? 0),
  }));
}
