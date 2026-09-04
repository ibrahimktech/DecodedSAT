-- DecodedSAT student analytics foundation and admin reporting.
--
-- Product behavior (page journeys, acquisition, funnels, replay) belongs in
-- PostHog. These tables contain only durable learning/product milestones that
-- are missing from the existing attempt and practice tables. No raw clicks,
-- mouse movement, scroll stream, typed text, IP address, or replay payload is
-- stored in Postgres.
--
-- `admin_users` remains the only role authority. New writes reject admins and
-- every reporting function filters them again, so using the student surface as
-- an operator cannot contaminate student analytics.


-- ============================================================================
-- 1. Event and session storage
-- ============================================================================

create table if not exists public.analytics_sessions (
  id                       uuid primary key,
  user_id                  uuid not null references public.profiles (id) on delete cascade,
  posthog_session_id       text,
  started_at               timestamptz not null default now(),
  last_activity_at         timestamptz not null default now(),
  ended_at                 timestamptz,
  landing_page             text,
  exit_page                text,
  referrer                 text,
  utm_source               text,
  utm_medium               text,
  utm_campaign             text,
  utm_content              text,
  utm_term                 text,
  page_views               integer not null default 0 check (page_views >= 0),
  meaningful_event_count   integer not null default 0
                             check (meaningful_event_count >= 0),
  constraint analytics_sessions_posthog_id_shape check (
    posthog_session_id is null or char_length(posthog_session_id) <= 200
  ),
  constraint analytics_sessions_page_shape check (
    (landing_page is null or char_length(landing_page) <= 500)
    and (exit_page is null or char_length(exit_page) <= 500)
    and (referrer is null or char_length(referrer) <= 1000)
  )
);

comment on table public.analytics_sessions is
  'Privacy-conscious student session summaries. Page transitions only; no raw clicks or replay data.';

create index if not exists analytics_sessions_user_recency_idx
  on public.analytics_sessions (user_id, last_activity_at desc);
create index if not exists analytics_sessions_started_idx
  on public.analytics_sessions (started_at desc);
create index if not exists analytics_sessions_meaningful_idx
  on public.analytics_sessions (last_activity_at desc)
  where meaningful_event_count > 0;

create table if not exists public.analytics_events (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  session_id          uuid references public.analytics_sessions (id) on delete cascade,
  event_name          text not null,
  question_id         uuid references public.questions (id) on delete set null,
  video_id            uuid references public.videos (id) on delete set null,
  practice_session_id uuid,
  is_correct          boolean,
  selected_choice     smallint check (selected_choice between 0 and 3),
  answer_time_ms      integer check (answer_time_ms between 0 and 7200000),
  progress_percent    smallint check (progress_percent between 0 and 100),
  watched_seconds     integer check (watched_seconds between 0 and 86400),
  used_desmos         boolean not null default false,
  path                text,
  metadata            jsonb not null default '{}'::jsonb,
  occurred_at         timestamptz not null default now(),
  constraint analytics_events_name_check check (event_name in (
    'practice_started',
    'practice_completed',
    'question_viewed',
    'question_answered',
    'question_skipped',
    'question_gave_up',
    'question_struggled',
    'explanation_opened',
    'explanation_closed',
    'explanation_button_shown',
    'watch_explanation_clicked',
    'explanation_video_started',
    'explanation_video_25',
    'explanation_video_50',
    'explanation_video_75',
    'explanation_video_completed',
    'explanation_video_abandoned',
    'explanation_video_replayed',
    'explanation_video_seeked',
    'video_started',
    'video_25',
    'video_50',
    'video_75',
    'video_completed',
    'video_abandoned',
    'video_replayed',
    'video_seeked',
    'desmos_opened',
    'test_started',
    'test_completed',
    'onboarding_started',
    'onboarding_completed',
    'search_performed',
    'filter_applied'
  )),
  constraint analytics_events_path_shape check (
    path is null or char_length(path) <= 500
  ),
  constraint analytics_events_metadata_shape check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 4096
  )
);

comment on table public.analytics_events is
  'Meaningful student learning milestones only. Existing attempts remain the source of truth for scores.';

create index if not exists analytics_events_user_time_idx
  on public.analytics_events (user_id, occurred_at desc);
create index if not exists analytics_events_name_time_idx
  on public.analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_question_time_idx
  on public.analytics_events (question_id, occurred_at desc)
  where question_id is not null;
create index if not exists analytics_events_video_time_idx
  on public.analytics_events (video_id, occurred_at desc)
  where video_id is not null;
create index if not exists analytics_events_session_time_idx
  on public.analytics_events (session_id, occurred_at)
  where session_id is not null;

-- These support the existing durable attempt tables when analytics ranges are
-- narrowed by question and date. They do not change existing write behavior.
create index if not exists question_attempts_question_time_idx
  on public.question_attempts (question_id, attempted_at desc);
create index if not exists practice_test_responses_question_time_idx
  on public.practice_test_responses (question_id, answered_at desc)
  where answered_at is not null;

alter table public.analytics_sessions enable row level security;
alter table public.analytics_sessions force row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;

revoke all on table public.analytics_sessions from public, anon, authenticated;
revoke all on table public.analytics_events from public, anon, authenticated;

-- Students do not need to query analytics records. Progress continues to use
-- the purpose-built attempt/session tables. Admin reads go through the guarded
-- aggregation functions below.


-- ============================================================================
-- 2. Central student-only event writer
-- ============================================================================

