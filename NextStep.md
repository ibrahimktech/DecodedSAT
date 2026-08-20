# Next Step — Math Rendering, Timers, Video Categories, Practice Tests, Desmos, Progress

Builds on Steps 1–5 (landing page, auth, dashboard + 5 pages, admin panel). Existing schema:
`domains`, `subtopics`, `questions`, `videos`, `practice_sections`, `question_attempts`,
`practice_attempts`, `profiles`, `admin_users`, `question_sets` (with `external_id`, `is_active`).

This step does **not** touch `practice_sections` / `practice_attempts` (the existing section-length
drills from Step 4) — those stay as-is. Full/half practice tests below are a **new, separate**
system, because they have real timing/module rules that section drills don't.

---

## 0. Decisions locked in, and two I made a judgment call on

Locked in from requirements gathering:
- Math notation in `questions` is plain text (`x^2`, `sqrt(x)`) — needs conversion, not a live guess-parser forever.
- Question bank timer: simple stopwatch, counts up, no limit.
- Practice tests mirror real digital SAT structure: 2 modules, separate timers, not adaptive.
- Video categories: fully dynamic, **videos only** — question bank and practice tests keep the existing fixed domain/subtopic structure.
- Practice test questions live in the same `questions` table (reusable), tagged into tests via a junction table — not a separate content pool.
- Practice test timing locks to real SAT standard (35 min / 22 questions per module).
- Leave-page mid-test: warn, and auto-submit if they actually leave/close.
- Desmos calculator: resizable/draggable, never small by default.

Judgment calls — flag these back to me if they're wrong, easy to change before build:
1. **"Half" test = 1 module** (22 Q / 35 min), **"full" test = 2 modules** (44 Q / 70 min total). This falls directly out of "mirror SAT structure" + "lock to standard timing" but wasn't asked explicitly.
2. **Module 2 doesn't auto-start** — after module 1 ends (time up or early submit), show a "Module 1 complete — click Continue to start Module 2 (35:00)" screen, so the 2nd timer only starts when the student is ready. Matches real digital SAT behavior.

---

## 1. Schema changes (run as one migration)

```sql
-- ── Math: no schema change needed, see Section 2 (content migration instead) ──

-- ── Question bank sessions (for the timer + Progress history) ──
create table public.question_bank_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int,
  question_count int not null default 0,
  correct_count int not null default 0,
  wrong_count int not null default 0
);
alter table public.question_bank_sessions enable row level security;
create policy "own sessions" on public.question_bank_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.question_attempts
  add column session_id uuid references public.question_bank_sessions(id) on delete set null;

-- ── Dynamic video categories (videos only) ──
create table public.video_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.video_categories enable row level security;
create policy "public read active categories" on public.video_categories
  for select using (is_active = true);
create policy "admin write categories" on public.video_categories
  for all using (public.is_admin()) with check (public.is_admin());

-- videos: domain becomes optional, category becomes an option
alter table public.videos alter column domain_id drop not null;
alter table public.videos alter column subtopic_id drop not null;
alter table public.videos add column video_category_id uuid references public.video_categories(id) on delete set null;
alter table public.videos add constraint videos_have_a_type
  check (domain_id is not null or video_category_id is not null);

-- ── Practice tests (full/half) ──
create table public.practice_tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  test_type text not null check (test_type in ('full','half')),
  module_count int not null generated always as (case when test_type = 'full' then 2 else 1 end) stored,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.practice_tests enable row level security;
create policy "public read active tests" on public.practice_tests
  for select using (is_active = true);
create policy "admin write tests" on public.practice_tests
  for all using (public.is_admin()) with check (public.is_admin());

create table public.practice_test_questions (
  practice_test_id uuid not null references public.practice_tests(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  module_number int not null check (module_number in (1,2)),
  order_index int not null,
  primary key (practice_test_id, question_id)
);
alter table public.practice_test_questions enable row level security;
create policy "public read via active test" on public.practice_test_questions
  for select using (exists (select 1 from public.practice_tests t
    where t.id = practice_test_id and t.is_active));
create policy "admin write test questions" on public.practice_test_questions
  for all using (public.is_admin()) with check (public.is_admin());

create table public.practice_test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_test_id uuid not null references public.practice_tests(id),
  status text not null default 'in_progress'
    check (status in ('in_progress','completed','abandoned_auto_submitted')),
  started_at timestamptz not null default now(),
  module1_ends_at timestamptz,
  module2_started_at timestamptz,
  module2_ends_at timestamptz,
  ended_at timestamptz,
  total_time_seconds int,
  correct_count int,
  wrong_count int
);
alter table public.practice_test_attempts enable row level security;
create policy "own test attempts" on public.practice_test_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.practice_test_responses (
  id uuid primary key default gen_random_uuid(),
  practice_test_attempt_id uuid not null references public.practice_test_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  module_number int not null,
  student_answer text,
  is_correct boolean,
  time_spent_seconds int,
  answered_at timestamptz,
  unique (practice_test_attempt_id, question_id)
);
alter table public.practice_test_responses enable row level security;
create policy "own responses" on public.practice_test_responses
  for all using (exists (select 1 from public.practice_test_attempts a
    where a.id = practice_test_attempt_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.practice_test_attempts a
    where a.id = practice_test_attempt_id and a.user_id = auth.uid()));
```

