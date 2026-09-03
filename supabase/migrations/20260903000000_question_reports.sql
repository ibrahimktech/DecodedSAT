-- ============================================================================
-- Question reports: student submission, immutable question snapshots, and the
-- admin review queue.
--
-- The application uses the caller's authenticated Supabase session throughout.
-- There is no service-role client. Students can only submit through the
-- `submit_question_report` function, which derives `user_id` from auth.uid()
-- and builds the answer-key snapshot from `questions` inside the database.
-- Admin reads and status changes are independently gated by `is_admin()`.
-- ============================================================================

create table if not exists public.question_reports (
  id                uuid primary key default gen_random_uuid(),
  question_id       uuid not null references public.questions (id),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  reason            text not null
                      check (reason in ('incorrect', 'unclear_or_broken')),
  details           text,
  status            text not null default 'open'
                      check (status in ('open', 'reviewed', 'resolved', 'dismissed')),
  question_snapshot jsonb not null,
  -- One request id is minted when the dialog opens. Replaying the same Server
  -- Action (a double click or network retry) therefore remains one report.
  client_request_id uuid not null,
  admin_note        text,
  reviewed_at       timestamptz,
  reviewed_by       uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint question_reports_details_shape check (
    details is null or (
      details = btrim(details)
      and char_length(details) between 1 and 1000
    )
  ),
  constraint question_reports_admin_note_shape check (
    admin_note is null or (
      admin_note = btrim(admin_note)
      and char_length(admin_note) between 1 and 2000
    )
  ),
  constraint question_reports_snapshot_shape check (
    jsonb_typeof(question_snapshot) = 'object'
    and question_snapshot ? 'prompt'
    and question_snapshot ? 'choices'
    and question_snapshot ? 'correct_choice'
  ),
  unique (user_id, client_request_id)
);

comment on table public.question_reports is
  'Student reports about question content. Reports are immutable to students; '
  'admins review them without deleting audit history.';

comment on column public.question_reports.question_snapshot is
  'Database-authored prompt, choices, and correct-choice snapshot at submission time.';

create index if not exists question_reports_question_id_idx
  on public.question_reports (question_id);

create index if not exists question_reports_status_created_idx
  on public.question_reports (status, created_at desc);


-- --- RLS and grants ----------------------------------------------------------

alter table public.question_reports enable row level security;
alter table public.question_reports force row level security;

revoke all on table public.question_reports from anon, authenticated;

-- The insert grant intentionally remains absent. The definer function below is
-- the only student write path, while this policy ensures even the table owner
-- under FORCE RLS can insert only a row for the authenticated caller.
drop policy if exists question_reports_insert_own on public.question_reports;
create policy question_reports_insert_own
  on public.question_reports for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists question_reports_select_admin on public.question_reports;
drop policy if exists question_reports_select_own_or_admin on public.question_reports;
create policy question_reports_select_own_or_admin
  on public.question_reports for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

-- There is still no table SELECT grant for authenticated users. The own-row
-- half makes the policy ready for a future student history UI and lets the
-- submission function perform its duplicate check; access remains closed until
-- a deliberately column-scoped grant is added in a future migration.

drop policy if exists question_reports_update_admin on public.question_reports;
create policy question_reports_update_admin
  on public.question_reports for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No DELETE policy, deliberately. Resolution and dismissal preserve history.


-- --- Student submission -----------------------------------------------------

