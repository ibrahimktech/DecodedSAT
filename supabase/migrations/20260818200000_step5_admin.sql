-- ============================================================================
-- Step 5 — admin authorization, content pipeline schema, and admin RLS.
--
-- Run this whole file once, top to bottom, in the Supabase Dashboard SQL
-- Editor (or via `supabase db push`). Idempotent; re-running it is safe.
-- Run `wipe-step5-content.sql` BEFORE this file (one-off content wipe), and
-- insert yourself into `admin_users` AFTER it (see section 1).
--
-- The authorization model, in one paragraph: `admin_users` is the only source
-- of admin truth, it is reachable from a client by NOBODY (no policies, no
-- grants), and the only way in is a manual INSERT in the SQL editor. The app
-- asks one question — `is_admin()` — and every admin-gated policy and every
-- server-side check derives from that function. There is no service_role
-- anywhere in this feature, no role flag in `profiles`, and no code path that
-- lets a client escalate themselves.
-- ============================================================================


-- ============================================================================
-- 1. admin_users — who is an admin. SQL-editor-only, by design.
-- ============================================================================

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz default now()
);

comment on table public.admin_users is
  'Admin allowlist. No RLS policies and no client grants on purpose: rows are '
  'inserted manually in the SQL editor and read only through is_admin(). '
  'Any policy added to this table widens the admin surface — do not.';

-- RLS enabled with ZERO policies = default deny for every client, including
-- authenticated admins themselves. Deliberately NOT `force row level
-- security`: is_admin() below is SECURITY DEFINER and runs as the table
-- owner, and forcing RLS onto the owner would deny the one reader this table
-- is supposed to have. (Every other table in this project forces RLS; this
-- one is the documented exception, and it holds nothing but uuids.)
alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

-- After running this file, confirm the default-deny actually holds:
--
--   select polname from pg_policies
--    where schemaname = 'public' and tablename = 'admin_users';
--
-- must return zero rows. Then authorize yourself, once, manually:
--
--   insert into public.admin_users (user_id) values ('<your-auth-uid>');
--
-- (Your uid is in Dashboard → Authentication → Users, or
--  `select id, email from auth.users`.)


-- The one sanctioned view into admin_users: a boolean about *yourself*.
-- SECURITY DEFINER so it can read a table clients cannot; empty search_path
-- so nothing in a caller's path can shadow the table; derives the caller from
-- auth.uid(), never from an argument — there is no "is this OTHER user an
-- admin" oracle.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

comment on function public.is_admin() is
  'True when the calling session''s user is in admin_users. The single '
  'admin-authorization primitive: RLS policies and server code both use this.';

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- ============================================================================
-- 2. Schema additions — soft delete, question sets, import identity
-- ============================================================================

-- Soft delete: student-facing queries filter `is_active = true`; the admin
-- panel sees both states and can restore. Nothing is ever hard-deleted from
-- the UI.
alter table public.questions add column if not exists is_active boolean not null default true;
alter table public.videos    add column if not exists is_active boolean not null default true;

-- The seed supplied hand-written ids; admin-created rows need the database to
-- mint them.
alter table public.questions alter column id set default gen_random_uuid();
alter table public.videos    alter column id set default gen_random_uuid();

-- One JSON upload = one set ("Official Practice Test 3 — Algebra"). A
-- categorization axis independent of domain/subtopic, and the namespace for
-- duplicate detection on re-upload.
create table if not exists public.question_sets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz default now()
);

comment on table public.question_sets is
  'One row per admin JSON upload batch. Written only via admin_import_question_set().';

alter table public.questions
  add column if not exists question_set_id uuid references public.question_sets (id),
  add column if not exists external_id text;

comment on column public.questions.external_id is
  'Admin-controlled identity from the upload JSON. (question_set_id, external_id) '
  'is the duplicate key: same pair on re-upload = row skipped, not duplicated.';

create unique index if not exists questions_set_external_id_uq
  on public.questions (question_set_id, external_id)
  where external_id is not null;

-- Students may now filter on `is_active` (their query-level filter needs the
-- column readable). The answer-key columns stay withheld exactly as before.
grant select (is_active) on table public.questions to authenticated;


