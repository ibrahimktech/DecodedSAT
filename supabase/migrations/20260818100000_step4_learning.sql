-- ============================================================================
-- Step 4 — learning schema: content, activity, stats.
--
-- Run this whole file once, top to bottom, in the Supabase Dashboard SQL
-- Editor (or via `supabase db push`). Idempotent; re-running it is safe.
-- Requires the profiles migration (20260818000000_profiles.sql) to have been
-- applied first — every user-owned row here references `public.profiles`.
--
-- Two classes of table, two trust models:
--
--   Content  (domains, subtopics, questions, videos, practice_sections,
--             practice_section_questions)
--     Read-only reference data. Authenticated users may SELECT; nobody may
--     write from a client, ever — rows arrive via the seed script only.
--     `questions` is special: its `correct_choice` and `explanation` columns
--     are withheld from clients by a column-scoped grant, so an answer key
--     cannot be pulled through the REST API before answering. Grading happens
--     inside security definer functions below.
--
--   Activity (question_attempts, practice_attempts, user_stats)
--     Per-user rows, default-deny. Users may SELECT their own rows and nothing
--     else — no INSERT/UPDATE/DELETE grants at all. Every write goes through a
--     security definer function that recomputes results server-side, so a
--     client cannot claim an answer was correct or invent a section score,
--     even talking to PostgREST directly with its own session token.
--
-- Streak and mastery are computed at read time from `question_attempts` /
-- `practice_attempts` (functions at the bottom); nothing stores a counter
-- that can drift. All "day" arithmetic is UTC.
-- ============================================================================


-- ============================================================================
-- 1. Content tables
-- ============================================================================

create table if not exists public.domains (
  id       uuid primary key,
  slug     text not null unique,
  name     text not null,
  -- Display order. The four SAT math domains are fixed; the seed is the only
  -- writer, so there is no path for a client to add a fifth.
  position smallint not null default 0
);

comment on table public.domains is
  'The four fixed SAT math domains. Seeded only; never client-writable.';

create table if not exists public.subtopics (
  id        uuid primary key,
  domain_id uuid not null references public.domains (id) on delete cascade,
  slug      text not null unique,
  name      text not null,
  position  smallint not null default 0
);

create index if not exists subtopics_domain_id_idx
  on public.subtopics (domain_id);

create table if not exists public.questions (
  id             uuid primary key,
  subtopic_id    uuid not null references public.subtopics (id) on delete cascade,
  prompt         text not null,
  -- Exactly four answer choices, as a JSON array of strings. The shape check
  -- is here so a malformed seed fails loudly at insert, not at render.
  choices        jsonb not null,
  -- Index into `choices`. Withheld from clients (see grants below).
  correct_choice smallint not null check (correct_choice between 0 and 3),
  explanation    text not null,
  difficulty     text not null check (difficulty in ('easy', 'medium', 'hard')),
  constraint questions_choices_shape check (
    jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) = 4
  )
);

create index if not exists questions_subtopic_id_idx
  on public.questions (subtopic_id);

create table if not exists public.videos (
  id          uuid primary key,
  subtopic_id uuid not null references public.subtopics (id) on delete cascade,
  title       text not null,
  youtube_id  text not null,
  description text not null default ''
);

create index if not exists videos_subtopic_id_idx
  on public.videos (subtopic_id);

create table if not exists public.practice_sections (
  id                 uuid primary key,
  domain_id          uuid not null references public.domains (id) on delete cascade,
  title              text not null,
  description        text,
  time_limit_seconds integer not null check (time_limit_seconds between 60 and 7200)
);

-- Which questions a section drills, and in what order.
create table if not exists public.practice_section_questions (
  section_id  uuid not null references public.practice_sections (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  position    smallint not null,
  primary key (section_id, question_id),
  unique (section_id, position)
);

create index if not exists practice_section_questions_question_id_idx
  on public.practice_section_questions (question_id);


-- ============================================================================
-- 2. Activity tables
-- ============================================================================

-- The source of truth for mastery, streak and daily goal. Rows are written
-- only by the security definer functions below; `is_correct` is recomputed by
-- a trigger on every insert, so it cannot be supplied from outside. Rows are
-- immutable — there is no update path at all.
create table if not exists public.question_attempts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  question_id         uuid not null references public.questions (id) on delete cascade,
  selected_choice     smallint not null check (selected_choice between 0 and 3),
  is_correct          boolean not null,
  -- Set when the attempt was part of a timed section submit; null for the
  -- question bank. Lets the results page reconstruct a run. The FK to
  -- practice_attempts is added further down, after that table exists.
  practice_attempt_id uuid,
  attempted_at        timestamptz not null default now()
);

