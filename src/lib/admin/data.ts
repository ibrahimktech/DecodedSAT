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
  AdminQuestion,
  AdminUserRow,
  AdminVideo,
  QuestionSetOption,
} from "./types";
import type { AdminQuestionFilters, AdminVideoFilters } from "./schemas";

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
  questionSets: number;
  totalUsers: number;
};

export async function getAdminOverviewCounts(
  supabase: SupabaseClient,
): Promise<AdminOverviewCounts> {
  const [questions, videos, sets, users] = await Promise.all([
    supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("videos")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase.from("question_sets").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  if (questions.error) logQueryError("count_questions", questions.error);
  if (videos.error) logQueryError("count_videos", videos.error);
  if (sets.error) logQueryError("count_sets", sets.error);
  if (users.error) logQueryError("count_users", users.error);

  return {
    activeQuestions: questions.count ?? 0,
    activeVideos: videos.count ?? 0,
    questionSets: sets.count ?? 0,
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
        "domain_name, question_set_id, set_name",
    )
    .order("domain_name")
    .order("subtopic_name")
    .order("external_id", { nullsFirst: false })
    .limit(500);

  const status = filters.status ?? "active";
  if (status !== "all") query = query.eq("is_active", status === "active");

  if (filters.subtopic) {
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
    }))
    .filter((question) => question.choices.length === 4);
}

// --- Videos ----------------------------------------------------------------------

export async function listAdminVideos(
  supabase: SupabaseClient,
  filters: AdminVideoFilters,
): Promise<AdminVideo[]> {
  let query = supabase
    .from("videos")
    .select(
      "id, title, youtube_id, description, is_active, subtopics!inner(id, name, domain_id)",
    )
    .order("title");

  const status = filters.status ?? "active";
  if (status !== "all") query = query.eq("is_active", status === "active");

  if (filters.subtopic) {
    query = query.eq("subtopic_id", filters.subtopic);
  } else if (filters.domain) {
    query = query.eq("subtopics.domain_id", filters.domain);
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
    subtopics: { id: string; name: string; domain_id: string };
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    youtubeId: row.youtube_id,
    description: row.description,
    isActive: row.is_active,
    subtopicId: row.subtopics.id,
    subtopicName: row.subtopics.name,
    domainId: row.subtopics.domain_id,
  }));
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
