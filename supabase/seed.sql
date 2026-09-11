-- ============================================================================
-- Seed — the fixed SAT math structure, and nothing else.
--
-- Run AFTER the migrations, in the Supabase Dashboard SQL Editor (or
-- `supabase db reset` picks it up automatically). Idempotent: every insert
-- upserts on its fixed id, so re-running updates rows in place and never
-- duplicates.
--
-- As of step 5 this file seeds ONLY `domains` and `subtopics` — the real,
-- fixed structure of SAT math. The placeholder questions, videos and practice
-- sections that used to live here were wiped by `wipe-step5-content.sql` and
-- must not come back via a seed re-run: real questions arrive through the
-- admin question editor, real videos through /admin/videos.
--
-- Content ids are hand-written UUIDs with a readable scheme:
--
--   1xxxxxxx… domains       10000000-0000-4000-8000-00000000000D
--   2xxxxxxx… subtopics     20000000-0000-4000-8000-0000000000DS
--
--   (D = domain 1-4, S = subtopic 1-3)
-- ============================================================================


-- --- Domains (the four fixed SAT math domains) -------------------------------

insert into public.domains (id, slug, name, position) values
  ('10000000-0000-4000-8000-000000000001', 'algebra',                       'Algebra',                          1),
  ('10000000-0000-4000-8000-000000000002', 'advanced-math',                 'Advanced Math',                    2),
  ('10000000-0000-4000-8000-000000000003', 'problem-solving-data-analysis', 'Problem-Solving and Data Analysis', 3),
  ('10000000-0000-4000-8000-000000000004', 'geometry-trigonometry',         'Geometry and Trigonometry',          4)
on conflict (id) do update
  set slug = excluded.slug, name = excluded.name, position = excluded.position;


-- --- Subtopics ---------------------------------------------------------------
-- `subtopics` is the compatibility table name for the fixed student-facing
-- skills. Admin question editors select from these fixed canonical skills.

insert into public.subtopics (id, domain_id, slug, name, position) values
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'solving-linear-equations',               'Solving linear equations',                  1),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000001', 'understanding-linear-functions',          'Understanding linear functions',             2),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 'graphing-linear-equations',               'Graphing linear equations',                  3),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'solving-systems-of-linear-equations',     'Solving systems of linear equations',        4),
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000001', 'working-with-linear-inequalities',         'Working with linear inequalities',           5),
  ('20000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000002', 'understanding-nonlinear-functions',       'Understanding nonlinear functions',          1),
  ('20000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000002', 'solving-nonlinear-equations-and-systems', 'Solving nonlinear equations and systems',    2),
  ('20000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000002', 'rewriting-and-simplifying-expressions',   'Rewriting and simplifying expressions',      3),
  ('20000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000003', 'ratios-rates-and-unit-conversions',       'Ratios, rates, and unit conversions',        1),
  ('20000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000003', 'percent-problems',                        'Percent problems',                           2),
  ('20000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000003', 'data-distributions-and-averages',         'Data distributions and averages',            3),
  ('20000000-0000-4000-8000-000000000034', '10000000-0000-4000-8000-000000000003', 'scatterplots-and-data-models',            'Scatterplots and data models',               4),
  ('20000000-0000-4000-8000-000000000035', '10000000-0000-4000-8000-000000000003', 'probability',                             'Probability',                                5),
  ('20000000-0000-4000-8000-000000000036', '10000000-0000-4000-8000-000000000003', 'statistical-estimates-and-margin-of-error','Statistical estimates and margin of error', 6),
  ('20000000-0000-4000-8000-000000000037', '10000000-0000-4000-8000-000000000003', 'evaluating-surveys-and-experiments',      'Evaluating surveys and experiments',         7),
  ('20000000-0000-4000-8000-000000000044', '10000000-0000-4000-8000-000000000004', 'area-surface-area-and-volume',            'Area, surface area, and volume',              1),
  ('20000000-0000-4000-8000-000000000041', '10000000-0000-4000-8000-000000000004', 'lines-angles-and-triangles',              'Lines, angles, and triangles',                2),
  ('20000000-0000-4000-8000-000000000043', '10000000-0000-4000-8000-000000000004', 'right-triangles-and-trigonometry',        'Right triangles and trigonometry',            3),
  ('20000000-0000-4000-8000-000000000042', '10000000-0000-4000-8000-000000000004', 'circle-geometry',                         'Circle geometry',                             4)
on conflict (id) do update
  set domain_id = excluded.domain_id, slug = excluded.slug,
      name = excluded.name, position = excluded.position, active = true;


-- --- User stats placeholder --------------------------------------------------
-- The dashboard's score-estimate card reads `current_score_estimate` — the
-- real value will come from onboarding (a future step). Seeding a placeholder
-- lets the card render a real number end to end today.
--
-- `target_score` is deliberately left NULL: the card for it renders an empty
-- "set a target" state, and inventing a number would be fake data.

insert into public.user_stats (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

update public.user_stats
   set current_score_estimate = 540
 where current_score_estimate is null;
