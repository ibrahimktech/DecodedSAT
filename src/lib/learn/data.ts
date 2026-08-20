/**
 * Read-side data layer for the signed-in app.
 *
 * Every function takes the caller's own Supabase server client — the one
 * carrying their session cookie — so Row Level Security scopes every query to
 * them. There is no service-role client anywhere; the explicit `user_id`
 * filters below are belt-and-braces on top of RLS, not the boundary itself.
 *
 * Failures degrade to empty results rather than crashing the page: a
 * dashboard that renders with a missing card beats a 500, and the cause is
 * logged server-side either way.
 *
 * All "day" arithmetic (streak, today's goal) is UTC, matching the SQL
 * functions this file calls.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeError } from "@/lib/auth/describe-error";
import type {
  Difficulty,
  Domain,
  PlayableQuestion,
  PracticeQuestion,
  Subtopic,
} from "./types";
import type { QuestionFilters } from "./schemas";

/** Logs a query failure without letting provider detail reach the page. */
function logQueryError(label: string, error: unknown): void {
  console.error(`[learn] ${label} failed: ${describeError(error)}`);
}

/**
 * `choices` is jsonb; trust it only after checking the shape. A malformed row
 * (impossible via the seed's CHECK constraint, but this code shouldn't need
 * to know that) renders as an empty question rather than crashing.
 */
function toChoices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((choice) => String(choice));
}

// --- Reference content -------------------------------------------------------

export async function getDomains(supabase: SupabaseClient): Promise<Domain[]> {
  const { data, error } = await supabase
    .from("domains")
    .select("id, slug, name")
    .order("position");

  if (error) {
    logQueryError("domains", error);
    return [];
  }
  return (data ?? []) as Domain[];
}

export async function getSubtopics(
  supabase: SupabaseClient,
): Promise<Subtopic[]> {
  const { data, error } = await supabase
    .from("subtopics")
    .select("id, domain_id, slug, name")
    .order("position");

  if (error) {
    logQueryError("subtopics", error);
    return [];
  }
  return ((data ?? []) as Array<Record<string, string>>).map((row) => ({
    id: row.id,
    domainId: row.domain_id,
    slug: row.slug,
    name: row.name,
  }));
}

// --- Profile & stats ---------------------------------------------------------

export type Profile = { fullName: string | null; email: string | null };

export async function getProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logQueryError("profile", error);
    return null;
  }
  if (!data) return null;
  return { fullName: data.full_name, email: data.email };
}

export type UserStats = {
  currentScoreEstimate: number | null;
  targetScore: number | null;
  dailyGoal: number;
  /** Null until onboarding is finished. See `@/lib/onboarding/status`. */
  onboardingCompletedAt: string | null;
  /** 0 = never sat the real SAT, 1 = once, 2 = twice or more. */
  satAttempts: number;
  lastSatMathScore: number | null;
  /** `YYYY-MM-DD`, or null for "not sure yet". */
  testDate: string | null;
};

/**
 * The stats row is created by a trigger the moment the profile exists, but a
 * pre-migration account might lack one — fall back to the schema's defaults
 * rather than special-casing that everywhere.
 */
export async function getUserStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserStats> {
  const fallback: UserStats = {
    currentScoreEstimate: null,
    targetScore: null,
    dailyGoal: 20,
    onboardingCompletedAt: null,
    satAttempts: 0,
    lastSatMathScore: null,
    testDate: null,
  };

  const { data, error } = await supabase
    .from("user_stats")
    // One string literal, not a concatenation: the client infers the row type
    // from the literal, and `+` collapses it to `string` and loses it.
    .select(
      "current_score_estimate, target_score, daily_goal, onboarding_completed_at, sat_attempts, last_sat_math_score, test_date",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logQueryError("user_stats", error);
    return fallback;
  }
  if (!data) return fallback;

  return {
    currentScoreEstimate: data.current_score_estimate,
    targetScore: data.target_score,
    dailyGoal: data.daily_goal ?? 20,
    onboardingCompletedAt: data.onboarding_completed_at,
    satAttempts: data.sat_attempts ?? 0,
    lastSatMathScore: data.last_sat_math_score,
    testDate: data.test_date,
  };
}

/**
 * The domains someone flagged as weak during onboarding, in the same display
 * order the rest of the app uses. RLS scopes the join table to the caller.
 */
