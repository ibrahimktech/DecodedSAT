import type { Metadata } from "next";
import Link from "next/link";
import {
  AnalyticsTabs,
  DataError,
  DateRangeFilter,
  EmptyState,
  MetricCard,
  MiniBars,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/components/admin/analytics/AnalyticsUi";
import {
  getAnalyticsQuestions,
  getAnalyticsUsers,
  getAnalyticsVideos,
  getOverview,
  getRecentActivity,
  getRetention,
  getSessions,
  getTraffic,
  resolveAnalyticsRange,
  type AnalyticsRange,
} from "@/lib/analytics/admin-data";
import { requireAdmin } from "@/lib/auth/admin";

export const metadata: Metadata = { title: "Analytics" };

const VIEWS = new Set(["overview", "users", "questions", "videos", "traffic", "retention", "sessions"]);
type Params = Record<string, string | string[] | undefined>;
const textParam = (value: string | string[] | undefined) => typeof value === "string" ? value : "";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;
  const requestedView = textParam(params.view);
  const view = VIEWS.has(requestedView) ? requestedView : "overview";
  const range = resolveAnalyticsRange({
    range: textParam(params.range),
    from: textParam(params.from),
    to: textParam(params.to),
  });
  const parsedPage = Number.parseInt(textParam(params.page) || "1", 10);
  const page = Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1;

  let loaded: unknown;
  let failed = false;
  try {
    if (view === "users") {
      loaded = await getAnalyticsUsers(supabase, range, textParam(params.search), textParam(params.sort) || "active_desc", page);
    } else if (view === "questions") {
      loaded = await getAnalyticsQuestions(supabase, range, textParam(params.sort) || "attempts_desc", page);
    } else if (view === "videos") {
      loaded = await getAnalyticsVideos(supabase, range, textParam(params.type) || "all", textParam(params.sort) || "starts_desc", page);
    } else if (view === "traffic") {
      loaded = await getTraffic(supabase, range);
    } else if (view === "retention") {
      loaded = await getRetention(supabase, range);
    } else if (view === "sessions") {
      loaded = await getSessions(supabase, range, page);
    } else {
      const [overview, activity, retention] = await Promise.all([
        getOverview(supabase, range),
        getRecentActivity(supabase, range),
        getRetention(supabase, range),
      ]);
      loaded = { overview, activity, retention };
    }
  } catch (error) {
    console.error("[admin analytics] query failed", { view, error });
    failed = true;
  }

  let content: React.ReactNode;
  if (failed) content = <DataError />;
  else if (view === "users") content = <UsersView rows={loaded as Record<string, unknown>[]} range={range} search={textParam(params.search)} sort={textParam(params.sort) || "active_desc"} page={page} />;
  else if (view === "questions") content = <QuestionsView rows={loaded as Record<string, unknown>[]} range={range} sort={textParam(params.sort) || "attempts_desc"} page={page} />;
  else if (view === "videos") content = <VideosView rows={loaded as Record<string, unknown>[]} range={range} type={textParam(params.type) || "all"} sort={textParam(params.sort) || "starts_desc"} page={page} />;
  else if (view === "traffic") content = <TrafficView data={loaded as Awaited<ReturnType<typeof getTraffic>>} />;
  else if (view === "retention") content = <RetentionView rows={loaded as Record<string, unknown>[]} />;
  else if (view === "sessions") content = <SessionsView rows={loaded as Record<string, unknown>[]} range={range} page={page} />;
  else {
    const bundle = loaded as {
      overview: Awaited<ReturnType<typeof getOverview>>;
      activity: Record<string, unknown>[];
      retention: Record<string, unknown>[];
    };
    content = <OverviewView data={bundle.overview} activity={bundle.activity} retention={bundle.retention} />;
  }

  return (
    <div className="mx-auto max-w-7xl">
      <header>
        <h1 className="font-display text-3xl font-extrabold text-ink">Student analytics</h1>
        <p className="mt-2 max-w-3xl text-[0.9375rem] text-muted">
          Learning behavior from Supabase, with journeys and acquisition from PostHog. Admin accounts are excluded at collection and query time.
        </p>
      </header>
      <AnalyticsTabs active={view} />
      <DateRangeFilter range={range} view={view} />
      <p className="mt-2 text-xs text-muted">Showing {range.label}. Date boundaries use UTC; timestamps are displayed in this browser&apos;s locale.</p>
      <div className="mt-6">{content}</div>
    </div>
  );
}

