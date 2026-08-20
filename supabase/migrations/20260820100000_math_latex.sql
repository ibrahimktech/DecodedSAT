-- ============================================================================
-- Step 7, part 2 — one-time math content migration: plain text to LaTeX.
--
-- Run this AFTER 20260820000000_step7_tests_sessions_progress.sql, once, in
-- the Supabase Dashboard SQL Editor.
--
-- It is idempotent twice over. `math_migration_questions` records every
-- question already processed and they are skipped wholesale; and
-- `to_latex_math()` itself refuses text that is already LaTeX, so content
-- uploaded after this ran (which the admin format requires be authored with
-- `$...$` already) survives a re-run untouched. See STEP 0 in the converter.
--
-- ---------------------------------------------------------------------------
-- Why this is a migration and not a Node script
-- ---------------------------------------------------------------------------
--
-- `questions.explanation` and `questions.correct_choice` are readable by NO
-- client role — step 4 hid them behind a column-scoped grant so the answer key
-- cannot be scraped. A Node script would therefore need the service role key,
-- and this project deliberately holds that key nowhere: not in the repo, not
-- in .env.example, not on the developer's machine. Introducing it to rewrite
-- some strings would be the single largest expansion of blast radius in the
-- codebase, in exchange for nothing this file cannot do.
--
-- ---------------------------------------------------------------------------
-- What it converts, and what it deliberately refuses to
-- ---------------------------------------------------------------------------
--
-- Converted (unambiguous):
--   x^2, x^-3, x^(n+1), (x+1)^2   ->  $x^{2}$, $x^{-3}$, ...
--   sqrt(x), sqrt(2x + 1)         ->  $\sqrt{x}$
--   √x                            ->  $\sqrt{x}$
--   π ≤ ≥ ± × ÷ ≠ ≈ ∞ °           ->  $\pi$ $\leq$ ...
--
-- NOT converted (ambiguous), reported instead:
--   bare a/b fractions. "increases by 3/4 of a percent" is prose; "3/4" in
--   "what is 3/4 of 20" is a fraction, and nothing in the string distinguishes
--   them. Blind-converting mangles the first kind silently, which is worse
--   than leaving both alone. `public.math_migration_review` lists every one so
--   they can be eyeballed and fixed by hand.
--
-- ---------------------------------------------------------------------------
-- Dollar signs
-- ---------------------------------------------------------------------------
--
-- SAT questions are full of prices. "$20" in a prompt would be read by the
-- renderer as the opening delimiter of a math span, and everything up to the
-- next "$" would silently become math — which, in a question with two prices,
-- turns the sentence between them into garbage.
--
-- So step 1 of the conversion escapes every literal `$` to `\$` BEFORE any
-- math is introduced. `<MathText />` renders `\$` as a plain dollar sign and
-- never treats it as a delimiter. This is why the conversion must run over
-- existing content rather than being applied at render time: the escaping and
-- the wrapping have to happen in that order, once, with a record of what
-- changed.
-- ============================================================================


-- ============================================================================
-- 1. Audit trail
--
-- "Log every change made (question id + before/after) so the migration is
-- auditable" — spec section 2. `math_migration_questions` doubles as the
-- idempotency guard: a question that appears there has been processed and is
-- never touched again, whether or not anything about it changed.
-- ============================================================================

create table if not exists public.math_migration_questions (
  question_id uuid primary key references public.questions (id) on delete cascade,
  migrated_at timestamptz not null default now()
);

comment on table public.math_migration_questions is
  'Idempotency guard for the math->LaTeX migration. One row per question '
  'processed, changed or not. Delete a row to force a re-run for that question.';

create table if not exists public.math_migration_log (
  id           bigint generated always as identity primary key,
  question_id  uuid not null references public.questions (id) on delete cascade,
  -- 'prompt' | 'explanation' | 'choice_0' .. 'choice_3'
  field        text not null,
  before_text  text not null,
  after_text   text not null,
  migrated_at  timestamptz not null default now()
);