export async function getFocusDomains(
  supabase: SupabaseClient,
  userId: string,
): Promise<Domain[]> {
  const { data, error } = await supabase
    .from("user_focus_domains")
    .select("domains!inner(id, slug, name, position)")
    .eq("user_id", userId);

  if (error) {
    logQueryError("focus_domains", error);
    return [];
  }

  return ((data ?? []) as unknown as Array<{
    domains: Domain & { position: number };
  }>)
    .map((row) => row.domains)
    .sort((a, b) => a.position - b.position)
    .map(({ id, slug, name }) => ({ id, slug, name }));
}

// --- Computed metrics (SQL functions; RLS applies inside) --------------------

export type DomainMastery = {
  domain: Domain;
  /** Attempts inside the rolling last-50 window. 0 = no data yet. */
  attempts: number;
  correct: number;
  /** 0–100, or null when there is nothing to compute from. */
  accuracy: number | null;
};

/**
 * Accuracy per domain over each domain's last 50 attempts — computed by
 * `domain_mastery()` in the database, never stored. Domains with no attempts
 * are included with `accuracy: null` so the dashboard can render all four.
 */
export async function getDomainMastery(
  supabase: SupabaseClient,
): Promise<DomainMastery[]> {
  const [domains, rpc] = await Promise.all([
    getDomains(supabase),
    supabase.rpc("domain_mastery"),
  ]);

  if (rpc.error) logQueryError("domain_mastery", rpc.error);

  const byDomain = new Map<string, { attempts: number; correct: number }>();
  for (const row of (rpc.data ?? []) as Array<{
    domain_id: string;
    attempts: number;
    correct: number;
  }>) {
    byDomain.set(row.domain_id, {
      attempts: row.attempts,
      correct: row.correct,
    });
  }

  return domains.map((domain) => {
    const stats = byDomain.get(domain.id);
    return {
      domain,
      attempts: stats?.attempts ?? 0,
      correct: stats?.correct ?? 0,
      accuracy:
        stats && stats.attempts > 0
          ? Math.round((stats.correct / stats.attempts) * 100)
          : null,
    };
  });
}

/**
 * The "adaptive" suggestion, kept deliberately simple per the step spec:
 * the lowest-mastery domain with data, else the first domain untouched.
 */
export function suggestFocusDomain(
  mastery: DomainMastery[],
): { domain: Domain; accuracy: number | null } | null {
  const untouched = mastery.find((entry) => entry.accuracy === null);
  const practised = mastery
    .filter((entry) => entry.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));

  // With no attempts anywhere there is nothing to adapt to — point at the
  // first domain as a starting place.
  if (practised.length === 0) {
    return untouched ? { domain: untouched.domain, accuracy: null } : null;
  }

  // An untouched domain outranks a weak one: no data is the biggest gap.
  if (untouched) return { domain: untouched.domain, accuracy: null };

  return { domain: practised[0].domain, accuracy: practised[0].accuracy };
}