create or replace function public.track_student_event(
  p_session_id uuid,
  p_event_name text,
  p_properties jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid                uuid;
  v_now                timestamptz := now();
  v_session_owner      uuid;
  v_question_id        uuid;
  v_video_id           uuid;
  v_practice_session   uuid;
  v_selected_choice    smallint;
  v_answer_time_ms     integer;
  v_progress_percent   smallint;
  v_watched_seconds    integer;
  v_path               text;
  v_metadata           jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- The existing role table is the only source of truth. Returning false (not
  -- raising) makes analytics a harmless no-op while an admin tests the app.
  if exists (
    select 1 from public.admin_users a where a.user_id = v_uid
  ) then
    return false;
  end if;

  if p_session_id is null then
    raise exception 'missing_session';
  end if;

  if p_properties is null or jsonb_typeof(p_properties) <> 'object'
     or octet_length(p_properties::text) > 8192 then
    raise exception 'invalid_properties';
  end if;

  select s.user_id into v_session_owner
    from public.analytics_sessions s
   where s.id = p_session_id;
  if found and v_session_owner <> v_uid then
    raise exception 'session_not_owned';
  end if;

  v_path := nullif(left(btrim(coalesce(p_properties ->> 'path', '')), 500), '');

  -- Route changes update one compact row and do not create event rows.
  if p_event_name = 'session_touched' then
    insert into public.analytics_sessions (
      id, user_id, posthog_session_id, started_at, last_activity_at,
      landing_page, exit_page, referrer,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      page_views
    )
    values (
      p_session_id,
      v_uid,
      nullif(left(p_properties ->> 'posthog_session_id', 200), ''),
      v_now,
      v_now,
      v_path,
      v_path,
      nullif(left(p_properties ->> 'referrer', 1000), ''),
      nullif(left(p_properties ->> 'utm_source', 200), ''),
      nullif(left(p_properties ->> 'utm_medium', 200), ''),
      nullif(left(p_properties ->> 'utm_campaign', 200), ''),
      nullif(left(p_properties ->> 'utm_content', 200), ''),
      nullif(left(p_properties ->> 'utm_term', 200), ''),
      1
    )
    on conflict (id) do update
       set last_activity_at   = v_now,
           ended_at           = null,
           exit_page          = coalesce(v_path, public.analytics_sessions.exit_page),
           posthog_session_id = coalesce(
             nullif(left(p_properties ->> 'posthog_session_id', 200), ''),
             public.analytics_sessions.posthog_session_id
           ),
           page_views = public.analytics_sessions.page_views +
             case
               when v_path is not null
                and v_path is distinct from public.analytics_sessions.exit_page
               then 1 else 0
             end
     where public.analytics_sessions.user_id = v_uid;
    return true;
  end if;

  if p_event_name = 'session_ended' then
    update public.analytics_sessions
       set last_activity_at = v_now,
           ended_at = v_now,
           exit_page = coalesce(v_path, exit_page)
     where id = p_session_id
       and user_id = v_uid;
    return true;
  end if;

  if p_event_name not in (
    'practice_started', 'practice_completed',
    'question_viewed', 'question_answered', 'question_skipped',
    'question_gave_up', 'question_struggled',
    'explanation_opened', 'explanation_closed',
    'explanation_button_shown', 'watch_explanation_clicked',
    'explanation_video_started', 'explanation_video_25',
    'explanation_video_50', 'explanation_video_75',
    'explanation_video_completed', 'explanation_video_abandoned',
    'explanation_video_replayed', 'explanation_video_seeked',
    'video_started', 'video_25', 'video_50', 'video_75',
    'video_completed', 'video_abandoned', 'video_replayed', 'video_seeked',
    'desmos_opened', 'test_started', 'test_completed',
    'onboarding_started', 'onboarding_completed',
    'search_performed', 'filter_applied'
  ) then
    raise exception 'unknown_event';
  end if;

  -- Cast only known identifiers. Invalid UUIDs fail the RPC without writing.
  v_question_id := nullif(p_properties ->> 'question_id', '')::uuid;
  v_video_id := nullif(p_properties ->> 'video_id', '')::uuid;
  v_practice_session := nullif(p_properties ->> 'practice_session_id', '')::uuid;
  v_selected_choice := nullif(p_properties ->> 'selected_choice', '')::smallint;
  v_answer_time_ms := nullif(p_properties ->> 'answer_time_ms', '')::integer;
  v_progress_percent := nullif(p_properties ->> 'progress_percent', '')::smallint;
  v_watched_seconds := nullif(p_properties ->> 'watched_seconds', '')::integer;

  -- Question-explanation milestones must refer to the active video actually
  -- linked to a question whose answer is already available to this student.
  -- This repeats the page-level check at the trusted database boundary so a
  -- forged browser request cannot poison explanation-effectiveness data.
  if p_event_name in (
    'explanation_button_shown', 'watch_explanation_clicked',
    'explanation_video_started', 'explanation_video_25',
    'explanation_video_50', 'explanation_video_75',
    'explanation_video_completed', 'explanation_video_abandoned',
    'explanation_video_replayed', 'explanation_video_seeked'
  ) and (
    v_question_id is null
    or v_video_id is null
    or not exists (
      select 1
        from public.attempted_question_solutions aqs
       where aqs.question_id = v_question_id
         and aqs.solution_video_id = v_video_id
    )
  ) then
    raise exception 'invalid_explanation_link';
  end if;

  if v_selected_choice is not null and (v_selected_choice < 0 or v_selected_choice > 3) then
    raise exception 'invalid_choice';
  end if;
  if v_answer_time_ms is not null and (v_answer_time_ms < 0 or v_answer_time_ms > 7200000) then
    raise exception 'invalid_answer_time';
  end if;
  if v_progress_percent is not null and (v_progress_percent < 0 or v_progress_percent > 100) then
    raise exception 'invalid_progress';
  end if;
  if v_watched_seconds is not null and (v_watched_seconds < 0 or v_watched_seconds > 86400) then
    raise exception 'invalid_watch_time';
  end if;

  -- Whitelist useful, non-sensitive context. Arbitrary client properties are
  -- deliberately not copied into the durable table.
  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'difficulty', nullif(left(p_properties ->> 'difficulty', 20), ''),
    'subtopic', nullif(left(p_properties ->> 'subtopic', 120), ''),
    'source', nullif(left(p_properties ->> 'source', 80), ''),
    'video_type', nullif(left(p_properties ->> 'video_type', 40), ''),
    'answer_result', nullif(left(p_properties ->> 'answer_result', 20), ''),
    'search_kind', nullif(left(p_properties ->> 'search_kind', 40), ''),
    'filter_kind', nullif(left(p_properties ->> 'filter_kind', 40), '')
  ));

  insert into public.analytics_sessions (
    id, user_id, posthog_session_id, started_at, last_activity_at,
    landing_page, exit_page, meaningful_event_count
  )
  values (
    p_session_id,
    v_uid,
    nullif(left(p_properties ->> 'posthog_session_id', 200), ''),
    v_now,
    v_now,
    v_path,
    v_path,
    1
  )
  on conflict (id) do update
     set last_activity_at = v_now,
         ended_at = null,
         exit_page = coalesce(v_path, public.analytics_sessions.exit_page),
         meaningful_event_count = public.analytics_sessions.meaningful_event_count + 1,
         posthog_session_id = coalesce(
           nullif(left(p_properties ->> 'posthog_session_id', 200), ''),
           public.analytics_sessions.posthog_session_id
         )
   where public.analytics_sessions.user_id = v_uid;

  insert into public.analytics_events (
    user_id, session_id, event_name, question_id, video_id,
    practice_session_id, is_correct, selected_choice, answer_time_ms,
    progress_percent, watched_seconds, used_desmos, path, metadata, occurred_at
  )
  values (
    v_uid,
    p_session_id,
    p_event_name,
    v_question_id,
    v_video_id,
    v_practice_session,
    case
      when p_properties ? 'correct' then (p_properties ->> 'correct')::boolean
      else null
    end,
    v_selected_choice,
    v_answer_time_ms,
    v_progress_percent,
    v_watched_seconds,
    coalesce((p_properties ->> 'used_desmos')::boolean, false),
    v_path,
    v_metadata,
    v_now
  );

  return true;
end;
$fn$;

