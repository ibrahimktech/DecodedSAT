-- ============================================================================
-- Private in-app notifications and admin-authored, eligibility-aware popups.
--
-- Notifications are readable and markable only by their owner. Report
-- resolution notifications are inserted by a database trigger, so the report
-- status change and its notification are one atomic transaction.
--
-- Popup eligibility is evaluated by get_eligible_popup(), which derives the
-- user from auth.uid() and records the impression before returning the popup.
-- This makes show-once reliable across refreshes and concurrent requests.
-- ============================================================================


-- --- Notifications ----------------------------------------------------------

create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (kind in ('question_report_resolved')),
  message          text not null,
  link_url         text,
  source_report_id uuid references public.question_reports (id) on delete cascade,
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  constraint notifications_message_shape check (
    message = btrim(message) and char_length(message) between 1 and 500
  ),
  constraint notifications_link_shape check (
    link_url is null or (
      link_url = btrim(link_url)
      and char_length(link_url) between 1 and 1000
      and left(link_url, 1) = '/'
      and left(link_url, 2) <> '//'
    )
  ),
  unique (source_report_id)
);

comment on table public.notifications is
  'Private in-app notifications. Users may read their own rows and set read_at only.';

create index if not exists notifications_user_recency_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
revoke all on table public.notifications from anon, authenticated;

-- user_id and source_report_id remain inaccessible through the client API.
grant select (id, kind, message, link_url, read_at, created_at)
  on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
  on public.notifications for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
  on public.notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The only permitted state transition is unread -> read. Column grants already
-- prevent every other field from changing; this trigger also prevents a raw
-- API caller from turning an item unread again.
create or replace function public.enforce_notification_read_once()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.read_at is null or old.read_at is not null then
    raise exception 'invalid_notification_read_transition';
  end if;
  return new;
end;
$fn$;

revoke all on function public.enforce_notification_read_once()
  from public, anon, authenticated;

drop trigger if exists notification_read_once on public.notifications;
create trigger notification_read_once
  before update of read_at on public.notifications
  for each row
  execute function public.enforce_notification_read_once();

-- There is deliberately no client INSERT or DELETE grant/policy. The trigger
-- is the only notification writer in this feature.

create or replace function public.notify_resolved_question_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    insert into public.notifications (
      user_id,
      kind,
      message,
      source_report_id
    )
    values (
      new.user_id,
      'question_report_resolved',
      'Your reported question has been resolved.',
      new.id
    )
    -- Reopening and resolving the same report again does not create noise.
    on conflict (source_report_id) do nothing;
  end if;

  return new;
end;
$fn$;

revoke all on function public.notify_resolved_question_report()
  from public, anon, authenticated;

drop trigger if exists question_report_resolved_notification
  on public.question_reports;
create trigger question_report_resolved_notification
  after update of status on public.question_reports
  for each row
  execute function public.notify_resolved_question_report();


-- --- Admin-authored popups --------------------------------------------------

create table if not exists public.popups (
  id                     uuid primary key default gen_random_uuid(),
  title                  text not null,
  message                text not null,
  button_text            text,
  button_url             text,
  is_active              boolean not null default true,
  starts_at              timestamptz not null default now(),
  ends_at                timestamptz,
  show_once              boolean not null default true,
  min_answered_questions integer,
  min_account_age_days   integer,
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint popups_title_shape check (
    title = btrim(title) and char_length(title) between 1 and 120
  ),
  constraint popups_message_shape check (
    message = btrim(message) and char_length(message) between 1 and 2000
  ),
  constraint popups_button_pair check (
    (button_text is null) = (button_url is null)
  ),
  constraint popups_button_text_shape check (
    button_text is null or (
      button_text = btrim(button_text)
      and char_length(button_text) between 1 and 60
    )
  ),
  constraint popups_button_url_shape check (
    button_url is null or (
      button_url = btrim(button_url)
      and char_length(button_url) between 1 and 1000
      and (
        (left(button_url, 1) = '/' and left(button_url, 2) <> '//')
        or button_url ~* '^https?://'
      )
    )
  ),
  constraint popups_date_order check (
    ends_at is null or ends_at > starts_at
  ),
  constraint popups_min_answers check (
    min_answered_questions is null or min_answered_questions between 1 and 1000000
  ),
  constraint popups_min_account_age check (
    min_account_age_days is null or min_account_age_days between 1 and 36500
  )
);