export async function getCurrentStreak(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await supabase.rpc("current_streak");
  if (error) {
    logQueryError("current_streak", error);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

/**
 * Questions answered today, against the daily goal.
 *
 * Counts practice test responses alongside question bank attempts: a student
 * who spent seventy minutes on a full test has unambiguously done their
 * questions for the day, and a goal card that says otherwise is just wrong.
 *
 * UTC, matching `current_streak()` and the rest of the goal machinery. (The
 * Progress page and the heatmap use the student's local timezone instead —
 * see `@/lib/learn/progress`. They can disagree by one day for a late-night
 * session; that is the accepted trade in this step.)
 */
export async function getTodayAttemptCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const startOfTodayUtc = new Date();
  startOfTodayUtc.setUTCHours(0, 0, 0, 0);
  const since = startOfTodayUtc.toISOString();

  const [bank, tests] = await Promise.all([
    supabase
      .from("question_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("attempted_at", since),
    // RLS scopes responses to attempts the caller owns, so no user filter is
    // expressible here — nor needed.
    supabase
      .from("practice_test_responses")
      .select("id", { count: "exact", head: true })
      .not("answered_at", "is", null)
      .gte("answered_at", since),
  ]);

  if (bank.error) logQueryError("today_attempts", bank.error);
  if (tests.error) logQueryError("today_test_responses", tests.error);

  return (bank.count ?? 0) + (tests.count ?? 0);
}

// --- Housekeeping -------------------------------------------------------------

/**
 * Closes any question bank sitting the caller left dangling.
 *
 * Call this from every page that is NOT the question player: the filter
 * picker, Progress, the dashboard. Arriving at one of them means the set is
 * over, so there is no risk of closing a session out from under someone who
 * is still answering.
 *
 * Deliberately not called from the player's own route with `?start=1`, and
 * deliberately not called from a layout — a layout runs on the player too.
 */
export async function finalizeOpenQuestionBankSessions(
  supabase: SupabaseClient,
): Promise<void> {
  const { error } = await supabase.rpc("finalize_open_question_bank_sessions");
  if (error) logQueryError("finalize_sessions", error);
}

/**
 * Auto-submits any practice test the caller abandoned.
 *
 * This is the source of truth for abandonment, not `beforeunload` and not
 * `sendBeacon` — a tab killed instantly runs no JavaScript at all, and the
 * result still has to be right. Cheap enough to call on every page that shows
 * test results: it reads the caller's in-progress attempts, of which there is
 * normally zero or one.
 */
export async function finalizeStalePracticeTestAttempts(
  supabase: SupabaseClient,
): Promise<void> {
  const { error } = await supabase.rpc("finalize_stale_practice_test_attempts");
  if (error) logQueryError("finalize_stale_tests", error);
}

// --- Continue where you left off ---------------------------------------------

export type ContinueTarget =
  | {
      kind: "practice";
      sectionId: string;
      sectionTitle: string;
      remainingSeconds: number;
    }
  | {
      kind: "subtopic";
      subtopicName: string;
      subtopicSlug: string;
    };

/**
 * Preference order: an unfinished, unexpired timed run (its clock is still
 * ticking), else the most recently practised subtopic in the question bank.
 */
export async function getContinueTarget(
  supabase: SupabaseClient,
  userId: string,
): Promise<ContinueTarget | null> {
  const { data: incomplete, error: incompleteError } = await supabase
    .from("practice_attempts")
    .select(
      "id, started_at, practice_sections!inner(id, title, time_limit_seconds)",
    )
    .eq("user_id", userId)
    .is("completed_at", null)
    .order("started_at", { ascending: false })
    .limit(5);

  if (incompleteError) logQueryError("continue_practice", incompleteError);

  // Casts below go through `unknown` because the untyped client infers
  // embedded relations as arrays, while PostgREST actually returns a to-one
  // embed (FK relationship) as an object.
  for (const row of (incomplete ?? []) as unknown as Array<{
    started_at: string;
    practice_sections: {
      id: string;
      title: string;
      time_limit_seconds: number;
    };
  }>) {
    const section = row.practice_sections;
    const deadline =
      new Date(row.started_at).getTime() + section.time_limit_seconds * 1000;
    const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);
    if (remainingSeconds > 0) {
      return {
        kind: "practice",
        sectionId: section.id,
        sectionTitle: section.title,
        remainingSeconds,
      };
    }
  }

  const { data: lastAttempt, error: lastError } = await supabase
    .from("question_attempts")
    .select("attempted_at, questions!inner(subtopics!inner(name, slug))")
    .eq("user_id", userId)
    .order("attempted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastError) {
    logQueryError("continue_subtopic", lastError);
    return null;
  }
  if (!lastAttempt) return null;

  const subtopic = (
    lastAttempt as unknown as {
      questions: { subtopics: { name: string; slug: string } };
    }
  ).questions.subtopics;

  return {
    kind: "subtopic",
    subtopicName: subtopic.name,
    subtopicSlug: subtopic.slug,
  };
}

// --- Explainer videos --------------------------------------------------------

/**
 * A video is filed under EITHER a subtopic (a domain video, the original and
 * still the common case) OR a dynamic category (a general video — "Desmos
 * tips", "Test-day strategy"). The database CHECK constraint
 * `videos_have_a_type` guarantees at least one, so exactly one pair of these
 * fields is populated on any given row.
 *
 * Categories are a video-only axis by decision: questions and practice tests
 * keep the fixed domain/subtopic structure.
 */
export type VideoEntry = {
  id: string;
  title: string;
  youtubeId: string;
  description: string;
  subtopicName: string | null;
  subtopicSlug: string | null;
  domainId: string | null;
  categoryId: string | null;
  categoryName: string | null;
};

export type VideoCategory = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
};

