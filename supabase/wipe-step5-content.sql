-- ============================================================================
-- Step 5 one-time cleanup — hard wipe of the AI-generated placeholder content.
--
-- Run ONCE in the Supabase Dashboard SQL Editor, BEFORE the step 5 migration.
-- This file is deliberately NOT in `supabase/migrations/` — it is not part of
-- the schema's history, just a one-off deletion of seeded filler. There is no
-- undo; that is the point (no real user activity exists yet).
--
-- What goes: every question, video, practice section (and its question
-- junction rows), and every attempt row that referenced them.
--
-- What stays: `domains` and `subtopics` (real, fixed SAT structure),
-- `profiles` (real accounts), `user_stats` (per-profile row created by
-- trigger; holds no content), and `admin_users` if it already exists.
--
-- After this, real questions arrive through /admin/questions uploads and real
-- videos through /admin/videos. Practice sections stay empty until section
-- management gets its own admin pipeline in a later step — /practice shows
-- its empty state, which is honest, not broken.
-- ============================================================================

truncate table
  public.practice_attempts,
  public.question_attempts,
  public.practice_section_questions,
  public.practice_sections,
  public.questions,
  public.videos
cascade;