create index if not exists question_attempts_user_recency_idx
  on public.question_attempts (user_id, attempted_at desc);
create index if not exists question_attempts_user_question_idx
  on public.question_attempts (user_id, question_id);
create index if not exists question_attempts_practice_attempt_idx
  on public.question_attempts (practice_attempt_id);

-- One row per timed run. Created by start_practice_attempt() with
-- completed_at null; score/total/time are written exactly once by
-- submit_practice_attempt(), which computes them server-side.
create table if not exists public.practice_attempts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  practice_section_id uuid not null references public.practice_sections (id) on delete cascade,
  score               smallint,
  total_questions     smallint,
  time_taken_seconds  integer,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists practice_attempts_user_recency_idx
  on public.practice_attempts (user_id, started_at desc);

-- Onboarding will populate the score columns later; the schema exists now so
-- nothing changes when it ships. `daily_goal` is a fixed default until
-- onboarding introduces user-configurable settings. Streak is deliberately
-- NOT a column here — it is computed from activity by current_streak().
create table if not exists public.user_stats (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  current_score_estimate smallint check (current_score_estimate between 200 and 800),
  target_score           smallint check (target_score between 200 and 800),
  daily_goal             smallint not null default 20 check (daily_goal between 1 and 200),
  created_at             timestamptz not null default now()
);

-- `question_attempts` above references `practice_attempts`, which is created
-- after it on a fresh database. Adding the FK separately keeps both
-- `create table` statements order-independent and the file idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'question_attempts_practice_attempt_id_fkey'
      and conrelid = 'public.question_attempts'::regclass
  ) then
    alter table public.question_attempts
      add constraint question_attempts_practice_attempt_id_fkey
      foreign key (practice_attempt_id)
      references public.practice_attempts (id) on delete set null;
  end if;
end;
$$;


-- ============================================================================
-- 3. Row Level Security + grants
--
-- Same doctrine as `profiles`: RLS enabled and FORCEd in the migration that
-- creates the table, grants revoked before being re-granted narrowly, and the
-- policies below are the complete list of what is permitted. Grants are the
-- coarse gate, policies the fine one; both must allow a statement.
-- ============================================================================

-- --- Content: authenticated may read, nobody may write from a client --------

alter table public.domains enable row level security;
alter table public.domains force row level security;
revoke all on table public.domains from anon, authenticated;
grant select on table public.domains to authenticated;

drop policy if exists domains_select_authenticated on public.domains;
create policy domains_select_authenticated
  on public.domains for select to authenticated
  using (true);

alter table public.subtopics enable row level security;
alter table public.subtopics force row level security;
revoke all on table public.subtopics from anon, authenticated;
grant select on table public.subtopics to authenticated;

drop policy if exists subtopics_select_authenticated on public.subtopics;
create policy subtopics_select_authenticated
  on public.subtopics for select to authenticated
  using (true);

-- Questions: the grant is column-scoped. `correct_choice` and `explanation`
-- are the answer key; a client that selects them gets a permission error, so
-- the key cannot be scraped before answering. Server code holds no service
-- key and runs as `authenticated` too — grading goes through the security
-- definer functions below, and post-attempt review goes through the
-- `attempted_question_solutions` view.
alter table public.questions enable row level security;
alter table public.questions force row level security;
revoke all on table public.questions from anon, authenticated;
grant select (id, subtopic_id, prompt, choices, difficulty)
  on public.questions to authenticated;

drop policy if exists questions_select_authenticated on public.questions;
create policy questions_select_authenticated
  on public.questions for select to authenticated
  using (true);

alter table public.videos enable row level security;
alter table public.videos force row level security;
revoke all on table public.videos from anon, authenticated;
grant select on table public.videos to authenticated;

drop policy if exists videos_select_authenticated on public.videos;
create policy videos_select_authenticated
  on public.videos for select to authenticated
  using (true);

alter table public.practice_sections enable row level security;
alter table public.practice_sections force row level security;
revoke all on table public.practice_sections from anon, authenticated;
grant select on table public.practice_sections to authenticated;