comment on table public.math_migration_log is
  'Every string the math migration rewrote, before and after. Changed fields '
  'only — a field left alone produces no row.';

create index if not exists math_migration_log_question_idx
  on public.math_migration_log (question_id);

-- Both tables hold question content, which is not secret but is not student
-- data either. Admin-only, same shape as question_sets.
alter table public.math_migration_questions enable row level security;
alter table public.math_migration_questions force row level security;
revoke all on table public.math_migration_questions from anon, authenticated;
grant select on table public.math_migration_questions to authenticated;

drop policy if exists math_migration_questions_select_admin on public.math_migration_questions;
create policy math_migration_questions_select_admin
  on public.math_migration_questions for select to authenticated
  using (public.is_admin());

alter table public.math_migration_log enable row level security;
alter table public.math_migration_log force row level security;
revoke all on table public.math_migration_log from anon, authenticated;
grant select on table public.math_migration_log to authenticated;

drop policy if exists math_migration_log_select_admin on public.math_migration_log;
create policy math_migration_log_select_admin
  on public.math_migration_log for select to authenticated
  using (public.is_admin());


-- ============================================================================
-- 2. The converter
--
-- IMMUTABLE and pure so it can be used in a plain UPDATE, in the review view,
-- and re-run without surprise. Order of the steps below is load-bearing and
-- each one says why.
-- ============================================================================