All admin writes reuse the existing `public.is_admin()` SECURITY DEFINER function from Step 5 —
do not build a new authorization path.

---

## 2. Real math rendering (question bank + practice tests + explanations)

**Don't build a live guess-parser that runs on every render forever.** Instead:

1. **One-time content migration script** (Node script, run once against Supabase, not part of app runtime):
   - Scans every `questions.prompt`, `questions.choices`, `questions.explanation` (and same fields
     wherever practice-test-only content lives — there is none, they share `questions`).
   - Confidently auto-converts unambiguous patterns to LaTeX wrapped in `$...$`:
     - `x^2`, `x^(-3)` → `x^{2}`, `x^{-3}`
     - `sqrt(x)` → `\sqrt{x}`
     - unicode `√ π ≤ ≥ ± × ÷` → their LaTeX equivalents
   - For ambiguous patterns (bare `a/b` fractions — could be a real fraction or just prose/dates),
     do **not** blind-convert. Instead output a CSV/markdown report listing every question with a
     possible unconverted fraction so you can eyeball and fix those specific ones manually. This
     avoids silently mangling sentences like "increases by 3/4 of a percent" vs an actual `3/4`.
   - Log every change made (question id + before/after) so the migration is auditable.

2. **Going forward**, the Step 5 practice-test/question JSON upload format should expect math
   already authored with `$...$` LaTeX delimiters — document this in the admin upload page's
   help text.

3. **Rendering component** — new shared `<MathText text={string} />` component:
   - Install `katex` (not `react-katex` — use `katex.renderToString()` directly for more control
     and fewer SSR surprises), import `katex/dist/katex.min.css` once in the root layout.
   - Splits the input string on `$...$` boundaries, renders math segments via
     `katex.renderToString(segment, { throwOnError: false })` inside a
     `dangerouslySetInnerHTML` span, renders everything else as plain text.
   - Use this component everywhere question content is displayed: question bank, practice tests,
     explanations/answer review, and anywhere else question text appears.

---

## 3. Question bank timer + sessions

- When a student starts practicing a set (after topic/difficulty selection, same entry point as
  today), create a `question_bank_sessions` row (`started_at = now()`).
- Show a small persistent stopwatch (counts up, `MM:SS`) in the practice UI. No limit, no
  auto-submit — purely informational, matches the "simple stopwatch" decision.
- Each `question_attempts` row written during the session gets `session_id` set.
- When the student finishes the set or exits, close the session: `ended_at`, `duration_seconds`,
  and roll up `question_count` / `correct_count` / `wrong_count` from the linked attempts.
- If a student closes the tab mid-session without finishing, close the session on their next
  visit (check for any session with `ended_at is null` on page load, finalize it with whatever
  attempts exist) so nothing is left dangling. No auto-submit warning needed here — that's
  specific to practice tests (Section 5), not the low-stakes question bank.

---

## 4. Admin: dynamic video categories

New admin page `/admin/video-categories`:
- List existing categories, create new (name → slug auto-generated, editable), rename, soft-delete
  (`is_active = false`).
- On the existing Add/Edit Video admin page, add a "Video type" choice:
  - **Domain video** (existing flow: pick domain + subtopic, unchanged)
  - **General video** (pick an existing category, or create one inline, from `video_categories`)
