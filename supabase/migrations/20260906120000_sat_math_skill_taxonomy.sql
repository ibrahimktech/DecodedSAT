-- ============================================================================
-- SAT-aligned Math skill taxonomy
--
-- `subtopics` is already the normalized, FK-backed skill table in this
-- project. Renaming the physical table/foreign key would add risk without
-- adding normalization, so they stay in place as compatibility names.
-- Existing stable ids are reused for the closest canonical skills; seven new
-- rows complete the 19-skill taxonomy.
--
-- The only question column changed below is `subtopic_id`. Question ids,
-- authored content, answer keys, difficulty, active state, set membership,
-- exact video links, attempts, reports, test membership and analytics events
-- are guarded by a before/after fingerprint and count assertions.
-- ============================================================================


-- --- Guard the data that categorization must not mutate --------------------

drop table if exists pg_temp._taxonomy_migration_guard;
create temporary table _taxonomy_migration_guard as
select
  (select count(*) from public.questions) as question_count,
  (select count(*) from public.question_attempts) as question_attempt_count,
  (select count(*) from public.question_reports) as question_report_count,
  (select count(*) from public.practice_section_questions) as section_link_count,
  (select count(*) from public.practice_test_questions) as test_link_count,
  (select count(*) from public.practice_test_responses) as test_response_count,
  (select count(*) from public.math_migration_questions) as math_migration_question_count,
  (select count(*) from public.math_migration_log) as math_migration_log_count,
  (select count(*) from public.analytics_events) as analytics_event_count,
  (select count(*) from public.videos) as video_count,
  (
    select md5(coalesce(string_agg(
      md5(jsonb_build_object(
        'id', q.id,
        'prompt', q.prompt,
        'content_blocks', q.content_blocks,
        'choices', q.choices,
        'correct_choice', q.correct_choice,
        'explanation', q.explanation,
        'difficulty', q.difficulty,
        'is_active', q.is_active,
        'question_set_id', q.question_set_id,
        'external_id', q.external_id,
        'solution_video_id', q.solution_video_id
      )::text), '' order by q.id), ''))
    from public.questions q
  ) as protected_question_fingerprint;


-- --- Keep the existing skill table, add production lifecycle metadata ------

alter table public.subtopics
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_taxonomy_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists subtopics_set_updated_at on public.subtopics;
create trigger subtopics_set_updated_at
before update on public.subtopics
for each row execute function public.set_taxonomy_updated_at();

update public.domains
   set name = case id
     when '10000000-0000-4000-8000-000000000003' then 'Problem-Solving and Data Analysis'
     when '10000000-0000-4000-8000-000000000004' then 'Geometry and Trigonometry'
     else name
   end
 where id in (
   '10000000-0000-4000-8000-000000000003',
   '10000000-0000-4000-8000-000000000004'
 );