/** The category rows a student may see — active ones, in display order. */
export async function getVideoCategories(
  supabase: SupabaseClient,
): Promise<VideoCategory[]> {
  const { data, error } = await supabase
    .from("video_categories")
    .select("id, slug, name, is_active")
    .eq("is_active", true)
    .order("position")
    .order("name");

  if (error) {
    logQueryError("video_categories", error);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    isActive: row.is_active as boolean,
  }));
}

type VideoRow = {
  id: string;
  title: string;
  youtube_id: string;
  description: string;
  subtopics: { name: string; slug: string; domain_id: string } | null;
  video_categories: { id: string; name: string; slug: string } | null;
};

function toVideoEntry(row: VideoRow): VideoEntry {
  return {
    id: row.id,
    title: row.title,
    youtubeId: row.youtube_id,
    description: row.description,
    subtopicName: row.subtopics?.name ?? null,
    subtopicSlug: row.subtopics?.slug ?? null,
    domainId: row.subtopics?.domain_id ?? null,
    categoryId: row.video_categories?.id ?? null,
    categoryName: row.video_categories?.name ?? null,
  };
}

/**
 * Both embeds are LEFT joins (no `!inner`) so a video with only one of the two
 * still comes back — switching them to inner is what would silently hide every
 * category video from the library.
 *
 * A filter on an embedded table needs that embed to be inner, though, so the
 * select string is chosen per filter rather than built by concatenation: the
 * Supabase client infers the row type from a string LITERAL, and `+` collapses
 * it to `string` and loses it.
 */
const VIDEO_SELECT_OPEN =
  "id, title, youtube_id, description, subtopics(name, slug, domain_id, position), video_categories(id, name, slug)";
const VIDEO_SELECT_BY_SUBTOPIC =
  "id, title, youtube_id, description, subtopics!inner(name, slug, domain_id, position), video_categories(id, name, slug)";
const VIDEO_SELECT_BY_CATEGORY =
  "id, title, youtube_id, description, subtopics(name, slug, domain_id, position), video_categories!inner(id, name, slug)";

export async function getVideos(
  supabase: SupabaseClient,
  filters: {
    domainId?: string;
    subtopicSlug?: string;
    categorySlug?: string;
  } = {},
): Promise<VideoEntry[]> {
  const bySubtopic = Boolean(filters.subtopicSlug || filters.domainId);
  const byCategory = Boolean(filters.categorySlug) && !bySubtopic;

  let query = supabase
    .from("videos")
    .select(
      bySubtopic
        ? VIDEO_SELECT_BY_SUBTOPIC
        : byCategory
          ? VIDEO_SELECT_BY_CATEGORY
          : VIDEO_SELECT_OPEN,
    )
    // Soft-deleted videos exist only for the admin panel.
    .eq("is_active", true)
    .order("title");

  if (filters.subtopicSlug) {
    query = query.eq("subtopics.slug", filters.subtopicSlug);
  } else if (filters.domainId) {
    query = query.eq("subtopics.domain_id", filters.domainId);
  } else if (filters.categorySlug) {
    query = query.eq("video_categories.slug", filters.categorySlug);
  }

  const { data, error } = await query;
  if (error) {
    logQueryError("videos", error);
    return [];
  }

  return ((data ?? []) as unknown as VideoRow[]).map(toVideoEntry);
}

/** One video by id, for the watch page. Unknown id → null → 404. */
export async function getVideo(
  supabase: SupabaseClient,
  videoId: string,
): Promise<VideoEntry | null> {
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_SELECT_OPEN)
    .eq("id", videoId)
    // A soft-deleted video's watch page 404s, same as an unknown id.
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    logQueryError("video", error);
    return null;
  }
  if (!data) return null;

  return toVideoEntry(data as unknown as VideoRow);
}

// --- Question bank -----------------------------------------------------------

/**
 * Picks the next batch of questions for the player. Never-attempted questions
 * come first; once everything has been seen, the least-recently-attempted
 * rotate back in. The rows shipped to the client carry no answer key — that
 * column is not even readable by this connection (see the migration's column
 * grant); verdicts come from the grading RPC at submit time.
 */
