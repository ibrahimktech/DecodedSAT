import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPostHogManagementConfigured,
  queryPostHog,
} from "@/lib/analytics/posthog-server";

export type RangeKey = "today" | "7d" | "30d" | "90d" | "all" | "custom";
export type AnalyticsRange = {
  key: RangeKey;
  from: string | null;
  to: string;
  label: string;
  customFrom?: string;
  customTo?: string;
};

function validDay(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function resolveAnalyticsRange(input: {
  range?: string;
  from?: string;
  to?: string;
}): AnalyticsRange {
  const now = new Date();
  const key: RangeKey = ["today", "7d", "30d", "90d", "all", "custom"].includes(input.range || "")
    ? (input.range as RangeKey)
    : "30d";

  if (key === "all") return { key, from: null, to: now.toISOString(), label: "All time" };
  if (key === "custom" && validDay(input.from) && validDay(input.to) && input.from <= input.to) {
    const exclusiveTo = new Date(`${input.to}T00:00:00Z`);
    exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);
    return {
      key,
      from: `${input.from}T00:00:00.000Z`,
      to: exclusiveTo.toISOString(),
      label: `${input.from} to ${input.to}`,
      customFrom: input.from,
      customTo: input.to,
    };
  }

  const from = new Date(now);
  if (key === "today") from.setUTCHours(0, 0, 0, 0);
  else from.setUTCDate(from.getUTCDate() - Number.parseInt(key, 10));
  return {
    key: key === "custom" ? "30d" : key,
    from: from.toISOString(),
    to: now.toISOString(),
    label: key === "today" ? "Today" : `Last ${Number.parseInt(key === "custom" ? "30" : key, 10)} days`,
  };
}