insert into public.subtopics (id, domain_id, slug, name, position, active)
values
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'solving-linear-equations',               'Solving linear equations',                   1, true),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', 'understanding-linear-functions',          'Understanding linear functions',             2, true),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 'graphing-linear-equations',               'Graphing linear equations',                  3, true),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'solving-systems-of-linear-equations',     'Solving systems of linear equations',        4, true),
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', 'working-with-linear-inequalities',         'Working with linear inequalities',           5, true),
  ('20000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000002', 'understanding-nonlinear-functions',       'Understanding nonlinear functions',          1, true),
  ('20000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000002', 'solving-nonlinear-equations-and-systems', 'Solving nonlinear equations and systems',    2, true),
  ('20000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000002', 'rewriting-and-simplifying-expressions',   'Rewriting and simplifying expressions',      3, true),
  ('20000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000003', 'ratios-rates-and-unit-conversions',       'Ratios, rates, and unit conversions',        1, true),
  ('20000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000003', 'percent-problems',                        'Percent problems',                           2, true),
  ('20000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000003', 'data-distributions-and-averages',         'Data distributions and averages',            3, true),
  ('20000000-0000-4000-8000-000000000034', '10000000-0000-4000-8000-000000000003', 'scatterplots-and-data-models',            'Scatterplots and data models',               4, true),
  ('20000000-0000-4000-8000-000000000035', '10000000-0000-4000-8000-000000000003', 'probability',                             'Probability',                                5, true),
  ('20000000-0000-4000-8000-000000000036', '10000000-0000-4000-8000-000000000003', 'statistical-estimates-and-margin-of-error','Statistical estimates and margin of error',  6, true),
  ('20000000-0000-4000-8000-000000000037', '10000000-0000-4000-8000-000000000003', 'evaluating-surveys-and-experiments',      'Evaluating surveys and experiments',         7, true),
  ('20000000-0000-4000-8000-000000000044', '10000000-0000-4000-8000-000000000004', 'area-surface-area-and-volume',            'Area, surface area, and volume',              1, true),
  ('20000000-0000-4000-8000-000000000041', '10000000-0000-4000-8000-000000000004', 'lines-angles-and-triangles',              'Lines, angles, and triangles',                2, true),
  ('20000000-0000-4000-8000-000000000043', '10000000-0000-4000-8000-000000000004', 'right-triangles-and-trigonometry',        'Right triangles and trigonometry',            3, true),
  ('20000000-0000-4000-8000-000000000042', '10000000-0000-4000-8000-000000000004', 'circle-geometry',                         'Circle geometry',                             4, true)
on conflict (id) do update
set domain_id = excluded.domain_id,
    slug = excluded.slug,
    name = excluded.name,
    position = excluded.position,
    active = true;


-- --- Legacy slugs remain valid bookmarks/import aliases -------------------