-- ============================================================================
-- 3. RLS for the new table and the admin write paths
--
-- Same doctrine as steps 1–4 — grants are the coarse gate, policies the fine
-- one — with one addition: every admin policy's test is `public.is_admin()`,
-- never a client-supplied flag.
--
-- Read visibility of inactive rows is handled at the query level (student
-- queries filter `is_active = true`; admin queries don't), per the step spec:
-- the existing simple SELECT policies stay, admin reads need inactive rows,
-- and an inactive question's prompt is hidden content, not a secret.
-- ============================================================================

-- --- question_sets: admins read; writes only inside the import function -----

alter table public.question_sets enable row level security;
alter table public.question_sets force row level security;
revoke all on table public.question_sets from anon, authenticated;
grant select on table public.question_sets to authenticated;

drop policy if exists question_sets_select_admin on public.question_sets;
create policy question_sets_select_admin
  on public.question_sets for select to authenticated
  using (public.is_admin());

-- No INSERT grant to authenticated: clients cannot create sets directly, only
-- admin_import_question_set() (definer, runs as owner) can. The policy still
-- gates that path — `force row level security` puts the owner under RLS too,
-- so even the definer function writes nothing unless the caller is an admin.
drop policy if exists question_sets_insert_admin on public.question_sets;
create policy question_sets_insert_admin
  on public.question_sets for insert to authenticated
  with check (public.is_admin());

-- --- questions: admin edit + soft delete; inserts only via the import fn ----

-- Everything editable except `id`. Includes the answer-key columns: the
-- column-scoped SELECT grant still hides them from every client read, and the
-- UPDATE policy below limits writes to admins.
grant update (subtopic_id, prompt, choices, correct_choice, explanation,
              difficulty, is_active, question_set_id, external_id)
  on table public.questions to authenticated;

drop policy if exists questions_update_admin on public.questions;
create policy questions_update_admin
  on public.questions for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Insert path exists only for the definer import function (owner privileges;
-- no client grant), and the policy gates it by the caller's admin status.
drop policy if exists questions_insert_admin on public.questions;
create policy questions_insert_admin
  on public.questions for insert to authenticated
  with check (public.is_admin());

-- --- subtopics: the import may create one under a domain --------------------
-- (`create_new_subtopics: true` uploads only.) No client grant — same
-- owner-only pattern as question_sets inserts.

drop policy if exists subtopics_insert_admin on public.subtopics;
create policy subtopics_insert_admin
  on public.subtopics for insert to authenticated
  with check (public.is_admin());

-- --- videos: admins add and edit directly (no hidden columns here) ----------

grant insert on table public.videos to authenticated;
grant update (subtopic_id, title, youtube_id, description, is_active)
  on table public.videos to authenticated;

drop policy if exists videos_insert_admin on public.videos;
create policy videos_insert_admin
  on public.videos for insert to authenticated
  with check (public.is_admin());

drop policy if exists videos_update_admin on public.videos;
create policy videos_update_admin
  on public.videos for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --- profiles: admins may list everyone (the /admin/users page) -------------

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin
  on public.profiles for select to authenticated
  using (public.is_admin());

-- --- question_attempts: admins may read all (per-user attempt counts) -------

drop policy if exists question_attempts_select_admin on public.question_attempts;
create policy question_attempts_select_admin
  on public.question_attempts for select to authenticated
  using (public.is_admin());


-- ============================================================================
-- 4. admin_questions — the admin read path, answer key included
--
-- The column-scoped grant on `questions` hides `correct_choice` and
-- `explanation` from every client, and grants are per-role, not per-user —
-- so "admins see the key, students never do" cannot be expressed as a grant.
-- This definer-style view is the sanctioned exception, same construct as
-- `attempted_question_solutions` from step 4 (the Supabase advisor will flag
-- it; that is expected): it reads columns clients cannot, and it releases
-- rows only when `is_admin()` holds. Non-admins get zero rows, not an error.
-- ============================================================================

create or replace view public.admin_questions
with (security_barrier = true)
as
select q.id,
       q.prompt,
       q.choices,
       q.correct_choice,
       q.explanation,
       q.difficulty,
       q.is_active,
       q.external_id,
       q.subtopic_id,
       s.name       as subtopic_name,
       s.domain_id,
       d.name       as domain_name,
       q.question_set_id,
       qs.name      as set_name
  from public.questions q
  join public.subtopics s on s.id = q.subtopic_id
  join public.domains   d on d.id = s.domain_id
  left join public.question_sets qs on qs.id = q.question_set_id
 where public.is_admin();

revoke all on table public.admin_questions from anon, authenticated;
grant select on table public.admin_questions to authenticated;


-- ============================================================================
-- 5. admin_import_question_set — the bulk upload, one transaction
--
-- Called by the upload Server Action through the admin's own session (anon
-- key + RLS; no service_role). SECURITY DEFINER because it must write tables
-- clients have no insert grant on — but `force row level security` keeps even
-- the owner under the insert policies above, and the first statement hard-
-- gates on is_admin() regardless. A function is one transaction, which is
-- what the spec's "partial failure must not half-import the set" requires.
--
-- Per-row failures REJECT THE ROW, not the file: bad rows land in the
-- returned `rejected` array with a reason, duplicates (same set + external_id,
-- including duplicates within the file itself) are counted as skipped, and
-- everything else imports. Zod validates the payload shape in the Server
-- Action first; the guards here are the defense that holds even if a caller
-- reaches the RPC directly.
--
-- Returns: { "imported": n, "skipped_duplicates": n,
--            "rejected": [{ "external_id": text, "reason": text }] }
-- ============================================================================