export async function getQuestionBatch(
  supabase: SupabaseClient,
  userId: string,
  filters: QuestionFilters,
  batchSize = 10,
): Promise<PlayableQuestion[]> {
  let query = supabase
    .from("questions")
    .select(
      "id, prompt, choices, difficulty, subtopics!inner(id, name, slug, domain_id)",
    )
    // Soft-deleted questions never enter a batch; past attempts on them keep
    // counting for streak/mastery, which read attempts, not questions.
    .eq("is_active", true)
    .limit(60);

  if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);

  // A subtopic filter implies its domain; when both arrive the subtopic wins.
  if (filters.subtopic) {
    query = query.eq("subtopics.slug", filters.subtopic);
  } else if (filters.domain) {
    const domains = await getDomains(supabase);
    const domain = domains.find((entry) => entry.slug === filters.domain);
    if (!domain) return [];
    query = query.eq("subtopics.domain_id", domain.id);
  }

  const { data, error } = await query;
  if (error) {
    logQueryError("question_batch", error);
    return [];
  }

  const candidates = ((data ?? []) as unknown as Array<{
    id: string;
    prompt: string;
    choices: unknown;
    difficulty: Difficulty;
    subtopics: { id: string; name: string; slug: string };
  }>).filter((row) => toChoices(row.choices).length === 4);

  if (candidates.length === 0) return [];

  // Most recent attempt per candidate question, to drive the rotation.
  const lastAttemptAt = new Map<string, number>();
  const { data: attempts, error: attemptsError } = await supabase
    .from("question_attempts")
    .select("question_id, attempted_at")
    .eq("user_id", userId)
    .in(
      "question_id",
      candidates.map((row) => row.id),
    )
    .order("attempted_at", { ascending: false })
    .limit(1000);

  if (attemptsError) logQueryError("question_batch_attempts", attemptsError);

  for (const attempt of (attempts ?? []) as Array<{
    question_id: string;
    attempted_at: string;
  }>) {
    if (!lastAttemptAt.has(attempt.question_id)) {
      lastAttemptAt.set(
        attempt.question_id,
        new Date(attempt.attempted_at).getTime(),
      );
    }
  }

  const ordered = [...candidates].sort((a, b) => {
    const lastA = lastAttemptAt.get(a.id) ?? 0; // 0 = never attempted → first
    const lastB = lastAttemptAt.get(b.id) ?? 0;
    return lastA - lastB;
  });

  const batch = ordered.slice(0, batchSize);

  // Which of the batch's subtopics have an explainer to link to after a miss.
  const subtopicIds = [...new Set(batch.map((row) => row.subtopics.id))];
  const { data: videoRows, error: videoError } = await supabase
    .from("videos")
    .select("subtopic_id")
    .eq("is_active", true)
    .in("subtopic_id", subtopicIds);

  if (videoError) logQueryError("question_batch_videos", videoError);

  const subtopicsWithVideo = new Set(
    ((videoRows ?? []) as Array<{ subtopic_id: string }>).map(
      (row) => row.subtopic_id,
    ),
  );

  return batch.map((row) => ({
    id: row.id,
    prompt: row.prompt,
    choices: toChoices(row.choices),
    difficulty: row.difficulty,
    subtopicName: row.subtopics.name,
    subtopicSlug: row.subtopics.slug,
    subtopicHasVideo: subtopicsWithVideo.has(row.subtopics.id),
  }));
}

// --- Practice tests ----------------------------------------------------------

export type SectionSummary = {
  id: string;
  title: string;
  description: string | null;
  timeLimitSeconds: number;
  questionCount: number;
  domainName: string;
  lastCompleted: { score: number; total: number; completedAt: string } | null;
  bestScore: { score: number; total: number } | null;
  /** An unfinished run whose clock has not run out. */
  active: { remainingSeconds: number } | null;
};

