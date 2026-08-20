-- ============================================================================
-- Step 7 — question bank sessions, dynamic video categories, full/half
-- practice tests, and the progress/heatmap read paths.
--
-- Run this whole file once, top to bottom, in the Supabase Dashboard SQL
-- Editor (or via `supabase db push`). Idempotent; re-running it is safe.
-- Requires steps 4, 5 and 6 to have been applied first.
--
-- ---------------------------------------------------------------------------
-- A note on why this file does not match the sketch in NextStep.md
-- ---------------------------------------------------------------------------
--
-- That sketch wrote every new activity table as:
--
--     create policy "own test attempts" on public.practice_test_attempts
--       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
--
-- which grants a student INSERT and UPDATE on their own attempt rows. Those
-- rows hold `correct_count` and `wrong_count`. A student holding nothing but
-- their own session token could POST straight to PostgREST and write
-- `correct_count = 44` — no app code involved, nothing to catch it. That
-- directly contradicts the step's own security checklist ("All scoring
-- computed server-side against the real answer key — never trust a
-- client-submitted 'I got this right'").
--
-- So this file follows the doctrine steps 4-6 already established instead:
--
--   Content  (video_categories, practice_tests, practice_test_questions)
--     Authenticated may SELECT. Writes are admin-only, gated by the existing
--     `public.is_admin()` from step 5 — no new authorization path.
--
--   Activity (question_bank_sessions, practice_test_attempts,
--             practice_test_responses)
--     Users may SELECT their own rows and NOTHING else. There is not a single
--     INSERT/UPDATE/DELETE grant to any client role. Every write goes through
--     a SECURITY DEFINER function that re-derives the caller from auth.uid(),
--     re-validates its arguments, and recomputes every score against the real
--     answer key. A client that skips the Server Action and talks to PostgREST
--     directly meets exactly the same wall.
--
-- Two more corrections to the sketch, both forced by what is actually in the
-- database rather than by preference:
--
--   * `videos` has no `domain_id` column. It has `subtopic_id NOT NULL`. So
--     "domain becomes optional" is implemented below as "subtopic_id becomes
--     nullable", with the same either-or CHECK the sketch intended.
--
--   * `questions.correct_choice` and `questions.explanation` are unreadable by
--     every client role (step 4's column-scoped grant). Practice test scoring
--     and answer review therefore go through definer functions and the
--     existing `attempted_question_solutions` security_barrier view, which
--     section 8 extends rather than duplicates.
--
-- All "day" arithmetic inside a *scoring* path is UTC, matching steps 4-6.
-- The reporting function at the bottom takes an IANA timezone instead,
-- because the heatmap is the first place a student reads a date as a date.
-- See section 9.
-- ============================================================================


-- ============================================================================
-- 0. Shared constants
--
-- The real digital SAT math section is two 35-minute modules of 22 questions.
-- Section 0 of the step spec locks timing to that standard, so the numbers
-- live here as immutable functions rather than being sprinkled through a
-- dozen statements. Changing the format later is a change to these.
-- ============================================================================

create or replace function public.sat_module_seconds()
returns integer language sql immutable set search_path = '' as $fn$ select 2100 $fn$;

create or replace function public.sat_module_question_count()
returns integer language sql immutable set search_path = '' as $fn$ select 22 $fn$;

-- Grace added to a module deadline before a submission is refused. Covers the
-- network round trip of an auto-submit fired exactly at 0:00 — the same 60s
-- allowance `submit_practice_attempt()` makes in step 4.
create or replace function public.sat_submit_grace_seconds()
returns integer language sql immutable set search_path = '' as $fn$ select 60 $fn$;

-- How long a finished module 1 may sit on the "Continue to module 2"
-- interstitial before the attempt counts as abandoned. Long enough that a
-- student can take a breather, short enough that a closed tab resolves the
-- same day.
create or replace function public.sat_interstitial_grace_seconds()
returns integer language sql immutable set search_path = '' as $fn$ select 900 $fn$;

comment on function public.sat_module_seconds() is
  'Seconds per practice-test module: 35 minutes, per the real digital SAT.';
comment on function public.sat_module_question_count() is
  'Questions per practice-test module: 22, per the real digital SAT.';

revoke all on function public.sat_module_seconds() from public, anon;
revoke all on function public.sat_module_question_count() from public, anon;
revoke all on function public.sat_submit_grace_seconds() from public, anon;
revoke all on function public.sat_interstitial_grace_seconds() from public, anon;
grant execute on function public.sat_module_seconds() to authenticated;
grant execute on function public.sat_module_question_count() to authenticated;


-- ============================================================================
-- 1. Question bank sessions
--
-- One row per "set" a student sits down to do. Purely a record of what
-- happened — the stopwatch in the UI counts up, imposes no limit, and
-- auto-submits nothing (spec section 3).
--
-- The rollup columns are NOT written by the client. They are recomputed from
-- the linked `question_attempts` rows every time a session closes, so they
-- cannot drift and cannot be forged.
-- ============================================================================

create table if not exists public.question_bank_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds integer,
  question_count   integer not null default 0,
  correct_count    integer not null default 0,
  wrong_count      integer not null default 0
);

comment on table public.question_bank_sessions is
  'One question-bank sitting. Rollup columns are recomputed from '
  'question_attempts on close, never supplied by a caller.';

create index if not exists question_bank_sessions_user_recency_idx
  on public.question_bank_sessions (user_id, started_at desc);

-- Partial index for the "is anything still open for this user" lookup that
-- every close path runs.
create index if not exists question_bank_sessions_open_idx
  on public.question_bank_sessions (user_id)
  where ended_at is null;

alter table public.question_bank_sessions enable row level security;
alter table public.question_bank_sessions force row level security;
revoke all on table public.question_bank_sessions from anon, authenticated;
grant select on table public.question_bank_sessions to authenticated;

drop policy if exists question_bank_sessions_select_own on public.question_bank_sessions;
create policy question_bank_sessions_select_own
  on public.question_bank_sessions for select to authenticated
  using (auth.uid() = user_id);

-- The link from an attempt back to its session. Nullable: attempts made
-- before this migration, and attempts made outside a session, have none.
alter table public.question_attempts
  add column if not exists session_id uuid
    references public.question_bank_sessions (id) on delete set null;

create index if not exists question_attempts_session_idx
  on public.question_attempts (session_id);


-- ============================================================================
-- 2. Question bank session write paths (definer only)
-- ============================================================================