create or replace function public.to_latex_math(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;

  -- STEP 0 — refuse to touch content that is ALREADY in the target format.
  --
  -- Without this, the function is destructive on a second exposure. Step 1
  -- escapes every `$`, including ones that are already delimiters — so a
  -- question authored as `If $x^{2} = 9$` would come back as
  -- `If \$x^{2} = 9\$`: two literal dollar signs and no math at all.
  --
  -- The per-question guard table below stops that for rows this migration has
  -- already seen. It does NOT stop it for rows created AFTERWARDS: the admin
  -- upload format asks for `$...$` LaTeX, so every practice test and question
  -- set imported from here on arrives already converted and is absent from
  -- that table. Re-running this file to pick up new legacy content would then
  -- wreck them.
  --
  -- Hence a content test rather than a bookkeeping one. Legacy plain-text
  -- content contains no backslash-commands, no `\$`, and no `^{` — those
  -- three markers appear only in text that is already LaTeX.
  --   '\\[a-zA-Z]+'  a backslash command:  \sqrt  \frac  \pi
  --   '\\\$'          an already-escaped dollar
  --   '\^\{'          a braced exponent:   x^{2}
  if p_text ~ '\\[a-zA-Z]+' or p_text ~ '\\\$' or p_text ~ '\^\{' then
    return p_text;
  end if;

  v := p_text;

  -- STEP 1 — escape literal dollars, before any are introduced as delimiters.
  -- Must be first. Doing it after the wrapping steps would escape the very
  -- delimiters those steps just wrote.
  v := replace(v, '$', '\$');

  -- STEP 2 — sqrt(...) with a parenthesised argument. Before the exponent
  -- rules, because `sqrt(x)^2` should become $\sqrt{x}$ then have its
  -- exponent handled against the closing brace rather than the paren.
  -- One level of nesting only: [^()]* refuses to match across an inner pair,
  -- so `sqrt(f(x))` is left alone and reported for manual review instead of
  -- being cut in half.
  v := regexp_replace(v, 'sqrt\s*\(([^()]*)\)', '$\\sqrt{\1}$', 'gi');

  -- STEP 3 — the √ glyph. Two forms: with parens, and bare in front of a
  -- short token (√2, √x, √17). A bare √ followed by anything longer is
  -- ambiguous about where the radicand ends, so it is left for review.
  v := regexp_replace(v, '√\s*\(([^()]*)\)', '$\\sqrt{\1}$', 'g');
  v := regexp_replace(v, '√\s*([A-Za-z0-9]+)', '$\\sqrt{\1}$', 'g');

  -- STEP 4 — parenthesised base with an integer exponent: (x+1)^2, (2a-b)^-1.
  -- Unambiguous because both ends are explicit.
  v := regexp_replace(v, '\(([^()]+)\)\^\(?(-?[0-9]+)\)?', '$(\1)^{\2}$', 'g');

  -- STEP 5 — parenthesised exponent on a simple base: x^(n+1), 2^(-3).
  v := regexp_replace(v, '([A-Za-z0-9])\^\(([^()]+)\)', '$\1^{\2}$', 'g');

  -- STEP 6 — the common case: an integer exponent on the ONE character before
  -- it, which is the standard reading. An exponent binds to the token
  -- immediately to its left, so `abc^2` becomes `ab$c^{2}$` — rendering as
  -- abc², which is what it means. It is not a guess about a longer base;
  -- there is deliberately no rule that tries to decide one, because nothing
  -- in the string would say so. A genuinely grouped base has to be written
  -- with parentheses, and step 4 above handles that.
  v := regexp_replace(v, '([A-Za-z0-9])\^(-?[0-9]+)', '$\1^{\2}$', 'g');

  -- STEP 7 — standalone unicode operators. Each becomes its own math span;
  -- step 8 merges any that ended up adjacent.
  v := replace(v, 'π',  '$\pi$');
  v := replace(v, '≤',  '$\leq$');
  v := replace(v, '≥',  '$\geq$');
  v := replace(v, '≠',  '$\neq$');
  v := replace(v, '≈',  '$\approx$');
  v := replace(v, '±',  '$\pm$');
  v := replace(v, '×',  '$\times$');
  v := replace(v, '÷',  '$\div$');
  v := replace(v, '∞',  '$\infty$');
  v := replace(v, '°',  '$^{\circ}$');
  v := replace(v, '≅',  '$\cong$');
  v := replace(v, '∠',  '$\angle$');

  -- STEP 8 — merge spans that ended up touching: `$a$$b$` -> `$ab$`. Purely
  -- cosmetic for the rendered output, but it keeps the stored strings from
  -- accumulating empty math spans that KaTeX would render as stray gaps.
  v := replace(v, '$$', '');

  return v;
end;
$fn$;

comment on function public.to_latex_math(text) is
  'Conservative plain-text-to-LaTeX conversion for question content. Escapes '
  'literal $ first, then wraps only unambiguous math. Never touches bare a/b '
  'fractions — see math_migration_review.';

revoke all on function public.to_latex_math(text) from public, anon, authenticated;


-- ============================================================================
-- 3. Apply it
--
-- Logging happens before the update, reading the old value and computing the
-- new one the same way the update will. `is distinct from` rather than `<>`
-- so a null field cannot silently skip its log row.
-- ============================================================================

do $mig$
declare
  v_processed integer;
begin
  -- --- Log the prompt and explanation changes -------------------------------
  insert into public.math_migration_log (question_id, field, before_text, after_text)
  select q.id, 'prompt', q.prompt, public.to_latex_math(q.prompt)
    from public.questions q
   where not exists (
           select 1 from public.math_migration_questions m
            where m.question_id = q.id)
     and public.to_latex_math(q.prompt) is distinct from q.prompt;

  insert into public.math_migration_log (question_id, field, before_text, after_text)
  select q.id, 'explanation', q.explanation, public.to_latex_math(q.explanation)
    from public.questions q
   where not exists (
           select 1 from public.math_migration_questions m
            where m.question_id = q.id)
     and public.to_latex_math(q.explanation) is distinct from q.explanation;

  -- --- Log the choice changes, one row per changed choice -------------------
  insert into public.math_migration_log (question_id, field, before_text, after_text)
  select q.id,
         'choice_' || (c.ord - 1),
         c.value #>> '{}',
         public.to_latex_math(c.value #>> '{}')
    from public.questions q
   cross join lateral jsonb_array_elements(q.choices) with ordinality as c(value, ord)
   where not exists (
           select 1 from public.math_migration_questions m
            where m.question_id = q.id)
     and public.to_latex_math(c.value #>> '{}') is distinct from (c.value #>> '{}');

  -- --- Rewrite the content --------------------------------------------------
  update public.questions q
     set prompt      = public.to_latex_math(q.prompt),
         explanation = public.to_latex_math(q.explanation),
         choices     = (
           select jsonb_agg(public.to_latex_math(c.value #>> '{}') order by c.ord)
             from jsonb_array_elements(q.choices) with ordinality as c(value, ord)
         )
   where not exists (
           select 1 from public.math_migration_questions m
            where m.question_id = q.id);

  get diagnostics v_processed = row_count;

  -- --- Mark them processed --------------------------------------------------
  insert into public.math_migration_questions (question_id)
  select q.id from public.questions q
   where not exists (
           select 1 from public.math_migration_questions m
            where m.question_id = q.id)
  on conflict (question_id) do nothing;

  raise notice 'math migration: % questions processed, % fields rewritten',
    v_processed,
    (select count(*) from public.math_migration_log
      where migrated_at > now() - interval '1 minute');
end;
$mig$;


-- ============================================================================
-- 4. The manual review queue
--
-- Everything the converter refused to guess at. Read this after running the
-- migration, fix the listed questions by hand in /admin/questions (authoring
-- the math with $...$ directly), and the rows drop off as you go.
--
--   select * from public.math_migration_review order by reason, external_id;
--
-- `reason` is one row per problem per question, so a question with both a
-- bare fraction and an unconverted exponent appears twice.
-- ============================================================================

create or replace view public.math_migration_review
with (security_barrier = true)
as
select q.id as question_id,
       q.external_id,
       reason,
       field,
       excerpt
  from public.questions q
 cross join lateral (
   values
     ('prompt',      q.prompt),
     ('explanation', q.explanation)
 ) as f(field, excerpt)
 cross join lateral (
   values
     -- A bare fraction: digits or a single letter, slash, digits or a single
     -- letter. Deliberately loose — this is a list to eyeball, and a false
     -- positive costs a glance while a false negative ships a broken question.
     ('possible unconverted fraction',
      f.excerpt ~ '(^|[^0-9A-Za-z/])[0-9A-Za-z]+\s*/\s*[0-9A-Za-z]+([^0-9A-Za-z/]|$)'),
     -- An exponent the converter would not touch: multi-character base, or a
     -- nested parenthesised one.
     ('unconverted exponent',
      f.excerpt ~ '\^' and f.excerpt !~ '\^\{'),
     -- sqrt with nesting the single-level pattern could not handle.
     ('unconverted sqrt',
      f.excerpt ~* 'sqrt' or f.excerpt ~ '√')
 ) as r(reason, hit)
 where r.hit
   and public.is_admin();

comment on view public.math_migration_review is
  'Questions whose math the migration deliberately did not guess at. Admin '
  'only. Fix these by hand; authoring $...$ directly makes the row disappear.';

revoke all on table public.math_migration_review from anon, authenticated;
grant select on table public.math_migration_review to authenticated;


-- ============================================================================
-- 5. Confirm the result
--
--   -- What changed, most recently first:
--   select question_id, field, before_text, after_text
--     from public.math_migration_log order by id desc limit 50;
--
--   -- What still needs a human:
--   select reason, count(*) from public.math_migration_review group by reason;
--
--   -- Sanity: no question should contain an unescaped, unpaired dollar.
--   -- This must return zero rows (odd number of unescaped $ = broken span):
--   select id, prompt from public.questions
--    where (length(regexp_replace(prompt, '\\\$', '', 'g'))
--           - length(regexp_replace(regexp_replace(prompt, '\\\$', '', 'g'), '\$', '', 'g'))) % 2 = 1;
-- ============================================================================