drop policy if exists practice_sections_select_authenticated on public.practice_sections;
create policy practice_sections_select_authenticated
  on public.practice_sections for select to authenticated
  using (true);

alter table public.practice_section_questions enable row level security;
alter table public.practice_section_questions force row level security;
revoke all on table public.practice_section_questions from anon, authenticated;
grant select on table public.practice_section_questions to authenticated;

drop policy if exists practice_section_questions_select_authenticated on public.practice_section_questions;
create policy practice_section_questions_select_authenticated
  on public.practice_section_questions for select to authenticated
  using (true);

-- --- Activity: read your own rows; write nothing directly -------------------
-- No INSERT/UPDATE/DELETE grants on purpose. Writes exist only inside the
-- security definer functions, which validate against the real answer key.

alter table public.question_attempts enable row level security;
alter table public.question_attempts force row level security;
revoke all on table public.question_attempts from anon, authenticated;
grant select on table public.question_attempts to authenticated;

drop policy if exists question_attempts_select_own on public.question_attempts;
create policy question_attempts_select_own
  on public.question_attempts for select to authenticated
  using (auth.uid() = user_id);

alter table public.practice_attempts enable row level security;
alter table public.practice_attempts force row level security;
revoke all on table public.practice_attempts from anon, authenticated;
grant select on table public.practice_attempts to authenticated;

drop policy if exists practice_attempts_select_own on public.practice_attempts;
create policy practice_attempts_select_own
  on public.practice_attempts for select to authenticated
  using (auth.uid() = user_id);

alter table public.user_stats enable row level security;
alter table public.user_stats force row level security;
revoke all on table public.user_stats from anon, authenticated;
grant select on table public.user_stats to authenticated;

drop policy if exists user_stats_select_own on public.user_stats;
create policy user_stats_select_own
  on public.user_stats for select to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 4. Triggers
-- ============================================================================

-- `is_correct` is never trusted from the caller: whatever an INSERT claims,
-- this recomputes it from the answer key. Security definer because the key
-- columns are readable by no client role — the trigger must be able to read
-- them no matter who (or what future code path) fires the insert.
create or replace function public.compute_question_attempt_correctness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correct smallint;
begin
  select q.correct_choice into v_correct
    from public.questions q
   where q.id = new.question_id;

  if not found then
    raise exception 'unknown_question';
  end if;

  new.is_correct := new.selected_choice = v_correct;
  return new;
end;
$$;

revoke all on function public.compute_question_attempt_correctness()
  from public, anon, authenticated;

drop trigger if exists question_attempts_compute_correctness on public.question_attempts;
create trigger question_attempts_compute_correctness
  before insert on public.question_attempts
  for each row
  execute function public.compute_question_attempt_correctness();

-- Every profile gets a stats row the moment it exists, so page code can rely
-- on the row being there instead of special-casing its absence everywhere.
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_profile()
  from public, anon, authenticated;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row
  execute function public.handle_new_profile();