-- Close every session the caller still has open.
--
-- Called two ways: by the player when a set finishes or the page is left, and
-- on load of any page that is NOT the player (the picker, Progress, the
-- dashboard). Reaching one of those means the set really is over, so there is
-- no window in which a live session gets closed underneath someone.
--
-- The end timestamp is the caller's LAST ATTEMPT, not now(). A session
-- abandoned at 21:04 and finalized at 09:00 the next morning lasted twenty
-- minutes, not thirteen hours, and the Progress page must not claim
-- otherwise. Sessions that recorded nothing are deleted rather than kept as
-- empty rows cluttering the history.
create or replace function public.finalize_open_question_bank_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid;
  v_closed integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.question_bank_sessions s
   where s.user_id = v_uid
     and s.ended_at is null
     and not exists (
       select 1 from public.question_attempts qa where qa.session_id = s.id
     );

  update public.question_bank_sessions s
     set ended_at = coalesce(
           (select max(qa.attempted_at) from public.question_attempts qa
             where qa.session_id = s.id),
           s.started_at),
         duration_seconds = greatest(0, ceil(extract(epoch from (
           coalesce(
             (select max(qa.attempted_at) from public.question_attempts qa
               where qa.session_id = s.id),
             s.started_at) - s.started_at)))::integer),
         question_count = (select count(*)::integer from public.question_attempts qa
                            where qa.session_id = s.id),
         correct_count  = (select count(*)::integer from public.question_attempts qa
                            where qa.session_id = s.id and qa.is_correct),
         wrong_count    = (select count(*)::integer from public.question_attempts qa
                            where qa.session_id = s.id and not qa.is_correct)
   where s.user_id = v_uid
     and s.ended_at is null;

  get diagnostics v_closed = row_count;
  return v_closed;
end;
$fn$;

revoke all on function public.finalize_open_question_bank_sessions()
  from public, anon, authenticated;
grant execute on function public.finalize_open_question_bank_sessions() to authenticated;

-- Open a session, closing any the caller left dangling first.
--
-- "Closing first" is what makes a tab closed mid-set resolve correctly (spec
-- section 3) without depending on a client event firing: the next set the
-- student starts finalizes the last one from whatever attempts it has.
create or replace function public.start_question_bank_session()
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid;
  v_session uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  perform public.finalize_open_question_bank_sessions();

  insert into public.question_bank_sessions (user_id)
  values (v_uid)
  returning id into v_session;

  return v_session;
end;
$fn$;

revoke all on function public.start_question_bank_session()
  from public, anon, authenticated;
grant execute on function public.start_question_bank_session() to authenticated;

-- Close one specific session, using the wall clock as its end.
--
-- This is the "student pressed See summary" path, where now() genuinely is
-- when the sitting ended — including time spent reading the last explanation,
-- which is real study time.
create or replace function public.close_question_bank_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid;
  v_updated integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Ownership is part of the WHERE clause, so someone else's session id is
  -- "no rows" (returns false), never an error confirming that it exists.
  delete from public.question_bank_sessions s
   where s.id = p_session_id
     and s.user_id = v_uid
     and s.ended_at is null
     and not exists (
       select 1 from public.question_attempts qa where qa.session_id = s.id
     );

  get diagnostics v_updated = row_count;
  if v_updated > 0 then
    return true;
  end if;

  update public.question_bank_sessions s
     set ended_at = now(),
         duration_seconds = greatest(0, ceil(extract(epoch from (now() - s.started_at)))::integer),
         question_count = (select count(*)::integer from public.question_attempts qa
                            where qa.session_id = s.id),
         correct_count  = (select count(*)::integer from public.question_attempts qa
                            where qa.session_id = s.id and qa.is_correct),
         wrong_count    = (select count(*)::integer from public.question_attempts qa
                            where qa.session_id = s.id and not qa.is_correct)
   where s.id = p_session_id
     and s.user_id = v_uid
     and s.ended_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$fn$;

revoke all on function public.close_question_bank_session(uuid)
  from public, anon, authenticated;
grant execute on function public.close_question_bank_session(uuid) to authenticated;


-- ============================================================================
-- 3. submit_question_attempt gains a session
--
-- The step 4 signature is REPLACED, not overloaded. Two functions with the
-- same name and a defaulted argument make PostgREST's overload resolution
-- ambiguous, and an ambiguous grading path is not worth the convenience.
--
-- `p_session_id` is advisory in the strictest sense: it is accepted only if
-- it names a session the caller owns that is still open. Anything else — a
-- forged id, someone else's session, one already closed — records the attempt
-- with no session rather than failing, because losing the grouping is a
-- reporting inconvenience while losing the attempt is data loss.
-- ============================================================================

drop function if exists public.submit_question_attempt(uuid, integer);

create or replace function public.submit_question_attempt(
  p_question_id uuid,
  p_choice      integer,
  p_session_id  uuid
)
returns table (is_correct boolean, correct_choice integer, explanation text)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid         uuid;
  v_correct     smallint;
  v_explanation text;
  v_session     uuid;
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

  select s.id into v_session
    from public.question_bank_sessions s
   where s.id = p_session_id
     and s.user_id = v_uid
     and s.ended_at is null;

  -- is_correct is filled in by the step 4 trigger; supplying it here would be
  -- overwritten anyway.
  insert into public.question_attempts
    (user_id, question_id, selected_choice, session_id)
  values (v_uid, p_question_id, p_choice::smallint, v_session);

  return query
    select (p_choice::smallint = v_correct), v_correct::integer, v_explanation;
end;
$fn$;