- Student-facing Explainer Videos page: keep the existing domain-grouped view, add a filter or
  separate section for category-based videos (e.g. "Tips & Tricks", "Desmos Tips") — grouped by
  category the same way domain videos are grouped by domain.

Question bank and practice test admin flows are **not** touched by this — they keep the existing
fixed domain/subtopic structure, per the earlier decision.

---

## 5. Admin: full/half practice tests

New admin page `/admin/practice-tests`:
- **Create test**: title, description, difficulty (easy/medium/hard dropdown), type (full/half
  radio — full = 2 modules, half = 1 module, locked timing per Section 0).
- **Question upload**: same drag-and-drop/file-picker JSON upload UX as Step 5's question bulk
  upload, reusing the same per-question fields (`external_id`, domain, subtopic, difficulty,
  prompt, choices, correct_answer, explanation — whatever your Step 5 schema already defines) plus
  **one new required field per question: `module_number`** (1, or 2 for full tests only).
  - Reuse Step 5's `external_id` dedup logic: if a question with that `external_id` already
    exists in `questions`, reuse it (don't duplicate) and just insert the
    `practice_test_questions` linking row; otherwise create the question first.
  - Validate module question counts against `test_type` before accepting the upload (full needs
    22 in module 1 and 22 in module 2; half needs 22 in module 1) — reject with a clear error
    listing counts found vs. expected, don't silently accept a malformed test.
- **List/edit tests**: view all tests, edit title/description/difficulty, soft-delete
  (`is_active = false`), replace/re-upload questions.

---

## 6. Student-facing: taking a practice test

- Test detail/start screen: title, description, difficulty, type, estimated time, Start button.
- **Module flow**:
  - Module 1 starts immediately on Start: countdown timer `35:00`, strict — when it hits `0:00`,
    auto-advance (submit whatever's answered, move on). Early submit allowed via a "Submit
    Module" button with a confirm step (can't un-submit).
  - After module 1 ends (by timer or early submit), show an interstitial: "Module 1 complete —
    click Continue to start Module 2 (35:00)." Module 2's timer does not start until they click
    Continue. Half tests skip straight to results after module 1.
  - After the last module, finalize the attempt: `status = 'completed'`, compute
    `correct_count`/`wrong_count` server-side from `practice_test_responses` — never trust a
    client-submitted score.
- **Autosave**: every answer selection immediately upserts the corresponding
  `practice_test_responses` row via a server action (debounce ~500ms is fine) — this is what makes
  the abandonment handling below safe, since nothing depends on the unload event actually
  completing.
- **Leave-page warning + auto-submit**:
  - Standard `beforeunload` confirm dialog while `status = 'in_progress'`.
  - On `visibilitychange`/`pagehide`, fire `navigator.sendBeacon()` to a lightweight endpoint
    flagging the attempt as possibly abandoned (don't rely on this alone — `sendBeacon` can't do
    real scoring work).
  - Source of truth: on the student's next page load (or a periodic check), any attempt still
    `in_progress` whose current module's `ends_at` has already passed gets server-side finalized:
    `status = 'abandoned_auto_submitted'`, scored from whatever was autosaved, unanswered
    questions counted wrong. This guarantees a correct result even if the browser closed instantly
    with no chance to run JS.
- **Desmos calculator**: see Section 7, available throughout both modules (this app is math-only,
  so it's always relevant, matching how the real digital SAT provides it for the whole math
  section).

---

## 7. Desmos calculator (shared component, used in question bank *and* practice tests)

- Sign up for a free Desmos API key at https://www.desmos.com/api if you don't have one yet, add
  `NEXT_PUBLIC_DESMOS_API_KEY` to your env vars (it's used client-side, so the public prefix is
  correct — this is a low-sensitivity key by design, not a secret to protect like your Supabase
  service role key).
- Load the Desmos script (`https://www.desmos.com/api/v1.9/calculator.js?apiKey=...`) and mount a
  `Desmos.GraphingCalculator` instance (matches what the real digital SAT provides) inside a
  floating, draggable panel.
- Toggle button (visible on every question bank question and every practice test question) opens/
  closes the panel. Default size should be generously large on open — not a cramped corner
  widget — and the panel must be resizable (drag a corner/edge handle) and repositionable (drag
  the header), with sensible min/max bounds so it can't be resized into uselessness or off-screen.
- Position/size reset per session is fine (no need to persist between page loads for this step).

---

## 8. Student dashboard: "Progress" page

- New nav item **Progress** (nav rail becomes: Dashboard, Explainer Videos, Question Bank,
  Practice Tests, Progress, Settings).
- Pulls from `question_bank_sessions` and `practice_test_attempts` (both scoped to the logged-in
  user via RLS), merged and sorted by date, most recent first.
- Grouped under date headings (e.g. "August 19"), each date showing a bullet per session, most
  recent first within the day:
  - Question bank session bullet: `30 questions from question bank · 35:29`
  - Practice test bullet: `[Test title] (Full/Half) · 41/44 correct · 1:08:12`
- **Practice test bullets are clickable** → opens a full review screen: every question in the
  test, the student's answer vs. the correct answer, correct/incorrect marker, and per-question
  time if you choose to track it at that granularity (you already have `time_spent_seconds` on
  `practice_test_responses` if the client reports it per-question; otherwise leave it null and
  just show total test time — either is fine to start).
- Question bank session bullets are summary-only for this step (no per-question review) — that's
  explicitly deferred, see Section 11.

---

## 9. Dashboard main page: progress heatmap

- Add a GitHub-contributions-style heatmap to the main dashboard (near the streak card), covering
  roughly the last 12 weeks, scrollable further back if you want.
- Each day's color intensity reflects total questions attempted that day (question bank +
  practice test responses combined, right + wrong).
- Hover tooltip on a day: total questions, correct count, wrong count for that date. Clicking a
  day could deep-link to that date's section on the Progress page (nice-to-have, not required).
- Query this from the same two tables as Section 8 (aggregate by date), no new table needed.

---

## 10. Security checklist (same standard as Steps 2, 3, 5)

- [ ] Every new table has RLS enabled with an explicit policy — no table left default-open.
- [ ] `video_categories` / `practice_tests` / `practice_test_questions` writes are gated by
      `public.is_admin()`, reads are public/authenticated-only as appropriate — no client path
      lets a non-admin write to these.
- [ ] All scoring (`is_correct`, `correct_count`, `wrong_count`) computed server-side against the
      real answer key — never trust a client-submitted "I got this right."
- [ ] Auto-submit-on-abandon logic is server-side/triggered on next load, not solely dependent on
      a client event firing.
- [ ] `NEXT_PUBLIC_DESMOS_API_KEY` is the only new env var — confirm nothing sensitive ends up
      prefixed `NEXT_PUBLIC_`.
- [ ] `question_bank_sessions`, `practice_test_attempts`, `practice_test_responses` are all scoped
      strictly to `auth.uid()` — one student can never read another's progress data.

---

## 11. Explicitly deferred (out of scope for this step)

- True adaptive difficulty for module 2 based on module 1 performance (locked as non-adaptive).
- Per-question review UI for question bank sessions (only practice tests get full review).
- Category-based grouping for question bank or practice tests (videos only, per the decision).
- Persisting Desmos calculator position/size across page loads or sessions.
- Custom per-test time limits (locked to real SAT standard timing for now).

---

## Suggested build order

1. Schema migration (Section 1) + RLS policies.
2. Math content migration script + `<MathText />` component (Section 2) — do this early since
   it touches shared display code used everywhere else you're about to build.
3. Question bank timer/sessions (Section 3).
4. Admin video categories (Section 4).
5. Admin practice test builder + JSON upload (Section 5).
6. Student practice test taking flow: modules, timing, autosave, abandonment handling (Section 6).
7. Desmos calculator component, wired into both question bank and practice tests (Section 7).
8. Progress page (Section 8).
9. Dashboard heatmap (Section 9).
10. Run the full security checklist (Section 10) before calling this step done.

Test end to end: convert a batch of real questions through the math migration and confirm they
render correctly; do a full question bank session and confirm it shows up on Progress; upload a
JSON practice test, take it end-to-end through both modules, deliberately close the tab mid-module
and confirm it auto-submits correctly on next login; confirm the heatmap and Progress page numbers
match what you actually did.