function kpi(data: Record<string, number | null>, key: string): number | null {
  const value = data[key];
  return typeof value === "number" ? value : null;
}

function retentionValue(rows: Record<string, unknown>[], key: string): unknown {
  return rows.find((row) => row[key] !== null && row[key] !== undefined)?.[key] ?? null;
}

function OverviewView({
  data,
  activity,
  retention,
}: {
  data: Awaited<ReturnType<typeof getOverview>>;
  activity: Record<string, unknown>[];
  retention: Record<string, unknown>[];
}) {
  const cards = [
    ["Active now", formatNumber(kpi(data.kpis, "activeNow")), "Meaningful student activity in the last 5 minutes."],
    ["Active today", formatNumber(kpi(data.kpis, "activeToday")), "Students with meaningful learning activity today."],
    ["WAU", formatNumber(kpi(data.kpis, "weeklyActiveUsers")), "Unique students active in the last 7 days."],
    ["MAU", formatNumber(kpi(data.kpis, "monthlyActiveUsers")), "Unique students active in the last 30 days."],
    ["New users", formatNumber(kpi(data.kpis, "newUsers")), "Student profile registrations in this range."],
    ["Returning users", formatNumber(kpi(data.kpis, "returningUsers")), "Active in this range with earlier learning activity."],
    ["Questions answered", formatNumber(kpi(data.kpis, "questionsAnswered")), "Durable question-bank and practice-test answers."],
    ["Correct answers", formatNumber(kpi(data.kpis, "correctAnswers")), "Submitted answers marked correct in this range."],
    ["Accuracy", formatPercent(kpi(data.kpis, "accuracy")), "Correct answers divided by submitted answers."],
    ["Questions / active user", String(kpi(data.kpis, "averageQuestionsPerActiveUser") ?? "—"), "Submitted answers per active student in this range."],
    ["Avg. session", formatDuration(kpi(data.kpis, "averageSessionSeconds")), "Tracked meaningful-session duration."],
    ["Practice sessions", formatNumber(kpi(data.kpis, "practiceSessions")), "Question-bank sittings, timed sections and practice tests."],
    ["Videos started", formatNumber(kpi(data.kpis, "videosStarted")), "General and question-explanation video starts."],
    ["Videos completed", formatNumber(kpi(data.kpis, "videosCompleted")), "Players that reached completion."],
    ["Explanation videos", formatNumber(kpi(data.kpis, "explanationVideosWatched")), "Question-linked explanation starts."],
    ["Give-up rate", formatPercent(kpi(data.kpis, "giveUpRate")), "Meaningful question views left after at least 30 seconds without submission."],
    ["Day-1 retention", formatPercent(retentionValue(retention, "day_1")), "Meaningful learning activity exactly one calendar day after signup; hidden below 5 users."],
    ["Day-7 retention", formatPercent(retentionValue(retention, "day_7")), "Meaningful learning activity exactly seven calendar days after signup; hidden below 5 users."],
  ];
  const series = data.series;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {cards.map(([label, value, title]) => <MetricCard key={label} label={label} value={value} title={title} />)}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <MiniBars title="Active students" rows={series.map((row) => ({ label: String(row.date), value: Number(row.activeUsers || 0) }))} />
        <MiniBars title="New registrations" rows={series.map((row) => ({ label: String(row.date), value: Number(row.newUsers || 0) }))} />
        <MiniBars title="Returning students" rows={series.map((row) => ({ label: String(row.date), value: Number(row.returningUsers || 0) }))} />
        <MiniBars title="Questions answered" rows={series.map((row) => ({ label: String(row.date), value: Number(row.questionsAnswered || 0) }))} />
        <MiniBars title="Practice sessions" rows={series.map((row) => ({ label: String(row.date), value: Number(row.practiceSessions || 0) }))} />
        <MiniBars title="Average accuracy (%)" rows={series.map((row) => ({ label: String(row.date), value: Number(row.accuracy || 0) }))} />
        <MiniBars title="Video starts" rows={series.map((row) => ({ label: String(row.date), value: Number(row.videoStarts || 0) }))} />
        <MiniBars title="Explanation video starts" rows={series.map((row) => ({ label: String(row.date), value: Number(row.explanationVideoStarts || 0) }))} />
        <MiniBars title="Videos completed" rows={series.map((row) => ({ label: String(row.date), value: Number(row.videoCompletions || 0) }))} />
        <MiniBars title="Give-up rate (%)" rows={series.map((row) => ({ label: String(row.date), value: Number(row.giveUpRate || 0) }))} />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <h2 className="font-display text-xl font-bold text-ink">Needs attention</h2>
          <p className="mt-1 text-sm text-muted">Only signals with at least 10 samples (or 3 reports) appear.</p>
          {data.needsAttention.length === 0 ? <EmptyState text="No high-confidence issues in this period." /> : (
            <div className="mt-4 divide-y divide-hairline">
              {data.needsAttention.map((item) => (
                <Link key={`${item.kind}-${item.entityId}-${item.reason}`} href={item.kind === "question" ? `/admin/analytics/questions/${item.entityId}` : item.kind === "video" ? `/admin/analytics?view=videos&range=30d` : `/admin/analytics?view=overview&range=30d`} className="block py-3 first:pt-0 hover:text-accent">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="font-semibold text-ink">{item.label}</p><p className="text-sm text-miss-ink">{item.reason}</p></div>
                    <span className="text-sm font-bold tabular-nums text-ink">{item.reason === "Repeated reports" ? item.value : `${item.value}%`}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Based on {item.sampleSize} events</p>
                </Link>
              ))}
            </div>
          )}
        </section>
        <RecentActivity rows={activity} />
      </div>
    </>
  );
}