-- Backfill for profiles that existed before this migration.
insert into public.user_stats (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;


-- ============================================================================
-- 5. Post-attempt solutions view
--
-- The column grant on `questions` hides the answer key. This view is the one
-- sanctioned way to see it afterwards: it exposes `correct_choice` and
-- `explanation` only for questions the caller has actually attempted, or that
-- belonged to a timed section the caller has completed (so the results page
-- can explain the questions they left blank).
--
-- Deliberately a definer-style view (owner's privileges — the Supabase
-- advisor will flag it; that is expected and intended). It has to read
-- columns clients cannot, and it filters every row by auth.uid() itself.
-- `security_barrier` stops a leaky function from peeking past that filter.
-- ============================================================================

create or replace view public.attempted_question_solutions
with (security_barrier = true)
as
select q.id as question_id,
       q.correct_choice,
       q.explanation
  from public.questions q
 where exists (
         select 1
           from public.question_attempts qa
          where qa.question_id = q.id
            and qa.user_id = auth.uid()
       )
    or exists (
         select 1
           from public.practice_attempts pa
           join public.practice_section_questions psq
             on psq.section_id = pa.practice_section_id
          where psq.question_id = q.id
            and pa.user_id = auth.uid()
            and pa.completed_at is not null
       );

revoke all on table public.attempted_question_solutions from anon, authenticated;
grant select on table public.attempted_question_solutions to authenticated;


-- ============================================================================
-- 6. Grading and attempt functions (the only write paths)
--
-- All four run as security definer with an empty search_path, so every name
-- is schema-qualified and each one re-derives the caller from auth.uid() —
-- never from an argument. Execution is granted to `authenticated` only.
-- ============================================================================

-- Grade one question-bank answer. Records the attempt and returns the
-- verdict, the correct choice, and the explanation — which is the moment the
-- caller earns the right to see them.
create or replace function public.submit_question_attempt(
  p_question_id uuid,
  p_choice      integer
)
returns table (is_correct boolean, correct_choice integer, explanation text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid;
  v_correct     smallint;
  v_explanation text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_choice is null or p_choice < 0 or p_choice > 3 then
    raise exception 'invalid_choice';
  end if;

  select q.correct_choice, q.explanation
    into v_correct, v_explanation
    from public.questions q
   where q.id = p_question_id;

  if not found then
    raise exception 'unknown_question';
  end if;

  -- is_correct is filled in by the trigger; supplying it here would be
  -- overwritten anyway.
  insert into public.question_attempts (user_id, question_id, selected_choice)
  values (v_uid, p_question_id, p_choice::smallint);

  return query
    select (p_choice::smallint = v_correct), v_correct::integer, v_explanation;
end;
$$;

revoke all on function public.submit_question_attempt(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.submit_question_attempt(uuid, integer)
  to authenticated;

-- Open a timed run. If an unfinished, unexpired run for this section already
-- exists it is returned instead of stacking a new row — that is what makes
-- "resume where you left off" resolve to one attempt.
create or replace function public.start_practice_attempt(p_section_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_limit   integer;
  v_attempt uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select ps.time_limit_seconds into v_limit
    from public.practice_sections ps
   where ps.id = p_section_id;

  if not found then
    raise exception 'unknown_section';
  end if;

  select pa.id into v_attempt
    from public.practice_attempts pa
   where pa.user_id = v_uid
     and pa.practice_section_id = p_section_id
     and pa.completed_at is null
     and pa.started_at + make_interval(secs => v_limit) > now()
   order by pa.started_at desc
   limit 1;

  if found then
    return v_attempt;
  end if;

  insert into public.practice_attempts (user_id, practice_section_id)
  values (v_uid, p_section_id)
  returning id into v_attempt;

  return v_attempt;
end;
$$;

revoke all on function public.start_practice_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.start_practice_attempt(uuid)
  to authenticated;

-- Close a timed run. The score, the per-question verdicts and the elapsed
-- time are all computed here from the server's own clock and answer key —
-- nothing numeric from the client survives. Answers are an array of
-- {"questionId": uuid, "choice": 0..3}; anything malformed, or referencing a
-- question outside the section, rejects the whole submission (no repair).
create or replace function public.submit_practice_attempt(
  p_attempt_id uuid,
  p_answers    jsonb
)
returns table (score integer, total integer, time_taken_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid;
  v_section   uuid;
  v_started   timestamptz;
  v_completed timestamptz;
  v_limit     integer;
  v_total     integer;
  v_correct   integer;
  v_time      integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_answers is null
     or jsonb_typeof(p_answers) <> 'array'
     or jsonb_array_length(p_answers) > 60 then
    raise exception 'malformed_answers';
  end if;

  -- Row lock so a double submit serialises: the second waits, re-reads the
  -- committed row, sees completed_at set, and raises instead of double-
  -- writing attempts.
  select pa.practice_section_id, pa.started_at, pa.completed_at,
         ps.time_limit_seconds
    into v_section, v_started, v_completed, v_limit
    from public.practice_attempts pa
    join public.practice_sections ps on ps.id = pa.practice_section_id
   where pa.id = p_attempt_id
     and pa.user_id = v_uid
   for update of pa;

  if not found then
    raise exception 'unknown_attempt';
  end if;

  if v_completed is not null then
    raise exception 'already_submitted';
  end if;

  -- 60s of grace over the limit covers the auto-submit's network trip; past
  -- that the run is dead and stays incomplete (start_practice_attempt will
  -- open a fresh one).
  if now() > v_started + make_interval(secs => v_limit + 60) then
    raise exception 'attempt_expired';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_answers) elem
     where jsonb_typeof(elem) <> 'object'
        or (elem->>'questionId') is null
        or not ((elem->>'choice') ~ '^[0-3]$')
  ) then
    raise exception 'malformed_answers';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_answers) elem
      left join public.practice_section_questions psq
        on psq.section_id = v_section
       and psq.question_id = (elem->>'questionId')::uuid
     where psq.question_id is null
  ) then
    raise exception 'question_not_in_section';
  end if;

  select count(*)::integer into v_total
    from public.practice_section_questions psq
   where psq.section_id = v_section;

  -- Last answer wins if the same question appears twice. Unanswered questions
  -- get no attempt row — they were not attempted — but still count against
  -- the score via v_total.
  with parsed as (
    select (elem->>'questionId')::uuid  as question_id,
           (elem->>'choice')::smallint  as choice,
           ord
      from jsonb_array_elements(p_answers) with ordinality as t(elem, ord)
  ),
  deduped as (
    select distinct on (question_id) question_id, choice
      from parsed
     order by question_id, ord desc
  ),
  inserted as (
    insert into public.question_attempts
      (user_id, question_id, selected_choice, practice_attempt_id)
    select v_uid, d.question_id, d.choice, p_attempt_id
      from deduped d
    returning question_attempts.is_correct
  )
  select (count(*) filter (where i.is_correct))::integer
    into v_correct
    from inserted i;

  v_time := greatest(
    0,
    least(ceil(extract(epoch from (now() - v_started)))::integer, v_limit)
  );

  update public.practice_attempts pa
     set score              = v_correct,
         total_questions    = v_total,
         time_taken_seconds = v_time,
         completed_at       = now()
   where pa.id = p_attempt_id;

  return query select v_correct, v_total, v_time;
end;
$$;

revoke all on function public.submit_practice_attempt(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_practice_attempt(uuid, jsonb)
  to authenticated;


-- ============================================================================
-- 7. Read-time metrics
--
-- Security *invoker* (the default), on purpose: they run with the caller's
-- own permissions, so RLS on the activity tables applies and the explicit
-- auth.uid() filters are belt-and-braces rather than the only barrier.
-- ============================================================================

-- Accuracy per domain over a rolling window of the caller's last 50 attempts
-- in that domain — recent work, not an all-time average that stale history
-- would anchor. Domains with no attempts return no row.
create or replace function public.domain_mastery()
returns table (domain_id uuid, attempts integer, correct integer)
language sql
stable
set search_path = ''
as $$
  select ranked.domain_id,
         count(*)::integer                                as attempts,
         (count(*) filter (where ranked.is_correct))::integer as correct
    from (
      select d.id as domain_id,
             qa.is_correct,
             row_number() over (
               partition by d.id
               order by qa.attempted_at desc, qa.id desc
             ) as recency_rank
        from public.question_attempts qa
        join public.questions  q on q.id = qa.question_id
        join public.subtopics  s on s.id = q.subtopic_id
        join public.domains    d on d.id = s.domain_id
       where qa.user_id = auth.uid()
    ) ranked
   where ranked.recency_rank <= 50
   group by ranked.domain_id;
$$;

revoke all on function public.domain_mastery()
  from public, anon, authenticated;
grant execute on function public.domain_mastery() to authenticated;

-- Consecutive UTC days with at least one question attempt or practice run,
-- counting back from today — or from yesterday, so a streak is not shown as
-- broken before today is over. Computed, never stored.
create or replace function public.current_streak()
returns integer
language sql
stable
set search_path = ''
as $$
  with days as (
    select distinct activity_day
      from (
        select (qa.attempted_at at time zone 'utc')::date as activity_day
          from public.question_attempts qa
         where qa.user_id = auth.uid()
        union all
        select (pa.started_at at time zone 'utc')::date
          from public.practice_attempts pa
         where pa.user_id = auth.uid()
      ) activity
  ),
  anchor as (
    select max(activity_day) as start_day
      from days
     where activity_day >= ((now() at time zone 'utc')::date - 1)
  ),
  runs as (
    -- row_number() yields bigint; cast so `date - integer` resolves below.
    select d.activity_day,
           (row_number() over (order by d.activity_day desc) - 1)::integer
             as offset_days
      from days d, anchor a
     where a.start_day is not null
       and d.activity_day <= a.start_day
  )
  select coalesce(
    (
      select count(*)::integer
        from runs r, anchor a
       where r.activity_day = a.start_day - r.offset_days
    ),
    0
  );
$$;

revoke all on function public.current_streak()
  from public, anon, authenticated;
grant execute on function public.current_streak() to authenticated;