revoke all on function public.submit_question_attempt(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_question_attempt(uuid, integer, uuid)
  to authenticated;


-- ============================================================================
-- 4. Dynamic video categories (videos only)
--
-- Per the locked decision in spec section 0: categories are a VIDEO-only
-- axis. The question bank and practice tests keep the fixed domain/subtopic
-- structure and are untouched by anything in this section.
-- ============================================================================

create table if not exists public.video_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  is_active  boolean not null default true,
  position   smallint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.video_categories is
  'Admin-managed grouping for general (non-domain) explainer videos — '
  '"Desmos tips", "Test-day strategy". Never applied to questions.';

alter table public.video_categories enable row level security;
alter table public.video_categories force row level security;
revoke all on table public.video_categories from anon, authenticated;
grant select on table public.video_categories to authenticated;
grant insert on table public.video_categories to authenticated;
grant update (name, slug, is_active, position) on table public.video_categories to authenticated;

-- Students see active categories; admins additionally see soft-deleted ones
-- so the admin list can offer "restore".
drop policy if exists video_categories_select on public.video_categories;
create policy video_categories_select
  on public.video_categories for select to authenticated
  using (is_active or public.is_admin());

drop policy if exists video_categories_insert_admin on public.video_categories;
create policy video_categories_insert_admin
  on public.video_categories for insert to authenticated
  with check (public.is_admin());

drop policy if exists video_categories_update_admin on public.video_categories;
create policy video_categories_update_admin
  on public.video_categories for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --- videos: a subtopic OR a category, never neither ------------------------
--
-- NOTE: the step spec said `alter column domain_id drop not null`. There is no
-- `domain_id` on this table — a video's domain is reached through its
-- subtopic. The equivalent, and what the spec meant, is below.

alter table public.videos alter column subtopic_id drop not null;

alter table public.videos
  add column if not exists video_category_id uuid
    references public.video_categories (id) on delete set null;

create index if not exists videos_category_idx
  on public.videos (video_category_id);

do $mig$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'videos_have_a_type'
       and conrelid = 'public.videos'::regclass
  ) then
    alter table public.videos
      add constraint videos_have_a_type
      check (subtopic_id is not null or video_category_id is not null);
  end if;
end;
$mig$;

-- The step 5 update grant listed columns individually, so the new one has to
-- be added explicitly or admins cannot set it.
grant update (video_category_id) on table public.videos to authenticated;


-- ============================================================================
-- 5. Practice tests — content tables
--
-- Separate from `practice_sections` / `practice_attempts` by design (spec
-- section 0): those are untimed-per-module section drills and stay exactly as
-- they are. These have real module rules.
-- ============================================================================

create table if not exists public.practice_tests (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  difficulty   text not null check (difficulty in ('easy', 'medium', 'hard')),
  test_type    text not null check (test_type in ('full', 'half')),
  module_count integer not null generated always as
                 (case when test_type = 'full' then 2 else 1 end) stored,
  is_active    boolean not null default true,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now()
);

comment on table public.practice_tests is
  'Full (2 module) and half (1 module) practice tests. Timing is locked to '
  'the real digital SAT by sat_module_seconds(); there is no per-test limit.';

alter table public.practice_tests enable row level security;
alter table public.practice_tests force row level security;
revoke all on table public.practice_tests from anon, authenticated;
grant select on table public.practice_tests to authenticated;
grant insert on table public.practice_tests to authenticated;
-- `test_type` is deliberately NOT updatable. Flipping full -> half after
-- questions are linked would strand 22 module-2 rows in a test that no longer
-- has a module 2, and the scoring denominator would silently change under
-- attempts that are already recorded.
grant update (title, description, difficulty, is_active)
  on table public.practice_tests to authenticated;

drop policy if exists practice_tests_select on public.practice_tests;
create policy practice_tests_select
  on public.practice_tests for select to authenticated
  using (is_active or public.is_admin());

drop policy if exists practice_tests_insert_admin on public.practice_tests;
create policy practice_tests_insert_admin
  on public.practice_tests for insert to authenticated
  with check (public.is_admin());

drop policy if exists practice_tests_update_admin on public.practice_tests;
create policy practice_tests_update_admin
  on public.practice_tests for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.practice_test_questions (
  practice_test_id uuid not null references public.practice_tests (id) on delete cascade,
  question_id      uuid not null references public.questions (id) on delete cascade,
  module_number    smallint not null check (module_number in (1, 2)),
  order_index      smallint not null,
  primary key (practice_test_id, question_id),
  unique (practice_test_id, module_number, order_index)
);

create index if not exists practice_test_questions_question_idx
  on public.practice_test_questions (question_id);

alter table public.practice_test_questions enable row level security;
alter table public.practice_test_questions force row level security;
revoke all on table public.practice_test_questions from anon, authenticated;
grant select on table public.practice_test_questions to authenticated;

drop policy if exists practice_test_questions_select on public.practice_test_questions;
create policy practice_test_questions_select
  on public.practice_test_questions for select to authenticated
  using (
    exists (
      select 1 from public.practice_tests t
       where t.id = practice_test_id
         and (t.is_active or public.is_admin())
    )
  );

-- No client INSERT/DELETE grant: links are written only by
-- admin_import_practice_test() below, which runs as owner. `force row level
-- security` keeps even the owner under these policies, so the definer
-- function still writes nothing unless the caller is an admin.
drop policy if exists practice_test_questions_insert_admin on public.practice_test_questions;
create policy practice_test_questions_insert_admin
  on public.practice_test_questions for insert to authenticated
  with check (public.is_admin());

drop policy if exists practice_test_questions_delete_admin on public.practice_test_questions;
create policy practice_test_questions_delete_admin
  on public.practice_test_questions for delete to authenticated
  using (public.is_admin());


-- ============================================================================
-- 6. Practice tests — activity tables
--
-- Default-deny, exactly like question_attempts and practice_attempts: SELECT
-- your own rows, and no write grant of any kind. Section 7 holds the only
-- writers.
-- ============================================================================

create table if not exists public.practice_test_attempts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  practice_test_id    uuid not null references public.practice_tests (id) on delete cascade,
  status              text not null default 'in_progress'
                        check (status in ('in_progress', 'completed', 'abandoned_auto_submitted')),
  started_at          timestamptz not null default now(),
  module1_ends_at     timestamptz,
  -- Set when module 1 is submitted EARLY. Without it there is no way to tell
  -- "finished at 22 minutes" from "still working", and the interstitial would
  -- have to trust the client about which module is live.
  module1_submitted_at timestamptz,
  module2_started_at  timestamptz,
  module2_ends_at     timestamptz,
  ended_at            timestamptz,
  total_time_seconds  integer,
  correct_count       integer,
  wrong_count         integer
);

comment on table public.practice_test_attempts is
  'One sitting of a practice test. Every timestamp is written from the '
  'server clock and every count is recomputed from practice_test_responses '
  'against the real answer key — no client value is ever stored here.';

create index if not exists practice_test_attempts_user_recency_idx
  on public.practice_test_attempts (user_id, started_at desc);

create index if not exists practice_test_attempts_open_idx
  on public.practice_test_attempts (user_id)
  where status = 'in_progress';

alter table public.practice_test_attempts enable row level security;
alter table public.practice_test_attempts force row level security;
revoke all on table public.practice_test_attempts from anon, authenticated;
grant select on table public.practice_test_attempts to authenticated;

drop policy if exists practice_test_attempts_select_own on public.practice_test_attempts;
create policy practice_test_attempts_select_own
  on public.practice_test_attempts for select to authenticated
  using (auth.uid() = user_id);