create or replace function public.admin_import_question_set(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set_id       uuid;
  v_set_name     text;
  v_create_subs  boolean;
  v_elem         jsonb;
  v_external     text;
  v_domain_name  text;
  v_sub_name     text;
  v_prompt       text;
  v_explanation  text;
  v_difficulty   text;
  v_correct      text;
  v_domain_id    uuid;
  v_subtopic_id  uuid;
  v_choices      jsonb;
  v_base_slug    text;
  v_slug         text;
  v_suffix       integer;
  v_imported     integer := 0;
  v_skipped      integer := 0;
  v_rejected     jsonb   := '[]'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  -- File-level shape. Anything wrong here fails the whole call — there is no
  -- sensible per-row recovery from a payload that isn't the format at all.
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'questions') <> 'array'
     or jsonb_array_length(p_payload->'questions') < 1
     or jsonb_array_length(p_payload->'questions') > 500 then
    raise exception 'malformed_payload';
  end if;

  v_set_name := trim(coalesce(p_payload->>'set_name', ''));
  if v_set_name = '' or length(v_set_name) > 120 then
    raise exception 'malformed_payload';
  end if;

  v_create_subs := jsonb_typeof(p_payload->'create_new_subtopics') = 'boolean'
                   and (p_payload->'create_new_subtopics')::text = 'true';

  -- Look up or create the set. The description only applies to a new set.
  select qs.id into v_set_id
    from public.question_sets qs
   where qs.name = v_set_name;

  if not found then
    insert into public.question_sets (name, description)
    values (
      v_set_name,
      nullif(trim(coalesce(p_payload->>'set_description', '')), '')
    )
    returning id into v_set_id;
  end if;

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

    -- Field-level guards. Reasons are written for the human reading the
    -- upload summary, not for a parser.
    if v_external = '' or length(v_external) > 64 then
      v_rejected := v_rejected || jsonb_build_object(
        'external_id', coalesce(nullif(v_external, ''), '(missing)'),
        'reason', 'external_id is missing or longer than 64 characters');
      continue;
    end if;

    if v_prompt = '' or length(v_prompt) > 4000
       or v_explanation = '' or length(v_explanation) > 4000
       or v_domain_name = '' or length(v_domain_name) > 100
       or v_sub_name = '' or length(v_sub_name) > 120 then
      v_rejected := v_rejected || jsonb_build_object(
        'external_id', v_external,
        'reason', 'prompt, explanation, domain or subtopic is empty or too long');
      continue;
    end if;

    if v_difficulty is null or v_difficulty not in ('easy', 'medium', 'hard') then
      v_rejected := v_rejected || jsonb_build_object(
        'external_id', v_external,
        'reason', 'difficulty must be easy, medium or hard');
      continue;
    end if;

    -- Exactly four choices, labelled exactly A–D, every text present.
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
      v_rejected := v_rejected || jsonb_build_object(
        'external_id', v_external,
        'reason', 'choices must be exactly four, labelled A-D, each with text');
      continue;
    end if;

    if v_correct is null or v_correct not in ('A', 'B', 'C', 'D') then
      v_rejected := v_rejected || jsonb_build_object(
        'external_id', v_external,
        'reason', 'correct_answer must be one of the choice labels A-D');
      continue;
    end if;

    -- Domain must be one of the four fixed ones; name (case-insensitive) or
    -- slug both resolve, so "Algebra" and "algebra" work.
    select d.id into v_domain_id
      from public.domains d
     where lower(d.name) = lower(v_domain_name) or d.slug = lower(v_domain_name)
     limit 1;

    if not found then
      v_rejected := v_rejected || jsonb_build_object(
        'external_id', v_external,
        'reason', 'unknown domain: ' || v_domain_name);
      continue;
    end if;

    select s.id into v_subtopic_id
      from public.subtopics s
     where s.domain_id = v_domain_id
       and (lower(s.name) = lower(v_sub_name) or s.slug = lower(v_sub_name))
     limit 1;

    if not found then
      if not v_create_subs then
        v_rejected := v_rejected || jsonb_build_object(
          'external_id', v_external,
          'reason', 'unknown subtopic for that domain: ' || v_sub_name
                    || ' (set create_new_subtopics to true to add it)');
        continue;
      end if;

      -- Slug from the name; suffix on collision (slugs are globally unique).
      -- Capped so it stays inside the app's `^[a-z0-9-]{1,64}$` filter shape.
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
        gen_random_uuid(),
        v_domain_id,
        v_slug,
        v_sub_name,
        coalesce(
          (select max(s.position) + 1 from public.subtopics s
            where s.domain_id = v_domain_id),
          1)
      )
      returning id into v_subtopic_id;
    end if;

    -- The duplicate key. Rows inserted earlier in this same call are visible
    -- here too, so a file that repeats an external_id imports it once and
    -- skips the repeats.
    if exists (
      select 1 from public.questions q
       where q.question_set_id = v_set_id and q.external_id = v_external
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.questions
      (subtopic_id, prompt, choices, correct_choice, explanation,
       difficulty, question_set_id, external_id)
    values (
      v_subtopic_id,
      v_prompt,
      -- Stored shape is what the player already renders: a 4-element array of
      -- choice texts in A-D order, with correct_choice as the 0-based index.
      (select jsonb_agg(trim(c->>'text') order by c->>'label')
         from jsonb_array_elements(v_elem->'choices') c),
      (position(v_correct in 'ABCD') - 1)::smallint,
      v_explanation,
      v_difficulty,
      v_set_id,
      v_external
    );

    v_imported := v_imported + 1;
  end loop;

  return jsonb_build_object(
    'imported', v_imported,
    'skipped_duplicates', v_skipped,
    'rejected', v_rejected
  );
end;
$$;

revoke all on function public.admin_import_question_set(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_import_question_set(jsonb)
  to authenticated;


-- ============================================================================
-- 6. admin_list_users — the /admin/users page, one call
--
-- Definer for the same reason as the view: the admin badge requires reading
-- `admin_users`, which no client can touch. Hard-gated on is_admin() — a
-- non-admin caller gets an error, not an empty-but-plausible list.
-- ============================================================================

create or replace function public.admin_list_users()
returns table (
  id             uuid,
  full_name      text,
  email          text,
  created_at     timestamptz,
  is_admin       boolean,
  attempts_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  return query
    select p.id,
           p.full_name,
           p.email,
           p.created_at,
           exists (select 1 from public.admin_users a where a.user_id = p.id),
           (select count(*) from public.question_attempts qa
             where qa.user_id = p.id)
      from public.profiles p
     order by p.created_at desc;
end;
$$;

revoke all on function public.admin_list_users()
  from public, anon, authenticated;
grant execute on function public.admin_list_users() to authenticated;