revoke all on function public.track_student_event(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.track_student_event(uuid, text, jsonb)
  to authenticated;


-- ============================================================================
-- 3. Overview, chart series and Needs Attention
-- ============================================================================

create or replace function public.admin_analytics_overview(
  p_from timestamptz default null,
  p_to   timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_from        timestamptz := coalesce(p_from, '1970-01-01'::timestamptz);
  v_to          timestamptz := coalesce(p_to, now());
  v_series_from date;
  v_result      jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if v_from >= v_to then
    raise exception 'invalid_range';
  end if;

  v_series_from := greatest(v_from::date, (v_to::date - 365));

  with
  students as (
    select p.id, p.created_at
      from public.profiles p
     where not exists (
       select 1 from public.admin_users a where a.user_id = p.id
     )
  ),
  answers as (
    select qa.user_id,
           qa.question_id,
           qa.is_correct,
           qa.selected_choice,
           qa.attempted_at as occurred_at
      from public.question_attempts qa
      join students s on s.id = qa.user_id
    union all
    select pta.user_id,
           ptr.question_id,
           ptr.is_correct,
           case when ptr.student_answer ~ '^[0-3]$' then ptr.student_answer::smallint else null end,
           ptr.answered_at
      from public.practice_test_responses ptr
      join public.practice_test_attempts pta on pta.id = ptr.practice_test_attempt_id
      join students s on s.id = pta.user_id
     where ptr.answered_at is not null
  ),
  activity as (
    select a.user_id, a.occurred_at from answers a
    union all
    select e.user_id, e.occurred_at
      from public.analytics_events e
      join students s on s.id = e.user_id
     where e.event_name not in ('question_viewed', 'explanation_button_shown')
    union all
    select pa.user_id, pa.started_at
      from public.practice_attempts pa join students s on s.id = pa.user_id
    union all
    select pta.user_id, pta.started_at
      from public.practice_test_attempts pta join students s on s.id = pta.user_id
  ),
  range_answers as (
    select * from answers where occurred_at >= v_from and occurred_at < v_to
  ),
  range_activity as (
    select * from activity where occurred_at >= v_from and occurred_at < v_to
  ),
  range_events as (
    select e.*
      from public.analytics_events e
      join students s on s.id = e.user_id
     where e.occurred_at >= v_from and e.occurred_at < v_to
  ),
  kpis as (
    select
      (select count(distinct user_id) from activity
        where occurred_at >= now() - interval '5 minutes') as active_now,
      (select count(distinct user_id) from activity
        where occurred_at >= date_trunc('day', now())) as active_today,
      (select count(distinct user_id) from activity
        where occurred_at >= date_trunc('day', now())) as daily_active_users,
      (select count(distinct user_id) from activity
        where occurred_at >= now() - interval '7 days') as weekly_active_users,
      (select count(distinct user_id) from activity
        where occurred_at >= now() - interval '30 days') as monthly_active_users,
      (select count(*) from students
        where created_at >= v_from and created_at < v_to) as new_users,
      (select count(distinct ra.user_id)
         from range_activity ra
        where exists (
          select 1 from activity older
           where older.user_id = ra.user_id and older.occurred_at < v_from
        )) as returning_users,
      (select count(*) from range_answers) as questions_answered,
      (select count(*) from range_answers where is_correct) as correct_answers,
      (select count(distinct user_id) from range_activity) as active_users_in_range,
      (
        select avg(extract(epoch from (
          coalesce(s.ended_at, s.last_activity_at) - s.started_at
        )))
          from public.analytics_sessions s
          join students st on st.id = s.user_id
         where s.started_at >= v_from and s.started_at < v_to
           and s.meaningful_event_count > 0
      ) as avg_session_seconds,
      (
        (select count(*) from public.question_bank_sessions qbs
          join students s on s.id = qbs.user_id
         where qbs.started_at >= v_from and qbs.started_at < v_to)
        +
        (select count(*) from public.practice_attempts pa
          join students s on s.id = pa.user_id
         where pa.started_at >= v_from and pa.started_at < v_to)
        +
        (select count(*) from public.practice_test_attempts pta
          join students s on s.id = pta.user_id
         where pta.started_at >= v_from and pta.started_at < v_to)
      ) as practice_sessions,
      (select count(*) from range_events
        where event_name in ('video_started', 'explanation_video_started')) as videos_started,
      (select count(*) from range_events
        where event_name in ('video_completed', 'explanation_video_completed')) as videos_completed,
      (select count(*) from range_events
        where event_name = 'explanation_video_started') as explanation_videos_watched,
      (select count(*) from range_events where event_name = 'question_gave_up') as give_ups,
      (select count(*) from range_events where event_name = 'question_viewed') as question_views,
      (
        select count(*) from public.question_bank_sessions qbs
          join students s on s.id = qbs.user_id
         where qbs.started_at >= v_from and qbs.started_at < v_to
      ) as question_bank_sessions
  ),
  days as (
    select generate_series(v_series_from, (v_to - interval '1 millisecond')::date, interval '1 day')::date as day
  ),
  series as (
    select d.day,
           (select count(distinct a.user_id) from activity a
             where a.occurred_at >= d.day::timestamptz
               and a.occurred_at < (d.day + 1)::timestamptz) as active_users,
           (select count(*) from students s where s.created_at >= d.day::timestamptz
             and s.created_at < (d.day + 1)::timestamptz) as new_users,
           (select count(distinct a.user_id) from activity a
             where a.occurred_at >= d.day::timestamptz
               and a.occurred_at < (d.day + 1)::timestamptz
               and exists (
                 select 1 from activity older
                  where older.user_id = a.user_id
                    and older.occurred_at < d.day::timestamptz
               )) as returning_users,
           (select count(*) from answers a where a.occurred_at >= d.day::timestamptz
             and a.occurred_at < (d.day + 1)::timestamptz) as questions_answered,
           (select round(100.0 * avg(case when a.is_correct then 1 else 0 end), 1)
               from answers a where a.occurred_at >= d.day::timestamptz
                and a.occurred_at < (d.day + 1)::timestamptz) as accuracy,
           (
             (select count(*) from public.question_bank_sessions qbs
               join students s on s.id = qbs.user_id
              where qbs.started_at >= d.day::timestamptz
                and qbs.started_at < (d.day + 1)::timestamptz)
             +
             (select count(*) from public.practice_attempts pa
               join students s on s.id = pa.user_id
              where pa.started_at >= d.day::timestamptz
                and pa.started_at < (d.day + 1)::timestamptz)
             +
             (select count(*) from public.practice_test_attempts pta
               join students s on s.id = pta.user_id
              where pta.started_at >= d.day::timestamptz
                and pta.started_at < (d.day + 1)::timestamptz)
           ) as practice_sessions,
           (select count(*) from public.analytics_events e
             join students s on s.id = e.user_id
            where e.event_name in ('video_started', 'explanation_video_started')
               and e.occurred_at >= d.day::timestamptz
               and e.occurred_at < (d.day + 1)::timestamptz) as video_starts,
           (select count(*) from public.analytics_events e
             join students s on s.id = e.user_id
            where e.event_name in ('video_completed', 'explanation_video_completed')
              and e.occurred_at >= d.day::timestamptz
              and e.occurred_at < (d.day + 1)::timestamptz) as video_completions,
           (select count(*) from public.analytics_events e
             join students s on s.id = e.user_id
            where e.event_name = 'explanation_video_started'
              and e.occurred_at >= d.day::timestamptz
              and e.occurred_at < (d.day + 1)::timestamptz) as explanation_video_starts,
           (select count(*) from public.analytics_events e
             join students s on s.id = e.user_id
            where e.event_name = 'question_gave_up'
              and e.occurred_at >= d.day::timestamptz
               and e.occurred_at < (d.day + 1)::timestamptz) as give_ups,
           (select case
              when count(*) filter (where e.event_name = 'question_viewed') >= 10
              then round(100.0 * count(*) filter (where e.event_name = 'question_gave_up')
                / nullif(count(*) filter (where e.event_name = 'question_viewed'), 0), 1)
              else null
            end
              from public.analytics_events e
              join students s on s.id = e.user_id
             where e.event_name in ('question_viewed', 'question_gave_up')
               and e.occurred_at >= d.day::timestamptz
               and e.occurred_at < (d.day + 1)::timestamptz) as give_up_rate
      from days d
  ),
  question_attention as (
    select q.id::text as entity_id,
           'question'::text as kind,
           'Question ' || left(q.id::text, 8) as label,
           case
             when count(a.question_id) >= 10
              and avg(case when a.is_correct then 1.0 else 0.0 end) < 0.45
             then 'Low accuracy'
           end as reason,
           round(100.0 * avg(case when a.is_correct then 1.0 else 0.0 end), 1) as value,
           count(a.question_id)::integer as sample_size,
           3::integer as priority
      from public.questions q
      join range_answers a on a.question_id = q.id
     group by q.id
    having count(a.question_id) >= 10
       and avg(case when a.is_correct then 1.0 else 0.0 end) < 0.45
  ),
  giveup_attention as (
    select e.question_id::text as entity_id,
           'question'::text as kind,
           'Question ' || left(e.question_id::text, 8) as label,
           'High give-up rate'::text as reason,
           round(100.0 * count(*) filter (where e.event_name = 'question_gave_up')
             / nullif(count(*) filter (where e.event_name = 'question_viewed'), 0), 1) as value,
           count(*) filter (where e.event_name = 'question_viewed')::integer as sample_size,
           4::integer as priority
      from range_events e
     where e.question_id is not null
       and e.event_name in ('question_viewed', 'question_gave_up')
     group by e.question_id
    having count(*) filter (where e.event_name = 'question_viewed') >= 10
       and count(*) filter (where e.event_name = 'question_gave_up')::numeric
           / nullif(count(*) filter (where e.event_name = 'question_viewed'), 0) >= 0.20
  ),
  struggle_attention as (
    select e.question_id::text as entity_id,
           'question'::text as kind,
           'Question ' || left(e.question_id::text, 8) as label,
           'High struggle rate'::text as reason,
           round(100.0 * count(*) filter (where e.event_name = 'question_struggled')
             / nullif(count(*) filter (where e.event_name = 'question_viewed'), 0), 1) as value,
           count(*) filter (where e.event_name = 'question_viewed')::integer as sample_size,
           4::integer as priority
      from range_events e
     where e.question_id is not null
       and e.event_name in ('question_viewed', 'question_struggled')
     group by e.question_id
    having count(*) filter (where e.event_name = 'question_viewed') >= 10
       and count(*) filter (where e.event_name = 'question_struggled')::numeric
           / nullif(count(*) filter (where e.event_name = 'question_viewed'), 0) >= 0.25
  ),
  onboarding_attention as (
    select 'onboarding'::text as entity_id,
           'flow'::text as kind,
           'Onboarding'::text as label,
           'High onboarding drop-off'::text as reason,
           round(100.0 * (started - completed) / nullif(started, 0), 1) as value,
           started::integer as sample_size,
           4::integer as priority
      from (
        select count(distinct user_id) filter (where event_name = 'onboarding_started')::numeric as started,
               count(distinct user_id) filter (where event_name = 'onboarding_completed')::numeric as completed
          from range_events
      ) counts
     where started >= 10
       and completed / nullif(started, 0) < 0.65
  ),
  practice_attention as (
    select 'practice'::text as entity_id,
           'flow'::text as kind,
           'Practice sessions'::text as label,
           'High practice abandonment'::text as reason,
           round(100.0 * (started - completed) / nullif(started, 0), 1) as value,
           started::integer as sample_size,
           3::integer as priority
      from (
        select count(distinct coalesce(practice_session_id, session_id))
                 filter (where event_name = 'practice_started')::numeric as started,
               count(distinct coalesce(practice_session_id, session_id))
                 filter (where event_name = 'practice_completed')::numeric as completed
          from range_events
      ) counts
     where started >= 10
       and completed / nullif(started, 0) < 0.50
  ),
  active_drop_attention as (
    select 'active-users'::text as entity_id,
           'usage'::text as kind,
           'Active students'::text as label,
           'Active users dropped week over week'::text as reason,
           round(100.0 * (previous_users - recent_users) / nullif(previous_users, 0), 1) as value,
           previous_users::integer as sample_size,
           5::integer as priority
      from (
        select count(distinct user_id) filter (
                 where occurred_at >= v_to - interval '7 days' and occurred_at < v_to
               )::numeric as recent_users,
               count(distinct user_id) filter (
                 where occurred_at >= v_to - interval '14 days'
                   and occurred_at < v_to - interval '7 days'
               )::numeric as previous_users
          from activity
      ) counts
     where previous_users >= 10
       and recent_users / nullif(previous_users, 0) < 0.70
  ),
  report_attention as (
    select r.question_id::text as entity_id,
           'question'::text as kind,
           'Question ' || left(r.question_id::text, 8) as label,
           'Repeated reports'::text as reason,
           count(*)::numeric as value,
           count(*)::integer as sample_size,
           5::integer as priority
      from public.question_reports r
      join students s on s.id = r.user_id
     where r.created_at >= v_from and r.created_at < v_to
     group by r.question_id
    having count(*) >= 3
  ),
  video_attention as (
    select e.video_id::text as entity_id,
           'video'::text as kind,
           coalesce(v.title, 'Video ' || left(e.video_id::text, 8)) as label,
           'Low completion'::text as reason,
           round(100.0 * count(*) filter (where e.event_name in ('video_completed', 'explanation_video_completed'))
             / nullif(count(*) filter (where e.event_name in ('video_started', 'explanation_video_started')), 0), 1) as value,
           count(*) filter (where e.event_name in ('video_started', 'explanation_video_started'))::integer as sample_size,
           2::integer as priority
      from range_events e
      join public.videos v on v.id = e.video_id
     where e.video_id is not null
       and e.event_name in ('video_started', 'explanation_video_started', 'video_completed', 'explanation_video_completed')
     group by e.video_id, v.title
    having count(*) filter (where e.event_name in ('video_started', 'explanation_video_started')) >= 10
       and count(*) filter (where e.event_name in ('video_completed', 'explanation_video_completed'))::numeric
           / nullif(count(*) filter (where e.event_name in ('video_started', 'explanation_video_started')), 0) < 0.35
  ),
  attention as (
    select * from question_attention where reason is not null
    union all select * from giveup_attention
    union all select * from struggle_attention
    union all select * from onboarding_attention
    union all select * from practice_attention
    union all select * from active_drop_attention
    union all select * from report_attention
    union all select * from video_attention
  )
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'activeNow', k.active_now,
      'activeToday', k.active_today,
      'dailyActiveUsers', k.daily_active_users,
      'weeklyActiveUsers', k.weekly_active_users,
      'monthlyActiveUsers', k.monthly_active_users,
      'newUsers', k.new_users,
      'returningUsers', k.returning_users,
      'questionsAnswered', k.questions_answered,
      'correctAnswers', k.correct_answers,
      'accuracy', case when k.questions_answered > 0
        then round(100.0 * k.correct_answers / k.questions_answered, 1) else null end,
      'averageQuestionsPerActiveUser', case when k.active_users_in_range > 0
        then round(k.questions_answered::numeric / k.active_users_in_range, 1) else null end,
      'averageSessionSeconds', round(k.avg_session_seconds),
      'practiceSessions', k.practice_sessions,
      'videosStarted', k.videos_started,
      'videosCompleted', k.videos_completed,
      'explanationVideosWatched', k.explanation_videos_watched,
      'giveUpRate', case when k.question_views >= 10
        then round(100.0 * k.give_ups / k.question_views, 1) else null end
    ),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', s.day,
        'activeUsers', s.active_users,
        'newUsers', s.new_users,
        'returningUsers', s.returning_users,
        'questionsAnswered', s.questions_answered,
        'accuracy', s.accuracy,
        'practiceSessions', s.practice_sessions,
        'videoStarts', s.video_starts,
        'videoCompletions', s.video_completions,
        'explanationVideoStarts', s.explanation_video_starts,
        'giveUps', s.give_ups,
        'giveUpRate', s.give_up_rate
      ) order by s.day) from series s
    ), '[]'::jsonb),
    'needsAttention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entityId', ranked.entity_id,
        'kind', ranked.kind,
        'label', ranked.label,
        'reason', ranked.reason,
        'value', ranked.value,
        'sampleSize', ranked.sample_size
      ) order by ranked.priority desc, ranked.value desc)
      from (
        select * from attention order by priority desc, value desc limit 8
      ) ranked
    ), '[]'::jsonb)
  ) into v_result
  from kpis k;

  return v_result;
