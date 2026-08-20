-- ============================================================================
-- Content reset — wipe every question and everything that depends on one.
--
-- Run in the Supabase Dashboard SQL Editor. NOT part of the schema history, so
-- it deliberately does not live in `supabase/migrations/`. There is no undo.
--
-- ---------------------------------------------------------------------------
-- Read this before running it
-- ---------------------------------------------------------------------------
--
-- "Just the questions" is not a thing the database can do. Six tables carry a
-- foreign key to `questions`, all of them ON DELETE CASCADE, so the rows below
-- go whether or not this file mentions them:
--
--     question_attempts          every answer anyone has ever given
--     practice_section_questions which questions each step-4 drill contains
--     practice_test_questions    which questions each practice test contains
--     practice_test_responses    every answer inside a practice test
--     math_migration_questions   the LaTeX migration's guard table
--     math_migration_log         its before/after audit trail
--
-- That cascade then leaves a second problem, which is why section 2 exists:
-- the ATTEMPT rows survive it. A `question_bank_sessions` row would still
-- claim "10 questions, 7 correct" with no attempts left behind it, and a
-- `practice_test_attempts` row would still hold a score computed from
-- responses that no longer exist. Those counts are exactly the drift the rest
-- of the schema goes out of its way to prevent, and Progress would render
-- them as fact. So the activity history goes with the content.
--
-- ---------------------------------------------------------------------------
-- What survives
-- ---------------------------------------------------------------------------
--
--     domains, subtopics     the fixed SAT structure — untouched
--     profiles, user_stats   real accounts, and their onboarding answers
--     admin_users            your admin grant — you stay an admin
--     videos, video_categories   explainer library — unrelated to questions
--     practice_sections      the step-4 drill shells (now empty)
--     practice_tests         the test shells (now empty; see section 3)
--
-- Streak and mastery are computed from attempts at read time, never stored, so
-- they simply go to zero on their own. Nothing needs resetting for that.
-- ============================================================================


-- ============================================================================
-- 0. Look before you leap — run this FIRST, on its own
--
-- Uncomment and run to see exactly what is about to disappear. If the numbers
-- surprise you, stop.
-- ============================================================================

-- select 'questions'                as table_name, count(*) from public.questions
-- union all select 'question_sets',            count(*) from public.question_sets
-- union all select 'question_attempts',        count(*) from public.question_attempts
-- union all select 'question_bank_sessions',   count(*) from public.question_bank_sessions
-- union all select 'practice_attempts',        count(*) from public.practice_attempts
-- union all select 'practice_test_questions',  count(*) from public.practice_test_questions
-- union all select 'practice_test_attempts',   count(*) from public.practice_test_attempts
-- union all select 'practice_test_responses',  count(*) from public.practice_test_responses
-- union all select 'practice_tests (kept)',    count(*) from public.practice_tests
-- union all select 'videos (kept)',            count(*) from public.videos
-- union all select 'profiles (kept)',          count(*) from public.profiles;


-- ============================================================================
-- 1 + 2. The wipe
--
-- One TRUNCATE, because it is one transaction: either all of this happens or
-- none of it does. There is no window in which questions are gone but the
-- attempts that reference them are not.
--
-- `cascade` here is TRUNCATE's own cascade — it pulls in every table with a
-- foreign key pointing at these. The six cascaded tables are listed explicitly
-- anyway, so this statement is a complete description of what it does rather
-- than something you have to know the schema to predict.
-- ============================================================================

truncate table
  -- The content itself.
  public.questions,
  public.question_sets,

  -- Cascade targets, named rather than left implicit.
  public.question_attempts,
  public.practice_section_questions,
  public.practice_test_questions,
  public.practice_test_responses,
  public.math_migration_questions,
  public.math_migration_log,

  -- Activity that would otherwise survive holding stale, unbacked counts.
  public.question_bank_sessions,
  public.practice_attempts,
  public.practice_test_attempts
cascade;


-- ============================================================================
-- 3. Optional — also remove the empty practice test shells
--
-- After the wipe every practice test still EXISTS but has zero questions. The
-- admin list will show each one as "Needs questions", and students cannot
-- start one (the runner has nothing to serve).
--
-- Keep them if you plan to re-upload questions into the same tests — the
-- upload replaces a test's questions in place, so the test id, its title and
-- its URL all survive.
--
-- Uncomment to delete them instead and start from nothing.
-- ============================================================================

-- delete from public.practice_tests;


-- ============================================================================
-- 4. Confirm
--
--   -- All zero:
--   select 'questions' as t, count(*) from public.questions
--   union all select 'question_attempts',      count(*) from public.question_attempts
--   union all select 'question_bank_sessions', count(*) from public.question_bank_sessions
--   union all select 'practice_test_responses', count(*) from public.practice_test_responses;
--
--   -- Still there — you have not locked yourself out, and accounts are intact:
--   select 'admin_users' as t, count(*) from public.admin_users
--   union all select 'profiles', count(*) from public.profiles
--   union all select 'subtopics', count(*) from public.subtopics
--   union all select 'videos',    count(*) from public.videos;
--
-- Then upload fresh content at /admin/questions and /admin/practice-tests.
-- Author it per `sample-structure.json`: LaTeX between $...$, \frac not /,
-- \sqrt not sqrt(), \pi not pi, \cdot not *. Nothing converts it for you.
-- ============================================================================