export async function getPracticeSections(
  supabase: SupabaseClient,
  userId: string,
): Promise<SectionSummary[]> {
  const [sectionsResult, attemptsResult] = await Promise.all([
    supabase
      .from("practice_sections")
      .select(
        "id, title, description, time_limit_seconds, domains!inner(name), practice_section_questions(question_id)",
      )
      .order("title"),
    supabase
      .from("practice_attempts")
      .select(
        "practice_section_id, score, total_questions, started_at, completed_at",
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(200),
  ]);

  if (sectionsResult.error) {
    logQueryError("practice_sections", sectionsResult.error);
    return [];
  }
  if (attemptsResult.error) {
    logQueryError("practice_attempts", attemptsResult.error);
  }

  const attempts = (attemptsResult.data ?? []) as Array<{
    practice_section_id: string;
    score: number | null;
    total_questions: number | null;
    started_at: string;
    completed_at: string | null;
  }>;

  return ((sectionsResult.data ?? []) as unknown as Array<{
    id: string;
    title: string;
    description: string | null;
    time_limit_seconds: number;
    domains: { name: string };
    practice_section_questions: Array<{ question_id: string }>;
  }>).map((section) => {
    const own = attempts.filter(
      (attempt) => attempt.practice_section_id === section.id,
    );

    const completed = own.filter(
      (attempt) =>
        attempt.completed_at !== null &&
        attempt.score !== null &&
        attempt.total_questions !== null,
    );

    const last = completed[0] ?? null;
    const best =
      completed.length > 0
        ? completed.reduce((a, b) => ((a.score ?? 0) >= (b.score ?? 0) ? a : b))
        : null;

    let active: SectionSummary["active"] = null;
    for (const attempt of own) {
      if (attempt.completed_at !== null) continue;
      const deadline =
        new Date(attempt.started_at).getTime() +
        section.time_limit_seconds * 1000;
      const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);
      if (remainingSeconds > 0) {
        active = { remainingSeconds };
        break;
      }
    }

    return {
      id: section.id,
      title: section.title,
      description: section.description,
      timeLimitSeconds: section.time_limit_seconds,
      questionCount: section.practice_section_questions.length,
      domainName: section.domains.name,
      lastCompleted: last
        ? {
            score: last.score as number,
            total: last.total_questions as number,
            completedAt: last.completed_at as string,
          }
        : null,
      bestScore: best
        ? { score: best.score as number, total: best.total_questions as number }
        : null,
      active,
    };
  });
}

export type ActiveAttempt = {
  attemptId: string;
  /** Epoch ms when the run's clock hits zero. */
  deadlineMs: number;
};

/** The caller's unfinished, unexpired run for a section, if one exists. */
export async function getActivePracticeAttempt(
  supabase: SupabaseClient,
  userId: string,
  sectionId: string,
  timeLimitSeconds: number,
): Promise<ActiveAttempt | null> {
  const { data, error } = await supabase
    .from("practice_attempts")
    .select("id, started_at")
    .eq("user_id", userId)
    .eq("practice_section_id", sectionId)
    .is("completed_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logQueryError("active_attempt", error);
    return null;
  }
  if (!data) return null;

  const deadlineMs =
    new Date(data.started_at).getTime() + timeLimitSeconds * 1000;
  if (deadlineMs <= Date.now()) return null;

  return { attemptId: data.id, deadlineMs };
}

export type SectionDetail = {
  id: string;
  title: string;
  description: string | null;
  timeLimitSeconds: number;
  domainName: string;
};

export async function getSection(
  supabase: SupabaseClient,
  sectionId: string,
): Promise<SectionDetail | null> {
  const { data, error } = await supabase
    .from("practice_sections")
    .select("id, title, description, time_limit_seconds, domains!inner(name)")
    .eq("id", sectionId)
    .maybeSingle();

  if (error) {
    logQueryError("section", error);
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    timeLimitSeconds: data.time_limit_seconds,
    domainName: (data.domains as unknown as { name: string }).name,
  };
}

export async function getSectionQuestions(
  supabase: SupabaseClient,
  sectionId: string,
): Promise<PracticeQuestion[]> {
  const { data, error } = await supabase
    .from("practice_section_questions")
    .select("position, questions!inner(id, prompt, choices)")
    .eq("section_id", sectionId)
    .order("position");

  if (error) {
    logQueryError("section_questions", error);
    return [];
  }

  return ((data ?? []) as unknown as Array<{
    questions: { id: string; prompt: string; choices: unknown };
  }>)
    .map((row) => ({
      id: row.questions.id,
      prompt: row.questions.prompt,
      choices: toChoices(row.questions.choices),
    }))
    .filter((question) => question.choices.length === 4);
}

// --- Practice results --------------------------------------------------------

export type ResultItem = {
  position: number;
  prompt: string;
  choices: string[];
  selectedChoice: number | null;
  isCorrect: boolean | null;
  /** From the solutions view — present once the run is completed. */
  correctChoice: number | null;
  explanation: string | null;
  subtopicName: string;
  subtopicSlug: string;
  subtopicHasVideo: boolean;
};

export type PracticeResults = {
  attemptId: string;
  sectionTitle: string;
  domainName: string;
  score: number;
  total: number;
  timeTakenSeconds: number;
  timeLimitSeconds: number;
  completedAt: string;
  items: ResultItem[];
};

