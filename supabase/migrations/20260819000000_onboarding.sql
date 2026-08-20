-- ============================================================================
-- Step 6 — onboarding.
--
-- Run this whole file once, top to bottom, in the Supabase Dashboard SQL
-- Editor (or via `supabase db push`). Idempotent; re-running it is safe.
--
-- The requirement, in one sentence: a student answers a short set of questions
-- once, and after they press the final button the flow is closed to them
-- forever.
--
-- "Forever" is not a routing rule. `src/proxy.ts` redirects and the page's own
-- server check are both conveniences that a mis-scoped matcher or a direct
-- PostgREST call walks straight past. So the lock lives here:
--
--   * `user_stats.onboarding_completed_at` is the single source of truth.
--   * `user_stats` has NO update grant for any client role — it did not have
--     one before this migration and it does not get one here.
--   * `complete_onboarding()` is the only writer, and its UPDATE carries
--     `and onboarding_completed_at is null`. A second call matches zero rows,
--     writes nothing, and returns false.
--
-- Everything above the database is then free to be wrong without the
-- guarantee failing.
-- ============================================================================


-- ============================================================================
-- 1. Columns on user_stats
--
-- The table was created in step 4 with current_score_estimate, target_score
-- and daily_goal already in place and a comment saying onboarding would fill
-- them in. This is that. The four columns below are the rest of the answers.
-- ============================================================================

-- The lock. Null = has not onboarded. Set exactly once, by the function below.
alter table public.user_stats
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.user_stats.onboarding_completed_at is
  'Null until onboarding is finished. Written only by complete_onboarding(), '
  'which refuses to run when it is already set. No client role can UPDATE '
  'this table at all — that is what makes onboarding genuinely one-shot.';

-- 0 = never sat the real SAT, 1 = once, 2 = twice or more. Capped well above
-- what the UI offers so a future "how many exactly?" question needs no
-- migration.
alter table public.user_stats
  add column if not exists sat_attempts smallint not null default 0
    check (sat_attempts between 0 and 10);

-- Their most recent real Math section score. Null when sat_attempts = 0; the
-- function enforces that pairing.
alter table public.user_stats
  add column if not exists last_sat_math_score smallint
    check (last_sat_math_score between 200 and 800);

-- Null = "not sure yet", which is a real answer and the default for most
-- students. A CHECK cannot call now() (it must be immutable), so these bounds
-- are only a sanity floor and ceiling — "must not be in the past" is enforced
-- in the Zod schema and again in the functions below.
alter table public.user_stats
  add column if not exists test_date date
    check (test_date >= date '2024-01-01' and test_date < date '2100-01-01');


-- ============================================================================
-- 2. user_focus_domains — the domains a student says they struggle with
--
-- A join table rather than a uuid[] column on user_stats: real foreign keys,
-- and it joins cleanly when this starts seeding practice recommendations.
-- ============================================================================

create table if not exists public.user_focus_domains (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  domain_id  uuid not null references public.domains (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, domain_id)
);

comment on table public.user_focus_domains is
  'Self-reported weak domains, captured during onboarding. Written only by '
  'complete_onboarding(); clients may SELECT their own rows and nothing else.';

-- RLS is enabled but deliberately NOT forced, unlike user_stats and
-- question_attempts.
--
-- FORCE applies RLS to the table OWNER as well as to client roles, and the
-- owner is exactly who complete_onboarding() runs as (SECURITY DEFINER).
-- Whether the insert below then survives depends on the definer role's
-- BYPASSRLS status, which varies with how this migration was applied — a
-- difference that would show up as focus domains silently vanishing while the
-- function still returned true. Since `authenticated` is already held to
-- SELECT by the grant below, and no client role has an INSERT/UPDATE/DELETE
-- grant at all, FORCE buys nothing here and risks breaking the only writer.
--
-- This is the same documented exception admin_users makes in
-- 20260818200000_step5_admin.sql, for the same SECURITY DEFINER reason.
alter table public.user_focus_domains enable row level security;
revoke all on table public.user_focus_domains from anon, authenticated;
grant select on table public.user_focus_domains to authenticated;

drop policy if exists user_focus_domains_select_own on public.user_focus_domains;
create policy user_focus_domains_select_own
  on public.user_focus_domains for select to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 3. complete_onboarding() — the one-shot write path