end;
$fn$;

revoke all on function public.admin_analytics_overview(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_overview(timestamptz, timestamptz)
  to authenticated;


-- ============================================================================
-- 4. Recent student activity
-- ============================================================================

create or replace function public.admin_analytics_recent_activity(
  p_from  timestamptz default null,
  p_to    timestamptz default now(),
  p_limit integer default 30
)
returns table (
  activity_id text,
  event_name text,
  occurred_at timestamptz,
  user_id uuid,
  full_name text,
  email text,
  question_id uuid,
  video_id uuid,
  video_title text,
  is_correct boolean,
  progress_percent integer
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
  with students as (
    select p.id, p.full_name, p.email, p.created_at
      from public.profiles p
     where not exists (
       select 1 from public.admin_users a where a.user_id = p.id
     )
  ),
  feed as (
    select 'attempt:' || qa.id::text as activity_id,
           'question_answered'::text as event_name,
           qa.attempted_at as occurred_at,
           qa.user_id,
           qa.question_id,
           null::uuid as video_id,
           null::text as video_title,
           qa.is_correct,
           null::integer as progress_percent
      from public.question_attempts qa
      join students s on s.id = qa.user_id
    union all
    select 'test-response:' || ptr.id::text,
           'question_answered',
           ptr.answered_at,
           pta.user_id,
           ptr.question_id,
           null::uuid,
           null::text,
           ptr.is_correct,
           null::integer
      from public.practice_test_responses ptr
      join public.practice_test_attempts pta on pta.id = ptr.practice_test_attempt_id
      join students s on s.id = pta.user_id
     where ptr.answered_at is not null
    union all
    select 'event:' || e.id::text,
           e.event_name,
           e.occurred_at,
           e.user_id,
           e.question_id,
           e.video_id,
           v.title,
           e.is_correct,
           e.progress_percent::integer
      from public.analytics_events e
      join students s on s.id = e.user_id
      left join public.videos v on v.id = e.video_id
     where e.event_name <> 'question_answered'
    union all
    select 'registration:' || s.id::text,
           'registered',
           s.created_at,
           s.id,
           null::uuid,
           null::uuid,
           null::text,
           null::boolean,
           null::integer
      from students s
    union all
    select 'report:' || r.id::text,
           'question_reported',
           r.created_at,
           r.user_id,
           r.question_id,
           null::uuid,
           null::text,
           null::boolean,
           null::integer
      from public.question_reports r
      join students s on s.id = r.user_id
  )
  select f.activity_id,
         f.event_name,
         f.occurred_at,
         f.user_id,
         s.full_name,
         s.email,
         f.question_id,
         f.video_id,
         f.video_title,
         f.is_correct,
         f.progress_percent
    from feed f
    join students s on s.id = f.user_id
   where f.occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
     and f.occurred_at < coalesce(p_to, now())
   order by f.occurred_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$fn$;

revoke all on function public.admin_analytics_recent_activity(timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_recent_activity(timestamptz, timestamptz, integer)
  to authenticated;


-- ============================================================================
-- 5. Student list and student detail
-- ============================================================================

create or replace function public.admin_analytics_users(
  p_from   timestamptz default null,
  p_to     timestamptz default now(),
  p_search text default null,
  p_sort   text default 'active_desc',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  joined_at timestamptz,
  last_active timestamptz,
  sessions_count bigint,
  questions_attempted bigint,
  questions_correct bigint,
  accuracy numeric,
  explanation_videos_watched bigint,
  total_videos_watched bigint,
  average_answer_time_ms numeric,
  estimated_study_seconds bigint,
  last_question_id uuid,
  current_status text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
  with students as (
    select p.id, p.full_name, p.email, p.created_at
      from public.profiles p
     where not exists (
       select 1 from public.admin_users a where a.user_id = p.id
     )
       and (
         nullif(btrim(coalesce(p_search, '')), '') is null
         or coalesce(p.full_name, '') ilike '%' || btrim(p_search) || '%'
         or coalesce(p.email, '') ilike '%' || btrim(p_search) || '%'
       )
  ),
  answers as (
    select qa.user_id, qa.question_id, qa.is_correct, qa.attempted_at as occurred_at
      from public.question_attempts qa
      join students s on s.id = qa.user_id
     where qa.attempted_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and qa.attempted_at < coalesce(p_to, now())
    union all
    select pta.user_id, ptr.question_id, ptr.is_correct, ptr.answered_at
      from public.practice_test_responses ptr
      join public.practice_test_attempts pta on pta.id = ptr.practice_test_attempt_id
      join students s on s.id = pta.user_id
     where ptr.answered_at is not null
       and ptr.answered_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and ptr.answered_at < coalesce(p_to, now())
  ),
  answer_rollup as (
    select a.user_id,
           count(*) as attempted,
           count(*) filter (where a.is_correct) as correct,
           max(a.occurred_at) as last_answered,
           (array_agg(a.question_id order by a.occurred_at desc))[1] as last_question_id
      from answers a
     group by a.user_id
  ),
  event_rollup as (
    select e.user_id,
           max(e.occurred_at) as last_event,
           count(*) filter (where e.event_name = 'explanation_video_started') as explanation_starts,
           count(*) filter (where e.event_name in ('video_started', 'explanation_video_started')) as video_starts,
           avg(e.answer_time_ms) filter (where e.event_name = 'question_answered' and e.answer_time_ms is not null) as avg_answer_ms,
           (array_agg(e.event_name order by e.occurred_at desc))[1] as latest_event
      from public.analytics_events e
      join students s on s.id = e.user_id
     where e.occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and e.occurred_at < coalesce(p_to, now())
     group by e.user_id
  ),
  session_rollup as (
    select ses.user_id,
           count(*) filter (where ses.meaningful_event_count > 0) as sessions,
           max(ses.last_activity_at) as last_session
      from public.analytics_sessions ses
      join students s on s.id = ses.user_id
     where ses.started_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and ses.started_at < coalesce(p_to, now())
     group by ses.user_id
  ),
  study_time as (
    select x.user_id, sum(x.seconds)::bigint as seconds
      from (
        select qbs.user_id, coalesce(qbs.duration_seconds, 0)::bigint as seconds
          from public.question_bank_sessions qbs join students s on s.id = qbs.user_id
         where qbs.started_at >= coalesce(p_from, '1970-01-01'::timestamptz)
           and qbs.started_at < coalesce(p_to, now())
        union all
        select pa.user_id, coalesce(pa.time_taken_seconds, 0)::bigint
          from public.practice_attempts pa join students s on s.id = pa.user_id
         where pa.started_at >= coalesce(p_from, '1970-01-01'::timestamptz)
           and pa.started_at < coalesce(p_to, now())
        union all
        select pta.user_id, coalesce(pta.total_time_seconds, 0)::bigint
          from public.practice_test_attempts pta join students s on s.id = pta.user_id
         where pta.started_at >= coalesce(p_from, '1970-01-01'::timestamptz)
           and pta.started_at < coalesce(p_to, now())
        union all
        select e.user_id, coalesce(e.watched_seconds, 0)::bigint
          from public.analytics_events e join students s on s.id = e.user_id
         where e.event_name in ('video_completed', 'video_abandoned', 'explanation_video_completed', 'explanation_video_abandoned')
           and e.occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
           and e.occurred_at < coalesce(p_to, now())
      ) x
     group by x.user_id
  ),
  combined as (
    select s.id,
           s.full_name,
           s.email,
           s.created_at,
           greatest(ar.last_answered, er.last_event, sr.last_session) as last_active,
           coalesce(sr.sessions, 0) as sessions_count,
           coalesce(ar.attempted, 0) as questions_attempted,
           coalesce(ar.correct, 0) as questions_correct,
           case when coalesce(ar.attempted, 0) > 0
             then round(100.0 * ar.correct / ar.attempted, 1) else null end as accuracy,
           coalesce(er.explanation_starts, 0) as explanation_videos_watched,
           coalesce(er.video_starts, 0) as total_videos_watched,
           round(er.avg_answer_ms) as average_answer_time_ms,
           coalesce(st.seconds, 0) as estimated_study_seconds,
           ar.last_question_id,
           case
             when greatest(ar.last_answered, er.last_event, sr.last_session) >= now() - interval '5 minutes'
               then coalesce(er.latest_event, 'learning_now')
             else 'offline'
           end as current_status
      from students s
      left join answer_rollup ar on ar.user_id = s.id
      left join event_rollup er on er.user_id = s.id
      left join session_rollup sr on sr.user_id = s.id
      left join study_time st on st.user_id = s.id
  )
  select c.id,
         c.full_name,
         c.email,
         c.created_at,
         c.last_active,
         c.sessions_count,
         c.questions_attempted,
         c.questions_correct,
         c.accuracy,
         c.explanation_videos_watched,
         c.total_videos_watched,
         c.average_answer_time_ms,
         c.estimated_study_seconds,
         c.last_question_id,
         c.current_status,
         count(*) over() as total_count
    from combined c
   order by
     case when p_sort = 'questions_desc' then c.questions_attempted end desc nulls last,
     case when p_sort = 'accuracy_desc' then c.accuracy end desc nulls last,
     case when p_sort = 'accuracy_asc' then c.accuracy end asc nulls last,
     case when p_sort = 'inactive_desc' then c.last_active end asc nulls first,
     case when p_sort = 'signup_desc' then c.created_at end desc,
     case when p_sort = 'explanations_desc' then c.explanation_videos_watched end desc,
     case when p_sort = 'active_desc' then c.last_active end desc nulls last,
     c.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

revoke all on function public.admin_analytics_users(timestamptz, timestamptz, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_users(timestamptz, timestamptz, text, text, integer, integer)
  to authenticated;


create or replace function public.admin_analytics_user_detail(
  p_user_id uuid,
  p_from    timestamptz default null,
  p_to      timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  if exists (select 1 from public.admin_users a where a.user_id = p_user_id) then
    return null;
  end if;

  with
  student as (
    select p.id, p.full_name, p.email, p.created_at
      from public.profiles p where p.id = p_user_id
  ),
  answers as (
    select qa.question_id, qa.is_correct, qa.attempted_at as occurred_at
      from public.question_attempts qa
     where qa.user_id = p_user_id
       and qa.attempted_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and qa.attempted_at < coalesce(p_to, now())
    union all
    select ptr.question_id, ptr.is_correct, ptr.answered_at
      from public.practice_test_responses ptr
      join public.practice_test_attempts pta on pta.id = ptr.practice_test_attempt_id
     where pta.user_id = p_user_id
       and ptr.answered_at is not null
       and ptr.answered_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and ptr.answered_at < coalesce(p_to, now())
  ),
  activity as (
    select a.occurred_at, 'question_answered'::text as event_name,
           a.question_id, null::uuid as video_id, null::integer as progress,
           a.is_correct
      from answers a
    union all
    select e.occurred_at, e.event_name, e.question_id, e.video_id,
           e.progress_percent::integer, e.is_correct
      from public.analytics_events e
     where e.user_id = p_user_id
       and e.event_name <> 'question_answered'
       and e.occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
        and e.occurred_at < coalesce(p_to, now())
  ),
  timings as (
    select e.question_id, avg(e.answer_time_ms) as average_answer_time_ms
      from public.analytics_events e
     where e.user_id = p_user_id
       and e.event_name = 'question_answered'
       and e.answer_time_ms is not null
       and e.occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and e.occurred_at < coalesce(p_to, now())
     group by e.question_id
  ),
  performance as (
    select d.name as domain_name,
           s.name as subtopic_name,
           q.difficulty,
           count(*)::integer as attempts,
           count(*) filter (where a.is_correct)::integer as correct,
           round(100.0 * avg(case when a.is_correct then 1.0 else 0.0 end), 1) as accuracy,
           round(max(t.average_answer_time_ms)) as average_answer_time_ms
      from answers a
      join public.questions q on q.id = a.question_id
      join public.subtopics s on s.id = q.subtopic_id
      join public.domains d on d.id = s.domain_id
       left join timings t on t.question_id = a.question_id
     group by d.name, s.name, q.difficulty
  ),
  overview as (
    select count(*)::integer as attempts,
           count(*) filter (where is_correct)::integer as correct,
           max(occurred_at) as last_active
      from answers
  ),
  video_rollup as (
    select count(*) filter (where event_name in ('video_started', 'explanation_video_started'))::integer as starts,
           count(*) filter (where event_name = 'explanation_video_started')::integer as explanation_starts,
           round(avg(answer_time_ms) filter (where event_name = 'question_answered')) as avg_answer_ms,
           coalesce(sum(watched_seconds) filter (
             where event_name in ('video_completed', 'video_abandoned', 'explanation_video_completed', 'explanation_video_abandoned')
           ), 0)::integer as watched_seconds
      from public.analytics_events
     where user_id = p_user_id
       and occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and occurred_at < coalesce(p_to, now())
  ),
  practice_rollup as (
    select (
      (select count(*) from public.question_bank_sessions where user_id = p_user_id
        and started_at >= coalesce(p_from, '1970-01-01'::timestamptz) and started_at < coalesce(p_to, now()))
      + (select count(*) from public.practice_attempts where user_id = p_user_id
        and started_at >= coalesce(p_from, '1970-01-01'::timestamptz) and started_at < coalesce(p_to, now()))
      + (select count(*) from public.practice_test_attempts where user_id = p_user_id
        and started_at >= coalesce(p_from, '1970-01-01'::timestamptz) and started_at < coalesce(p_to, now()))
    )::integer as sessions,
    (
      (select coalesce(sum(duration_seconds), 0) from public.question_bank_sessions where user_id = p_user_id
        and started_at >= coalesce(p_from, '1970-01-01'::timestamptz) and started_at < coalesce(p_to, now()))
      + (select coalesce(sum(time_taken_seconds), 0) from public.practice_attempts where user_id = p_user_id
        and started_at >= coalesce(p_from, '1970-01-01'::timestamptz) and started_at < coalesce(p_to, now()))
      + (select coalesce(sum(total_time_seconds), 0) from public.practice_test_attempts where user_id = p_user_id
        and started_at >= coalesce(p_from, '1970-01-01'::timestamptz) and started_at < coalesce(p_to, now()))
    )::integer as study_seconds
  ),
  analytics_session_rollup as (
    select count(*)::integer as sessions
      from public.analytics_sessions
     where user_id = p_user_id
       and meaningful_event_count > 0
       and started_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and started_at < coalesce(p_to, now())
  )
  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', s.id,
      'fullName', s.full_name,
      'email', s.email,
      'joinedAt', s.created_at
    ),
    'overview', jsonb_build_object(
      'lastActive', greatest(o.last_active, (select max(occurred_at) from activity)),
      'sessions', sr.sessions,
      'practiceSessions', pr.sessions,
      'questionsAttempted', o.attempts,
      'questionsCorrect', o.correct,
      'accuracy', case when o.attempts > 0 then round(100.0 * o.correct / o.attempts, 1) else null end,
      'videosStarted', vr.starts,
      'explanationVideosWatched', vr.explanation_starts,
      'estimatedStudySeconds', pr.study_seconds + vr.watched_seconds,
      'averageAnswerTimeMs', vr.avg_answer_ms
    ),
    'recentActivity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'occurredAt', a.occurred_at,
        'eventName', a.event_name,
        'questionId', a.question_id,
        'videoId', a.video_id,
        'videoTitle', v.title,
        'progressPercent', a.progress,
        'correct', a.is_correct
      ) order by a.occurred_at desc)
      from (select * from activity order by occurred_at desc limit 50) a
      left join public.videos v on v.id = a.video_id
    ), '[]'::jsonb),
    'performance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'domain', p.domain_name,
        'subtopic', p.subtopic_name,
        'difficulty', p.difficulty,
        'attempts', p.attempts,
        'correct', p.correct,
        'accuracy', p.accuracy,
        'averageAnswerTimeMs', p.average_answer_time_ms
      ) order by p.accuracy asc nulls last, p.attempts desc)
      from performance p
    ), '[]'::jsonb)
  ) into v_result
  from student s
  cross join overview o
  cross join video_rollup vr
  cross join practice_rollup pr
  cross join analytics_session_rollup sr;

  return v_result;