export async function getPracticeResults(
  supabase: SupabaseClient,
  attemptId: string,
): Promise<PracticeResults | null> {
  // RLS restricts this to the caller's own attempts; someone else's attempt
  // id resolves to "not found", not "forbidden".
  const { data: attempt, error: attemptError } = await supabase
    .from("practice_attempts")
    .select(
      "id, practice_section_id, score, total_questions, time_taken_seconds, completed_at, practice_sections!inner(title, time_limit_seconds, domains!inner(name))",
    )
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptError) {
    logQueryError("results_attempt", attemptError);
    return null;
  }
  if (!attempt || attempt.completed_at === null) return null;

  const section = attempt.practice_sections as unknown as {
    title: string;
    time_limit_seconds: number;
    domains: { name: string };
  };

  const [questionsResult, answersResult] = await Promise.all([
    supabase
      .from("practice_section_questions")
      .select(
        "position, questions!inner(id, prompt, choices, subtopics!inner(id, name, slug))",
      )
      .eq("section_id", attempt.practice_section_id)
      .order("position"),
    supabase
      .from("question_attempts")
      .select("question_id, selected_choice, is_correct")
      .eq("practice_attempt_id", attemptId),
  ]);

  if (questionsResult.error) {
    logQueryError("results_questions", questionsResult.error);
    return null;
  }
  if (answersResult.error) logQueryError("results_answers", answersResult.error);

  const questionRows = (questionsResult.data ?? []) as unknown as Array<{
    position: number;
    questions: {
      id: string;
      prompt: string;
      choices: unknown;
      subtopics: { id: string; name: string; slug: string };
    };
  }>;

  const questionIds = questionRows.map((row) => row.questions.id);
  const subtopicIds = [
    ...new Set(questionRows.map((row) => row.questions.subtopics.id)),
  ];

  // The solutions view releases the answer key for completed runs only —
  // which this attempt is, per the completed_at check above.
  const [solutionsResult, videosResult] = await Promise.all([
    supabase
      .from("attempted_question_solutions")
      .select("question_id, correct_choice, explanation")
      .in("question_id", questionIds),
    supabase
      .from("videos")
      .select("subtopic_id")
      .eq("is_active", true)
      .in("subtopic_id", subtopicIds),
  ]);

  if (solutionsResult.error) {
    logQueryError("results_solutions", solutionsResult.error);
  }
  if (videosResult.error) logQueryError("results_videos", videosResult.error);

  const answers = new Map<
    string,
    { selected_choice: number; is_correct: boolean }
  >();
  for (const row of (answersResult.data ?? []) as Array<{
    question_id: string;
    selected_choice: number;
    is_correct: boolean;
  }>) {
    answers.set(row.question_id, row);
  }

  const solutions = new Map<
    string,
    { correct_choice: number; explanation: string }
  >();
  for (const row of (solutionsResult.data ?? []) as Array<{
    question_id: string;
    correct_choice: number;
    explanation: string;
  }>) {
    solutions.set(row.question_id, row);
  }

  const subtopicsWithVideo = new Set(
    ((videosResult.data ?? []) as Array<{ subtopic_id: string }>).map(
      (row) => row.subtopic_id,
    ),
  );

  return {
    attemptId: attempt.id,
    sectionTitle: section.title,
    domainName: section.domains.name,
    score: attempt.score ?? 0,
    total: attempt.total_questions ?? questionRows.length,
    timeTakenSeconds: attempt.time_taken_seconds ?? 0,
    timeLimitSeconds: section.time_limit_seconds,
    completedAt: attempt.completed_at,
    items: questionRows.map((row) => {
      const answer = answers.get(row.questions.id);
      const solution = solutions.get(row.questions.id);
      return {
        position: row.position,
        prompt: row.questions.prompt,
        choices: toChoices(row.questions.choices),
        selectedChoice: answer?.selected_choice ?? null,
        isCorrect: answer?.is_correct ?? null,
        correctChoice: solution?.correct_choice ?? null,
        explanation: solution?.explanation ?? null,
        subtopicName: row.questions.subtopics.name,
        subtopicSlug: row.questions.subtopics.slug,
        subtopicHasVideo: subtopicsWithVideo.has(row.questions.subtopics.id),
      };
    }),
  };
}