comment on table public.popups is
  'Admin-authored in-app popups with optional activity and account-age eligibility.';

create index if not exists popups_delivery_idx
  on public.popups (is_active, starts_at, ends_at);

alter table public.popups enable row level security;
alter table public.popups force row level security;
revoke all on table public.popups from anon, authenticated;
grant select, insert, update on table public.popups to authenticated;

drop policy if exists popups_select_admin on public.popups;
create policy popups_select_admin
  on public.popups for select to authenticated
  using (public.is_admin());

drop policy if exists popups_insert_admin on public.popups;
create policy popups_insert_admin
  on public.popups for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid());

drop policy if exists popups_update_admin on public.popups;
create policy popups_update_admin
  on public.popups for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No DELETE policy: popups are deactivated so impression history remains.


-- --- Per-user popup delivery state -----------------------------------------

create table if not exists public.popup_user_states (
  popup_id      uuid not null references public.popups (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  dismissed_at  timestamptz,
  primary key (popup_id, user_id)
);

comment on table public.popup_user_states is
  'Private popup impression/dismissal state. Written only by popup delivery RPCs.';

create index if not exists popup_user_states_user_idx
  on public.popup_user_states (user_id, last_seen_at desc);

alter table public.popup_user_states enable row level security;
alter table public.popup_user_states force row level security;
revoke all on table public.popup_user_states from anon, authenticated;

-- No direct client grants or policies. Both operations below derive user_id
-- from auth.uid(), and the app never accepts a user id for popup state.


-- --- Eligible popup delivery -----------------------------------------------

create or replace function public.get_eligible_popup()
returns table (
  id          uuid,
  title       text,
  message     text,
  button_text text,
  button_url  text,
  show_once   boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user_id        uuid := auth.uid();
  v_answered_count bigint;
  v_popup          public.popups%rowtype;
  v_claimed        integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Section-practice answers also live in question_attempts. Practice-test
  -- responses are separate and count only when an answer was actually given.
  select
    (select count(*)
       from public.question_attempts qa
      where qa.user_id = v_user_id)
    +
    (select count(*)
       from public.practice_test_responses ptr
       join public.practice_test_attempts pta
         on pta.id = ptr.practice_test_attempt_id
      where pta.user_id = v_user_id
        and ptr.answered_at is not null)
    into v_answered_count;

  select p.*
    into v_popup
    from public.popups p
    join public.profiles profile on profile.id = v_user_id
   where p.is_active
     and p.starts_at <= now()
     and (p.ends_at is null or p.ends_at > now())
     and (
       p.min_answered_questions is null
       or v_answered_count >= p.min_answered_questions
     )
     and (
       p.min_account_age_days is null
       or profile.created_at <= now() - make_interval(days => p.min_account_age_days)
     )
     and (
       not p.show_once
       or not exists (
         select 1
           from public.popup_user_states state
          where state.popup_id = p.id
            and state.user_id = v_user_id
       )
     )
   order by p.created_at desc, p.id
   limit 1;

  if not found then
    return;
  end if;

  if v_popup.show_once then
    insert into public.popup_user_states (popup_id, user_id)
    values (v_popup.id, v_user_id)
    on conflict (popup_id, user_id) do nothing;

    get diagnostics v_claimed = row_count;
    -- Another concurrent request claimed it first. Returning nothing keeps a
    -- one-time popup from being displayed twice.
    if v_claimed = 0 then
      return;
    end if;
  else
    insert into public.popup_user_states (popup_id, user_id)
    values (v_popup.id, v_user_id)
    on conflict (popup_id, user_id) do update
       set last_seen_at = now(),
           dismissed_at = null;
  end if;

  return query
    select v_popup.id,
           v_popup.title,
           v_popup.message,
           v_popup.button_text,
           v_popup.button_url,
           v_popup.show_once;
end;
$fn$;

revoke all on function public.get_eligible_popup()
  from public, anon, authenticated;
grant execute on function public.get_eligible_popup() to authenticated;

create or replace function public.dismiss_popup(p_popup_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_changed integer;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  update public.popup_user_states state
     set dismissed_at = coalesce(state.dismissed_at, now())
   where state.popup_id = p_popup_id
     and state.user_id = v_user_id;

  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$fn$;

revoke all on function public.dismiss_popup(uuid)
  from public, anon, authenticated;
grant execute on function public.dismiss_popup(uuid) to authenticated;