create table if not exists public.practice_test_responses (
  id                       uuid primary key default gen_random_uuid(),
  practice_test_attempt_id uuid not null
                             references public.practice_test_attempts (id) on delete cascade,
  question_id              uuid not null references public.questions (id) on delete cascade,
  module_number            smallint not null check (module_number in (1, 2)),
  -- The student's answer as text so a future student-produced-response
  -- (grid-in) question needs no schema change. For today's four-choice
  -- questions this holds the 0-based choice index as a string: '0'..'3'.
  student_answer           text,
  is_correct               boolean,
  -- Left null this step by decision: the review screen shows total test time
  -- only. The column exists so per-question timing is an app change later,
  -- not a migration.
  time_spent_seconds       integer,
  answered_at              timestamptz,
  unique (practice_test_attempt_id, question_id)
);

create index if not exists practice_test_responses_attempt_idx
  on public.practice_test_responses (practice_test_attempt_id);

alter table public.practice_test_responses enable row level security;
alter table public.practice_test_responses force row level security;
revoke all on table public.practice_test_responses from anon, authenticated;
grant select on table public.practice_test_responses to authenticated;

drop policy if exists practice_test_responses_select_own on public.practice_test_responses;
create policy practice_test_responses_select_own
  on public.practice_test_responses for select to authenticated
  using (
    exists (
      select 1 from public.practice_test_attempts a
       where a.id = practice_test_attempt_id
         and a.user_id = auth.uid()
    )
  );


-- ============================================================================
-- 7. Practice test write paths (definer only)
-- ============================================================================

