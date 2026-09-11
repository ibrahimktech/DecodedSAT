-- ============================================================================
-- Student-produced responses and manual Practice Test authoring.
--
-- Existing questions remain multiple choice through the column default and
-- backfill. Numeric answers are represented internally as reduced rational
-- strings (for example 3.50 -> 7/2), so exact grading never uses floating
-- point equality. All student-facing grading paths call grade_question_answer.
-- ============================================================================


-- --- Exact numeric parsing --------------------------------------------------

create or replace function public.parse_numeric_answer(
  p_answer text
)
returns table (numerator numeric, denominator numeric)
language plpgsql
immutable
security definer
set search_path = ''
as $fn$
declare
  v_answer text := btrim(coalesce(p_answer, ''));
  v_left text;
  v_right text;
  v_left_sign numeric := 1;
  v_right_sign numeric := 1;
  v_left_scale integer := 0;
  v_right_scale integer := 0;
  v_left_n numeric;
  v_left_d numeric;
  v_right_n numeric := 1;
  v_right_d numeric := 1;
  v_n numeric;
  v_d numeric;
  v_a numeric;
  v_b numeric;
  v_gcd numeric;
begin
  if char_length(v_answer) not between 1 and 100
     or v_answer !~ '^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)(/[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+))?$' then
    raise exception 'invalid_numeric_answer';
  end if;

  v_left := split_part(v_answer, '/', 1);
  v_right := case when strpos(v_answer, '/') > 0
                  then split_part(v_answer, '/', 2)
                  else null end;

  if left(v_left, 1) = '-' then
    v_left_sign := -1;
    v_left := substr(v_left, 2);
  elsif left(v_left, 1) = '+' then
    v_left := substr(v_left, 2);
  end if;

  if strpos(v_left, '.') > 0 then
    v_left_scale := char_length(split_part(v_left, '.', 2));
  end if;
  v_left_n := replace(v_left, '.', '')::numeric * v_left_sign;
  v_left_d := power(10::numeric, v_left_scale);

  if v_right is not null then
    if left(v_right, 1) = '-' then
      v_right_sign := -1;
      v_right := substr(v_right, 2);
    elsif left(v_right, 1) = '+' then
      v_right := substr(v_right, 2);
    end if;
    if strpos(v_right, '.') > 0 then
      v_right_scale := char_length(split_part(v_right, '.', 2));
    end if;
    v_right_n := replace(v_right, '.', '')::numeric * v_right_sign;
    v_right_d := power(10::numeric, v_right_scale);
  end if;

  if v_right_n = 0 then
    raise exception 'zero_denominator';
  end if;

  v_n := v_left_n * v_right_d;
  v_d := v_left_d * v_right_n;
  if v_d < 0 then
    v_n := -v_n;
    v_d := -v_d;
  end if;

  if v_n = 0 then
    return query select 0::numeric, 1::numeric;
    return;
  end if;

  v_a := abs(v_n);
  v_b := v_d;
  while v_b <> 0 loop
    v_gcd := mod(v_a, v_b);
    v_a := v_b;
    v_b := v_gcd;
  end loop;

  return query select v_n / v_a, v_d / v_a;
exception when others then
  if sqlerrm in ('invalid_numeric_answer', 'zero_denominator') then
    raise;
  end if;
  raise exception 'invalid_numeric_answer';
end;
$fn$;

revoke all on function public.parse_numeric_answer(text)
  from public, anon, authenticated;

