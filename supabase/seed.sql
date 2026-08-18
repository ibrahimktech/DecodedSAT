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
-- admin panel's JSON upload, real videos through /admin/videos.
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
  ('10000000-0000-4000-8000-000000000003', 'problem-solving-data-analysis', 'Problem-Solving & Data Analysis', 3),
  ('10000000-0000-4000-8000-000000000004', 'geometry-trigonometry',         'Geometry & Trigonometry',          4)
on conflict (id) do update
  set slug = excluded.slug, name = excluded.name, position = excluded.position;


-- --- Subtopics ---------------------------------------------------------------
-- The admin upload can add more under a domain when `create_new_subtopics` is
-- true; those get generated ids and positions after these fixed ones.

insert into public.subtopics (id, domain_id, slug, name, position) values
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000001', 'linear-equations',          'Linear equations in one variable', 1),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'systems-of-equations',      'Systems of linear equations',      2),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000001', 'linear-functions-graphs',   'Linear functions & graphs',        3),
  ('20000000-0000-4000-8000-000000000021', '10000000-0000-4000-8000-000000000002', 'quadratics',                'Quadratics & parabolas',           1),
  ('20000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000002', 'exponents-radicals',        'Exponents & radicals',             2),
  ('20000000-0000-4000-8000-000000000023', '10000000-0000-4000-8000-000000000002', 'functions-transformations', 'Function notation & transformations', 3),
  ('20000000-0000-4000-8000-000000000031', '10000000-0000-4000-8000-000000000003', 'ratios-proportions',        'Ratios, rates & proportions',      1),
  ('20000000-0000-4000-8000-000000000032', '10000000-0000-4000-8000-000000000003', 'percentages',               'Percentages',                      2),
  ('20000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000003', 'statistics',                'Mean, median & spread',            3),
  ('20000000-0000-4000-8000-000000000041', '10000000-0000-4000-8000-000000000004', 'triangles',                 'Triangle properties',              1),
  ('20000000-0000-4000-8000-000000000042', '10000000-0000-4000-8000-000000000004', 'circles',                   'Circles: area, circumference & arcs', 2),
  ('20000000-0000-4000-8000-000000000043', '10000000-0000-4000-8000-000000000004', 'trigonometry',              'Right-triangle trigonometry',      3)
on conflict (id) do update
  set domain_id = excluded.domain_id, slug = excluded.slug,
      name = excluded.name, position = excluded.position;


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
