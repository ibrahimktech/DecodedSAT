-- ============================================================================
-- Admin-only manual creation of one question.
--
-- Authenticated clients deliberately have no INSERT grant on `questions`.
-- This narrow definer function is therefore the manual equivalent of
-- `admin_import_question_set`: it uses the caller's session, hard-checks
-- `is_admin()`, validates the existing question shape, and inserts atomically.
-- No table or column changes are required.
-- ============================================================================

create or replace function public.admin_create_question(
  p_subtopic_id    uuid,
  p_prompt         text,
  p_choices        jsonb,
  p_correct_choice smallint,
  p_explanation    text,
  p_difficulty     text,
  p_is_active      boolean,
  p_question_set_id uuid,
  p_external_id    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id          uuid;
  v_prompt      text := btrim(coalesce(p_prompt, ''));
  v_explanation text := btrim(coalesce(p_explanation, ''));
  v_external_id text := nullif(btrim(coalesce(p_external_id, '')), '');
  v_choices     jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;

  if p_subtopic_id is null or not exists (
    select 1 from public.subtopics s where s.id = p_subtopic_id
  ) then
    raise exception 'unknown_subtopic';
  end if;

  if v_prompt = '' or char_length(v_prompt) > 4000 then
    raise exception 'invalid_prompt';
  end if;

  if v_explanation = '' or char_length(v_explanation) > 4000 then
    raise exception 'invalid_explanation';
  end if;

  if p_difficulty is null
     or p_difficulty not in ('easy', 'medium', 'hard') then
    raise exception 'invalid_difficulty';
  end if;

  if p_correct_choice is null or p_correct_choice not between 0 and 3 then
    raise exception 'invalid_correct_choice';
  end if;

  if p_is_active is null then
    raise exception 'invalid_active_state';
  end if;

  if p_choices is null
     or jsonb_typeof(p_choices) <> 'array'
     or jsonb_array_length(p_choices) <> 4 then
    raise exception 'invalid_choices';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_choices) as choice(value)
     where jsonb_typeof(choice.value) <> 'string'
        or btrim(choice.value #>> '{}') = ''
        or char_length(choice.value #>> '{}') > 1000
  ) then
    raise exception 'invalid_choices';
  end if;

  -- Match the JSON importer: choice text is trimmed and stored in A-D order.
  select jsonb_agg(to_jsonb(btrim(choice.value #>> '{}')) order by choice.ordinal)
    into v_choices
    from jsonb_array_elements(p_choices) with ordinality
      as choice(value, ordinal);

  -- `external_id` is scoped by a question set. Hand-authored questions may
  -- omit both, but accepting only half the pair would create unusable import
  -- identity and make duplicate detection surprising.
  if (p_question_set_id is null) <> (v_external_id is null) then
    raise exception 'incomplete_question_identity';
  end if;

  if v_external_id is not null and char_length(v_external_id) > 64 then
    raise exception 'invalid_external_id';
  end if;

  if p_question_set_id is not null then
    if not exists (
      select 1
        from public.question_sets qs
       where qs.id = p_question_set_id
    ) then
      raise exception 'unknown_question_set';
    end if;

    if exists (
      select 1
        from public.questions q
       where q.question_set_id = p_question_set_id
         and q.external_id = v_external_id
    ) then
      raise exception 'duplicate_question_identity';
    end if;
  end if;

  insert into public.questions (
    subtopic_id,
    prompt,
    choices,
    correct_choice,
    explanation,
    difficulty,
    is_active,
    question_set_id,
    external_id
  )
  values (
    p_subtopic_id,
    v_prompt,
    v_choices,
    p_correct_choice,
    v_explanation,
    p_difficulty,
    p_is_active,
    p_question_set_id,
    v_external_id
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text
) is
  'Creates one existing-model multiple-choice question for an authenticated admin.';

revoke all on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text
) from public, anon, authenticated;
grant execute on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text
) to authenticated;