const EVENT_LABELS: Record<string, string> = {
  question_answered: "answered a question",
  question_skipped: "skipped a question",
  question_gave_up: "likely gave up on a question",
  question_struggled: "showed a struggle signal on a question",
  explanation_opened: "opened a written explanation",
  watch_explanation_clicked: "opened a filmed explanation",
  explanation_video_started: "started an explanation video",
  explanation_video_completed: "completed an explanation video",
  video_started: "started a video",
  video_completed: "completed a video",
  practice_started: "started practice",
  practice_completed: "completed practice",
  registered: "registered",
  question_reported: "reported a question",
};

function RecentActivity({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5">
      <h2 className="font-display text-xl font-bold text-ink">Recent student activity</h2>
      {rows.length === 0 ? <EmptyState text="No student activity in this period." /> : (
        <div className="mt-4 divide-y divide-hairline">
          {rows.slice(0, 20).map((row) => {
            const userId = String(row.user_id || "");
            const questionId = typeof row.question_id === "string" ? row.question_id : null;
            const correct = row.is_correct;
            return (
              <div key={String(row.activity_id)} className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted">
                  <Link href={`/admin/analytics/users/${userId}`} className="font-semibold text-ink hover:text-accent">{String(row.full_name || row.email || "Student")}</Link>{" "}
                  {EVENT_LABELS[String(row.event_name)] || String(row.event_name).replaceAll("_", " ")}
                  {correct === true ? " correctly" : correct === false ? " incorrectly" : ""}
                  {questionId && <> · <Link href={`/admin/analytics/questions/${questionId}`} className="font-medium text-accent">Question {questionId.slice(0, 8)}</Link></>}
                </p>
                <time className="shrink-0 text-xs text-muted">{formatDate(row.occurred_at)}</time>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-hairline bg-surface"><table className="w-full min-w-[760px] text-left text-sm">{children}</table></div>;
}
const TH = ({ children }: { children: React.ReactNode }) => <th className="border-b border-hairline bg-background px-4 py-3 text-xs font-bold uppercase tracking-wide text-muted">{children}</th>;
const TD = ({ children }: { children: React.ReactNode }) => <td className="border-b border-hairline px-4 py-3 align-top text-ink last:border-b-0">{children}</td>;

const PAGE_SIZE = 50;

function Pagination({
  page,
  total,
  view,
  range,
  extras = {},
}: {
  page: number;
  total: number;
  view: string;
  range: AnalyticsRange;
  extras?: Record<string, string>;
}) {
  const totalPages = Math.max(page, Math.ceil(total / PAGE_SIZE), 1);
  if (totalPages <= 1) return null;

  const hrefFor = (nextPage: number) => {
    const query = new URLSearchParams({ view, range: range.key, page: String(nextPage) });
    if (range.customFrom) query.set("from", range.customFrom);
    if (range.customTo) query.set("to", range.customTo);
    for (const [key, value] of Object.entries(extras)) {
      if (value) query.set(key, value);
    }
    return `/admin/analytics?${query.toString()}`;
  };

  return (
    <nav aria-label={`${view} pagination`} className="mt-4 flex items-center justify-between gap-3 text-sm">
      {page > 1 ? <Link href={hrefFor(page - 1)} className="rounded-xl border border-hairline bg-surface px-4 py-2 font-semibold text-ink hover:bg-background">Previous</Link> : <span />}
      <span className="text-muted">Page {page} of {totalPages}</span>
      {page < totalPages ? <Link href={hrefFor(page + 1)} className="rounded-xl border border-hairline bg-surface px-4 py-2 font-semibold text-ink hover:bg-background">Next</Link> : <span />}
    </nav>
  );
}

function UsersView({ rows, range, search, sort, page }: { rows: Record<string, unknown>[]; range: AnalyticsRange; search: string; sort: string; page: number }) {
  const total = Number(rows[0]?.total_count || 0);
  return (
    <>
      <form className="mb-4 flex flex-wrap gap-2" method="get">
        <input type="hidden" name="view" value="users" /><input type="hidden" name="range" value={range.key} />{range.customFrom && <input type="hidden" name="from" value={range.customFrom} />}{range.customTo && <input type="hidden" name="to" value={range.customTo} />}
        <input name="search" defaultValue={search} placeholder="Search name or email" className="min-w-64 rounded-xl border border-hairline bg-surface px-3.5 py-2 text-sm" />
        <select name="sort" defaultValue={sort} className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm">
          <option value="active_desc">Most active</option><option value="questions_desc">Most questions</option><option value="accuracy_desc">Highest accuracy</option><option value="accuracy_asc">Lowest accuracy</option><option value="inactive_desc">Longest inactive</option><option value="signup_desc">Newest signup</option><option value="explanations_desc">Most explanations</option>
        </select>
        <button className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white">Filter</button>
      </form>
      {rows.length === 0 ? <EmptyState text="No students match this period and search." /> : (
        <Table><thead><tr><TH>Student</TH><TH>Joined</TH><TH>Last active</TH><TH>Status</TH><TH>Sessions</TH><TH>Questions</TH><TH>Last question</TH><TH>Accuracy</TH><TH>Explanations</TH><TH>Videos</TH><TH>Avg. answer</TH><TH>Study time</TH></tr></thead><tbody>
          {rows.map((row) => <tr key={String(row.user_id)}><TD><Link href={`/admin/analytics/users/${String(row.user_id)}`} className="font-semibold hover:text-accent">{String(row.full_name || "Unnamed student")}</Link><p className="text-xs text-muted">{String(row.email || "")}</p></TD><TD>{formatDate(row.joined_at)}</TD><TD>{formatDate(row.last_active)}</TD><TD><span className={row.current_status === "offline" ? "text-muted" : "font-semibold text-accent"}>{String(row.current_status || "offline").replaceAll("_", " ")}</span></TD><TD>{formatNumber(row.sessions_count)}</TD><TD>{formatNumber(row.questions_attempted)}</TD><TD>{Boolean(row.last_question_id) ? <Link href={`/admin/analytics/questions/${String(row.last_question_id)}`} className="font-semibold text-accent">{String(row.last_question_id).slice(0, 8)}</Link> : "\u2014"}</TD><TD>{formatPercent(row.accuracy)}</TD><TD>{formatNumber(row.explanation_videos_watched)}</TD><TD>{formatNumber(row.total_videos_watched)}</TD><TD>{formatDuration(Number(row.average_answer_time_ms) / 1000)}</TD><TD>{formatDuration(row.estimated_study_seconds)}</TD></tr>)}
        </tbody></Table>
      )}
      <Pagination page={page} total={total} view="users" range={range} extras={{ search, sort }} />
    </>
  );
}

function QuestionsView({ rows, range, sort, page }: { rows: Record<string, unknown>[]; range: AnalyticsRange; sort: string; page: number }) {
  const total = Number(rows[0]?.total_count || 0);
  return (
    <>
      <form className="mb-4 flex gap-2" method="get"><input type="hidden" name="view" value="questions" /><input type="hidden" name="range" value={range.key} />{range.customFrom && <input type="hidden" name="from" value={range.customFrom} />}{range.customTo && <input type="hidden" name="to" value={range.customTo} />}<select name="sort" defaultValue={sort} className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm"><option value="attempts_desc">Most attempted</option><option value="accuracy_asc">Lowest accuracy</option><option value="accuracy_desc">Highest accuracy</option><option value="skips_desc">Most skipped</option><option value="giveups_desc">Highest give-up</option><option value="struggle_desc">Highest struggle</option><option value="time_desc">Longest answer time</option><option value="explanations_desc">Most explanations</option><option value="reports_desc">Most reports</option></select><button className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white">Sort</button></form>
      {rows.length === 0 ? <EmptyState text="No questions are available." /> : <Table><thead><tr><TH>Question</TH><TH>Topic</TH><TH>Views</TH><TH>Attempts</TH><TH>Accuracy</TH><TH>Skip</TH><TH>Give-up</TH><TH>Struggle</TH><TH>Avg. time</TH><TH>Explanation opens</TH><TH>Explanation rate</TH><TH>Video starts / completed</TH><TH>Reports</TH></tr></thead><tbody>{rows.map((row) => <tr key={String(row.question_id)}><TD><Link href={`/admin/analytics/questions/${String(row.question_id)}`} className="font-semibold hover:text-accent">{String(row.prompt_preview || "Question")}</Link><p className="mt-1 text-xs capitalize text-muted">{String(row.difficulty)}</p></TD><TD>{String(row.domain_name)}<p className="text-xs text-muted">{String(row.subtopic_name)}</p></TD><TD>{formatNumber(row.total_views)}</TD><TD>{formatNumber(row.attempts)}</TD><TD>{formatPercent(row.accuracy)}</TD><TD>{formatPercent(row.skip_rate)}</TD><TD>{formatPercent(row.give_up_rate)}</TD><TD>{formatPercent(row.struggle_rate)}</TD><TD>{formatDuration(Number(row.average_answer_time_ms) / 1000)}</TD><TD>{formatNumber(row.explanation_opens)}</TD><TD>{formatPercent(row.explanation_open_rate)}</TD><TD>{formatNumber(row.explanation_video_starts)} / {formatNumber(row.explanation_video_completions)}</TD><TD>{formatNumber(row.reports)}</TD></tr>)}</tbody></Table>}
      <Pagination page={page} total={total} view="questions" range={range} extras={{ sort }} />
    </>
  );
}

function VideosView({ rows, range, type, sort, page }: { rows: Record<string, unknown>[]; range: AnalyticsRange; type: string; sort: string; page: number }) {
  const total = Number(rows[0]?.total_count || 0);
  return (
    <><form className="mb-4 flex flex-wrap gap-2" method="get"><input type="hidden" name="view" value="videos" /><input type="hidden" name="range" value={range.key} />{range.customFrom && <input type="hidden" name="from" value={range.customFrom} />}{range.customTo && <input type="hidden" name="to" value={range.customTo} />}<select name="type" defaultValue={type} className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm"><option value="all">All videos</option><option value="explanation">Question explanations</option><option value="general">General lessons</option></select><select name="sort" defaultValue={sort} className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm"><option value="starts_desc">Most watched</option><option value="completion_desc">Highest completion</option><option value="completion_asc">Lowest completion</option><option value="abandoned_desc">Most abandoned</option><option value="replayed_desc">Most replayed</option></select><button className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white">Filter</button></form>
    {rows.length === 0 ? <EmptyState text="No videos match this filter." /> : <Table><thead><tr><TH>Video</TH><TH>Type</TH><TH>Linked questions</TH><TH>Starts</TH><TH>Viewers</TH><TH>Watch time</TH><TH>Avg. watched</TH><TH>25 / 50 / 75%</TH><TH>Completed</TH><TH>Abandoned</TH><TH>Repeats</TH></tr></thead><tbody>{rows.map((row) => <tr key={String(row.video_id)}><TD><span className="font-semibold">{String(row.title)}</span><p className="text-xs text-muted">{String(row.domain_name || "General")} {"\u00b7"} {String(row.subtopic_name || "Library")}</p></TD><TD><span className="capitalize">{String(row.video_type)}</span></TD><TD>{formatNumber(row.linked_questions)}</TD><TD>{formatNumber(row.starts)}</TD><TD>{formatNumber(row.unique_viewers)}</TD><TD>{formatDuration(row.total_watch_seconds)}</TD><TD>{formatPercent(row.average_percent_watched)}</TD><TD>{formatNumber(row.reached_25)} / {formatNumber(row.reached_50)} / {formatNumber(row.reached_75)}</TD><TD>{formatPercent(row.completion_rate)}</TD><TD>{formatPercent(row.abandonment_rate)}</TD><TD>{formatNumber(row.repeat_viewers)}</TD></tr>)}</tbody></Table>}
    <Pagination page={page} total={total} view="videos" range={range} extras={{ type, sort }} /></>
  );
}

function formatTrafficCell(column: string, value: string | number | null) {
  if (["source", "medium", "campaign", "referrer", "landing_page"].includes(column)) return String(value ?? "\u2014");
  if (column.endsWith("_percent")) return formatPercent(value);
  return formatNumber(value);
}

function TrafficView({ data }: { data: Awaited<ReturnType<typeof getTraffic>> }) {
  if (!data.configured) return <EmptyState text="Connect the PostHog management API variables to see traffic, devices, locations, journeys and funnels. Learning analytics remains available from Supabase." />;
  const funnels = ["Practice", "Explanation", "Video"];
  return <div className="grid gap-6"><section><h2 className="font-display text-xl font-bold text-ink">Traffic quality by source</h2><p className="mt-1 mb-4 text-sm text-muted">Location is inferred by PostHog when available; it is never treated as nationality. Source retention uses only cohorts old enough to reach that day and stays hidden below five signups.</p>{data.sources.length === 0 ? <EmptyState text="PostHog has no traffic data in this period." /> : <Table><thead><tr>{data.columns.map((column) => <TH key={column}>{column.replaceAll("_", " ")}</TH>)}</tr></thead><tbody>{data.sources.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <TD key={cellIndex}>{formatTrafficCell(data.columns[cellIndex] || "", cell)}</TD>)}</tr>)}</tbody></Table>}</section><section className="rounded-2xl border border-hairline bg-surface p-5"><h2 className="font-display text-xl font-bold text-ink">Acquisition funnel</h2><div className="mt-4 grid gap-3 sm:grid-cols-4">{data.funnel.map(([stage, users]) => <MetricCard key={String(stage)} label={String(stage)} value={formatNumber(users)} />)}</div></section><section><h2 className="font-display text-xl font-bold text-ink">Learning funnel stage reach</h2><p className="mt-1 text-sm text-muted">Unique students reaching each PostHog event stage in the selected period.</p><div className="mt-4 grid gap-4 lg:grid-cols-3">{funnels.map((funnel) => <div key={funnel} className="rounded-2xl border border-hairline bg-surface p-5"><h3 className="font-display text-lg font-bold text-ink">{funnel}</h3><div className="mt-3 space-y-2">{data.productFunnels.filter(([name]) => name === funnel).map(([, position, stage, users]) => <div key={String(position)} className="flex justify-between gap-3 rounded-lg bg-background px-3 py-2 text-sm"><span>{String(stage)}</span><strong className="tabular-nums">{formatNumber(users)}</strong></div>)}</div></div>)}</div></section><section><h2 className="font-display text-xl font-bold text-ink">Audience and landing pages</h2><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.breakdowns.slice(0, 24).map(([dimension, value, visitors], index) => <div key={`${dimension}-${value}-${index}`} className="rounded-xl border border-hairline bg-surface p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{String(dimension)}</p><p className="mt-1 truncate font-semibold text-ink" title={String(value)}>{String(value)}</p><p className="mt-2 text-sm text-muted">{formatNumber(visitors)} visitors</p></div>)}</div></section></div>;
}

function RetentionView({ rows }: { rows: Record<string, unknown>[] }) {
  return <section><h2 className="font-display text-xl font-bold text-ink">Weekly signup cohorts</h2><p className="mt-1 mb-4 text-sm text-muted">Returned means a meaningful learning action on the exact day after signup. Rates stay hidden for cohorts smaller than five.</p>{rows.length === 0 ? <EmptyState text="No signup cohorts in this period." /> : <Table><thead><tr><TH>Cohort</TH><TH>Students</TH><TH>Day 1</TH><TH>Day 3</TH><TH>Day 7</TH><TH>Day 14</TH><TH>Day 30</TH></tr></thead><tbody>{rows.map((row) => <tr key={String(row.cohort_start)}><TD>{String(row.cohort_start)}</TD><TD>{formatNumber(row.cohort_size)}</TD><TD>{formatPercent(row.day_1)}</TD><TD>{formatPercent(row.day_3)}</TD><TD>{formatPercent(row.day_7)}</TD><TD>{formatPercent(row.day_14)}</TD><TD>{formatPercent(row.day_30)}</TD></tr>)}</tbody></Table>}</section>;
}

function SessionsView({ rows, range, page }: { rows: Record<string, unknown>[]; range: AnalyticsRange; page: number }) {
  const appHost = (process.env.POSTHOG_API_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  const projectId = process.env.POSTHOG_PROJECT_ID || "";
  const total = Number(rows[0]?.total_count || 0);

  return (
    <section>
      <h2 className="font-display text-xl font-bold text-ink">Meaningful student sessions</h2>
      <p className="mt-1 mb-4 text-sm text-muted">A session appears only after a learning event; page count alone does not make a student active.</p>
      {rows.length === 0 ? <EmptyState text="No meaningful sessions in this period." /> : (
        <Table><thead><tr><TH>Student</TH><TH>Started</TH><TH>Duration</TH><TH>Pages</TH><TH>Questions</TH><TH>Accuracy</TH><TH>Videos</TH><TH>Exit</TH><TH>Signal</TH><TH>Replay</TH></tr></thead><tbody>{rows.map((row) => <tr key={String(row.session_id)}><TD><Link href={`/admin/analytics/users/${String(row.user_id)}`} className="font-semibold hover:text-accent">{String(row.full_name || row.email || "Student")}</Link></TD><TD>{formatDate(row.started_at)}</TD><TD>{formatDuration(row.duration_seconds)}</TD><TD>{formatNumber(row.pages_viewed)}</TD><TD>{formatNumber(row.questions_answered)}</TD><TD>{formatPercent(row.accuracy)}</TD><TD>{formatNumber(row.videos_watched)}</TD><TD><span className="max-w-40 break-all text-xs">{String(row.exit_page || "\u2014")}</span></TD><TD>{Boolean(row.likely_give_up) ? <span className="font-semibold text-miss-ink">Likely give-up</span> : "\u2014"}</TD><TD>{projectId && Boolean(row.posthog_session_id) ? <a href={`${appHost}/project/${encodeURIComponent(projectId)}/replay/${encodeURIComponent(String(row.posthog_session_id))}`} target="_blank" rel="noreferrer" className="font-semibold text-accent">Open</a> : "\u2014"}</TD></tr>)}</tbody></Table>
      )}
      <Pagination page={page} total={total} view="sessions" range={range} />
    </section>
  );
}