create or replace function public.normalize_numeric_answer(p_answer text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $fn$
declare
  v_n numeric;
  v_d numeric;
begin
  select parsed.numerator, parsed.denominator
    into v_n, v_d
    from public.parse_numeric_answer(p_answer) parsed;
  -- The parser's outputs are integers stored in unconstrained numeric values.
  -- Cast through scale zero so PostgreSQL never exposes division-result
  -- trailing zeroes (the browser uses this exact canonical representation).
  return (v_n::numeric(1000, 0))::text
         || case when v_d = 1 then ''
                 else '/' || (v_d::numeric(1000, 0))::text end;
end;
$fn$;

revoke all on function public.normalize_numeric_answer(text)
  from public, anon, authenticated;
grant execute on function public.normalize_numeric_answer(text)
  to authenticated;

create or replace function public.is_valid_numeric_answer(p_answer text)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $fn$
begin
  perform public.normalize_numeric_answer(p_answer);
  return true;
exception when others then
  return false;
end;
$fn$;

revoke all on function public.is_valid_numeric_answer(text)
  from public, anon, authenticated;
grant execute on function public.is_valid_numeric_answer(text)
  to authenticated;

create or replace function public.normalize_numeric_answer_array(p_answers text[])
returns text[]
language plpgsql
immutable
security definer
set search_path = ''
as $fn$
declare
  v_answer text;
  v_values text[] := '{}';
begin
  if p_answers is null then return null; end if;
  foreach v_answer in array p_answers loop
    v_values := array_append(v_values, public.normalize_numeric_answer(v_answer));
  end loop;
  return v_values;
end;
$fn$;

revoke all on function public.normalize_numeric_answer_array(text[])
  from public, anon, authenticated;
grant execute on function public.normalize_numeric_answer_array(text[])
  to authenticated;

create or replace function public.numeric_answer_values_are_unique(p_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_values is not null
     and cardinality(p_values) = cardinality(array(
       select distinct item.value
         from unnest(p_values) as item(value)
     ));
$fn$;

revoke all on function public.numeric_answer_values_are_unique(text[])
  from public, anon, authenticated;
grant execute on function public.numeric_answer_values_are_unique(text[])
  to authenticated;

create or replace function public.numeric_answer_is_nonnegative(p_answer text)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $fn$
declare v_n numeric;
begin
  select parsed.numerator into v_n
    from public.parse_numeric_answer(p_answer) parsed;
  return v_n >= 0;
exception when others then
  return false;
end;
$fn$;

revoke all on function public.numeric_answer_is_nonnegative(text)
  from public, anon, authenticated;
grant execute on function public.numeric_answer_is_nonnegative(text)
  to authenticated;

create or replace function public.numeric_answers_equivalent(
  p_left text,
  p_right text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_ln numeric;
  v_ld numeric;
  v_rn numeric;
  v_rd numeric;
begin
  select numerator, denominator into v_ln, v_ld
    from public.parse_numeric_answer(p_left);
  select numerator, denominator into v_rn, v_rd
    from public.parse_numeric_answer(p_right);
  return v_ln = v_rn and v_ld = v_rd;
end;
$fn$;

revoke all on function public.numeric_answers_equivalent(text, text)
  from public, anon, authenticated;

create or replace function public.numeric_answer_within_tolerance(
  p_student text,
  p_correct text,
  p_tolerance text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_sn numeric;
  v_sd numeric;
  v_cn numeric;
  v_cd numeric;
  v_tn numeric;
  v_td numeric;
begin
  select numerator, denominator into v_sn, v_sd
    from public.parse_numeric_answer(p_student);
  select numerator, denominator into v_cn, v_cd
    from public.parse_numeric_answer(p_correct);
  select numerator, denominator into v_tn, v_td
    from public.parse_numeric_answer(p_tolerance);
  if v_tn < 0 then raise exception 'negative_tolerance'; end if;

  -- |student - correct| <= tolerance, cross-multiplied as integers.
  return abs(v_sn * v_cd - v_cn * v_sd) * v_td
         <= v_tn * v_sd * v_cd;
end;
$fn$;

revoke all on function public.numeric_answer_within_tolerance(text, text, text)
  from public, anon, authenticated;


-- --- Question answer model -------------------------------------------------

alter table public.questions
  add column if not exists question_type text not null default 'multiple_choice',
  add column if not exists spr_answer_mode text,
  add column if not exists spr_answers text[],
  add column if not exists spr_answer_values text[],
  add column if not exists spr_tolerance text,
  add column if not exists spr_tolerance_value text;

alter table public.questions alter column choices drop not null;
alter table public.questions alter column correct_choice drop not null;
alter table public.questions drop constraint if exists questions_choices_shape;
alter table public.questions drop constraint if exists questions_answer_shape;
alter table public.questions add constraint questions_answer_shape check (
  (
    question_type = 'multiple_choice'
    and choices is not null
    and jsonb_typeof(choices) = 'array'
    and jsonb_array_length(choices) = 4
    and correct_choice is not null
    and correct_choice between 0 and 3
    and spr_answer_mode is null
    and spr_answers is null
    and spr_answer_values is null
    and spr_tolerance is null
    and spr_tolerance_value is null
  )
  or
  (
    question_type = 'student_produced_response'
    and choices is null
    and correct_choice is null
    and spr_answer_mode in ('exact', 'tolerance', 'multiple')
    and spr_answers is not null
    and spr_answer_values is not null
    and cardinality(spr_answers) between 1 and 10
    and cardinality(spr_answer_values) = cardinality(spr_answers)
    and spr_answer_values = public.normalize_numeric_answer_array(spr_answers)
    and public.numeric_answer_values_are_unique(spr_answer_values)
    and (
      (spr_answer_mode = 'exact' and cardinality(spr_answers) = 1
        and spr_tolerance is null and spr_tolerance_value is null)
      or
      (spr_answer_mode = 'tolerance' and cardinality(spr_answers) = 1
        and public.numeric_answer_is_nonnegative(spr_tolerance)
        and spr_tolerance_value = public.normalize_numeric_answer(spr_tolerance))
      or
      (spr_answer_mode = 'multiple' and cardinality(spr_answers) >= 2
        and spr_tolerance is null and spr_tolerance_value is null)
    )
  )
);

comment on column public.questions.question_type is
  'multiple_choice or numeric student_produced_response.';
comment on column public.questions.spr_answer_values is
  'Reduced rational values derived from spr_answers; hidden from student reads.';

grant select (question_type) on table public.questions to authenticated;
grant update (
  question_type, spr_answer_mode, spr_answers, spr_answer_values,
  spr_tolerance, spr_tolerance_value
) on table public.questions to authenticated;


-- One authoritative grader for Question Bank, section, and Practice Test use.
create or replace function public.grade_question_answer(
  p_question_id uuid,
  p_answer text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_question public.questions%rowtype;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_correct text;
begin
  select * into v_question from public.questions q where q.id = p_question_id;
  if not found then raise exception 'unknown_question'; end if;

  if v_question.question_type = 'multiple_choice' then
    if v_answer !~ '^[0-3]$' then raise exception 'invalid_choice'; end if;
    return v_answer::smallint = v_question.correct_choice;
  end if;

  if not public.is_valid_numeric_answer(v_answer) then
    raise exception 'invalid_numeric_answer';
  end if;

  if v_question.spr_answer_mode = 'tolerance' then
    return public.numeric_answer_within_tolerance(
      v_answer,
      v_question.spr_answer_values[1],
      v_question.spr_tolerance_value
    );
  end if;

  foreach v_correct in array v_question.spr_answer_values loop
    if public.numeric_answers_equivalent(v_answer, v_correct) then
      return true;
    end if;
  end loop;
  return false;
end;
$fn$;

revoke all on function public.grade_question_answer(uuid, text)
  from public, anon, authenticated;


-- --- Attempt storage and immediate grading --------------------------------

alter table public.question_attempts
  add column if not exists student_answer text,
  add column if not exists question_type text;

update public.question_attempts qa
   set student_answer = qa.selected_choice::text
 where qa.student_answer is null;

update public.question_attempts qa
   set question_type = q.question_type
  from public.questions q
 where q.id = qa.question_id
   and qa.question_type is null;

alter table public.question_attempts alter column selected_choice drop not null;
alter table public.question_attempts alter column student_answer set not null;
alter table public.question_attempts alter column question_type set not null;
alter table public.question_attempts drop constraint if exists question_attempts_answer_shape;
alter table public.question_attempts add constraint question_attempts_answer_shape check (
  char_length(student_answer) between 1 and 100
  and (
    (question_type = 'multiple_choice'
      and selected_choice between 0 and 3
      and student_answer = selected_choice::text)
    or
    (question_type = 'student_produced_response'
      and selected_choice is null
      and public.is_valid_numeric_answer(student_answer))
  )
);

create or replace function public.compute_question_attempt_correctness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_type text;
begin
  select q.question_type into v_type
    from public.questions q where q.id = new.question_id;
  if not found then raise exception 'unknown_question'; end if;

  new.student_answer := btrim(coalesce(
    new.student_answer,
    new.selected_choice::text
  ));
  new.question_type := v_type;
  new.is_correct := public.grade_question_answer(new.question_id, new.student_answer);

  if v_type = 'multiple_choice' then
    new.selected_choice := new.student_answer::smallint;
  else
    new.selected_choice := null;
  end if;
  return new;
end;
$fn$;

revoke all on function public.compute_question_attempt_correctness()
  from public, anon, authenticated;

drop trigger if exists question_attempts_compute_correctness on public.question_attempts;
create trigger question_attempts_compute_correctness
  before insert on public.question_attempts
  for each row execute function public.compute_question_attempt_correctness();

drop function if exists public.submit_question_attempt(uuid, text, uuid);
create function public.submit_question_attempt(
  p_question_id uuid,
  p_answer text,
  p_session_id uuid
)
returns table (
  is_correct boolean,
  question_type text,
  correct_choice integer,
  correct_answers text[],
  correct_answer_tolerance text,
  explanation text,
  solution_video_id uuid,
  solution_video_title text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_session uuid;
  v_question public.questions%rowtype;
  v_is_correct boolean;
  v_video_id uuid;
  v_video_title text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select q.* into v_question
    from public.questions q
   where q.id = p_question_id and q.is_active;
  if not found then raise exception 'unknown_question'; end if;

  select s.id into v_session
    from public.question_bank_sessions s
   where s.id = p_session_id and s.user_id = v_uid and s.ended_at is null;

  insert into public.question_attempts
    (user_id, question_id, student_answer, session_id)
  values (v_uid, p_question_id, btrim(p_answer), v_session)
  returning public.question_attempts.is_correct into v_is_correct;

  select v.id, v.title into v_video_id, v_video_title
    from public.videos v
   where v.id = v_question.solution_video_id and v.is_active;

  return query select
    v_is_correct,
    v_question.question_type,
    v_question.correct_choice::integer,
    v_question.spr_answers,
    v_question.spr_tolerance,
    v_question.explanation,
    v_video_id,
    v_video_title;
end;
$fn$;

revoke all on function public.submit_question_attempt(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_question_attempt(uuid, text, uuid)
  to authenticated;

-- Short-lived compatibility for a tab running the previous MCQ client.
drop function if exists public.submit_question_attempt(uuid, integer, uuid);
create function public.submit_question_attempt(
  p_question_id uuid,
  p_choice integer,
  p_session_id uuid
)
returns table (
  is_correct boolean,
  correct_choice integer,
  explanation text,
  solution_video_id uuid,
  solution_video_title text
)
language sql
security definer
set search_path = ''
as $fn$
  select result.is_correct, result.correct_choice, result.explanation,
         result.solution_video_id, result.solution_video_title
    from public.submit_question_attempt(
      p_question_id, p_choice::text, p_session_id
    ) result;
$fn$;

revoke all on function public.submit_question_attempt(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_question_attempt(uuid, integer, uuid)
  to authenticated;


-- --- Timed section grading -------------------------------------------------

create or replace function public.submit_practice_attempt(
  p_attempt_id uuid,
  p_answers jsonb
)
returns table (score integer, total integer, time_taken_seconds integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_section uuid;
  v_started timestamptz;
  v_completed timestamptz;
  v_limit integer;
  v_total integer;
  v_correct integer;
  v_time integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array'
     or jsonb_array_length(p_answers) > 60 then
    raise exception 'malformed_answers';
  end if;

  select pa.practice_section_id, pa.started_at, pa.completed_at,
         ps.time_limit_seconds
    into v_section, v_started, v_completed, v_limit
    from public.practice_attempts pa
    join public.practice_sections ps on ps.id = pa.practice_section_id
   where pa.id = p_attempt_id and pa.user_id = v_uid
   for update of pa;

  if not found then raise exception 'unknown_attempt'; end if;
  if v_completed is not null then raise exception 'already_submitted'; end if;
  if now() > v_started + make_interval(secs => v_limit + 60) then
    raise exception 'attempt_expired';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_answers) elem
     where jsonb_typeof(elem) <> 'object'
        or (elem->>'questionId') is null
        or coalesce(elem->>'answer', elem->>'choice') is null
        or not public.is_valid_numeric_answer(
          coalesce(elem->>'answer', elem->>'choice')
        )
  ) then raise exception 'malformed_answers'; end if;

  if exists (
    select 1
      from jsonb_array_elements(p_answers) elem
      left join public.practice_section_questions psq
        on psq.section_id = v_section
       and psq.question_id = (elem->>'questionId')::uuid
     where psq.question_id is null
  ) then raise exception 'question_not_in_section'; end if;

  select count(*)::integer into v_total
    from public.practice_section_questions psq where psq.section_id = v_section;

  with parsed as (
    select (elem->>'questionId')::uuid as question_id,
           btrim(coalesce(elem->>'answer', elem->>'choice')) as answer,
           ord
      from jsonb_array_elements(p_answers) with ordinality as t(elem, ord)
  ),
  deduped as (
    select distinct on (question_id) question_id, answer
      from parsed order by question_id, ord desc
  ),
  inserted as (
    insert into public.question_attempts
      (user_id, question_id, student_answer, practice_attempt_id)
    select v_uid, d.question_id, d.answer, p_attempt_id from deduped d
    returning question_attempts.is_correct
  )
  select (count(*) filter (where inserted.is_correct))::integer
    into v_correct from inserted;

  v_time := greatest(0, least(
    ceil(extract(epoch from (now() - v_started)))::integer, v_limit
  ));

  update public.practice_attempts
     set score = v_correct,
         total_questions = v_total,
         time_taken_seconds = v_time,
         completed_at = now()
   where id = p_attempt_id;

  return query select v_correct, v_total, v_time;
end;
$fn$;

revoke all on function public.submit_practice_attempt(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_practice_attempt(uuid, jsonb)
  to authenticated;


-- --- Complete-test publication invariant ----------------------------------

create or replace function public.practice_test_is_complete(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.practice_tests test
     where test.id = p_test_id
       and (
         select count(*)
           from public.practice_test_questions link
           join public.questions question on question.id = link.question_id
          where link.practice_test_id = test.id
            and link.module_number = 1
            and question.is_active
       ) = public.sat_module_question_count()
       and (
         select count(*)
           from public.practice_test_questions link
           join public.questions question on question.id = link.question_id
          where link.practice_test_id = test.id
            and link.module_number = 2
            and question.is_active
       ) = case when test.module_count = 2
                then public.sat_module_question_count() else 0 end
       and (
         select count(*)
           from public.practice_test_questions link
          where link.practice_test_id = test.id
       ) = test.module_count * public.sat_module_question_count()
  );
$fn$;

revoke all on function public.practice_test_is_complete(uuid)
  from public, anon, authenticated;

alter table public.practice_tests alter column is_active set default false;

-- Existing drafts may predate the publication invariant. Preserve them, but
-- hide them until an admin fills every module and explicitly restores them.
update public.practice_tests test
   set is_active = false
 where test.is_active
   and not public.practice_test_is_complete(test.id);

create or replace function public.enforce_complete_active_practice_test()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.is_active and (
    tg_op = 'INSERT' or not public.practice_test_is_complete(new.id)
  ) then
    raise exception 'incomplete_practice_test';
  end if;
  return new;
end;
$fn$;

revoke all on function public.enforce_complete_active_practice_test()
  from public, anon, authenticated;

drop trigger if exists practice_test_require_complete_to_activate
  on public.practice_tests;
create trigger practice_test_require_complete_to_activate
  before insert or update of is_active on public.practice_tests
  for each row execute function public.enforce_complete_active_practice_test();

create or replace function public.deactivate_tests_for_inactive_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if old.is_active and not new.is_active then
    update public.practice_tests test
       set is_active = false
     where test.is_active
       and exists (
         select 1
           from public.practice_test_questions link
          where link.practice_test_id = test.id
            and link.question_id = new.id
       );
  end if;
  return new;
end;
$fn$;

revoke all on function public.deactivate_tests_for_inactive_question()
  from public, anon, authenticated;

drop trigger if exists question_deactivate_linked_practice_tests
  on public.questions;
create trigger question_deactivate_linked_practice_tests
  after update of is_active on public.questions
  for each row execute function public.deactivate_tests_for_inactive_question();

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
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select test.is_active into v_active
    from public.practice_tests test
   where test.id = p_test_id;
  if not found or not v_active then raise exception 'unknown_test'; end if;
  if not public.practice_test_is_complete(p_test_id) then
    raise exception 'incomplete_practice_test';
  end if;

  perform public.finalize_stale_practice_test_attempts();

  select attempt.id into v_attempt
    from public.practice_test_attempts attempt
   where attempt.user_id = v_uid
     and attempt.practice_test_id = p_test_id
     and attempt.status = 'in_progress'
   order by attempt.started_at desc
   limit 1;
  if found then return v_attempt; end if;

  insert into public.practice_test_attempts
    (user_id, practice_test_id, module1_ends_at)
  values (
    v_uid,
    p_test_id,
    now() + make_interval(secs => public.sat_module_seconds())
  )
  returning id into v_attempt;
  return v_attempt;
end;
$fn$;

revoke all on function public.start_practice_test_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.start_practice_test_attempt(uuid)
  to authenticated;

create or replace view public.admin_practice_tests
with (security_barrier = true)
as
select test.id,
       test.title,
       test.description,
       test.difficulty,
       test.test_type,
       test.module_count,
       test.is_active,
       test.created_at,
       (select count(*) from public.practice_test_questions link
         where link.practice_test_id = test.id and link.module_number = 1) as module1_count,
       (select count(*) from public.practice_test_questions link
         where link.practice_test_id = test.id and link.module_number = 2) as module2_count,
       (select count(*) from public.practice_test_attempts attempt
         where attempt.practice_test_id = test.id) as attempt_count,
       (select count(*)
          from public.practice_test_questions link
          join public.questions question on question.id = link.question_id
         where link.practice_test_id = test.id
           and link.module_number = 1
           and question.is_active) as module1_active_count,
       (select count(*)
          from public.practice_test_questions link
          join public.questions question on question.id = link.question_id
         where link.practice_test_id = test.id
           and link.module_number = 2
           and question.is_active) as module2_active_count
  from public.practice_tests test
 where public.is_admin();

revoke all on table public.admin_practice_tests from anon, authenticated;
grant select on table public.admin_practice_tests to authenticated;


-- --- Practice Test autosave ------------------------------------------------

alter table public.practice_test_responses
  add column if not exists question_type text;

update public.practice_test_responses response
   set question_type = q.question_type
  from public.questions q
 where q.id = response.question_id and response.question_type is null;

alter table public.practice_test_responses alter column question_type set not null;
alter table public.practice_test_responses drop constraint if exists practice_test_responses_answer_shape;
alter table public.practice_test_responses add constraint practice_test_responses_answer_shape check (
  student_answer is null
  or (
    char_length(student_answer) between 1 and 100
    and (
      (question_type = 'multiple_choice' and student_answer ~ '^[0-3]$')
      or
      (question_type = 'student_produced_response'
        and public.is_valid_numeric_answer(student_answer))
    )
  )
);

drop function if exists public.save_practice_test_response(uuid, uuid, text);
create function public.save_practice_test_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_answer text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_attempt record;
  v_module smallint;
  v_deadline timestamptz;
  v_qmodule smallint;
  v_type text;
  v_answer text := nullif(btrim(coalesce(p_answer, '')), '');
  v_correct boolean;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;

  select a.id, a.practice_test_id, a.status, a.module1_ends_at,
         a.module1_submitted_at, a.module2_started_at, a.module2_ends_at
    into v_attempt
    from public.practice_test_attempts a
   where a.id = p_attempt_id and a.user_id = v_uid;
  if not found then raise exception 'unknown_attempt'; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'attempt_closed'; end if;

  if v_attempt.module2_started_at is not null then
    v_module := 2;
    v_deadline := v_attempt.module2_ends_at;
  else
    if v_attempt.module1_submitted_at is not null then raise exception 'module_closed'; end if;
    v_module := 1;
    v_deadline := v_attempt.module1_ends_at;
  end if;
  if now() > v_deadline + make_interval(secs => public.sat_submit_grace_seconds()) then
    raise exception 'module_expired';
  end if;

  select link.module_number, q.question_type
    into v_qmodule, v_type
    from public.practice_test_questions link
    join public.questions q on q.id = link.question_id
   where link.practice_test_id = v_attempt.practice_test_id
     and link.question_id = p_question_id;
  if not found or v_qmodule <> v_module then raise exception 'question_not_in_module'; end if;

  if v_answer is null then
    delete from public.practice_test_responses response
     where response.practice_test_attempt_id = p_attempt_id
       and response.question_id = p_question_id;
    return true;
  end if;

  v_correct := public.grade_question_answer(p_question_id, v_answer);
  insert into public.practice_test_responses
    (practice_test_attempt_id, question_id, module_number,
     student_answer, question_type, is_correct, answered_at)
  values
    (p_attempt_id, p_question_id, v_module,
     v_answer, v_type, v_correct, now())
  on conflict (practice_test_attempt_id, question_id) do update
     set student_answer = excluded.student_answer,
         question_type = excluded.question_type,
         is_correct = excluded.is_correct,
         answered_at = excluded.answered_at;
  return true;
end;
$fn$;

revoke all on function public.save_practice_test_response(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_practice_test_response(uuid, uuid, text)
  to authenticated;

drop function if exists public.save_practice_test_response(uuid, uuid, integer);
create function public.save_practice_test_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_choice integer
)
returns boolean
language sql
security definer
set search_path = ''
as $fn$
  select public.save_practice_test_response(
    p_attempt_id, p_question_id, p_choice::text
  );
$fn$;

revoke all on function public.save_practice_test_response(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.save_practice_test_response(uuid, uuid, integer)
  to authenticated;


-- --- Answer-key views ------------------------------------------------------

create or replace view public.attempted_question_solutions
with (security_barrier = true)
as
select q.id as question_id,
       q.correct_choice,
       q.explanation,
       v.id as solution_video_id,
       v.title as solution_video_title,
       q.question_type,
       q.spr_answers as correct_answers,
       q.spr_tolerance as correct_answer_tolerance
  from public.questions q
  left join public.videos v on v.id = q.solution_video_id and v.is_active
 where exists (
         select 1 from public.question_attempts qa
          where qa.question_id = q.id and qa.user_id = auth.uid()
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


-- --- Admin read models and question writes --------------------------------

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
       s.name as subtopic_name,
       s.domain_id,
       d.name as domain_name,
       q.question_set_id,
       qs.name as set_name,
       q.solution_video_id,
       v.title as solution_video_title,
       v.is_active as solution_video_is_active,
       q.content_blocks,
       s.active as subtopic_active,
       review.confidence as skill_review_confidence,
       review.reason as skill_review_reason,
       review.status as skill_review_status,
       review.old_subtopic_name,
       review.suggested_subtopic_id,
       q.question_type,
       q.spr_answer_mode,
       q.spr_answers,
       q.spr_tolerance
  from public.questions q
  join public.subtopics s on s.id = q.subtopic_id
  join public.domains d on d.id = s.domain_id
  left join public.question_sets qs on qs.id = q.question_set_id
  left join public.videos v on v.id = q.solution_video_id
  left join public.question_skill_migration_reviews review
    on review.question_id = q.id
 where public.is_admin();

revoke all on table public.admin_questions from anon, authenticated;
grant select on table public.admin_questions to authenticated;

drop function if exists public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid, jsonb, uuid
);

create function public.admin_create_question(
  p_subtopic_id uuid,
  p_prompt text,
  p_choices jsonb,
  p_correct_choice smallint,
  p_explanation text,
  p_difficulty text,
  p_is_active boolean,
  p_question_set_id uuid,
  p_external_id text,
  p_solution_video_id uuid default null,
  p_content_blocks jsonb default null,
  p_question_id uuid default null,
  p_question_type text default 'multiple_choice',
  p_spr_answer_mode text default null,
  p_spr_answers text[] default null,
  p_spr_tolerance text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid := coalesce(p_question_id, gen_random_uuid());
  v_prompt text := btrim(coalesce(p_prompt, ''));
  v_explanation text := btrim(coalesce(p_explanation, ''));
  v_external_id text := nullif(btrim(coalesce(p_external_id, '')), '');
  v_choices jsonb;
  v_spr_answers text[];
  v_spr_values text[];
  v_tolerance text;
  v_tolerance_value text;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_subtopic_id is null or not exists (
    select 1 from public.subtopics s where s.id = p_subtopic_id and s.active
  ) then raise exception 'unknown_subtopic'; end if;
  if p_solution_video_id is not null and not exists (
    select 1 from public.videos v where v.id = p_solution_video_id
  ) then raise exception 'unknown_solution_video'; end if;
  if v_prompt = '' or char_length(v_prompt) > 4000 then raise exception 'invalid_prompt'; end if;
  if v_explanation = '' or char_length(v_explanation) > 4000 then raise exception 'invalid_explanation'; end if;
  if p_difficulty not in ('easy', 'medium', 'hard') then raise exception 'invalid_difficulty'; end if;
  if p_is_active is null then raise exception 'invalid_active_state'; end if;
  if not public.is_valid_question_content_blocks(p_content_blocks) then
    raise exception 'invalid_content_blocks';
  end if;

  if p_question_type = 'multiple_choice' then
    if p_correct_choice is null or p_correct_choice not between 0 and 3 then
      raise exception 'invalid_correct_choice';
    end if;
    if p_choices is null or jsonb_typeof(p_choices) <> 'array'
       or jsonb_array_length(p_choices) <> 4
       or exists (
         select 1 from jsonb_array_elements(p_choices) choice(value)
          where jsonb_typeof(choice.value) <> 'string'
             or btrim(choice.value #>> '{}') = ''
             or char_length(choice.value #>> '{}') > 1000
       ) then raise exception 'invalid_choices'; end if;
    select jsonb_agg(to_jsonb(btrim(choice.value #>> '{}')) order by choice.ordinal)
      into v_choices
      from jsonb_array_elements(p_choices) with ordinality choice(value, ordinal);
  elsif p_question_type = 'student_produced_response' then
    if p_spr_answer_mode not in ('exact', 'tolerance', 'multiple') then
      raise exception 'invalid_spr_answer_mode';
    end if;
    if cardinality(p_spr_answers) not between 1 and 10 then
      raise exception 'invalid_spr_answers';
    end if;
    select array_agg(btrim(answer) order by ordinal)
      into v_spr_answers
      from unnest(p_spr_answers) with ordinality item(answer, ordinal);
    v_spr_values := public.normalize_numeric_answer_array(v_spr_answers);
    if not public.numeric_answer_values_are_unique(v_spr_values) then
      raise exception 'duplicate_spr_answers';
    end if;
    if p_spr_answer_mode in ('exact', 'tolerance')
       and cardinality(v_spr_answers) <> 1 then
      raise exception 'invalid_spr_answers';
    end if;
    if p_spr_answer_mode = 'multiple' and cardinality(v_spr_answers) < 2 then
      raise exception 'invalid_spr_answers';
    end if;
    if p_spr_answer_mode = 'tolerance' then
      v_tolerance := btrim(coalesce(p_spr_tolerance, ''));
      if not public.numeric_answer_is_nonnegative(v_tolerance) then
        raise exception 'invalid_spr_tolerance';
      end if;
      v_tolerance_value := public.normalize_numeric_answer(v_tolerance);
    elsif p_spr_tolerance is not null then
      raise exception 'unexpected_spr_tolerance';
    end if;
  else
    raise exception 'invalid_question_type';
  end if;

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
       where q.question_set_id = p_question_set_id and q.external_id = v_external_id
    ) then raise exception 'duplicate_question_identity'; end if;
  end if;

  insert into public.questions (
    id, subtopic_id, prompt, content_blocks, choices, correct_choice,
    explanation, difficulty, is_active, question_set_id, external_id,
    solution_video_id, question_type, spr_answer_mode, spr_answers,
    spr_answer_values, spr_tolerance, spr_tolerance_value
  ) values (
    v_id, p_subtopic_id, v_prompt, p_content_blocks, v_choices,
    case when p_question_type = 'multiple_choice' then p_correct_choice else null end,
    v_explanation, p_difficulty, p_is_active, p_question_set_id, v_external_id,
    p_solution_video_id, p_question_type, p_spr_answer_mode, v_spr_answers,
    v_spr_values, v_tolerance, v_tolerance_value
  );
  return v_id;
end;
$fn$;

revoke all on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid,
  jsonb, uuid, text, text, text[], text
) from public, anon, authenticated;
grant execute on function public.admin_create_question(
  uuid, text, jsonb, smallint, text, text, boolean, uuid, text, uuid,
  jsonb, uuid, text, text, text[], text
) to authenticated;


-- --- Manual Practice Test question management ------------------------------

-- Order changes are available only through the definer RPCs below. There is
-- deliberately no client UPDATE grant, while this policy keeps FORCE RLS
-- compatible with those admin-authenticated calls.
drop policy if exists practice_test_questions_update_admin
  on public.practice_test_questions;
create policy practice_test_questions_update_admin
  on public.practice_test_questions for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace view public.admin_practice_test_questions
with (security_barrier = true)
as
select link.practice_test_id,
       link.module_number,
       link.order_index,
       q.*
  from public.practice_test_questions link
  join public.admin_questions q on q.id = link.question_id
 where public.is_admin();

revoke all on table public.admin_practice_test_questions from anon, authenticated;
grant select on table public.admin_practice_test_questions to authenticated;

create or replace function public.admin_create_practice_test_question(
  p_test_id uuid,
  p_module_number smallint,
  p_subtopic_id uuid,
  p_prompt text,
  p_choices jsonb,
  p_correct_choice smallint,
  p_explanation text,
  p_difficulty text,
  p_is_active boolean,
  p_solution_video_id uuid default null,
  p_content_blocks jsonb default null,
  p_question_id uuid default null,
  p_question_type text default 'multiple_choice',
  p_spr_answer_mode text default null,
  p_spr_answers text[] default null,
  p_spr_tolerance text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_module_count integer;
  v_position smallint;
  v_question_id uuid;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select t.module_count into v_module_count
    from public.practice_tests t where t.id = p_test_id for update;
  if not found then raise exception 'unknown_test'; end if;
  if p_module_number not in (1, 2)
     or p_module_number > v_module_count then raise exception 'invalid_module'; end if;

  select candidate.slot::smallint into v_position
    from generate_series(
      1, public.sat_module_question_count()
    ) as candidate(slot)
   where not exists (
     select 1 from public.practice_test_questions link
      where link.practice_test_id = p_test_id
        and link.module_number = p_module_number
        and link.order_index = candidate.slot
   )
   order by candidate.slot
   limit 1;
  if not found then raise exception 'module_full'; end if;

  v_question_id := public.admin_create_question(
    p_subtopic_id, p_prompt, p_choices, p_correct_choice, p_explanation,
    p_difficulty, p_is_active, null, null, p_solution_video_id,
    p_content_blocks, p_question_id, p_question_type, p_spr_answer_mode,
    p_spr_answers, p_spr_tolerance
  );

  insert into public.practice_test_questions (
    practice_test_id, question_id, module_number, order_index
  ) values (p_test_id, v_question_id, p_module_number, v_position);
  return v_question_id;
end;
$fn$;

revoke all on function public.admin_create_practice_test_question(
  uuid, smallint, uuid, text, jsonb, smallint, text, text, boolean, uuid,
  jsonb, uuid, text, text, text[], text
) from public, anon, authenticated;
grant execute on function public.admin_create_practice_test_question(
  uuid, smallint, uuid, text, jsonb, smallint, text, text, boolean, uuid,
  jsonb, uuid, text, text, text[], text
) to authenticated;

create or replace function public.admin_remove_practice_test_question(
  p_test_id uuid,
  p_question_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_changed integer;
  v_module smallint;
  v_position smallint;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select link.module_number, link.order_index into v_module, v_position
    from public.practice_test_questions link
   where link.practice_test_id = p_test_id and link.question_id = p_question_id
   for update;
  if not found then return false; end if;

  delete from public.practice_test_questions link
   where link.practice_test_id = p_test_id and link.question_id = p_question_id;
  get diagnostics v_changed = row_count;

  -- Removing content immediately unpublishes the test. It can be restored
  -- after the module is full again; existing attempt history remains intact.
  update public.practice_tests test
     set is_active = false
   where test.id = p_test_id and test.is_active;

  update public.practice_test_questions link
     set order_index = -link.order_index
   where link.practice_test_id = p_test_id
     and link.module_number = v_module
     and link.order_index > v_position;
  update public.practice_test_questions link
     set order_index = -link.order_index - 1
   where link.practice_test_id = p_test_id
     and link.module_number = v_module
     and link.order_index < 0;
  return v_changed = 1;
end;
$fn$;

revoke all on function public.admin_remove_practice_test_question(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_remove_practice_test_question(uuid, uuid)
  to authenticated;

create or replace function public.admin_move_practice_test_question(
  p_test_id uuid,
  p_question_id uuid,
  p_direction text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_current record;
  v_other record;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_direction not in ('up', 'down') then raise exception 'invalid_direction'; end if;

  select link.module_number, link.order_index into v_current
    from public.practice_test_questions link
   where link.practice_test_id = p_test_id and link.question_id = p_question_id
   for update;
  if not found then return false; end if;

  if p_direction = 'up' then
    select link.question_id, link.order_index into v_other
      from public.practice_test_questions link
     where link.practice_test_id = p_test_id
       and link.module_number = v_current.module_number
       and link.order_index < v_current.order_index
     order by link.order_index desc limit 1 for update;
  else
    select link.question_id, link.order_index into v_other
      from public.practice_test_questions link
     where link.practice_test_id = p_test_id
       and link.module_number = v_current.module_number
       and link.order_index > v_current.order_index
     order by link.order_index limit 1 for update;
  end if;
  if not found then return false; end if;

  update public.practice_test_questions
     set order_index = -32768
   where practice_test_id = p_test_id and question_id = p_question_id;
  update public.practice_test_questions
     set order_index = v_current.order_index
   where practice_test_id = p_test_id and question_id = v_other.question_id;
  update public.practice_test_questions
     set order_index = v_other.order_index
   where practice_test_id = p_test_id and question_id = p_question_id;
  return true;
end;
$fn$;

revoke all on function public.admin_move_practice_test_question(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_move_practice_test_question(uuid, uuid, text)
  to authenticated;


-- --- Reports ---------------------------------------------------------------

update public.question_reports report
   set question_snapshot = report.question_snapshot || jsonb_build_object(
     'question_type', 'multiple_choice',
     'spr_answers', null,
     'spr_answer_mode', null,
     'spr_tolerance', null
   )
 where not (report.question_snapshot ? 'question_type');

alter table public.question_reports drop constraint if exists question_reports_snapshot_shape;
alter table public.question_reports add constraint question_reports_snapshot_shape check (
  jsonb_typeof(question_snapshot) = 'object'
  and question_snapshot ? 'prompt'
  and question_snapshot ? 'question_type'
  and question_snapshot ? 'choices'
  and question_snapshot ? 'correct_choice'
  and question_snapshot ? 'spr_answers'
);

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
  if p_request_id is null or p_question_id is null then raise exception 'invalid_report'; end if;
  if p_reason not in ('incorrect', 'unclear_or_broken') then raise exception 'invalid_reason'; end if;
  if v_details is not null and char_length(v_details) > 1000 then
    raise exception 'details_too_long';
  end if;

  select jsonb_build_object(
           'prompt', q.prompt,
           'content_blocks', q.content_blocks,
           'question_type', q.question_type,
           'choices', q.choices,
           'correct_choice', q.correct_choice,
           'spr_answer_mode', q.spr_answer_mode,
           'spr_answers', q.spr_answers,
           'spr_tolerance', q.spr_tolerance
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
       q.content_blocks as current_content_blocks,
       q.question_type as current_question_type,
       q.spr_answer_mode as current_spr_answer_mode,
       q.spr_answers as current_spr_answers,
       q.spr_tolerance as current_spr_tolerance
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


-- --- Analytics snapshots --------------------------------------------------

alter table public.analytics_events
  add column if not exists question_type text;

update public.analytics_events event
   set question_type = q.question_type
  from public.questions q
 where q.id = event.question_id and event.question_type is null;

create index if not exists analytics_events_question_type_idx
  on public.analytics_events (question_type, occurred_at desc)
  where question_type is not null;

create or replace function public.set_analytics_event_question_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.question_id is not null then
    select q.question_type into new.question_type
      from public.questions q where q.id = new.question_id;
  end if;
  return new;
end;
$fn$;

revoke all on function public.set_analytics_event_question_type()
  from public, anon, authenticated;

drop trigger if exists analytics_events_set_question_type on public.analytics_events;
create trigger analytics_events_set_question_type
  before insert or update of question_id on public.analytics_events
  for each row execute function public.set_analytics_event_question_type();

create or replace function public.admin_spr_answer_distribution(
  p_question_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default now()
)
returns table (answer text, is_correct boolean, answer_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query
    with answers as (
      select qa.student_answer, qa.is_correct
        from public.question_attempts qa
       where qa.question_id = p_question_id
         and qa.question_type = 'student_produced_response'
         and not exists (
           select 1 from public.admin_users admin where admin.user_id = qa.user_id
         )
         and qa.attempted_at >= coalesce(p_from, '1970-01-01'::timestamptz)
         and qa.attempted_at < coalesce(p_to, now())
      union all
      select response.student_answer, response.is_correct
        from public.practice_test_responses response
        join public.practice_test_attempts pta
          on pta.id = response.practice_test_attempt_id
       where response.question_id = p_question_id
         and response.question_type = 'student_produced_response'
         and not exists (
           select 1 from public.admin_users admin where admin.user_id = pta.user_id
         )
         and response.answered_at >= coalesce(p_from, '1970-01-01'::timestamptz)
         and response.answered_at < coalesce(p_to, now())
    )
    select public.normalize_numeric_answer(answers.student_answer),
           answers.is_correct,
           count(*)
      from answers
     where answers.student_answer is not null
     group by public.normalize_numeric_answer(answers.student_answer),
              answers.is_correct
     order by count(*) desc, public.normalize_numeric_answer(answers.student_answer);
end;
$fn$;

revoke all on function public.admin_spr_answer_distribution(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_spr_answer_distribution(uuid, timestamptz, timestamptz)
  to authenticated;


-- --- Remove JSON-only database entry points -------------------------------

drop function if exists public.admin_import_question_set(jsonb);
drop function if exists public.admin_import_question_set_without_content_blocks(jsonb);
drop function if exists public.admin_import_practice_test(uuid, jsonb);
drop function if exists public.admin_import_practice_test_without_content_blocks(uuid, jsonb);

-- These insert policies existed solely for the removed definer import RPCs.
-- Normal question creation still uses questions_insert_admin; fixed skills
-- and optional set metadata have no client-side creation path.
drop policy if exists question_sets_insert_admin on public.question_sets;
drop policy if exists subtopics_insert_admin on public.subtopics;

comment on table public.question_sets is
  'Optional grouping metadata retained for existing and manually authored questions.';
comment on column public.questions.external_id is
  'Optional admin-controlled identity unique within a question set.';