end;
$fn$;

revoke all on function public.admin_analytics_user_detail(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_user_detail(uuid, timestamptz, timestamptz)
  to authenticated;


-- ============================================================================
-- 6. Question analytics and distractor/effectiveness detail
-- ============================================================================

create or replace function public.admin_analytics_questions(
  p_from   timestamptz default null,
  p_to     timestamptz default now(),
  p_sort   text default 'attempts_desc',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  question_id uuid,
  prompt_preview text,
  difficulty text,
  domain_name text,
  subtopic_name text,
  total_views bigint,
  attempts bigint,
  correct_attempts bigint,
  incorrect_attempts bigint,
  accuracy numeric,
  skips bigint,
  skip_rate numeric,
  give_ups bigint,
  give_up_rate numeric,
  struggles bigint,
  struggle_rate numeric,
  average_answer_time_ms numeric,
  median_answer_time_ms numeric,
  explanation_opens bigint,
  explanation_open_rate numeric,
  explanation_video_starts bigint,
  explanation_video_completions bigint,
  reports bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
  with students as (
    select p.id from public.profiles p
     where not exists (select 1 from public.admin_users a where a.user_id = p.id)
  ),
  answers as (
    select qa.user_id, qa.question_id, qa.is_correct, qa.attempted_at as occurred_at
      from public.question_attempts qa join students s on s.id = qa.user_id
     where qa.attempted_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and qa.attempted_at < coalesce(p_to, now())
    union all
    select pta.user_id, ptr.question_id, ptr.is_correct, ptr.answered_at
      from public.practice_test_responses ptr
      join public.practice_test_attempts pta on pta.id = ptr.practice_test_attempt_id
      join students s on s.id = pta.user_id
     where ptr.answered_at is not null
       and ptr.answered_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and ptr.answered_at < coalesce(p_to, now())
  ),
  answer_rollup as (
    select a.question_id,
           count(*) as attempts,
           count(*) filter (where a.is_correct) as correct,
           count(*) filter (where not a.is_correct) as incorrect
      from answers a group by a.question_id
  ),
  event_rollup as (
    select e.question_id,
           count(*) filter (where e.event_name = 'question_viewed') as views,
           count(*) filter (where e.event_name = 'question_skipped') as skips,
           count(*) filter (where e.event_name = 'question_gave_up') as give_ups,
           count(*) filter (where e.event_name = 'question_struggled') as struggles,
           count(*) filter (where e.event_name = 'explanation_opened') as explanation_opens,
           count(*) filter (where e.event_name = 'explanation_video_started') as video_starts,
           count(*) filter (where e.event_name = 'explanation_video_completed') as video_completions,
           avg(e.answer_time_ms) filter (where e.event_name = 'question_answered' and e.answer_time_ms is not null) as avg_answer_time,
           percentile_cont(0.5) within group (order by e.answer_time_ms)
             filter (where e.event_name = 'question_answered' and e.answer_time_ms is not null) as median_answer_time
      from public.analytics_events e
      join students s on s.id = e.user_id
     where e.question_id is not null
       and e.occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and e.occurred_at < coalesce(p_to, now())
     group by e.question_id
  ),
  report_rollup as (
    select r.question_id, count(*) as reports
      from public.question_reports r
      join students s on s.id = r.user_id
     where r.created_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and r.created_at < coalesce(p_to, now())
     group by r.question_id
  ),
  combined as (
    select q.id,
           left(regexp_replace(q.prompt, '\s+', ' ', 'g'), 140) as prompt_preview,
           q.difficulty,
           d.name as domain_name,
           st.name as subtopic_name,
           coalesce(er.views, 0) as total_views,
           coalesce(ar.attempts, 0) as attempts,
           coalesce(ar.correct, 0) as correct_attempts,
           coalesce(ar.incorrect, 0) as incorrect_attempts,
           case when coalesce(ar.attempts, 0) > 0
             then round(100.0 * ar.correct / ar.attempts, 1)
             else null
           end as accuracy,
           coalesce(er.skips, 0) as skips,
           case when coalesce(er.views, 0) >= 5 then round(100.0 * er.skips / er.views, 1) else null end as skip_rate,
           coalesce(er.give_ups, 0) as give_ups,
           case when coalesce(er.views, 0) >= 5 then round(100.0 * er.give_ups / er.views, 1) else null end as give_up_rate,
           coalesce(er.struggles, 0) as struggles,
           case when coalesce(ar.attempts, 0) >= 5 then round(100.0 * er.struggles / ar.attempts, 1) else null end as struggle_rate,
           round(er.avg_answer_time) as average_answer_time_ms,
            round(er.median_answer_time::numeric) as median_answer_time_ms,
           coalesce(er.explanation_opens, 0) as explanation_opens,
           case when coalesce(ar.attempts, 0) >= 5 then round(100.0 * er.explanation_opens / ar.attempts, 1) else null end as explanation_open_rate,
           coalesce(er.video_starts, 0) as explanation_video_starts,
           coalesce(er.video_completions, 0) as explanation_video_completions,
           coalesce(rr.reports, 0) as reports
      from public.questions q
      join public.subtopics st on st.id = q.subtopic_id
      join public.domains d on d.id = st.domain_id
      left join answer_rollup ar on ar.question_id = q.id
      left join event_rollup er on er.question_id = q.id
      left join report_rollup rr on rr.question_id = q.id
  )
  select c.id,
         c.prompt_preview,
         c.difficulty,
         c.domain_name,
         c.subtopic_name,
         c.total_views,
         c.attempts,
         c.correct_attempts,
         c.incorrect_attempts,
         c.accuracy,
         c.skips,
         c.skip_rate,
         c.give_ups,
         c.give_up_rate,
         c.struggles,
         c.struggle_rate,
         c.average_answer_time_ms,
         c.median_answer_time_ms,
         c.explanation_opens,
         c.explanation_open_rate,
         c.explanation_video_starts,
         c.explanation_video_completions,
         c.reports,
         count(*) over()
    from combined c
   order by
     case when p_sort = 'accuracy_asc' then c.accuracy end asc nulls last,
     case when p_sort = 'accuracy_desc' then c.accuracy end desc nulls last,
     case when p_sort = 'skips_desc' then c.skip_rate end desc nulls last,
     case when p_sort = 'giveups_desc' then c.give_up_rate end desc nulls last,
     case when p_sort = 'struggle_desc' then c.struggle_rate end desc nulls last,
     case when p_sort = 'time_desc' then c.average_answer_time_ms end desc nulls last,
     case when p_sort = 'explanations_desc' then c.explanation_opens end desc,
     case when p_sort = 'reports_desc' then c.reports end desc,
     case when p_sort = 'attempts_desc' then c.attempts end desc,
     c.id
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

revoke all on function public.admin_analytics_questions(timestamptz, timestamptz, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_questions(timestamptz, timestamptz, text, integer, integer)
  to authenticated;


create or replace function public.admin_analytics_question_detail(
  p_question_id uuid,
  p_from        timestamptz default null,
  p_to          timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  with
  students as (
    select p.id from public.profiles p
     where not exists (select 1 from public.admin_users a where a.user_id = p.id)
  ),
  all_answers as (
    select qa.user_id, qa.question_id, qa.selected_choice,
           qa.is_correct, qa.attempted_at as occurred_at
      from public.question_attempts qa join students s on s.id = qa.user_id
    union all
    select pta.user_id,
           ptr.question_id,
           case when ptr.student_answer ~ '^[0-3]$' then ptr.student_answer::smallint else null end,
           ptr.is_correct,
           ptr.answered_at
      from public.practice_test_responses ptr
      join public.practice_test_attempts pta on pta.id = ptr.practice_test_attempt_id
      join students s on s.id = pta.user_id
     where ptr.answered_at is not null
  ),
  answers as (
    select * from all_answers
     where question_id = p_question_id
       and occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and occurred_at < coalesce(p_to, now())
  ),
  events as (
    select e.* from public.analytics_events e
      join students s on s.id = e.user_id
     where e.question_id = p_question_id
       and e.occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and e.occurred_at < coalesce(p_to, now())
  ),
  original_misses as (
    select a.user_id, min(a.occurred_at) as missed_at
      from answers a
     where not a.is_correct
     group by a.user_id
  ),
  watchers as (
    select e.user_id, min(e.occurred_at) as watched_at
      from events e
      join original_misses m on m.user_id = e.user_id
     where e.event_name = 'watch_explanation_clicked'
       and e.occurred_at >= m.missed_at
     group by e.user_id
  ),
  later_watched as (
    select a.user_id, a.is_correct, a.question_id
      from watchers w
      join public.questions original on original.id = p_question_id
      join all_answers a on a.user_id = w.user_id
      join public.questions later_q on later_q.id = a.question_id
     where later_q.subtopic_id = original.subtopic_id
       and a.occurred_at > w.watched_at
       and a.occurred_at <= w.watched_at + interval '30 days'
  ),
  later_not_watched as (
    select a.user_id, a.is_correct, a.question_id
      from original_misses m
      join public.questions original on original.id = p_question_id
      join all_answers a on a.user_id = m.user_id
      join public.questions later_q on later_q.id = a.question_id
     where not exists (select 1 from watchers w where w.user_id = m.user_id)
       and later_q.subtopic_id = original.subtopic_id
       and a.occurred_at > m.missed_at
       and a.occurred_at <= m.missed_at + interval '30 days'
  ),
  summary as (
    select count(*)::integer as attempts,
           count(*) filter (where is_correct)::integer as correct,
           count(*) filter (where not is_correct)::integer as incorrect
      from answers
  ),
  event_summary as (
    select count(*) filter (where event_name = 'question_viewed')::integer as views,
           count(*) filter (where event_name = 'question_skipped')::integer as skips,
           count(*) filter (where event_name = 'question_gave_up')::integer as give_ups,
           count(*) filter (where event_name = 'question_struggled')::integer as struggles,
           count(*) filter (where event_name = 'explanation_opened')::integer as explanation_opens,
           count(*) filter (where event_name = 'explanation_video_started')::integer as video_starts,
           count(*) filter (where event_name = 'explanation_video_completed')::integer as video_completions,
           round(avg(answer_time_ms) filter (where event_name = 'question_answered' and answer_time_ms is not null)) as avg_answer_ms,
           round(percentile_cont(0.5) within group (order by answer_time_ms)
             filter (where event_name = 'question_answered' and answer_time_ms is not null)) as median_answer_ms
      from events
  ),
  reports as (
    select count(*)::integer as count
      from public.question_reports r
      join students s on s.id = r.user_id
     where r.question_id = p_question_id
       and r.created_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and r.created_at < coalesce(p_to, now())
  ),
  effectiveness as (
    select
      (select count(distinct user_id) from original_misses) as incorrect_users,
      (select count(*) from watchers) as watchers,
      (select count(distinct e.user_id)
         from events e join watchers w on w.user_id = e.user_id
        where e.event_name = 'explanation_video_completed'
          and e.occurred_at >= w.watched_at) as completers,
      (select count(*) from later_watched) as watched_later_attempts,
      (select count(*) filter (where is_correct) from later_watched) as watched_later_correct,
      (select count(*) from later_not_watched) as comparison_later_attempts,
      (select count(*) filter (where is_correct) from later_not_watched) as comparison_later_correct,
      (select count(distinct user_id) from later_watched
        where question_id = p_question_id and is_correct) as successful_retries
  )
  select jsonb_build_object(
    'question', jsonb_build_object(
      'id', q.id,
      'prompt', q.prompt,
      'choices', q.choices,
      'correctChoice', q.correct_choice,
      'difficulty', q.difficulty,
      'domain', d.name,
      'subtopic', st.name,
      'solutionVideoId', q.solution_video_id
    ),
    'metrics', jsonb_build_object(
      'views', es.views,
      'attempts', sm.attempts,
      'correct', sm.correct,
      'incorrect', sm.incorrect,
      'accuracy', case when sm.attempts > 0 then round(100.0 * sm.correct / sm.attempts, 1) else null end,
      'skips', es.skips,
      'skipRate', case when es.views >= 5 then round(100.0 * es.skips / es.views, 1) else null end,
      'giveUps', es.give_ups,
      'giveUpRate', case when es.views >= 5 then round(100.0 * es.give_ups / es.views, 1) else null end,
      'struggles', es.struggles,
      'struggleRate', case when sm.attempts >= 5 then round(100.0 * es.struggles / sm.attempts, 1) else null end,
      'averageAnswerTimeMs', es.avg_answer_ms,
      'medianAnswerTimeMs', es.median_answer_ms,
      'explanationOpens', es.explanation_opens,
      'explanationOpenRate', case when sm.attempts >= 5 then round(100.0 * es.explanation_opens / sm.attempts, 1) else null end,
      'explanationVideoStarts', es.video_starts,
      'explanationVideoCompletions', es.video_completions,
      'explanationVideoCompletionRate', case when es.video_starts >= 5 then round(100.0 * es.video_completions / es.video_starts, 1) else null end,
      'reports', rp.count
    ),
    'answerDistribution', coalesce((
      select jsonb_agg(jsonb_build_object(
        'choice', choices.choice,
        'count', choices.count,
        'percent', case when sm.attempts > 0 then round(100.0 * choices.count / sm.attempts, 1) else 0 end,
        'isCorrect', choices.choice = q.correct_choice
      ) order by choices.choice)
      from (
        select generated.choice,
               count(a.selected_choice) filter (where a.selected_choice = generated.choice)::integer as count
          from generate_series(0, 3) generated(choice)
          left join answers a on a.selected_choice = generated.choice
         group by generated.choice
      ) choices
    ), '[]'::jsonb),
    'effectiveness', jsonb_build_object(
      'incorrectUsers', ef.incorrect_users,
      'watchers', ef.watchers,
      'watchRate', case when ef.incorrect_users >= 5 then round(100.0 * ef.watchers / ef.incorrect_users, 1) else null end,
      'completers', ef.completers,
      'completionRate', case when ef.watchers >= 5 then round(100.0 * ef.completers / ef.watchers, 1) else null end,
      'watchedLaterAttempts', ef.watched_later_attempts,
      'watchedLaterAccuracy', case when ef.watched_later_attempts >= 5 then round(100.0 * ef.watched_later_correct / ef.watched_later_attempts, 1) else null end,
      'comparisonLaterAttempts', ef.comparison_later_attempts,
      'comparisonLaterAccuracy', case when ef.comparison_later_attempts >= 5 then round(100.0 * ef.comparison_later_correct / ef.comparison_later_attempts, 1) else null end,
      'successfulRetries', ef.successful_retries
    )
  ) into v_result
  from public.questions q
  join public.subtopics st on st.id = q.subtopic_id
  join public.domains d on d.id = st.domain_id
  cross join summary sm
  cross join event_summary es
  cross join reports rp
  cross join effectiveness ef
  where q.id = p_question_id;

  return v_result;
end;
$fn$;

revoke all on function public.admin_analytics_question_detail(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_question_detail(uuid, timestamptz, timestamptz)
  to authenticated;


-- ============================================================================
-- 7. Video analytics
-- ============================================================================

create or replace function public.admin_analytics_videos(
  p_from        timestamptz default null,
  p_to          timestamptz default now(),
  p_video_type  text default 'all',
  p_sort        text default 'starts_desc',
  p_limit       integer default 50,
  p_offset      integer default 0
)
returns table (
  video_id uuid,
  title text,
  video_type text,
  starts bigint,
  unique_viewers bigint,
  total_watch_seconds bigint,
  average_percent_watched numeric,
  reached_25 bigint,
  reached_50 bigint,
  reached_75 bigint,
  completions bigint,
  completion_rate numeric,
  abandonments bigint,
  abandonment_rate numeric,
  repeat_viewers bigint,
  linked_questions bigint,
  domain_name text,
  subtopic_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
  with students as (
    select p.id from public.profiles p
     where not exists (select 1 from public.admin_users a where a.user_id = p.id)
  ),
  raw as (
    select e.*,
           case when e.question_id is not null or e.event_name like 'explanation_video_%'
             then 'explanation' else 'general' end as playback_type
      from public.analytics_events e
      join students s on s.id = e.user_id
     where e.video_id is not null
       and e.event_name in (
         'video_started', 'video_25', 'video_50', 'video_75',
         'video_completed', 'video_abandoned', 'video_replayed', 'video_seeked',
         'explanation_video_started', 'explanation_video_25',
         'explanation_video_50', 'explanation_video_75',
         'explanation_video_completed', 'explanation_video_abandoned',
         'explanation_video_replayed', 'explanation_video_seeked'
       )
       and e.occurred_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and e.occurred_at < coalesce(p_to, now())
  ),
  playbacks as (
    select r.video_id,
           r.user_id,
           r.session_id,
           max(r.playback_type) as playback_type,
           bool_or(r.event_name in ('video_started', 'explanation_video_started')) as started,
           max(coalesce(r.progress_percent, 0)) as max_progress,
           max(coalesce(r.watched_seconds, 0)) as watched_seconds,
           bool_or(r.event_name in ('video_completed', 'explanation_video_completed')) as completed,
           bool_or(r.event_name in ('video_abandoned', 'explanation_video_abandoned')) as abandoned,
           count(*) filter (where r.event_name in ('video_replayed', 'explanation_video_replayed')) as replays
      from raw r
     group by r.video_id, r.user_id, r.session_id
  ),
  viewer_counts as (
    select p.video_id, p.user_id, count(*) filter (where p.started) as starts
      from playbacks p group by p.video_id, p.user_id
  ),
  rollup as (
    select p.video_id,
           case
             when bool_or(p.playback_type = 'explanation') and bool_or(p.playback_type = 'general') then 'mixed'
             when bool_or(p.playback_type = 'explanation') then 'explanation'
             else 'general'
           end as video_type,
           count(*) filter (where p.started) as starts,
           count(distinct p.user_id) filter (where p.started) as unique_viewers,
           sum(p.watched_seconds)::bigint as watch_seconds,
           avg(p.max_progress) filter (where p.started) as avg_percent,
           count(*) filter (where p.max_progress >= 25) as reached_25,
           count(*) filter (where p.max_progress >= 50) as reached_50,
           count(*) filter (where p.max_progress >= 75) as reached_75,
           count(*) filter (where p.completed) as completions,
           count(*) filter (where p.abandoned and not p.completed) as abandonments,
           sum(p.replays)::bigint as replays
      from playbacks p
     group by p.video_id
  ),
  linked as (
    select q.solution_video_id as video_id, count(*) as linked_questions
      from public.questions q
     where q.solution_video_id is not null
     group by q.solution_video_id
  ),
  combined as (
    select v.id,
           v.title,
           coalesce(r.video_type, case when coalesce(l.linked_questions, 0) > 0 then 'explanation' else 'general' end) as video_type,
           coalesce(r.starts, 0) as starts,
           coalesce(r.unique_viewers, 0) as unique_viewers,
           coalesce(r.watch_seconds, 0) as total_watch_seconds,
           round(r.avg_percent, 1) as average_percent_watched,
           coalesce(r.reached_25, 0) as reached_25,
           coalesce(r.reached_50, 0) as reached_50,
           coalesce(r.reached_75, 0) as reached_75,
           coalesce(r.completions, 0) as completions,
           case when coalesce(r.starts, 0) >= 5 then round(100.0 * r.completions / r.starts, 1) else null end as completion_rate,
           coalesce(r.abandonments, 0) as abandonments,
           case when coalesce(r.starts, 0) >= 5 then round(100.0 * r.abandonments / r.starts, 1) else null end as abandonment_rate,
           coalesce((select count(*) from viewer_counts vc where vc.video_id = v.id and vc.starts > 1), 0) as repeat_viewers,
           coalesce(l.linked_questions, 0) as linked_questions,
           d.name as domain_name,
           st.name as subtopic_name
      from public.videos v
      left join rollup r on r.video_id = v.id
      left join linked l on l.video_id = v.id
      left join public.subtopics st on st.id = v.subtopic_id
      left join public.domains d on d.id = st.domain_id
  )
  select c.id,
         c.title,
         c.video_type,
         c.starts,
         c.unique_viewers,
         c.total_watch_seconds,
         c.average_percent_watched,
         c.reached_25,
         c.reached_50,
         c.reached_75,
         c.completions,
         c.completion_rate,
         c.abandonments,
         c.abandonment_rate,
         c.repeat_viewers,
         c.linked_questions,
         c.domain_name,
         c.subtopic_name,
         count(*) over()
    from combined c
   where p_video_type = 'all'
      or c.video_type = p_video_type
      or (p_video_type = 'explanation' and c.video_type = 'mixed')
      or (p_video_type = 'general' and c.video_type = 'mixed')
   order by
     case when p_sort = 'completion_desc' then c.completion_rate end desc nulls last,
     case when p_sort = 'completion_asc' then c.completion_rate end asc nulls last,
     case when p_sort = 'abandoned_desc' then c.abandonment_rate end desc nulls last,
     case when p_sort = 'replayed_desc' then c.repeat_viewers end desc,
     case when p_sort = 'starts_desc' then c.starts end desc,
     c.title
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

revoke all on function public.admin_analytics_videos(timestamptz, timestamptz, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_videos(timestamptz, timestamptz, text, text, integer, integer)
  to authenticated;


-- ============================================================================
-- 8. Retention cohorts and tracked sessions
-- ============================================================================

create or replace function public.admin_analytics_retention(
  p_from timestamptz default null,
  p_to   timestamptz default now()
)
returns table (
  cohort_start date,
  cohort_size bigint,
  day_1 numeric,
  day_3 numeric,
  day_7 numeric,
  day_14 numeric,
  day_30 numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
  with students as (
    select p.id, p.created_at
      from public.profiles p
     where not exists (select 1 from public.admin_users a where a.user_id = p.id)
       and p.created_at >= coalesce(p_from, '1970-01-01'::timestamptz)
       and p.created_at < coalesce(p_to, now())
  ),
  activity as (
    select qa.user_id, qa.attempted_at::date as activity_day
      from public.question_attempts qa
    union
    select pta.user_id, ptr.answered_at::date
      from public.practice_test_responses ptr
      join public.practice_test_attempts pta on pta.id = ptr.practice_test_attempt_id
     where ptr.answered_at is not null
    union
    select e.user_id, e.occurred_at::date
      from public.analytics_events e
     where e.event_name not in ('question_viewed', 'explanation_button_shown')
  ),
  cohorts as (
    select date_trunc('week', s.created_at)::date as cohort_start,
           s.id,
           s.created_at::date as joined_day
      from students s
  ),
  flags as (
    select c.cohort_start,
           c.id,
           c.joined_day,
           bool_or(a.activity_day = c.joined_day + 1) as d1,
           bool_or(a.activity_day = c.joined_day + 3) as d3,
           bool_or(a.activity_day = c.joined_day + 7) as d7,
           bool_or(a.activity_day = c.joined_day + 14) as d14,
           bool_or(a.activity_day = c.joined_day + 30) as d30
      from cohorts c
      left join activity a on a.user_id = c.id
       and a.activity_day between c.joined_day + 1 and c.joined_day + 30
     group by c.cohort_start, c.id, c.joined_day
  )
  select f.cohort_start,
         count(*) as cohort_size,
         case when count(*) filter (where f.joined_day + 1 < current_date) >= 5
           then round(100.0 * count(*) filter (where f.d1 and f.joined_day + 1 < current_date)
             / count(*) filter (where f.joined_day + 1 < current_date), 1) else null end,
         case when count(*) filter (where f.joined_day + 3 < current_date) >= 5
           then round(100.0 * count(*) filter (where f.d3 and f.joined_day + 3 < current_date)
             / count(*) filter (where f.joined_day + 3 < current_date), 1) else null end,
         case when count(*) filter (where f.joined_day + 7 < current_date) >= 5
           then round(100.0 * count(*) filter (where f.d7 and f.joined_day + 7 < current_date)
             / count(*) filter (where f.joined_day + 7 < current_date), 1) else null end,
         case when count(*) filter (where f.joined_day + 14 < current_date) >= 5
           then round(100.0 * count(*) filter (where f.d14 and f.joined_day + 14 < current_date)
             / count(*) filter (where f.joined_day + 14 < current_date), 1) else null end,
         case when count(*) filter (where f.joined_day + 30 < current_date) >= 5
           then round(100.0 * count(*) filter (where f.d30 and f.joined_day + 30 < current_date)
             / count(*) filter (where f.joined_day + 30 < current_date), 1) else null end
    from flags f
   group by f.cohort_start
   order by f.cohort_start desc;
end;
$fn$;

revoke all on function public.admin_analytics_retention(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_retention(timestamptz, timestamptz)
  to authenticated;


create or replace function public.admin_analytics_sessions(
  p_from   timestamptz default null,
  p_to     timestamptz default now(),
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  session_id uuid,
  user_id uuid,
  full_name text,
  email text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  pages_viewed integer,
  questions_answered bigint,
  accuracy numeric,
  videos_watched bigint,
  exit_page text,
  likely_give_up boolean,
  posthog_session_id text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
  with students as (
    select p.id, p.full_name, p.email
      from public.profiles p
     where not exists (select 1 from public.admin_users a where a.user_id = p.id)
  ),
  rollup as (
    select e.session_id,
           count(*) filter (where e.event_name = 'question_answered') as questions,
           count(*) filter (where e.event_name = 'question_answered' and e.is_correct) as correct,
           count(*) filter (where e.event_name = 'question_answered' and e.is_correct is not null) as graded,
           count(*) filter (where e.event_name in ('video_started', 'explanation_video_started')) as videos,
           bool_or(e.event_name = 'question_gave_up') as gave_up
      from public.analytics_events e
      join students s on s.id = e.user_id
     where e.session_id is not null
     group by e.session_id
  )
  select ses.id,
         ses.user_id,
         s.full_name,
         s.email,
         ses.started_at,
         ses.ended_at,
         greatest(0, extract(epoch from (coalesce(ses.ended_at, ses.last_activity_at) - ses.started_at))::integer),
         ses.page_views,
         coalesce(r.questions, 0),
         case when coalesce(r.graded, 0) > 0 then round(100.0 * r.correct / r.graded, 1) else null end,
         coalesce(r.videos, 0),
         ses.exit_page,
         coalesce(r.gave_up, false),
         ses.posthog_session_id,
         count(*) over()
    from public.analytics_sessions ses
    join students s on s.id = ses.user_id
    left join rollup r on r.session_id = ses.id
   where ses.meaningful_event_count > 0
     and ses.started_at >= coalesce(p_from, '1970-01-01'::timestamptz)
     and ses.started_at < coalesce(p_to, now())
   order by ses.started_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;

revoke all on function public.admin_analytics_sessions(timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_analytics_sessions(timestamptz, timestamptz, integer, integer)
  to authenticated;


-- Used only by the server-side PostHog query adapter for defense-in-depth.
-- The UI never receives this list, and non-admin callers cannot invoke it.
create or replace function public.admin_analytics_admin_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  return query select a.user_id from public.admin_users a;
end;
$fn$;

revoke all on function public.admin_analytics_admin_ids()
  from public, anon, authenticated;
grant execute on function public.admin_analytics_admin_ids()
  to authenticated;