--
-- Security definer with an empty search_path, deriving the caller from
-- auth.uid() and never from an argument, exactly like the step 4 functions.
-- Every range is re-checked here even though CHECK constraints cover most of
-- them: this function is reachable over PostgREST by anything holding a valid
-- token, so it cannot assume the Zod schema in front of it ever ran.
--
-- Returns true when it wrote, false when the caller had already onboarded.
-- ============================================================================

create or replace function public.complete_onboarding(
  p_current_score integer,
  p_target_score  integer,
  p_sat_attempts  integer,
  p_last_sat_math integer,
  p_test_date     date,
  p_daily_goal    integer,
  p_focus_domains uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_updated integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- --- Independent re-validation -------------------------------------------
  -- Scores are on the SAT's 10-point grid; anything else is a forged payload,
  -- not a typo worth repairing.
  if p_current_score is null
     or p_current_score < 200 or p_current_score > 800
     or p_current_score % 10 <> 0 then
    raise exception 'invalid_current_score';
  end if;

  if p_target_score is null
     or p_target_score < 200 or p_target_score > 800
     or p_target_score % 10 <> 0 then
    raise exception 'invalid_target_score';
  end if;

  if p_sat_attempts is null or p_sat_attempts < 0 or p_sat_attempts > 10 then
    raise exception 'invalid_sat_attempts';
  end if;

  -- The pairing rule: a score for an exam they say they never sat is
  -- incoherent, and so is sitting the exam with no score to show for it.
  if p_sat_attempts = 0 and p_last_sat_math is not null then
    raise exception 'invalid_sat_history';
  end if;

  if p_sat_attempts > 0 then
    if p_last_sat_math is null
       or p_last_sat_math < 200 or p_last_sat_math > 800
       or p_last_sat_math % 10 <> 0 then
      raise exception 'invalid_sat_history';
    end if;
  end if;

  -- Null is a real answer here ("not sure yet"). A non-null date has to be one
  -- someone could actually sit.
  if p_test_date is not null
     and (p_test_date < current_date
          or p_test_date > current_date + interval '3 years') then
    raise exception 'invalid_test_date';
  end if;

  if p_daily_goal is null or p_daily_goal < 1 or p_daily_goal > 200 then
    raise exception 'invalid_daily_goal';
  end if;

  -- --- Ensure the row exists ------------------------------------------------
  -- The step 4 trigger creates this row the moment a profile does, so this is
  -- normally a no-op. It is here so that `row_count = 0` below can only ever
  -- mean "already onboarded" — without it, a missing row produces the same
  -- zero and the caller cannot tell the two apart.
  --
  -- The FK to profiles still makes this fail loudly for an account whose email
  -- is unconfirmed, which is the correct outcome: no profile, not yet a user.
  insert into public.user_stats (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  -- --- The lock -------------------------------------------------------------
  -- `and onboarding_completed_at is null` is the whole guarantee. Everything
  -- in the application above this line is a convenience.
  update public.user_stats
     set current_score_estimate  = p_current_score::smallint,
         target_score            = p_target_score::smallint,
         sat_attempts            = p_sat_attempts::smallint,
         last_sat_math_score     = p_last_sat_math::smallint,
         test_date               = p_test_date,
         daily_goal              = p_daily_goal::smallint,
         onboarding_completed_at = now()
   where user_id = v_uid
     and onboarding_completed_at is null;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  -- Selecting *from* domains is what validates the ids: a forged or stale uuid
  -- simply matches no row and is dropped, with no error and no way to probe
  -- which ids exist.
  insert into public.user_focus_domains (user_id, domain_id)
  select v_uid, d.id
    from public.domains d
   where d.id = any(p_focus_domains)
  on conflict do nothing;

  return true;
end;
$$;

comment on function public.complete_onboarding(integer, integer, integer, integer, date, integer, uuid[]) is
  'One-shot. Writes the onboarding answers and stamps onboarding_completed_at, '
  'but only while that column is still null. Returns false on a second call.';

revoke all on function public.complete_onboarding(integer, integer, integer, integer, date, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.complete_onboarding(integer, integer, integer, integer, date, integer, uuid[])
  to authenticated;


-- ============================================================================
-- 4. update_study_plan() — the "editable in Settings" path
--
-- Onboarding is closed forever; the numbers it captured are not. A student who
-- improves must be able to raise their target, and a test date moves.
--
-- What this function deliberately cannot touch: onboarding_completed_at (so it
-- can never reopen the flow), current_score_estimate, sat_attempts and
-- last_sat_math_score (the baseline that progress is measured against — a
-- baseline you can edit measures nothing).
--
-- The range checks below are written out in full rather than shared with
-- complete_onboarding(). Both functions are independently reachable over
-- PostgREST, so each one validates independently; a shared helper is one
-- forgotten call away from an unguarded write path.
-- ============================================================================

create or replace function public.update_study_plan(
  p_target_score integer,
  p_daily_goal   integer,
  p_test_date    date
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid;
  v_updated integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_target_score is null
     or p_target_score < 200 or p_target_score > 800
     or p_target_score % 10 <> 0 then
    raise exception 'invalid_target_score';
  end if;

  if p_daily_goal is null or p_daily_goal < 1 or p_daily_goal > 200 then
    raise exception 'invalid_daily_goal';
  end if;

  -- Null clears the date back to "not sure yet", which Settings offers.
  if p_test_date is not null
     and (p_test_date < current_date
          or p_test_date > current_date + interval '3 years') then
    raise exception 'invalid_test_date';
  end if;

  -- `onboarding_completed_at is not null` is the mirror image of the lock in
  -- complete_onboarding(): that one runs only before, this one only after.
  -- Between them there is no statement that can move the column back to null.
  update public.user_stats
     set target_score = p_target_score::smallint,
         daily_goal   = p_daily_goal::smallint,
         test_date    = p_test_date
   where user_id = v_uid
     and onboarding_completed_at is not null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.update_study_plan(integer, integer, date) is
  'Edits the three study-plan fields Settings exposes. Refuses to run before '
  'onboarding is complete, and cannot write onboarding_completed_at.';

revoke all on function public.update_study_plan(integer, integer, date)
  from public, anon, authenticated;
grant execute on function public.update_study_plan(integer, integer, date)
  to authenticated;


-- ============================================================================
-- 5. session_flags() — the routing question, answered in one round trip
--
-- `src/proxy.ts` runs on nearly every request and already pays for getUser()
-- plus an is_admin() RPC. Rather than adding a third call, this returns both
-- answers at once and the proxy calls it in place of is_admin().
--
-- `needs_onboarding` is the COMPLETE answer, admin exemption folded in, so the
-- rule lives in exactly one place and the TypeScript side cannot drift from
-- it. `is_admin` is returned alongside because the proxy still needs it for
-- the /admin branch.
--
-- is_admin() itself is left untouched — the layouts and admin actions use it.
-- ============================================================================

create or replace function public.session_flags()
returns table (is_admin boolean, needs_onboarding boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.admin_users a where a.user_id = auth.uid()
    ) as is_admin,
    (
      -- Admins are exempt: being trapped in the student wizard while trying to
      -- check the student app is a worse failure than skipping it.
      not exists (
        select 1 from public.admin_users a where a.user_id = auth.uid()
      )
      -- Load-bearing. An account whose email is unconfirmed has no profile row
      -- and is not a DecodedSAT user yet. Gating it would bounce it between
      -- /dashboard and /onboarding forever, since the wizard cannot complete
      -- without the profile the FK requires.
      and exists (
        select 1 from public.profiles p where p.id = auth.uid()
      )
      and not exists (
        select 1 from public.user_stats s
         where s.user_id = auth.uid()
           and s.onboarding_completed_at is not null
      )
    ) as needs_onboarding;
$$;

comment on function public.session_flags() is
  'Routing flags for the proxy, in one round trip. needs_onboarding already '
  'accounts for the admin exemption and for unconfirmed accounts.';

revoke all on function public.session_flags() from public, anon, authenticated;
grant execute on function public.session_flags() to authenticated;


-- ============================================================================
-- 6. Confirm the shape after running this file
--
--   -- user_stats must still have NO update grant for any client role.
--   -- This must return zero rows:
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_name = 'user_stats'
--      and grantee in ('anon', 'authenticated')
--      and privilege_type <> 'SELECT';
--
--   -- user_focus_domains must have RLS on, FORCE off, exactly one policy:
--   select relrowsecurity, relforcerowsecurity
--     from pg_class where relname = 'user_focus_domains';   -- expect t, f
--   select polname from pg_policies
--    where schemaname = 'public' and tablename = 'user_focus_domains';
-- ============================================================================
