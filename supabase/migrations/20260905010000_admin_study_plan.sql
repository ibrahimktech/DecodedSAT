-- Admins are exempt from onboarding so they can enter the student app without
-- completing the one-shot wizard. That exemption left their
-- onboarding_completed_at value null, while update_study_plan() only matched
-- completed rows. The Settings form therefore validated successfully but the
-- function returned false for every admin update.
--
-- Keep the onboarding lock for ordinary students, but let an authenticated
-- admin maintain the three Settings fields without pretending they completed
-- onboarding or inventing baseline answers for them.

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

  if p_test_date is not null
     and (p_test_date < current_date
          or p_test_date > current_date + interval '3 years') then
    raise exception 'invalid_test_date';
  end if;

  update public.user_stats
     set target_score = p_target_score::smallint,
         daily_goal   = p_daily_goal::smallint,
         test_date    = p_test_date
   where user_id = v_uid
     and (
       onboarding_completed_at is not null
       or exists (
         select 1
           from public.admin_users a
          where a.user_id = v_uid
       )
     );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on function public.update_study_plan(integer, integer, date) is
  'Edits the three study-plan fields Settings exposes. Available after '
  'onboarding or to onboarding-exempt admins; cannot mark onboarding complete.';

-- CREATE OR REPLACE preserves privileges on the existing function, but state
-- them again so a fresh or manually repaired environment has the same narrow
-- executable surface.
revoke all on function public.update_study_plan(integer, integer, date)
  from public, anon, authenticated;
grant execute on function public.update_study_plan(integer, integer, date)
  to authenticated;
