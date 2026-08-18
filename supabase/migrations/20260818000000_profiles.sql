-- ============================================================================
-- public.profiles — the application's user table
--
-- Run this whole file once, top to bottom, in the Supabase Dashboard SQL
-- Editor (or via `supabase db push` once the CLI is set up). It is written to
-- be idempotent, so re-running it is safe.
--
-- The idea it encodes: a Supabase auth user is not yet a DecodedSAT user. A row
-- in `auth.users` appears the moment someone submits the signup form, verified
-- or not. A row in `public.profiles` appears only once their email is actually
-- confirmed, and every other table added later will reference `profiles`, not
-- `auth.users`. So an unverified signup can hold an auth row forever and still
-- reach nothing: RLS has no profile to match it against.
--
-- Application code never inserts here. The trigger below is the only writer,
-- which is what makes "confirmed" the single condition for existing.
-- ============================================================================


-- --- Table -------------------------------------------------------------------

create table if not exists public.profiles (
  -- Same id as the auth user. `on delete cascade` means deleting someone from
  -- the Supabase auth dashboard cleans up here too, rather than orphaning a row.
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  email      text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Confirmed DecodedSAT users. Written only by handle_confirmed_user(); never by application code.';


-- --- Row Level Security ------------------------------------------------------
-- Enabled in the same migration that creates the table, never retrofitted.
-- With RLS on and no policy, the default is deny; the policies below are the
-- complete list of what is permitted.

alter table public.profiles enable row level security;

-- `force` makes the table owner obey RLS too. Without it, a query running as
-- the table owner silently bypasses every policy below.
alter table public.profiles force row level security;

-- Grants are the coarse gate, policies the fine one; both have to allow a
-- statement. Revoking first means a default grant from a Supabase template
-- cannot leave something open that the policies never intended.
revoke all on table public.profiles from anon, authenticated;

grant select on table public.profiles to authenticated;

-- Column-scoped: a person may rename themselves, but cannot rewrite `id`
-- (which would reassign the row) or `email` (which would desynchronise this
-- table from `auth.users`, where email changes belong).
grant update (full_name) on table public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  -- `using` picks which rows may be updated; `with check` validates the result.
  -- Both are required — without the second, someone could pass the first and
  -- then set `id` to another user's, handing the row away.
  with check (auth.uid() = id);

-- No insert or delete policy, on purpose. Inserts belong to the trigger, and
-- account deletion belongs to `auth.users` via the cascade above.


-- --- Trigger function --------------------------------------------------------

create or replace function public.handle_confirmed_user()
returns trigger
language plpgsql
-- `security definer` so it can write to a table that `authenticated` has no
-- insert grant on. This is the only thing in the system that may insert here.
security definer
-- Empty search_path so a schema planted earlier in a caller's path cannot
-- shadow `profiles` and capture the insert. Every name below is therefore
-- schema-qualified. (`pg_catalog` is always searched first regardless, so
-- `coalesce`, `nullif`, `trim` and `now` still resolve.)
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, created_at)
  values (
    new.id,
    -- Signup writes `full_name` into user metadata. `name` is the fallback
    -- other providers use, kept so this keeps working if a social login is
    -- ever added. `nullif(trim(...), '')` stores NULL rather than an empty
    -- string when nothing usable arrives.
    nullif(
      trim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      ''
    ),
    new.email,
    now()
  )
  -- Both triggers below can fire for one account in edge cases. First write
  -- wins; the second is a no-op.
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_confirmed_user() is
  'Creates the public.profiles row once an auth user has a confirmed email.';

-- A security definer function must not be callable directly by clients — it
-- writes to a table they have no insert grant on. Triggers run as the table
-- owner and are unaffected by this revoke.
revoke all on function public.handle_confirmed_user() from public, anon, authenticated;


-- --- Triggers ----------------------------------------------------------------
-- Two of them, because there are two ways an account becomes confirmed and a
-- single UPDATE trigger would only ever catch one.

-- 1. Accounts that are born confirmed: anyone added through the Supabase
--    dashboard's "Add user" with auto-confirm on, the admin API, or a social
--    provider if one is added later. Supabase INSERTs those rows with
--    `email_confirmed_at` already populated and no UPDATE ever follows, so an
--    update-only trigger would never fire for them and they would have no
--    profile row — locked out by RLS from the moment they signed in. Worth
--    knowing while testing: a user you create by hand in the dashboard takes
--    this path, not the one below.
drop trigger if exists on_auth_user_created_confirmed on auth.users;
create trigger on_auth_user_created_confirmed
  after insert on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function public.handle_confirmed_user();

-- 2. Email + password: the row is INSERTed unconfirmed and UPDATEd when the
--    confirmation link is opened. This transition is the enforcement point for
--    "no real user until verified".
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_confirmed_user();
