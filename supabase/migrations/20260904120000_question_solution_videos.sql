-- ============================================================================
-- Exact solution videos for questions.
--
-- A question keeps only the stable videos.id foreign key. Student-facing
-- metadata is released by the same post-attempt paths that already release the
-- answer key; admins read and write the link through the existing admin view
-- and RLS-gated questions update policy.
-- ============================================================================

alter table public.questions
  add column if not exists solution_video_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'questions_solution_video_id_fkey'
       and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
      add constraint questions_solution_video_id_fkey
      foreign key (solution_video_id)
      references public.videos (id)
      on delete set null;
  end if;
end;
$$;

create index if not exists questions_solution_video_id_idx
  on public.questions (solution_video_id)
  where solution_video_id is not null;

comment on column public.questions.solution_video_id is
  'Optional exact solution video. Stores videos.id; public routes are derived from the related video.';

-- UPDATE is still denied unless the existing questions_update_admin RLS policy
-- passes, so this adds no student write path.
grant update (solution_video_id) on table public.questions to authenticated;


-- --- Admin read path ---------------------------------------------------------

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
       v.is_active  as solution_video_is_active
  from public.questions q
  join public.subtopics s on s.id = q.subtopic_id
  join public.domains   d on d.id = s.domain_id
  left join public.question_sets qs on qs.id = q.question_set_id
  left join public.videos v on v.id = q.solution_video_id
 where public.is_admin();

revoke all on table public.admin_questions from anon, authenticated;
grant select on table public.admin_questions to authenticated;


-- --- Post-attempt solution read path ----------------------------------------

-- Exact video metadata follows the answer key's existing access rule. The
-- LEFT JOIN deliberately treats a soft-deleted video as absent; a hard delete
-- has already SET NULL on questions.solution_video_id.
create or replace view public.attempted_question_solutions
with (security_barrier = true)
as
select q.id as question_id,
       q.correct_choice,
       q.explanation,
       v.id    as solution_video_id,
       v.title as solution_video_title
  from public.questions q
  left join public.videos v
    on v.id = q.solution_video_id
   and v.is_active
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


-- --- Immediate question-bank grading ----------------------------------------

-- PostgreSQL cannot change a function's TABLE return shape in place.
drop function if exists public.submit_question_attempt(uuid, integer, uuid);

create function public.submit_question_attempt(
  p_question_id uuid,
  p_choice      integer,
  p_session_id  uuid
)
returns table (
  is_correct          boolean,
  correct_choice      integer,
  explanation         text,
  solution_video_id   uuid,
  solution_video_title text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid                  uuid;
  v_correct              smallint;
  v_explanation          text;
  v_session              uuid;
  v_solution_video_id    uuid;
  v_solution_video_title text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_choice is null or p_choice < 0 or p_choice > 3 then
    raise exception 'invalid_choice';
  end if;

  select q.correct_choice,
         q.explanation,
         v.id,
         v.title
    into v_correct,
         v_explanation,
         v_solution_video_id,
         v_solution_video_title
    from public.questions q
    left join public.videos v
      on v.id = q.solution_video_id
     and v.is_active
   where q.id = p_question_id;

  if not found then
    raise exception 'unknown_question';
  end if;

  select s.id into v_session
    from public.question_bank_sessions s
   where s.id = p_session_id
     and s.user_id = v_uid
     and s.ended_at is null;

  insert into public.question_attempts
    (user_id, question_id, selected_choice, session_id)
  values (v_uid, p_question_id, p_choice::smallint, v_session);

  return query
    select (p_choice::smallint = v_correct),
           v_correct::integer,
           v_explanation,
           v_solution_video_id,
           v_solution_video_title;
end;
$fn$;

revoke all on function public.submit_question_attempt(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_question_attempt(uuid, integer, uuid)
  to authenticated;


-- --- Manual question creation ----------------------------------------------

-- The final argument defaults to NULL so a cached pre-deploy caller can still
-- create an unlinked question while application and migration roll out.
drop function if exists public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text
);

create or replace function public.admin_create_question(
  p_subtopic_id      uuid,
  p_prompt           text,
  p_choices          jsonb,
  p_correct_choice   smallint,
  p_explanation      text,
  p_difficulty       text,
  p_is_active        boolean,
  p_question_set_id  uuid,
  p_external_id      text,
  p_solution_video_id uuid default null
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

  if p_solution_video_id is not null and not exists (
    select 1 from public.videos v where v.id = p_solution_video_id
  ) then
    raise exception 'unknown_solution_video';
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

  select jsonb_agg(to_jsonb(btrim(choice.value #>> '{}')) order by choice.ordinal)
    into v_choices
    from jsonb_array_elements(p_choices) with ordinality
      as choice(value, ordinal);

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
    external_id,
    solution_video_id
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
    v_external_id,
    p_solution_video_id
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid
) is
  'Creates one multiple-choice question, optionally linked to an exact solution video, for an authenticated admin.';

revoke all on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid
) to authenticated;