async function rpc<T>(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

const dates = (range: AnalyticsRange) => ({ p_from: range.from, p_to: range.to });

export type OverviewData = {
  kpis: Record<string, number | null>;
  series: Array<Record<string, number | string | null>>;
  needsAttention: Array<{
    entityId: string;
    kind: "question" | "video" | "flow" | "usage";
    label: string;
    reason: string;
    value: number;
    sampleSize: number;
  }>;
};

export const getOverview = (supabase: SupabaseClient, range: AnalyticsRange) =>
  rpc<OverviewData>(supabase, "admin_analytics_overview", dates(range));
export const getRecentActivity = (supabase: SupabaseClient, range: AnalyticsRange) =>
  rpc<Record<string, unknown>[]>(supabase, "admin_analytics_recent_activity", {
    ...dates(range),
    p_limit: 30,
  });
export const getAnalyticsUsers = (
  supabase: SupabaseClient,
  range: AnalyticsRange,
  search: string,
  sort: string,
  page = 1,
) =>
  rpc<Record<string, unknown>[]>(supabase, "admin_analytics_users", {
    ...dates(range),
    p_search: search || null,
    p_sort: sort,
    p_limit: 50,
    p_offset: Math.max(0, page - 1) * 50,
  });
export const getAnalyticsUser = (supabase: SupabaseClient, range: AnalyticsRange, userId: string) =>
  rpc<Record<string, unknown> | null>(supabase, "admin_analytics_user_detail", {
    ...dates(range),
    p_user_id: userId,
  });
export const getAnalyticsQuestions = (
  supabase: SupabaseClient,
  range: AnalyticsRange,
  sort: string,
  page = 1,
) =>
  rpc<Record<string, unknown>[]>(supabase, "admin_analytics_questions", {
    ...dates(range),
    p_sort: sort,
    p_limit: 50,
    p_offset: Math.max(0, page - 1) * 50,
  });
export const getAnalyticsQuestion = (supabase: SupabaseClient, range: AnalyticsRange, questionId: string) =>
  rpc<Record<string, unknown> | null>(supabase, "admin_analytics_question_detail", {
    ...dates(range),
    p_question_id: questionId,
  });
export const getAnalyticsVideos = (
  supabase: SupabaseClient,
  range: AnalyticsRange,
  type: string,
  sort: string,
  page = 1,
) =>
  rpc<Record<string, unknown>[]>(supabase, "admin_analytics_videos", {
    ...dates(range),
    p_video_type: type,
    p_sort: sort,
    p_limit: 50,
    p_offset: Math.max(0, page - 1) * 50,
  });
export const getRetention = (supabase: SupabaseClient, range: AnalyticsRange) =>
  rpc<Record<string, unknown>[]>(supabase, "admin_analytics_retention", dates(range));
export const getSessions = (supabase: SupabaseClient, range: AnalyticsRange, page = 1) =>
  rpc<Record<string, unknown>[]>(supabase, "admin_analytics_sessions", {
    ...dates(range),
    p_limit: 50,
    p_offset: Math.max(0, page - 1) * 50,
  });

export type TrafficData = {
  configured: boolean;
  sources: Array<Array<string | number | null>>;
  columns: string[];
  funnel: Array<Array<string | number | null>>;
  breakdowns: Array<Array<string | number | null>>;
  productFunnels: Array<Array<string | number | null>>;
};

export async function getTraffic(
  supabase: SupabaseClient,
  range: AnalyticsRange,
): Promise<TrafficData> {
  if (!isPostHogManagementConfigured()) {
    return { configured: false, sources: [], columns: [], funnel: [], breakdowns: [], productFunnels: [] };
  }
  const from = (range.from ?? "1970-01-01T00:00:00.000Z").replace(/'/g, "");
  const to = range.to.replace(/'/g, "");
  const { data: rawAdminIds, error: adminIdsError } = await supabase.rpc(
    "admin_analytics_admin_ids",
  );
  if (adminIdsError) throw adminIdsError;
  const adminIds = (rawAdminIds ?? [])
    .map((row: unknown) => typeof row === "string" ? row : (row as { admin_analytics_admin_ids?: string }).admin_analytics_admin_ids)
    .filter((id: unknown): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));
  const adminClause = adminIds.length > 0
    ? `and distinct_id not in (${adminIds.map((id: string) => `'${id}'`).join(",")})`
    : "";
  const where = `timestamp >= toDateTime('${from}') and timestamp < toDateTime('${to}') and coalesce(properties.account_role, 'anonymous') != 'admin' ${adminClause}`;

  const [sources, funnel, breakdowns, productFunnels] = await Promise.all([
    queryPostHog<{ columns?: string[]; results?: Array<Array<string | number | null>> }>(`
      select
        coalesce(nullIf(properties.initial_utm_source, ''), nullIf(properties.initial_referrer, ''), 'Direct') as source,
        coalesce(nullIf(properties.initial_utm_medium, ''), 'None') as medium,
        coalesce(nullIf(properties.initial_utm_campaign, ''), 'None') as campaign,
        coalesce(nullIf(properties.initial_referrer, ''), 'Direct') as referrer,
        coalesce(nullIf(properties.initial_landing_page, ''), 'Unknown') as landing_page,
        uniq(distinct_id) as visitors,
        uniqIf(distinct_id, event = 'user_registered') as signups,
        round(100.0 * uniqIf(distinct_id, event = 'user_registered') / nullIf(uniq(distinct_id), 0), 1) as signup_conversion_percent,
        uniqIf(distinct_id, event = 'question_answered') as answered_one,
        uniqIf(distinct_id, event = 'question_answered' and distinct_id in (
          select distinct_id from events where ${where} and event = 'question_answered' group by distinct_id having count() >= 5
        )) as answered_five,
        countIf(event = 'question_answered') as questions_answered,
        round(countIf(event = 'question_answered') / nullIf(uniq(distinct_id), 0), 1) as average_questions,
        if(
          uniqIf(
            distinct_id,
            event = 'user_registered' and timestamp < toDateTime('${to}') - interval 1 day
          ) >= 5,
          round(100.0 * uniqIf(
            distinct_id,
            event in ('question_answered', 'practice_started', 'video_started', 'explanation_video_started', 'explanation_opened')
              and properties.days_since_signup = 1
              and distinct_id in (
                select distinct_id from events
                where ${where}
                  and event = 'user_registered'
                  and timestamp < toDateTime('${to}') - interval 1 day
              )
          ) / nullIf(uniqIf(
            distinct_id,
            event = 'user_registered' and timestamp < toDateTime('${to}') - interval 1 day
          ), 0), 1),
          null
        ) as day_1_retention_percent,
        if(
          uniqIf(
            distinct_id,
            event = 'user_registered' and timestamp < toDateTime('${to}') - interval 7 day
          ) >= 5,
          round(100.0 * uniqIf(
            distinct_id,
            event in ('question_answered', 'practice_started', 'video_started', 'explanation_video_started', 'explanation_opened')
              and properties.days_since_signup = 7
              and distinct_id in (
                select distinct_id from events
                where ${where}
                  and event = 'user_registered'
                  and timestamp < toDateTime('${to}') - interval 7 day
              )
          ) / nullIf(uniqIf(
            distinct_id,
            event = 'user_registered' and timestamp < toDateTime('${to}') - interval 7 day
          ), 0), 1),
          null
        ) as day_7_retention_percent
      from events
      where ${where}
      group by source, medium, campaign, referrer, landing_page
      order by visitors desc
      limit 50
    `),
    queryPostHog<{ results?: Array<Array<string | number | null>> }>(`
      select stage, users from (
        select 1 as position, 'Landing viewed' as stage, uniqIf(distinct_id, event = '$pageview') as users from events where ${where}
        union all select 2, 'Signed up', uniqIf(distinct_id, event = 'user_registered') from events where ${where}
        union all select 3, 'Onboarding completed', uniqIf(distinct_id, event = 'onboarding_completed') from events where ${where}
        union all select 4, 'Answered a question', uniqIf(distinct_id, event = 'question_answered') from events where ${where}
        union all select 5, 'Answered 5 questions', uniqIf(distinct_id, event = 'question_answered' and distinct_id in (
          select distinct_id from events where ${where} and event = 'question_answered' group by distinct_id having count() >= 5
        )) from events where ${where}
        union all select 6, 'Returned next day', uniqIf(distinct_id,
          event in ('question_answered', 'practice_started', 'video_started', 'explanation_video_started', 'explanation_opened')
          and properties.days_since_signup = 1
        ) from events where ${where}
      ) order by position
    `),
    queryPostHog<{ results?: Array<Array<string | number | null>> }>(`
      select dimension, value, visitors from (
        select 'Country / location' as dimension, coalesce(properties.$geoip_country_name, 'Unknown') as value, uniq(distinct_id) as visitors from events where ${where} group by value
        union all select 'Device', coalesce(properties.$device_type, 'Unknown'), uniq(distinct_id) from events where ${where} group by coalesce(properties.$device_type, 'Unknown')
        union all select 'Browser', coalesce(properties.$browser, 'Unknown'), uniq(distinct_id) from events where ${where} group by coalesce(properties.$browser, 'Unknown')
        union all select 'Landing page', coalesce(properties.$pathname, 'Unknown'), uniq(distinct_id) from events where ${where} and event = '$pageview' group by coalesce(properties.$pathname, 'Unknown')
      ) order by dimension, visitors desc
      limit 100
    `),
    queryPostHog<{ results?: Array<Array<string | number | null>> }>(`
      select funnel, position, stage, users from (
        select 'Practice' as funnel, 1 as position, 'Practice opened' as stage, uniqIf(distinct_id, event = 'practice_started') as users from events where ${where}
        union all select 'Practice', 2, 'Question viewed', uniqIf(distinct_id, event = 'question_viewed') from events where ${where}
        union all select 'Practice', 3, 'Answer submitted', uniqIf(distinct_id, event = 'question_answered') from events where ${where}
        union all select 'Practice', 4, 'Practice completed', uniqIf(distinct_id, event = 'practice_completed') from events where ${where}
        union all select 'Explanation', 1, 'Incorrect answer', uniqIf(distinct_id, event = 'question_answered' and properties.correct = false) from events where ${where}
        union all select 'Explanation', 2, 'Explanation opened', uniqIf(distinct_id, event = 'explanation_opened') from events where ${where}
        union all select 'Explanation', 3, 'Watch clicked', uniqIf(distinct_id, event = 'watch_explanation_clicked') from events where ${where}
        union all select 'Explanation', 4, 'Video started', uniqIf(distinct_id, event = 'explanation_video_started') from events where ${where}
        union all select 'Explanation', 5, 'Video completed', uniqIf(distinct_id, event = 'explanation_video_completed') from events where ${where}
        union all select 'Video', 1, 'Video started', uniqIf(distinct_id, event in ('video_started', 'explanation_video_started')) from events where ${where}
        union all select 'Video', 2, 'Reached 25%', uniqIf(distinct_id, event in ('video_25', 'explanation_video_25')) from events where ${where}
        union all select 'Video', 3, 'Reached 50%', uniqIf(distinct_id, event in ('video_50', 'explanation_video_50')) from events where ${where}
        union all select 'Video', 4, 'Reached 75%', uniqIf(distinct_id, event in ('video_75', 'explanation_video_75')) from events where ${where}
        union all select 'Video', 5, 'Completed', uniqIf(distinct_id, event in ('video_completed', 'explanation_video_completed')) from events where ${where}
      ) order by funnel, position
    `),
  ]);
  return {
    configured: true,
    columns: sources.columns ?? [],
    sources: sources.results ?? [],
    funnel: funnel.results ?? [],
    breakdowns: breakdowns.results ?? [],
    productFunnels: productFunnels.results ?? [],
  };
}