create table if not exists public.subtopic_slug_aliases (
  alias_slug  text primary key,
  subtopic_id uuid not null references public.subtopics (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint subtopic_slug_aliases_slug_shape
    check (alias_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

insert into public.subtopic_slug_aliases (alias_slug, subtopic_id)
values
  ('linear-equations',          '20000000-0000-4000-8000-000000000011'),
  ('systems-of-equations',      '20000000-0000-4000-8000-000000000012'),
  ('linear-functions-graphs',   '20000000-0000-4000-8000-000000000013'),
  ('quadratics',                '20000000-0000-4000-8000-000000000021'),
  ('exponents-radicals',        '20000000-0000-4000-8000-000000000022'),
  ('functions-transformations', '20000000-0000-4000-8000-000000000023'),
  ('ratios-proportions',        '20000000-0000-4000-8000-000000000031'),
  ('percentages',               '20000000-0000-4000-8000-000000000032'),
  ('statistics',                '20000000-0000-4000-8000-000000000033'),
  ('triangles',                 '20000000-0000-4000-8000-000000000041'),
  ('circles',                   '20000000-0000-4000-8000-000000000042'),
  ('trigonometry',              '20000000-0000-4000-8000-000000000043')
on conflict (alias_slug) do update set subtopic_id = excluded.subtopic_id;

alter table public.subtopic_slug_aliases enable row level security;
alter table public.subtopic_slug_aliases force row level security;
revoke all on table public.subtopic_slug_aliases from anon, authenticated;
grant select on table public.subtopic_slug_aliases to authenticated;

drop policy if exists subtopic_slug_aliases_select_authenticated
  on public.subtopic_slug_aliases;
create policy subtopic_slug_aliases_select_authenticated
  on public.subtopic_slug_aliases for select to authenticated
  using (exists (
    select 1 from public.subtopics s
     where s.id = subtopic_id and s.active
  ));

drop policy if exists subtopics_select_authenticated on public.subtopics;
create policy subtopics_select_authenticated
  on public.subtopics for select to authenticated
  using (active or public.is_admin());

grant update (domain_id, slug, name, position, active)
  on table public.subtopics to authenticated;
drop policy if exists subtopics_update_admin on public.subtopics;
create policy subtopics_update_admin
  on public.subtopics for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Imports retain the legacy JSON property but cannot manufacture a twentieth
-- student-facing skill. The migration/seed owns the canonical row set.
drop policy if exists subtopics_insert_admin on public.subtopics;
create policy subtopics_insert_admin
  on public.subtopics for insert to authenticated
  with check (
    public.is_admin()
    and id in (
      '20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000014',
      '20000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000012',
      '20000000-0000-4000-8000-000000000015', '20000000-0000-4000-8000-000000000023',
      '20000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000022',
      '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000032',
      '20000000-0000-4000-8000-000000000033', '20000000-0000-4000-8000-000000000034',
      '20000000-0000-4000-8000-000000000035', '20000000-0000-4000-8000-000000000036',
      '20000000-0000-4000-8000-000000000037', '20000000-0000-4000-8000-000000000044',
      '20000000-0000-4000-8000-000000000041', '20000000-0000-4000-8000-000000000043',
      '20000000-0000-4000-8000-000000000042'
    )
  );

create or replace function public.require_active_question_skill()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from public.subtopics s
     where s.id = new.subtopic_id and s.active
  ) then
    raise exception 'unknown_or_inactive_skill';
  end if;
  return new;
end;
$fn$;

drop trigger if exists questions_require_active_skill on public.questions;
create trigger questions_require_active_skill
before insert or update of subtopic_id on public.questions
for each row execute function public.require_active_question_skill();

create or replace function public.require_active_video_skill()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.subtopic_id is not null and not exists (
    select 1 from public.subtopics s
     where s.id = new.subtopic_id and s.active
  ) then
    raise exception 'unknown_or_inactive_skill';
  end if;
  return new;
end;
$fn$;

drop trigger if exists videos_require_active_skill on public.videos;
create trigger videos_require_active_skill
before insert or update of subtopic_id on public.videos
for each row execute function public.require_active_video_skill();


-- --- Durable classification report and review state -----------------------

create table if not exists public.question_skill_migration_reviews (
  question_id             uuid primary key references public.questions (id) on delete cascade,
  old_domain_name         text not null,
  old_subtopic_id         uuid not null references public.subtopics (id),
  old_subtopic_name       text not null,
  old_subtopic_slug       text not null,
  suggested_subtopic_id   uuid references public.subtopics (id),
  confidence              text not null check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  reason                  text not null,
  status                  text not null default 'applied'
                          check (status in ('applied', 'pending', 'accepted', 'changed')),
  applied_at              timestamptz,
  reviewed_at             timestamptz,
  reviewed_by             uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists question_skill_reviews_status_idx
  on public.question_skill_migration_reviews (status, confidence);
create index if not exists question_skill_reviews_suggestion_idx
  on public.question_skill_migration_reviews (suggested_subtopic_id);

drop trigger if exists question_skill_reviews_set_updated_at
  on public.question_skill_migration_reviews;
create trigger question_skill_reviews_set_updated_at
before update on public.question_skill_migration_reviews
for each row execute function public.set_taxonomy_updated_at();

alter table public.question_skill_migration_reviews enable row level security;
alter table public.question_skill_migration_reviews force row level security;
revoke all on table public.question_skill_migration_reviews from anon, authenticated;
grant select, update (suggested_subtopic_id, status, reviewed_at, reviewed_by)
  on table public.question_skill_migration_reviews to authenticated;

drop policy if exists question_skill_reviews_select_admin
  on public.question_skill_migration_reviews;
create policy question_skill_reviews_select_admin
  on public.question_skill_migration_reviews for select to authenticated
  using (public.is_admin());

drop policy if exists question_skill_reviews_update_admin
  on public.question_skill_migration_reviews;
create policy question_skill_reviews_update_admin
  on public.question_skill_migration_reviews for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- --- Classify the current inventory ---------------------------------------
--
-- Defaults cover questions whose actual task was verified to match the old
-- category. UUID exception sets are the questions whose required solving
-- skill differs from, or splits, that old category. They are explicit so a
-- future question is never silently classified by a keyword rule.

with classified as (
  select q.id as question_id,
         q.subtopic_id as old_subtopic_id,
         case d.id
           when '10000000-0000-4000-8000-000000000003' then 'Problem-Solving & Data Analysis'
           when '10000000-0000-4000-8000-000000000004' then 'Geometry & Trigonometry'
           else d.name
         end as old_domain_name,
         case q.subtopic_id
           when '20000000-0000-4000-8000-000000000011' then 'Linear equations in one variable'
           when '20000000-0000-4000-8000-000000000012' then 'Systems of linear equations'
           when '20000000-0000-4000-8000-000000000013' then 'Linear functions & graphs'
           when '20000000-0000-4000-8000-000000000021' then 'Quadratics & parabolas'
           when '20000000-0000-4000-8000-000000000022' then 'Exponents & radicals'
           when '20000000-0000-4000-8000-000000000023' then 'Function notation & transformations'
           when '20000000-0000-4000-8000-000000000031' then 'Ratios, rates & proportions'
           when '20000000-0000-4000-8000-000000000032' then 'Percentages'
           when '20000000-0000-4000-8000-000000000033' then 'Mean, median & spread'
           when '20000000-0000-4000-8000-000000000041' then 'Triangle properties'
           when '20000000-0000-4000-8000-000000000042' then 'Circles: area, circumference & arcs'
           when '20000000-0000-4000-8000-000000000043' then 'Right-triangle trigonometry'
           else s.name
         end as old_subtopic_name,
         case q.subtopic_id
           when '20000000-0000-4000-8000-000000000011' then 'linear-equations'
           when '20000000-0000-4000-8000-000000000012' then 'systems-of-equations'
           when '20000000-0000-4000-8000-000000000013' then 'linear-functions-graphs'
           when '20000000-0000-4000-8000-000000000021' then 'quadratics'
           when '20000000-0000-4000-8000-000000000022' then 'exponents-radicals'
           when '20000000-0000-4000-8000-000000000023' then 'functions-transformations'
           when '20000000-0000-4000-8000-000000000031' then 'ratios-proportions'
           when '20000000-0000-4000-8000-000000000032' then 'percentages'
           when '20000000-0000-4000-8000-000000000033' then 'statistics'
           when '20000000-0000-4000-8000-000000000041' then 'triangles'
           when '20000000-0000-4000-8000-000000000042' then 'circles'
           when '20000000-0000-4000-8000-000000000043' then 'trigonometry'
           else s.slug
         end as old_subtopic_slug,
         case
           when q.id = any (array[
             '3e04216e-e228-4416-b89d-68888e2bf746', '527deb6a-9642-4a4f-b6b2-92a11cf0d2d0',
             '53dee0fc-d404-4112-99cf-6f52eadf7944', '6938db65-c31b-43eb-80ec-5537d596326b',
             '909a8a74-b916-44a0-84e3-77ef76ed81e1', 'd3ab5de9-9997-40d3-aa43-6ef5d141e714',
             'dae99bdb-16a0-415a-8c09-ee571f676d43'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000014'::uuid
           when q.id = '9389d822-0fc1-4663-b25c-6ef256de3d2e' then '20000000-0000-4000-8000-000000000013'::uuid
           when q.id = any (array[
             '537d654c-89e1-460c-a6bc-9c57f22bcd27', 'd0c2ca24-c978-4bf2-a81f-e2ad3ebdd952',
             'd6e4ece2-06fe-46f9-bee7-de0f11cb713d'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000012'::uuid
           when q.id = any (array[
             '9dc6c92c-bf5d-451f-8c9e-34c2c762444c', 'a706b0e0-adf2-41e6-8f00-c470a43179ac',
             '0c8ba2b0-fb06-4f65-9323-16a3deb178b5'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000015'::uuid
           when q.id = any (array[
             '020e0a00-7cd9-4ed4-bf86-52b2603a8e79', '0728296b-e3cf-4368-acc7-eeb4eec5a127',
             '1156da08-1414-47a3-b60b-dfad0304e72f', '1ff9cf5f-d2b0-40d5-a0be-bdbbaad93801',
             '4c1ef8ce-c0b2-4470-b815-f611e1acc2d3', '5acb4fce-f4dd-433e-a22f-959ed2250ac1',
             '65481abd-155a-44f9-8ad2-62b3c925ea4b', '7257db2b-c788-45ee-b0a4-dcd3fb004896',
             '96e52a67-4eef-4d33-985c-924de24f5f97', '9a51c04e-21fa-4b6f-ba0e-1d63d2314c63',
             'd2e9234a-e870-41a3-bcac-94e0208b88b2', 'd398b253-dc1d-48b1-b9b2-a3fb69202c36',
             'daab0574-f2ee-421d-8f0d-8c8361df2f41', 'f7bb3d9e-ab52-4abc-93c1-95870d05f9a5',
             'd460be7d-2d98-4448-b96e-db41267f3b96', 'f5025841-51b9-4f1d-a0a5-d44538c83181'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000023'::uuid
           when q.id = any (array[
             '2df96cde-855c-4b46-ab0b-4129dd6549da', '314181fe-fa9a-49a5-b4fc-b9e7b5ac97f0',
             '3373e7fb-21f4-41ac-a572-6087969feaea', '61fa1715-bdf8-43bd-a52e-27b5ad262fa4',
             'bc93645f-c1f8-494e-9bf2-9015904dda20', '611270ff-3727-41fa-a30c-98ec68d3f9fa',
             'f61afa6c-9f14-4f60-ba21-bd673616a2bb', '071e92f9-156e-4ada-9b2b-c9140297859d',
             '18e734d5-7b84-48a0-8294-7a7dd9870e3c', '1bd32b8f-d883-4c92-9bff-1f26b3c3bd12',
             '2ccdb92d-11c4-4df5-98c2-225d65c72716', '30af7e54-ef22-4373-b694-42ebd5442f08',
             '5a582b6f-68e8-4edc-ad1e-3d977271c90d', '664fdc28-a606-4d0d-9e74-6518527f8747',
             '6f7bad19-f989-4bd8-a0a3-fa0e2ca0091f', '8a9bc185-56b9-4827-8ad0-e705c70cb76f',
             '8b784254-eda5-4220-83a7-27000b75f859', '95c62ff0-232c-4ca1-9da9-0820e36a311c',
             'b4514dd4-567a-4e9b-929a-202f5528a545', 'b712079c-4bfb-4fa6-88fa-add24cd0c24e',
             'bc12f050-5c99-466a-b959-66b8c02a908c', 'c0d8eeef-c574-4116-8484-0308bc780e02',
             'cc1d2ce0-28ff-4c80-89d0-468d1823257c', 'd1e692ea-17e6-467e-a83e-4c30739136b4',
             'd360f664-e561-40ab-ba69-799fa483d05d', 'e1326b2c-2cf2-4ba6-814c-e2ce4e36aaf2',
             'e7eebdbc-4735-41e9-bd09-72ab8ed318aa', 'f94262a9-186d-44b3-b285-868f53812e80',
             '0cb61697-3907-4d9c-b250-5dad9389df7e', 'd778ef8e-a5ae-45ed-b9fd-1c0a84cde35c',
             'edb5e04c-5033-4d4b-8f0d-7e0acee280e7'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000021'::uuid
           when q.id = any (array[
             'c1dfcee9-449c-4849-9617-f53dc94466e2', 'ddb10cae-d314-4aed-b0c8-3c436f27cd55',
             '1e318f31-1a60-4cfd-b168-fa3069d12bd7', '25b212d0-59ab-4ec9-a862-2eed69211e27',
             '593d9374-0e7e-43a7-bbc8-af9ca24f8ba6'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000022'::uuid
           when q.id = any (array[
             '4a9d46d6-4421-4df0-ab45-b4c85729eb4c', 'ff45b453-2cbc-4bf3-b28a-2279d7aeb0ad'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000031'::uuid
           when q.id = 'bd601174-04fb-4ab9-9495-b12ae22ecb18' then '20000000-0000-4000-8000-000000000032'::uuid
           when q.id = 'ecad13f5-48bb-4bc4-957a-2d63e56e3535' then '20000000-0000-4000-8000-000000000034'::uuid
           when q.id = any (array[
             '45607aea-c841-4524-8e68-fe44a6d37f99', 'acfc70d5-12f9-4ffa-8b35-89832c9ee51f'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000035'::uuid
           when q.id = '5ebfe23c-dbb5-4f0a-92ec-893ad8d8839c' then '20000000-0000-4000-8000-000000000036'::uuid
           when q.id = any (array[
             '1f6f55e2-ac05-4d34-834b-2b068c54a27b', '68146850-1a06-47c6-9765-6a3ec9079def',
             '741b0285-d995-4751-a7e7-d1684c939307', '7798ea33-5119-4056-8286-31eb57e08890',
             'b6d2f077-1818-4af0-830b-b7dec0de8c95', 'b9588d85-5493-4839-ae98-3e96f7e78f97',
             'e0d0060b-0a25-4114-97a0-04f37428938e', 'f6492062-7738-45a0-9188-fb89dc9ac741'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000044'::uuid
           when q.id = any (array[
             '76d727fb-71c0-4870-bfe6-6ddb674c93ec', '8306f247-b9fc-41c3-a4be-ca3efa4339aa',
             '9a75200f-afad-4f5a-b359-422815af6f21', 'aac5cb65-0c8a-4c38-8ace-3f9d80a41918',
             'b1d230af-eeee-4736-9be4-8b42c5985d35', 'b3c6b477-bb9c-45a1-aa36-697e53106c94',
             'ba900eed-55e4-4bd4-9a08-5d8edf3fc3ed', 'f0f0ba80-b3d4-4db8-9f77-11f1f325414e',
             'f7dc559b-abd8-420d-85df-78677343cdf2'
           ]::uuid[]) then '20000000-0000-4000-8000-000000000043'::uuid
           else case q.subtopic_id
             when '20000000-0000-4000-8000-000000000011' then '20000000-0000-4000-8000-000000000011'::uuid
             when '20000000-0000-4000-8000-000000000012' then '20000000-0000-4000-8000-000000000012'::uuid
             when '20000000-0000-4000-8000-000000000013' then '20000000-0000-4000-8000-000000000013'::uuid
             when '20000000-0000-4000-8000-000000000021' then '20000000-0000-4000-8000-000000000021'::uuid
             when '20000000-0000-4000-8000-000000000022' then '20000000-0000-4000-8000-000000000022'::uuid
             when '20000000-0000-4000-8000-000000000023' then '20000000-0000-4000-8000-000000000023'::uuid
             when '20000000-0000-4000-8000-000000000031' then '20000000-0000-4000-8000-000000000031'::uuid
             when '20000000-0000-4000-8000-000000000032' then '20000000-0000-4000-8000-000000000032'::uuid
             when '20000000-0000-4000-8000-000000000033' then '20000000-0000-4000-8000-000000000033'::uuid
             when '20000000-0000-4000-8000-000000000041' then '20000000-0000-4000-8000-000000000041'::uuid
             when '20000000-0000-4000-8000-000000000042' then '20000000-0000-4000-8000-000000000042'::uuid
             when '20000000-0000-4000-8000-000000000043' then '20000000-0000-4000-8000-000000000043'::uuid
             else null
           end
         end as suggested_subtopic_id,
         case
           when q.id = any (array[
             '4a9d46d6-4421-4df0-ab45-b4c85729eb4c', 'ff45b453-2cbc-4bf3-b28a-2279d7aeb0ad',
             'bd601174-04fb-4ab9-9495-b12ae22ecb18', '0c8ba2b0-fb06-4f65-9323-16a3deb178b5',
             '611270ff-3727-41fa-a30c-98ec68d3f9fa', 'a9a3d84e-0188-4a22-ae4a-6d882babe40a',
             'daab0574-f2ee-421d-8f0d-8c8361df2f41', 'f61afa6c-9f14-4f60-ba21-bd673616a2bb',
             'd398b253-dc1d-48b1-b9b2-a3fb69202c36', '1e318f31-1a60-4cfd-b168-fa3069d12bd7',
             'edb5e04c-5033-4d4b-8f0d-7e0acee280e7', '5d99c711-b9b5-4261-886a-87920b7ef45c',
             '76d727fb-71c0-4870-bfe6-6ddb674c93ec', 'b1d230af-eeee-4736-9be4-8b42c5985d35',
             'b3c6b477-bb9c-45a1-aa36-697e53106c94', 'f7dc559b-abd8-420d-85df-78677343cdf2',
             'f5025841-51b9-4f1d-a0a5-d44538c83181'
           ]::uuid[]) then 'MEDIUM'
           when q.subtopic_id in (
             '20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000012',
             '20000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000021',
             '20000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000023',
             '20000000-0000-4000-8000-000000000031', '20000000-0000-4000-8000-000000000032',
             '20000000-0000-4000-8000-000000000033', '20000000-0000-4000-8000-000000000041',
             '20000000-0000-4000-8000-000000000042', '20000000-0000-4000-8000-000000000043'
           ) then 'HIGH'
           else 'LOW'
         end as confidence
    from public.questions q
    join public.subtopics s on s.id = q.subtopic_id
    join public.domains d on d.id = s.domain_id
), explained as (
  select c.*,
         case
           when c.suggested_subtopic_id is null then
             'The question uses a noncanonical pre-migration skill and needs an admin decision.'
           when c.confidence = 'MEDIUM' then
             'The prompt combines more than one taxonomy area; the proposed skill is the primary operation used in the solution and should receive an admin sanity check.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000011' then
             'The solution primarily isolates a variable in a linear equation.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000014' then
             'The solution primarily evaluates or interprets a linear function or model.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000013' then
             'The solution primarily uses slope, intercepts, points, or a line equation.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000012' then
             'The solution primarily relates or solves two linear equations.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000015' then
             'The solution primarily solves or interprets linear inequalities.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000023' then
             'The solution primarily evaluates or interprets nonlinear function behavior.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000021' then
             'The solution primarily finds values satisfying a nonlinear equation or system.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000022' then
             'The solution primarily rewrites, factors, expands, or simplifies an expression.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000031' then
             'The solution primarily uses a ratio, rate, proportional relationship, or unit conversion.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000032' then
             'The solution primarily computes or applies a percentage or percent change.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000033' then
             'The solution primarily describes a distribution or calculates a measure of center or spread.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000034' then
             'The solution primarily interprets a data model, line of best fit, or residual.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000035' then
             'The solution primarily computes or interprets probability.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000036' then
             'The solution primarily reasons about sample size, an estimate, or margin of error.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000037' then
             'The solution primarily evaluates how a survey or experiment supports a claim.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000044' then
             'The solution primarily computes area, surface area, or volume.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000041' then
             'The solution primarily uses angle, line, similarity, or general triangle relationships.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000043' then
             'The solution primarily uses a right-triangle or trigonometric relationship.'
           when c.suggested_subtopic_id = '20000000-0000-4000-8000-000000000042' then
             'The solution primarily uses a circle theorem or circle measurement relationship.'
           else 'The prompt and solution were reviewed against the canonical taxonomy.'
         end as reason
    from classified c
)
insert into public.question_skill_migration_reviews (
  question_id, old_domain_name, old_subtopic_id, old_subtopic_name,
  old_subtopic_slug, suggested_subtopic_id, confidence, reason, status,
  applied_at
)
select e.question_id,
       e.old_domain_name,
       e.old_subtopic_id,
       e.old_subtopic_name,
       e.old_subtopic_slug,
       e.suggested_subtopic_id,
       e.confidence,
       e.reason,
       case when e.confidence = 'MEDIUM' then 'pending'
            when e.confidence = 'LOW' then 'pending'
            else 'applied' end,
       case when e.confidence in ('HIGH', 'MEDIUM') then now() else null end
  from explained e
on conflict (question_id) do nothing;

-- HIGH and MEDIUM proposals are applied. LOW rows are deliberately untouched.
update public.questions q
   set subtopic_id = r.suggested_subtopic_id
  from public.question_skill_migration_reviews r
 where r.question_id = q.id
   and r.confidence in ('HIGH', 'MEDIUM')
   and r.suggested_subtopic_id is not null
   and q.subtopic_id is distinct from r.suggested_subtopic_id;


-- --- Admin review RPC and read models -------------------------------------

create or replace function public.admin_resolve_question_skill_review(
  p_question_id uuid,
  p_subtopic_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_suggested uuid;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if not exists (
    select 1 from public.subtopics s
     where s.id = p_subtopic_id and s.active
  ) then raise exception 'unknown_or_inactive_skill'; end if;

  select r.suggested_subtopic_id into v_suggested
    from public.question_skill_migration_reviews r
   where r.question_id = p_question_id;

  if not found then return false; end if;

  update public.questions
     set subtopic_id = p_subtopic_id
   where id = p_question_id;

  update public.question_skill_migration_reviews
     set suggested_subtopic_id = p_subtopic_id,
         status = case when p_subtopic_id = v_suggested then 'accepted' else 'changed' end,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where question_id = p_question_id;

  return true;
end;
$fn$;

revoke all on function public.admin_resolve_question_skill_review(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_resolve_question_skill_review(uuid, uuid)
  to authenticated;

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
       q.content_blocks,
       s.active     as subtopic_active,
       review.confidence as skill_review_confidence,
       review.reason as skill_review_reason,
       review.status as skill_review_status,
       review.old_subtopic_name,
       review.suggested_subtopic_id
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

create or replace view public.admin_question_skill_migration_report
with (security_barrier = true)
as
select r.question_id,
       r.old_domain_name as old_domain,
       r.old_subtopic_name as old_skill,
       r.old_subtopic_slug as old_skill_slug,
       d.name as proposed_new_domain,
       s.name as proposed_new_skill,
       s.slug as proposed_new_skill_slug,
       r.confidence,
       r.reason,
       r.status,
       r.applied_at,
       r.reviewed_at,
       r.reviewed_by
  from public.question_skill_migration_reviews r
  left join public.subtopics s on s.id = r.suggested_subtopic_id
  left join public.domains d on d.id = s.domain_id
 where public.is_admin();

revoke all on table public.admin_question_skill_migration_report
  from anon, authenticated;
grant select on table public.admin_question_skill_migration_report
  to authenticated;


-- --- Transactional preservation assertions -------------------------------

do $guard$
declare
  before_row pg_temp._taxonomy_migration_guard%rowtype;
  after_fingerprint text;
begin
  select * into before_row from _taxonomy_migration_guard;

  if (select count(*) from public.questions) <> before_row.question_count
     or (select count(*) from public.question_attempts) <> before_row.question_attempt_count
     or (select count(*) from public.question_reports) <> before_row.question_report_count
     or (select count(*) from public.practice_section_questions) <> before_row.section_link_count
     or (select count(*) from public.practice_test_questions) <> before_row.test_link_count
     or (select count(*) from public.practice_test_responses) <> before_row.test_response_count
     or (select count(*) from public.math_migration_questions) <> before_row.math_migration_question_count
     or (select count(*) from public.math_migration_log) <> before_row.math_migration_log_count
     or (select count(*) from public.analytics_events) <> before_row.analytics_event_count
     or (select count(*) from public.videos) <> before_row.video_count then
    raise exception 'taxonomy migration changed a protected row count';
  end if;

  select md5(coalesce(string_agg(
    md5(jsonb_build_object(
      'id', q.id,
      'prompt', q.prompt,
      'content_blocks', q.content_blocks,
      'choices', q.choices,
      'correct_choice', q.correct_choice,
      'explanation', q.explanation,
      'difficulty', q.difficulty,
      'is_active', q.is_active,
      'question_set_id', q.question_set_id,
      'external_id', q.external_id,
      'solution_video_id', q.solution_video_id
    )::text), '' order by q.id), ''))
    into after_fingerprint
    from public.questions q;

  if after_fingerprint is distinct from before_row.protected_question_fingerprint then
    raise exception 'taxonomy migration changed protected question data';
  end if;

  if exists (
    select 1
      from public.question_skill_migration_reviews r
     where r.confidence = 'LOW' and r.applied_at is not null
  ) then
    raise exception 'a LOW-confidence classification was applied';
  end if;
end;
$guard$;

drop table if exists pg_temp._taxonomy_migration_guard;
