-- ============================================================================
-- Rich, ordered question content with legacy prompt compatibility.
--
-- `prompt` stays NOT NULL and remains the compact/searchable fallback. Existing
-- rows are untouched: NULL content_blocks means "render prompt exactly as
-- before". New rich questions store a validated discriminated-union JSON array.
-- ============================================================================

create or replace function public.is_valid_question_content_blocks(p_blocks jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_block jsonb;
  v_row jsonb;
  v_cell jsonb;
  v_type text;
  v_id text;
  v_seen_ids text[] := '{}';
  v_width integer;
begin
  if p_blocks is null then
    return true;
  end if;
  if jsonb_typeof(p_blocks) <> 'array'
     or jsonb_array_length(p_blocks) < 1
     or jsonb_array_length(p_blocks) > 30 then
    return false;
  end if;

  for v_block in select value from jsonb_array_elements(p_blocks)
  loop
    if jsonb_typeof(v_block) <> 'object' then return false; end if;
    v_id := v_block->>'id';
    if v_id is null
       or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or v_id = any(v_seen_ids) then
      return false;
    end if;
    v_seen_ids := v_seen_ids || v_id;
    v_type := v_block->>'type';

    if v_type = 'text' then
      if not (v_block ? 'content')
         or jsonb_typeof(v_block->'content') <> 'string'
         or btrim(v_block->>'content') = ''
         or char_length(v_block->>'content') > 8000 then
        return false;
      end if;
    elsif v_type = 'centered_math' then
      if not (v_block ? 'content')
         or jsonb_typeof(v_block->'content') <> 'string'
         or btrim(v_block->>'content') = ''
         or char_length(v_block->>'content') > 4000 then
        return false;
      end if;
    elsif v_type = 'image' then
      if not (v_block ? 'storagePath')
         or jsonb_typeof(v_block->'storagePath') <> 'string'
         or (v_block->>'storagePath') !~* '^questions/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'
         or (v_block ? 'alt' and (
              jsonb_typeof(v_block->'alt') <> 'string'
              or char_length(v_block->>'alt') > 500
            ))
         or (v_block ? 'caption' and (
              jsonb_typeof(v_block->'caption') <> 'string'
              or char_length(v_block->>'caption') > 500
            ))
         or (v_block ? 'size' and coalesce(v_block->>'size', '') not in
              ('small', 'medium', 'large', 'full')) then
        return false;
      end if;
    elsif v_type = 'table' then
      if (v_block ? 'header' and jsonb_typeof(v_block->'header') <> 'boolean')
         or not (v_block ? 'rows')
         or jsonb_typeof(v_block->'rows') <> 'array'
         or jsonb_array_length(v_block->'rows') < 1
         or jsonb_array_length(v_block->'rows') > 50 then
        return false;
      end if;
      v_width := null;
      for v_row in select value from jsonb_array_elements(v_block->'rows')
      loop
        if jsonb_typeof(v_row) <> 'array'
           or jsonb_array_length(v_row) < 1
           or jsonb_array_length(v_row) > 12 then
          return false;
        end if;
        if v_width is null then
          v_width := jsonb_array_length(v_row);
        elsif jsonb_array_length(v_row) <> v_width then
          return false;
        end if;
        for v_cell in select value from jsonb_array_elements(v_row)
        loop
          if jsonb_typeof(v_cell) <> 'string'
             or char_length(v_cell #>> '{}') > 1000 then
            return false;
          end if;
        end loop;
      end loop;
    else
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$fn$;

revoke all on function public.is_valid_question_content_blocks(jsonb)
  from public, anon, authenticated;
grant execute on function public.is_valid_question_content_blocks(jsonb)
  to authenticated;

alter table public.questions
  add column if not exists content_blocks jsonb;

comment on column public.questions.content_blocks is
  'Ordered validated question body blocks. NULL uses the legacy prompt column.';

alter table public.questions
  drop constraint if exists questions_content_blocks_shape;
alter table public.questions
  add constraint questions_content_blocks_shape
  check (public.is_valid_question_content_blocks(content_blocks)) not valid;
alter table public.questions
  validate constraint questions_content_blocks_shape;

-- Students may read content but still cannot read correct_choice/explanation.
grant select (content_blocks) on table public.questions to authenticated;
grant update (content_blocks) on table public.questions to authenticated;


-- --- Admin question read model ---------------------------------------------

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
       qs.name      as set_name,
       q.solution_video_id,
       v.title      as solution_video_title,
       v.is_active  as solution_video_is_active,
       q.content_blocks
  from public.questions q
  join public.subtopics s on s.id = q.subtopic_id
  join public.domains d on d.id = s.domain_id
  left join public.question_sets qs on qs.id = q.question_set_id
  left join public.videos v on v.id = q.solution_video_id
 where public.is_admin();

revoke all on table public.admin_questions from anon, authenticated;
grant select on table public.admin_questions to authenticated;


-- --- Manual creation -------------------------------------------------------

drop function if exists public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid
);

create function public.admin_create_question(
  p_subtopic_id       uuid,
  p_prompt            text,
  p_choices           jsonb,
  p_correct_choice    smallint,
  p_explanation       text,
  p_difficulty        text,
  p_is_active         boolean,
  p_question_set_id   uuid,
  p_external_id       text,
  p_solution_video_id uuid default null,
  p_content_blocks    jsonb default null,
  p_question_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id          uuid := coalesce(p_question_id, gen_random_uuid());
  v_prompt      text := btrim(coalesce(p_prompt, ''));
  v_explanation text := btrim(coalesce(p_explanation, ''));
  v_external_id text := nullif(btrim(coalesce(p_external_id, '')), '');
  v_choices     jsonb;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_subtopic_id is null or not exists (
    select 1 from public.subtopics s where s.id = p_subtopic_id
  ) then raise exception 'unknown_subtopic'; end if;
  if p_solution_video_id is not null and not exists (
    select 1 from public.videos v where v.id = p_solution_video_id
  ) then raise exception 'unknown_solution_video'; end if;
  if v_prompt = '' or char_length(v_prompt) > 4000 then
    raise exception 'invalid_prompt';
  end if;
  if v_explanation = '' or char_length(v_explanation) > 4000 then
    raise exception 'invalid_explanation';
  end if;
  if p_difficulty is null or p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'invalid_difficulty';
  end if;
  if p_correct_choice is null or p_correct_choice not between 0 and 3 then
    raise exception 'invalid_correct_choice';
  end if;
  if p_is_active is null then raise exception 'invalid_active_state'; end if;
  if not public.is_valid_question_content_blocks(p_content_blocks) then
    raise exception 'invalid_content_blocks';
  end if;
  if p_choices is null or jsonb_typeof(p_choices) <> 'array'
     or jsonb_array_length(p_choices) <> 4
     or exists (
       select 1 from jsonb_array_elements(p_choices) choice(value)
        where jsonb_typeof(choice.value) <> 'string'
           or btrim(choice.value #>> '{}') = ''
           or char_length(choice.value #>> '{}') > 1000
     ) then
    raise exception 'invalid_choices';
  end if;
  select jsonb_agg(to_jsonb(btrim(choice.value #>> '{}')) order by choice.ordinal)
    into v_choices
    from jsonb_array_elements(p_choices) with ordinality choice(value, ordinal);
  if (p_question_set_id is null) <> (v_external_id is null) then
    raise exception 'incomplete_question_identity';
  end if;
  if v_external_id is not null and char_length(v_external_id) > 64 then
    raise exception 'invalid_external_id';
  end if;
  if p_question_set_id is not null then
    if not exists (select 1 from public.question_sets where id = p_question_set_id) then
      raise exception 'unknown_question_set';
    end if;
    if exists (
      select 1 from public.questions q
       where q.question_set_id = p_question_set_id
         and q.external_id = v_external_id
    ) then raise exception 'duplicate_question_identity'; end if;
  end if;

  insert into public.questions (
    id, subtopic_id, prompt, content_blocks, choices, correct_choice,
    explanation, difficulty, is_active, question_set_id, external_id,
    solution_video_id
  ) values (
    v_id, p_subtopic_id, v_prompt, p_content_blocks, v_choices,
    p_correct_choice, v_explanation, p_difficulty, p_is_active,
    p_question_set_id, v_external_id, p_solution_video_id
  );
  return v_id;
end;
$fn$;

revoke all on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid, jsonb, uuid
) to authenticated;


-- --- Existing JSON imports, extended transactionally ----------------------
-- Keep the proven import implementations as private helpers. The wrappers
-- validate rich blocks, call the old code, and attach blocks only to questions
-- that old code actually imported (duplicates/reused questions stay unchanged).

alter function public.admin_import_question_set(jsonb)
  rename to admin_import_question_set_without_content_blocks;
revoke all on function public.admin_import_question_set_without_content_blocks(jsonb)
  from public, anon, authenticated;

create function public.admin_import_question_set(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_result jsonb;
  v_elem jsonb;
  v_set_id uuid;
  v_existing text[] := '{}';
  v_processed text[] := '{}';
  v_external text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  for v_elem in select value from jsonb_array_elements(p_payload->'questions')
  loop
    if v_elem ? 'content_blocks'
       and not public.is_valid_question_content_blocks(v_elem->'content_blocks') then
      raise exception 'invalid_content_blocks for %', coalesce(v_elem->>'external_id', '(missing)');
    end if;
  end loop;

  select id into v_set_id from public.question_sets
   where name = btrim(p_payload->>'set_name');
  if found then
    select coalesce(array_agg(q.external_id), '{}') into v_existing
      from public.questions q
     where q.question_set_id = v_set_id and q.external_id is not null;
  end if;

  v_result := public.admin_import_question_set_without_content_blocks(p_payload);
  select id into v_set_id from public.question_sets
   where name = btrim(p_payload->>'set_name');

  for v_elem in select value from jsonb_array_elements(p_payload->'questions')
  loop
    v_external := btrim(v_elem->>'external_id');
    if v_elem ? 'content_blocks'
       and not (v_external = any(v_existing))
       and not (v_external = any(v_processed)) then
      update public.questions
         set content_blocks = v_elem->'content_blocks'
       where question_set_id = v_set_id and external_id = v_external;
    end if;
    v_processed := v_processed || v_external;
  end loop;
  return v_result;
end;
$fn$;

revoke all on function public.admin_import_question_set(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_import_question_set(jsonb) to authenticated;

alter function public.admin_import_practice_test(uuid, jsonb)
  rename to admin_import_practice_test_without_content_blocks;
revoke all on function public.admin_import_practice_test_without_content_blocks(uuid, jsonb)
  from public, anon, authenticated;

create function public.admin_import_practice_test(p_test_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_result jsonb;
  v_elem jsonb;
  v_set_id uuid;
  v_set_name text;
  v_existing text[] := '{}';
  v_external text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  for v_elem in select value from jsonb_array_elements(p_payload->'questions')
  loop
    if v_elem ? 'content_blocks'
       and not public.is_valid_question_content_blocks(v_elem->'content_blocks') then
      raise exception 'invalid_content_blocks for %', coalesce(v_elem->>'external_id', '(missing)');
    end if;
  end loop;

  select left('Practice test — ' || title, 120) into v_set_name
    from public.practice_tests where id = p_test_id;
  select id into v_set_id from public.question_sets where name = v_set_name;
  if found then
    select coalesce(array_agg(q.external_id), '{}') into v_existing
      from public.questions q
     where q.question_set_id = v_set_id and q.external_id is not null;
  end if;

  v_result := public.admin_import_practice_test_without_content_blocks(
    p_test_id, p_payload
  );
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;
  select id into v_set_id from public.question_sets where name = v_set_name;
  for v_elem in select value from jsonb_array_elements(p_payload->'questions')
  loop
    v_external := btrim(v_elem->>'external_id');
    if v_elem ? 'content_blocks' and not (v_external = any(v_existing)) then
      update public.questions
         set content_blocks = v_elem->'content_blocks'
       where question_set_id = v_set_id and external_id = v_external;
    end if;
  end loop;
  return v_result;
end;
$fn$;

revoke all on function public.admin_import_practice_test(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_import_practice_test(uuid, jsonb)
  to authenticated;


-- --- Question report snapshots/read model ---------------------------------

create or replace function public.submit_question_report(
  p_request_id uuid,
  p_question_id uuid,
  p_reason text,
  p_details text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_snapshot jsonb;
begin
  if v_user_id is null then raise exception 'not_authenticated'; end if;
  if p_request_id is null or p_question_id is null then
    raise exception 'invalid_report';
  end if;
  if p_reason not in ('incorrect', 'unclear_or_broken') then
    raise exception 'invalid_reason';
  end if;
  if v_details is not null and char_length(v_details) > 1000 then
    raise exception 'details_too_long';
  end if;

  select jsonb_build_object(
           'prompt', q.prompt,
           'content_blocks', q.content_blocks,
           'choices', q.choices,
           'correct_choice', q.correct_choice
         ) into v_snapshot
    from public.questions q where q.id = p_question_id;
  if not found then raise exception 'question_not_found'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || p_question_id::text, 0)
  );
  if exists (
    select 1 from public.question_reports recent
     where recent.user_id = v_user_id
       and recent.question_id = p_question_id
       and recent.created_at >= now() - interval '5 minutes'
  ) then return true; end if;

  insert into public.question_reports (
    question_id, user_id, reason, details, question_snapshot, client_request_id
  ) values (
    p_question_id, v_user_id, p_reason, v_details, v_snapshot, p_request_id
  ) on conflict (user_id, client_request_id) do nothing;
  return true;
end;
$fn$;

revoke all on function public.submit_question_report(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_question_report(uuid, uuid, text, text)
  to authenticated;

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
       (select count(*) from public.question_reports same_question
         where same_question.question_id = r.question_id) as question_report_count,
       (select count(*) from public.question_reports same_question
         where same_question.question_id = r.question_id
           and same_question.status = 'open') as open_question_report_count,
       case r.status when 'open' then 0 when 'reviewed' then 1
         when 'resolved' then 2 else 3 end as status_sort,
       q.content_blocks as current_content_blocks
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


-- --- Safe orphan checks ----------------------------------------------------

create or replace function public.admin_question_asset_reference_count(
  p_storage_path text,
  p_exclude_question_id uuid default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare v_count bigint;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select count(*) into v_count
    from public.questions q
   where (p_exclude_question_id is null or q.id <> p_exclude_question_id)
     and exists (
       select 1
         from jsonb_array_elements(coalesce(q.content_blocks, '[]'::jsonb)) block
        where block->>'type' = 'image'
          and block->>'storagePath' = p_storage_path
     );
  return v_count;
end;
$fn$;

revoke all on function public.admin_question_asset_reference_count(text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_question_asset_reference_count(text, uuid)
  to authenticated;


-- --- Supabase Storage ------------------------------------------------------
-- Public read is intentional: question figures are ordinary educational
-- content. Every mutation still requires the caller's admin session and RLS.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-assets',
  'question-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists question_assets_public_read on storage.objects;
create policy question_assets_public_read
  on storage.objects for select to public
  using (bucket_id = 'question-assets');

drop policy if exists question_assets_admin_insert on storage.objects;
create policy question_assets_admin_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'question-assets'
    and (storage.foldername(name))[1] = 'questions'
    and public.is_admin()
  );

drop policy if exists question_assets_admin_update on storage.objects;
create policy question_assets_admin_update
  on storage.objects for update to authenticated
  using (bucket_id = 'question-assets' and public.is_admin())
  with check (
    bucket_id = 'question-assets'
    and (storage.foldername(name))[1] = 'questions'
    and public.is_admin()
  );

drop policy if exists question_assets_admin_delete on storage.objects;
create policy question_assets_admin_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'question-assets' and public.is_admin());