-- Internal scorer. NOT granted to any client role — the only callers are the
-- definer functions below, which run as the owner.
--
-- Everything here is recomputed: `correct_count` from the responses joined to
-- the real answer key, `wrong_count` as "every question in the test that is
-- not a recorded correct answer" so unanswered questions count wrong (spec
-- section 6), and the elapsed time from server timestamps only.
create or replace function public.finalize_practice_test_attempt_row(
  p_attempt_id uuid,
  p_status     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_total   integer;
  v_correct integer;
  v_end     timestamptz;
  v_row     record;
begin
  select a.started_at, a.module1_ends_at, a.module1_submitted_at,
         a.module2_ends_at, t.module_count
    into v_row
    from public.practice_test_attempts a
    join public.practice_tests t on t.id = a.practice_test_id
   where a.id = p_attempt_id;

  if not found then
    return;
  end if;

  select count(*)::integer into v_total
    from public.practice_test_questions q
   where q.practice_test_id = (
     select a.practice_test_id from public.practice_test_attempts a
      where a.id = p_attempt_id
   );

  select count(*)::integer into v_correct
    from public.practice_test_responses r
   where r.practice_test_attempt_id = p_attempt_id
     and r.is_correct;

  -- An attempt abandoned at 21:04 and finalized at 09:00 the next morning did
  -- not take thirteen hours. Cap the elapsed time at the last module deadline
  -- the attempt actually reached; a normal completion is always earlier than
  -- that, so least() picks now() for it.
  v_end := least(
    now(),
    coalesce(v_row.module2_ends_at, v_row.module1_submitted_at, v_row.module1_ends_at, now())
  );

  update public.practice_test_attempts a
     set status             = p_status,
         ended_at           = now(),
         total_time_seconds = greatest(0, ceil(extract(epoch from (v_end - v_row.started_at)))::integer),
         correct_count      = v_correct,
         wrong_count        = greatest(0, v_total - v_correct)
   where a.id = p_attempt_id
     and a.status = 'in_progress';
end;
$fn$;

revoke all on function public.finalize_practice_test_attempt_row(uuid, text)
  from public, anon, authenticated;

-- Auto-submit anything the caller abandoned.
--
-- This is the SOURCE OF TRUTH for abandonment (spec section 6), not the
-- browser's `beforeunload` or `sendBeacon`. It runs on page load, so a tab
-- killed instantly with no chance to execute JavaScript still scores
-- correctly the next time the student appears.
--
-- Three ways an attempt is stale, matching the three places a student can be:
--   * inside module 2, past its deadline
--   * inside module 1, past its deadline, on a test with no module 2 to go to
--   * parked on the module 2 interstitial for longer than the grace window
create or replace function public.finalize_stale_practice_test_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid;
  v_attempt   record;
  v_finalized integer := 0;
  v_grace     interval;
  v_pause     interval;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_grace := make_interval(secs => public.sat_submit_grace_seconds());
  v_pause := make_interval(secs => public.sat_interstitial_grace_seconds());

  for v_attempt in
    select a.id,
           a.module1_ends_at,
           a.module1_submitted_at,
           a.module2_started_at,
           a.module2_ends_at,
           t.module_count
      from public.practice_test_attempts a
      join public.practice_tests t on t.id = a.practice_test_id
     where a.user_id = v_uid
       and a.status = 'in_progress'
  loop
    if v_attempt.module2_started_at is not null then
      if now() > v_attempt.module2_ends_at + v_grace then
        perform public.finalize_practice_test_attempt_row(
          v_attempt.id, 'abandoned_auto_submitted');
        v_finalized := v_finalized + 1;
      end if;

    elsif v_attempt.module_count = 1 then
      if now() > v_attempt.module1_ends_at + v_grace then
        perform public.finalize_practice_test_attempt_row(
          v_attempt.id, 'abandoned_auto_submitted');
        v_finalized := v_finalized + 1;
      end if;

    else
      -- Full test, module 2 not started: they are on the interstitial. Module
      -- 1 is over either because they submitted it or because its clock ran
      -- out; the pause window starts from whichever happened.
      if now() > least(
           coalesce(v_attempt.module1_submitted_at, 'infinity'::timestamptz),
           v_attempt.module1_ends_at
         ) + v_pause then
        perform public.finalize_practice_test_attempt_row(
          v_attempt.id, 'abandoned_auto_submitted');
        v_finalized := v_finalized + 1;
      end if;
    end if;
  end loop;

  return v_finalized;
end;
$fn$;

revoke all on function public.finalize_stale_practice_test_attempts()
  from public, anon, authenticated;
grant execute on function public.finalize_stale_practice_test_attempts() to authenticated;

-- Open a test, or hand back the one already in progress.
--
-- Resuming rather than stacking a second attempt is what makes a refresh
-- mid-module harmless. Stale attempts are swept first, so "resume" can never
-- resurrect a test whose clock ran out yesterday.
create or replace function public.start_practice_test_attempt(p_test_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid;
  v_attempt uuid;
  v_active  boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select t.is_active into v_active
    from public.practice_tests t
   where t.id = p_test_id;

  if not found or not v_active then
    raise exception 'unknown_test';
  end if;

  perform public.finalize_stale_practice_test_attempts();

  select a.id into v_attempt
    from public.practice_test_attempts a
   where a.user_id = v_uid
     and a.practice_test_id = p_test_id
     and a.status = 'in_progress'
   order by a.started_at desc
   limit 1;

  if found then
    return v_attempt;
  end if;

  insert into public.practice_test_attempts
    (user_id, practice_test_id, module1_ends_at)
  values
    (v_uid, p_test_id, now() + make_interval(secs => public.sat_module_seconds()))
  returning id into v_attempt;

  return v_attempt;
end;
$fn$;

revoke all on function public.start_practice_test_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.start_practice_test_attempt(uuid) to authenticated;

-- Autosave one answer.
--
-- Called on every selection (spec section 6), which is what makes the
-- abandonment handling safe: nothing depends on an unload event completing,
-- because the answer was already durable when it was clicked.
--
-- `is_correct` is computed here against the answer key and stored. The client
-- sends a choice index and nothing else; it never learns whether it was right
-- until the attempt is finalized and the solutions view opens up.
create or replace function public.save_practice_test_response(
  p_attempt_id  uuid,
  p_question_id uuid,
  p_choice      integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid      uuid;
  v_attempt  record;
  v_module   smallint;
  v_deadline timestamptz;
  v_correct  smallint;
  v_qmodule  smallint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_choice is null or p_choice < 0 or p_choice > 3 then
    raise exception 'invalid_choice';
  end if;

  select a.id, a.practice_test_id, a.status, a.module1_ends_at,
         a.module1_submitted_at, a.module2_started_at, a.module2_ends_at
    into v_attempt
    from public.practice_test_attempts a
   where a.id = p_attempt_id
     and a.user_id = v_uid;

  if not found then
    raise exception 'unknown_attempt';
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'attempt_closed';
  end if;

  -- Which module is live is derived from the attempt's own timestamps, never
  -- from an argument. A client cannot answer module 2 questions during module
  -- 1 by claiming to be in module 2.
  if v_attempt.module2_started_at is not null then
    v_module   := 2;
    v_deadline := v_attempt.module2_ends_at;
  else
    if v_attempt.module1_submitted_at is not null then
      raise exception 'module_closed';
    end if;
    v_module   := 1;
    v_deadline := v_attempt.module1_ends_at;
  end if;

  if now() > v_deadline + make_interval(secs => public.sat_submit_grace_seconds()) then
    raise exception 'module_expired';
  end if;

  select q.module_number into v_qmodule
    from public.practice_test_questions q
   where q.practice_test_id = v_attempt.practice_test_id
     and q.question_id = p_question_id;

  if not found or v_qmodule <> v_module then
    raise exception 'question_not_in_module';
  end if;

  select q.correct_choice into v_correct
    from public.questions q
   where q.id = p_question_id;

  if not found then
    raise exception 'unknown_question';
  end if;

  insert into public.practice_test_responses
    (practice_test_attempt_id, question_id, module_number,
     student_answer, is_correct, answered_at)
  values
    (p_attempt_id, p_question_id, v_module,
     p_choice::text, p_choice::smallint = v_correct, now())
  on conflict (practice_test_attempt_id, question_id) do update
     set student_answer = excluded.student_answer,
         is_correct     = excluded.is_correct,
         answered_at    = excluded.answered_at;

  return true;
end;
$fn$;

revoke all on function public.save_practice_test_response(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.save_practice_test_response(uuid, uuid, integer)
  to authenticated;

-- End the live module.
--
-- Returns what happens next so the client does not have to guess:
--   'interstitial' — full test, module 1 done, module 2 waiting on Continue
--   'completed'    — the attempt is finished and scored
--
-- Serves both the early "Submit module" button and the timer hitting 0:00;
-- they are the same operation, and which one fired is not something the
-- server needs to trust the client about.
create or replace function public.submit_practice_test_module(p_attempt_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid;
  v_attempt record;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Row lock so a double submit serialises: the second waits, re-reads the
  -- committed row, and takes the already-closed branch instead of scoring
  -- twice.
  select a.id, a.status, a.module1_submitted_at, a.module2_started_at,
         t.module_count
    into v_attempt
    from public.practice_test_attempts a
    join public.practice_tests t on t.id = a.practice_test_id
   where a.id = p_attempt_id
     and a.user_id = v_uid
   for update of a;

  if not found then
    raise exception 'unknown_attempt';
  end if;

  if v_attempt.status <> 'in_progress' then
    return 'completed';
  end if;

  -- Module 1 of a full test hands off to the interstitial; everything else
  -- ends the attempt.
  if v_attempt.module_count = 2 and v_attempt.module2_started_at is null then
    if v_attempt.module1_submitted_at is null then
      update public.practice_test_attempts a
         set module1_submitted_at = now()
       where a.id = p_attempt_id;
    end if;
    return 'interstitial';
  end if;

  perform public.finalize_practice_test_attempt_row(p_attempt_id, 'completed');
  return 'completed';
end;
$fn$;

revoke all on function public.submit_practice_test_module(uuid)
  from public, anon, authenticated;
grant execute on function public.submit_practice_test_module(uuid) to authenticated;

-- Start module 2. The second clock does not begin until this is called, which
-- is the whole point of the interstitial (spec section 0, judgment call 2).
create or replace function public.start_practice_test_module_two(p_attempt_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid       uuid;
  v_attempt   record;
  v_module1_end timestamptz;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select a.id, a.status, a.module1_ends_at, a.module1_submitted_at,
         a.module2_started_at, t.module_count
    into v_attempt
    from public.practice_test_attempts a
    join public.practice_tests t on t.id = a.practice_test_id
   where a.id = p_attempt_id
     and a.user_id = v_uid
   for update of a;

  if not found then
    raise exception 'unknown_attempt';
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'attempt_closed';
  end if;

  if v_attempt.module_count <> 2 then
    raise exception 'no_second_module';
  end if;

  -- Already started: idempotent, so a double-clicked Continue does not reset
  -- the clock the student is already racing.
  if v_attempt.module2_started_at is not null then
    return true;
  end if;

  v_module1_end := least(
    coalesce(v_attempt.module1_submitted_at, 'infinity'::timestamptz),
    v_attempt.module1_ends_at
  );

  -- Module 1 must genuinely be over. Without this a client could skip module
  -- 1 entirely by calling this the moment the test opened.
  if now() < v_module1_end then
    raise exception 'module_one_still_open';
  end if;

  -- Parked too long: refuse, and let the stale sweep score it.
  --
  -- Deliberately NOT finalizing here first. `raise` aborts the transaction,
  -- so a finalize on this line would be rolled back by the very statement
  -- meant to report it — the write would appear to happen and then silently
  -- undo. The sweep runs on the caller's next page load (and on the beacon),
  -- and finalizes this attempt correctly there.
  if now() > v_module1_end + make_interval(secs => public.sat_interstitial_grace_seconds()) then
    raise exception 'interstitial_expired';
  end if;

  update public.practice_test_attempts a
     set module2_started_at = now(),
         module2_ends_at    = now() + make_interval(secs => public.sat_module_seconds())
   where a.id = p_attempt_id;

  return true;
end;
$fn$;

revoke all on function public.start_practice_test_module_two(uuid)
  from public, anon, authenticated;
grant execute on function public.start_practice_test_module_two(uuid) to authenticated;


-- ============================================================================
-- 8. Answer review for finished practice tests
--
-- `attempted_question_solutions` (step 4) is the one sanctioned way to see the
-- answer key. Rather than build a second view with a second set of rules,
-- this REPLACES it with the same view plus a third arm: questions belonging to
-- a practice test the caller has actually finished.
--
-- The first two arms are byte-identical to step 4. `create or replace view`
-- requires the column list to be unchanged, which it is.
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
       )
    or exists (
         select 1
           from public.practice_test_attempts pta
           join public.practice_test_questions ptq
             on ptq.practice_test_id = pta.practice_test_id
          where ptq.question_id = q.id
            and pta.user_id = auth.uid()
            and pta.status <> 'in_progress'
       );

revoke all on table public.attempted_question_solutions from anon, authenticated;
grant select on table public.attempted_question_solutions to authenticated;


-- ============================================================================
-- 9. Reporting: the dashboard heatmap
--
-- Security INVOKER (the default) on purpose, like domain_mastery() and
-- current_streak(): it runs with the caller's own permissions, so RLS on the
-- activity tables applies and the explicit auth.uid() filters are
-- belt-and-braces rather than the only barrier.
--
-- Unlike every other date calculation in this project, this one buckets by a
-- caller-supplied IANA timezone rather than UTC. The heatmap is the first
-- place a student reads a date AS a date, and a 9pm session in California
-- appearing on tomorrow's square is simply wrong to them. An unrecognised
-- timezone name falls back to UTC rather than erroring — a bad `Intl` string
-- from some browser must not take the dashboard down.
-- ============================================================================

create or replace function public.daily_activity(
  p_timezone text,
  p_days     integer
)
returns table (activity_date date, total integer, correct integer, wrong integer)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_tz   text;
  v_days integer;
begin
  v_tz := p_timezone;
  if v_tz is null
     or not exists (
       select 1 from pg_catalog.pg_timezone_names n where n.name = v_tz
     ) then
    v_tz := 'UTC';
  end if;

  v_days := least(greatest(coalesce(p_days, 84), 1), 366);

  return query
  with activity as (
    select (qa.attempted_at at time zone v_tz)::date as day,
           qa.is_correct
      from public.question_attempts qa
     where qa.user_id = auth.uid()
       and qa.attempted_at >= now() - make_interval(days => v_days + 1)
    union all
    select (r.answered_at at time zone v_tz)::date,
           r.is_correct
      from public.practice_test_responses r
      join public.practice_test_attempts a
        on a.id = r.practice_test_attempt_id
     where a.user_id = auth.uid()
       and r.answered_at is not null
       and r.answered_at >= now() - make_interval(days => v_days + 1)
  )
  select activity.day,
         count(*)::integer,
         (count(*) filter (where activity.is_correct))::integer,
         (count(*) filter (where not activity.is_correct))::integer
    from activity
   where activity.day > ((now() at time zone v_tz)::date - v_days)
   group by activity.day;
end;
$fn$;

comment on function public.daily_activity(text, integer) is
  'Per-day question counts for the dashboard heatmap, bucketed in the '
  'caller''s timezone. Combines question bank attempts and practice test '
  'responses; an unknown timezone name falls back to UTC.';

revoke all on function public.daily_activity(text, integer)
  from public, anon, authenticated;
grant execute on function public.daily_activity(text, integer) to authenticated;


-- ============================================================================
-- 10. Streak: practice tests now count
--
-- Step 4's current_streak() unions question_attempts and practice_attempts.
-- Without practice_test_attempts in that union, a student who sat a full
-- 70-minute practice test and did nothing else would watch their streak break
-- — which is the exact opposite of what a streak is for.
--
-- This is the only step 4 function this migration touches, and the change is
-- purely additive: one more arm on the union. Day arithmetic stays UTC, so
-- the streak card continues to agree with itself. (The heatmap above is
-- deliberately local-time; the two can disagree by one day for a late-night
-- session, which is the accepted trade in this step.)
-- ============================================================================

create or replace function public.current_streak()
returns integer
language sql
stable
set search_path = ''
as $fn$
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
        union all
        select (pta.started_at at time zone 'utc')::date
          from public.practice_test_attempts pta
         where pta.user_id = auth.uid()
      ) activity
  ),
  anchor as (
    select max(activity_day) as start_day
      from days
     where activity_day >= ((now() at time zone 'utc')::date - 1)
  ),
  runs as (
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
$fn$;

revoke all on function public.current_streak()
  from public, anon, authenticated;
grant execute on function public.current_streak() to authenticated;


-- ============================================================================
-- 11. Admin read views
--
-- Same construct and same caveat as `admin_questions` in step 5: definer-style
-- views that release rows only when is_admin() holds. A non-admin gets zero
-- rows, not an error. The Supabase advisor will flag these; that is expected.
-- ============================================================================

create or replace view public.admin_practice_tests
with (security_barrier = true)
as
select t.id,
       t.title,
       t.description,
       t.difficulty,
       t.test_type,
       t.module_count,
       t.is_active,
       t.created_at,
       (select count(*) from public.practice_test_questions q
         where q.practice_test_id = t.id and q.module_number = 1) as module1_count,
       (select count(*) from public.practice_test_questions q
         where q.practice_test_id = t.id and q.module_number = 2) as module2_count,
       (select count(*) from public.practice_test_attempts a
         where a.practice_test_id = t.id) as attempt_count
  from public.practice_tests t
 where public.is_admin();

revoke all on table public.admin_practice_tests from anon, authenticated;
grant select on table public.admin_practice_tests to authenticated;


-- ============================================================================
-- 12. admin_import_practice_test — the bulk upload, one transaction
--
-- Reuses step 5's identity model exactly: one `question_sets` row per test,
-- and `(question_set_id, external_id)` as the duplicate key. Re-uploading the
-- same file is therefore idempotent — the questions are found, not
-- duplicated, and only the link rows are rebuilt.
--
-- One deliberate difference from admin_import_question_set: that function
-- rejects bad ROWS and imports the rest, because a question set is just a
-- bag of questions. A practice test is not — a test with 21 questions in
-- module 1 is not a test. So this validates the ENTIRE payload first and
-- imports nothing at all if any row fails or any module count is wrong.
--
-- Returns on success: { "ok": true, "imported": n, "reused": n, "linked": n }
-- Returns on failure: { "ok": false, "errors": ["...", ...] }
-- ============================================================================

create or replace function public.admin_import_practice_test(
  p_test_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_test        record;
  v_expected    integer;
  v_create_subs boolean;
  v_elem        jsonb;
  v_errors      jsonb := '[]'::jsonb;
  v_external    text;
  v_domain_name text;
  v_sub_name    text;
  v_prompt      text;
  v_explanation text;
  v_difficulty  text;
  v_correct     text;
  v_module      integer;
  v_domain_id   uuid;
  v_subtopic_id uuid;
  v_set_id      uuid;
  v_set_name    text;
  v_question_id uuid;
  v_base_slug   text;
  v_slug        text;
  v_suffix      integer;
  v_seen        text[] := '{}';
  v_m1          integer := 0;
  v_m2          integer := 0;
  v_imported    integer := 0;
  v_reused      integer := 0;
  v_linked      integer := 0;
  v_order       integer;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  select t.id, t.title, t.test_type, t.module_count
    into v_test
    from public.practice_tests t
   where t.id = p_test_id;

  if not found then
    raise exception 'unknown_test';
  end if;

  v_expected := public.sat_module_question_count();

  -- --- File-level shape ----------------------------------------------------
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'questions') <> 'array'
     or jsonb_array_length(p_payload->'questions') < 1
     or jsonb_array_length(p_payload->'questions') > 200 then
    raise exception 'malformed_payload';
  end if;

  v_create_subs := jsonb_typeof(p_payload->'create_new_subtopics') = 'boolean'
                   and (p_payload->'create_new_subtopics')::text = 'true';

  -- --- Pass 1: validate everything, write nothing --------------------------
  -- Nothing below this point writes until the payload is known to be whole,
  -- so a rejected upload leaves the existing test exactly as it was.
  for v_elem in
    select elem from jsonb_array_elements(p_payload->'questions') as t(elem)
  loop
    v_external    := trim(coalesce(v_elem->>'external_id', ''));
    v_domain_name := trim(coalesce(v_elem->>'domain', ''));
    v_sub_name    := trim(coalesce(v_elem->>'subtopic', ''));
    v_prompt      := trim(coalesce(v_elem->>'prompt', ''));
    v_explanation := trim(coalesce(v_elem->>'explanation', ''));
    v_difficulty  := v_elem->>'difficulty';
    v_correct     := v_elem->>'correct_answer';

    if v_external = '' or length(v_external) > 64 then
      v_errors := v_errors || to_jsonb(
        'A question is missing external_id, or it is longer than 64 characters.');
      continue;
    end if;

    if v_external = any(v_seen) then
      v_errors := v_errors || to_jsonb(
        format('%s: external_id appears more than once in this file.', v_external));
      continue;
    end if;
    v_seen := v_seen || v_external;

    -- module_number is the one field a practice test upload adds on top of
    -- the step 5 question format.
    if jsonb_typeof(v_elem->'module_number') <> 'number' then
      v_errors := v_errors || to_jsonb(
        format('%s: module_number is required and must be 1 or 2.', v_external));
      continue;
    end if;

    v_module := (v_elem->>'module_number')::integer;

    if v_module not in (1, 2) then
      v_errors := v_errors || to_jsonb(
        format('%s: module_number must be 1 or 2, got %s.', v_external, v_module));
      continue;
    end if;

    if v_module = 2 and v_test.module_count = 1 then
      v_errors := v_errors || to_jsonb(
        format('%s: this is a half test, which has no module 2.', v_external));
      continue;
    end if;

    if v_prompt = '' or length(v_prompt) > 4000
       or v_explanation = '' or length(v_explanation) > 4000
       or v_domain_name = '' or length(v_domain_name) > 100
       or v_sub_name = '' or length(v_sub_name) > 120 then
      v_errors := v_errors || to_jsonb(
        format('%s: prompt, explanation, domain or subtopic is empty or too long.',
               v_external));
      continue;
    end if;

    if v_difficulty is null or v_difficulty not in ('easy', 'medium', 'hard') then
      v_errors := v_errors || to_jsonb(
        format('%s: difficulty must be easy, medium or hard.', v_external));
      continue;
    end if;

    if jsonb_typeof(v_elem->'choices') <> 'array'
       or jsonb_array_length(v_elem->'choices') <> 4
       or exists (
            select 1 from jsonb_array_elements(v_elem->'choices') c
             where jsonb_typeof(c) <> 'object'
                or coalesce(c->>'label', '') not in ('A', 'B', 'C', 'D')
                or trim(coalesce(c->>'text', '')) = ''
                or length(c->>'text') > 1000
          )
       or (select count(distinct c->>'label')
             from jsonb_array_elements(v_elem->'choices') c) <> 4 then
      v_errors := v_errors || to_jsonb(
        format('%s: choices must be exactly four, labelled A-D, each with text.',
               v_external));
      continue;
    end if;

    if v_correct is null or v_correct not in ('A', 'B', 'C', 'D') then
      v_errors := v_errors || to_jsonb(
        format('%s: correct_answer must be one of the choice labels A-D.',
               v_external));
      continue;
    end if;

    select d.id into v_domain_id
      from public.domains d
     where lower(d.name) = lower(v_domain_name) or d.slug = lower(v_domain_name)
     limit 1;

    if not found then
      v_errors := v_errors || to_jsonb(
        format('%s: unknown domain "%s".', v_external, v_domain_name));
      continue;
    end if;

    if not exists (
      select 1 from public.subtopics s
       where s.domain_id = v_domain_id
         and (lower(s.name) = lower(v_sub_name) or s.slug = lower(v_sub_name))
    ) and not v_create_subs then
      v_errors := v_errors || to_jsonb(
        format('%s: unknown subtopic "%s" for that domain '
               '(set create_new_subtopics to true to add it).',
               v_external, v_sub_name));
      continue;
    end if;

    if v_module = 1 then v_m1 := v_m1 + 1; else v_m2 := v_m2 + 1; end if;
  end loop;

  -- --- Module counts -------------------------------------------------------
  -- Reported as found-vs-expected so the admin can see what to fix, per spec
  -- section 5. Counted from VALID rows only, so a malformed row shows up both
  -- as its own error and in the shortfall.
  if v_m1 <> v_expected then
    v_errors := v_errors || to_jsonb(
      format('Module 1 must have exactly %s questions; found %s.', v_expected, v_m1));
  end if;

  if v_test.module_count = 2 and v_m2 <> v_expected then
    v_errors := v_errors || to_jsonb(
      format('Module 2 must have exactly %s questions; found %s.', v_expected, v_m2));
  end if;

  if v_test.module_count = 1 and v_m2 <> 0 then
    v_errors := v_errors || to_jsonb(
      format('This is a half test; module 2 must be empty, found %s questions.', v_m2));
  end if;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  -- --- Pass 2: import ------------------------------------------------------
  -- One question_set per test, named after it. Same namespace rule as step 5,
  -- so re-uploading finds the existing questions instead of duplicating them.
  v_set_name := left('Practice test — ' || v_test.title, 120);

  select qs.id into v_set_id
    from public.question_sets qs
   where qs.name = v_set_name;

  if not found then
    insert into public.question_sets (name, description)
    values (v_set_name,
            format('Questions for the "%s" practice test.', v_test.title))
    returning id into v_set_id;
  end if;

  -- Replace semantics: the upload defines the test's questions in full, so
  -- old links go before new ones arrive. The questions themselves are left
  -- alone — they may be shared with the bank and carry attempt history.
  delete from public.practice_test_questions q
   where q.practice_test_id = p_test_id;

  v_m1 := 0;
  v_m2 := 0;

  for v_elem in
    select elem from jsonb_array_elements(p_payload->'questions') as t(elem)
  loop
    v_external    := trim(v_elem->>'external_id');
    v_domain_name := trim(v_elem->>'domain');
    v_sub_name    := trim(v_elem->>'subtopic');
    v_prompt      := trim(v_elem->>'prompt');
    v_explanation := trim(v_elem->>'explanation');
    v_difficulty  := v_elem->>'difficulty';
    v_correct     := v_elem->>'correct_answer';
    v_module      := (v_elem->>'module_number')::integer;

    select d.id into v_domain_id
      from public.domains d
     where lower(d.name) = lower(v_domain_name) or d.slug = lower(v_domain_name)
     limit 1;

    select s.id into v_subtopic_id
      from public.subtopics s
     where s.domain_id = v_domain_id
       and (lower(s.name) = lower(v_sub_name) or s.slug = lower(v_sub_name))
     limit 1;

    if not found then
      -- create_new_subtopics was verified in pass 1, so reaching here means
      -- it is true. Slug rules match step 5's exactly.
      v_base_slug := left(
        trim(both '-' from regexp_replace(lower(v_sub_name), '[^a-z0-9]+', '-', 'g')),
        56);
      if v_base_slug = '' then
        v_base_slug := 'subtopic';
      end if;

      v_slug   := v_base_slug;
      v_suffix := 1;
      while exists (select 1 from public.subtopics s where s.slug = v_slug) loop
        v_suffix := v_suffix + 1;
        v_slug   := v_base_slug || '-' || v_suffix;
      end loop;

      insert into public.subtopics (id, domain_id, slug, name, position)
      values (
        gen_random_uuid(), v_domain_id, v_slug, v_sub_name,
        coalesce((select max(s.position) + 1 from public.subtopics s
                   where s.domain_id = v_domain_id), 1))
      returning id into v_subtopic_id;
    end if;

    -- Step 5's duplicate key, reused verbatim.
    select q.id into v_question_id
      from public.questions q
     where q.question_set_id = v_set_id
       and q.external_id = v_external;

    if found then
      v_reused := v_reused + 1;
    else
      insert into public.questions
        (subtopic_id, prompt, choices, correct_choice, explanation,
         difficulty, question_set_id, external_id)
      values (
        v_subtopic_id,
        v_prompt,
        (select jsonb_agg(trim(c->>'text') order by c->>'label')
           from jsonb_array_elements(v_elem->'choices') c),
        (position(v_correct in 'ABCD') - 1)::smallint,
        v_explanation,
        v_difficulty,
        v_set_id,
        v_external
      )
      returning id into v_question_id;

      v_imported := v_imported + 1;
    end if;

    if v_module = 1 then
      v_m1 := v_m1 + 1;
      v_order := v_m1;
    else
      v_m2 := v_m2 + 1;
      v_order := v_m2;
    end if;

    insert into public.practice_test_questions
      (practice_test_id, question_id, module_number, order_index)
    values (p_test_id, v_question_id, v_module::smallint, v_order::smallint);

    v_linked := v_linked + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'imported', v_imported,
    'reused', v_reused,
    'linked', v_linked
  );
end;
$fn$;

revoke all on function public.admin_import_practice_test(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_import_practice_test(uuid, jsonb)
  to authenticated;


-- ============================================================================
-- 13. Confirm the shape after running this file
--
--   -- No client role may write any activity table. All three must return
--   -- zero rows:
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_name in ('question_bank_sessions', 'practice_test_attempts',
--                         'practice_test_responses')
--      and grantee in ('anon', 'authenticated')
--      and privilege_type <> 'SELECT';
--
--   -- Every new table has RLS on AND forced:
--   select relname, relrowsecurity, relforcerowsecurity
--     from pg_class
--    where relname in ('question_bank_sessions', 'video_categories',
--                      'practice_tests', 'practice_test_questions',
--                      'practice_test_attempts', 'practice_test_responses');
--   -- expect t, t on every row
--
--   -- Every new table has at least one policy (none left default-open):
--   select tablename, count(*) from pg_policies
--    where schemaname = 'public'
--      and tablename in ('question_bank_sessions', 'video_categories',
--                        'practice_tests', 'practice_test_questions',
--                        'practice_test_attempts', 'practice_test_responses')
--    group by tablename;
--
--   -- The old two-argument grading function is gone, not shadowed:
--   select oid::regprocedure from pg_proc where proname = 'submit_question_attempt';
--   -- expect exactly one row, the (uuid, integer, uuid) signature
-- ============================================================================