create or replace function public.submit_question_report(
  p_request_id  uuid,
  p_question_id uuid,
  p_reason      text,
  p_details     text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id  uuid := auth.uid();
  v_details  text := nullif(btrim(coalesce(p_details, '')), '');
  v_snapshot jsonb;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_request_id is null or p_question_id is null then
    raise exception 'invalid_report';
  end if;

  if p_reason not in ('incorrect', 'unclear_or_broken') then
    raise exception 'invalid_reason';
  end if;

  if v_details is not null and char_length(v_details) > 1000 then
    raise exception 'details_too_long';
  end if;

  -- This is the authoritative existence check and snapshot source. The client
  -- submits only an id and never supplies a prompt, choices, or answer key.
  select jsonb_build_object(
           'prompt', q.prompt,
           'choices', q.choices,
           'correct_choice', q.correct_choice
         )
    into v_snapshot
    from public.questions q
   where q.id = p_question_id;

  if not found then
    raise exception 'question_not_found';
  end if;

  -- Serialize reports for this user/question pair, then treat another report
  -- in the last five minutes as the same accidental submission. This catches
  -- separate request ids too; the unique request id below catches exact
  -- network retries forever.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_question_id::text, 0)
  );

  if exists (
    select 1
      from public.question_reports recent
     where recent.user_id = v_user_id
       and recent.question_id = p_question_id
       and recent.created_at >= now() - interval '5 minutes'
  ) then
    return true;
  end if;

  insert into public.question_reports (
    question_id,
    user_id,
    reason,
    details,
    question_snapshot,
    client_request_id
  )
  values (
    p_question_id,
    v_user_id,
    p_reason,
    v_details,
    v_snapshot,
    p_request_id
  )
  on conflict (user_id, client_request_id) do nothing;

  return true;
end;
$fn$;

revoke all on function public.submit_question_report(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_question_report(uuid, uuid, text, text)
  to authenticated;


-- --- Admin status updates ---------------------------------------------------

create or replace function public.admin_update_question_report(
  p_report_id  uuid,
  p_status     text,
  p_admin_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_admin_note text := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_changed    integer;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  if p_status not in ('open', 'reviewed', 'resolved', 'dismissed') then
    raise exception 'invalid_status';
  end if;

  if v_admin_note is not null and char_length(v_admin_note) > 2000 then
    raise exception 'admin_note_too_long';
  end if;

  update public.question_reports
     set status = p_status,
         admin_note = v_admin_note,
         reviewed_at = case when p_status = 'open' then null else now() end,
         reviewed_by = case when p_status = 'open' then null else auth.uid() end,
         updated_at = now()
   where id = p_report_id;

  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$fn$;

revoke all on function public.admin_update_question_report(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_question_report(uuid, text, text)
  to authenticated;


create or replace function public.admin_question_report_counts()
returns table (open_reports bigint, unique_open_questions bigint)
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
    select count(*) filter (where r.status = 'open'),
           count(distinct r.question_id) filter (where r.status = 'open')
      from public.question_reports r;
end;
$fn$;

revoke all on function public.admin_question_report_counts()
  from public, anon, authenticated;
grant execute on function public.admin_question_report_counts()
  to authenticated;


-- --- Admin read model -------------------------------------------------------
--
-- Mirrors `admin_questions`: a definer-style view exposes answer-key and
-- reporter data only while the caller passes the database's admin check.

create or replace view public.admin_question_reports
with (security_barrier = true)
as
select r.id,
       r.question_id,
       r.user_id,
       r.reason,
       r.details,
       r.status,
       r.question_snapshot,
       r.admin_note,
       r.reviewed_at,
       r.reviewed_by,
       r.created_at,
       r.updated_at,
       reporter.full_name as reporter_name,
       reporter.email as reporter_email,
       reviewer.full_name as reviewer_name,
       q.prompt as current_prompt,
       q.choices as current_choices,
       q.correct_choice as current_correct_choice,
       q.explanation as current_explanation,
       q.difficulty as current_difficulty,
       q.is_active as current_is_active,
       q.external_id,
       s.id as subtopic_id,
       s.name as subtopic_name,
       d.id as domain_id,
       d.name as domain_name,
       qs.name as set_name,
       (select count(*)
          from public.question_reports same_question
         where same_question.question_id = r.question_id) as question_report_count,
       (select count(*)
          from public.question_reports same_question
         where same_question.question_id = r.question_id
           and same_question.status = 'open') as open_question_report_count,
       case r.status
         when 'open' then 0
         when 'reviewed' then 1
         when 'resolved' then 2
         else 3
       end as status_sort
  from public.question_reports r
  join public.profiles reporter on reporter.id = r.user_id
  join public.questions q on q.id = r.question_id
  join public.subtopics s on s.id = q.subtopic_id
  join public.domains d on d.id = s.domain_id
  left join public.question_sets qs on qs.id = q.question_set_id
  left join public.profiles reviewer on reviewer.id = r.reviewed_by
 where public.is_admin();

revoke all on table public.admin_question_reports from anon, authenticated;
grant select on table public.admin_question_reports to authenticated;
