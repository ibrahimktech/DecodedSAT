# Step 4: Dashboard & Core App Pages — DecodedSAT

## Context

- Step 1 (landing page): done.
- Step 2/3 (signup, signin, session security, RLS on `profiles`): done and audited. Cookie-based sessions via `@supabase/ssr`, Turnstile on signup, `profiles` row created only after email confirmation.
- Stack: Next.js App Router, TypeScript, Supabase Auth + Postgres, RLS everywhere.
- Visual design is handled separately (a Claude Design mockup already exists and will be pasted in by the user). **This document is about data model, page functionality, and system behavior — not visual styling.** Match the layout/structure implied below, but colors, spacing, and component styling come from the design prompt, not this file.
- No real SAT content exists yet (no questions, no videos, no tests written). Everything must be DB-backed with a seed script producing placeholder/sample data — not hardcoded values in the frontend.
- Onboarding (where a user's real score estimate and target score come from) is a **future step**, not part of this one. Step 4 must build the schema and UI to support it, but data for it will be null/placeholder until onboarding exists.

## Scope

Build out all 5 authenticated pages behind a shared layout:

1. **Dashboard** — overview/home
2. **Explainer videos** — video library
3. **Question bank** — topic-filtered practice, one question at a time
4. **Practice tests** — timed section-length drills (full-length tests are a later step)
5. **Settings** — account info, logout

Shared left nav (icon + label) persists across all 5. Order: Dashboard, Explainer videos, Question bank, Practice tests, then Settings pinned lower, Logout separated below Settings (not grouped with it — different action class).

## Data model

Design exact SQL/migrations yourself, but the entities and relationships below are fixed:

**Content tables** (public-read for authenticated users, no client write access — seeded via migration/seed script only):
- `domains` — the four fixed SAT math domains: Algebra, Advanced Math, Problem-Solving & Data Analysis, Geometry & Trigonometry. Do not let these be user-editable or dynamically added from the client.
- `subtopics` — belongs to a domain (e.g. Geometry & Trigonometry → circle theorems, triangle properties, etc.). Seed a handful of realistic subtopics per domain.
- `questions` — belongs to a subtopic. Needs: prompt, answer choices, correct answer, explanation text, difficulty level (easy/medium/hard).
- `videos` — belongs to a subtopic (or domain, your call). Needs: title, YouTube video ID, short description.
- `practice_sections` — a timed, section-length drill. Belongs to a domain or subtopic, has a time limit, and links to a set of questions (junction table).

**User activity tables** (RLS: a user can only read/write their own rows — default-deny like the rest of the app):
- `question_attempts` — user_id, question_id, is_correct, attempted_at. This is the source of truth for domain mastery, streak, and daily goal — don't duplicate this data elsewhere, compute from it.
- `practice_attempts` — user_id, practice_section_id, score, time_taken, completed_at.
- `user_stats` (or `user_progress`) — user_id, `current_score_estimate` (nullable), `target_score` (nullable), `daily_goal` (default 20, not yet user-editable — see Settings below). Do not store streak as a stale counter; compute "current streak" from `question_attempts`/`practice_attempts` activity dates at read time, or maintain it via a trigger if you prefer — your call, but it must reflect real activity, not a value that can drift.

Seed script: populate `domains`, `subtopics`, a modest set of sample `questions` per subtopic (mixed difficulty), a few sample `videos` (real or dummy YouTube IDs), and a couple of `practice_sections`. Enough that the dashboard and all 5 pages render real data end to end, not empty states everywhere.

## Page-by-page behavior

### Dashboard
- Greeting with current date + user's name (from `profiles`), streak badge.
- **Streak**: any day with at least one `question_attempts` or `practice_attempts` row counts. Compute from activity dates, don't hardcode.
- **Score estimate card**: reads `user_stats.current_score_estimate`. Since onboarding doesn't exist yet, seed this with placeholder mock data in the seed script so the card renders a real number — but the query/component should already be written to read the real column, so nothing changes when onboarding ships.
- **Target score card**: reads `user_stats.target_score`. This one stays **null for now** — render an empty/grayed state ("set a target score" or similar, no fake number) since onboarding is what sets this.
- **Continue where you left off**: most recent incomplete `practice_attempts` (or most recently attempted subtopic with a partially-done question set). Resume button routes into that subtopic/section.
- **Domain mastery**: accuracy per domain computed from `question_attempts`, over a **rolling window of the last 50 attempts per domain** (not all-time, not a simple average — needs a query that orders by `attempted_at desc` and limits per domain).
- **Today's goal**: count of today's `question_attempts` vs `user_stats.daily_goal`.
- **No weak-area insight card in this step** — skip it entirely. It depends on enough attempt history to detect real patterns; add it in a later step once there's data to work with. Don't stub it with fake content.

### Explainer videos
- Grid/list of `videos`, filterable by domain (and subtopic if it doesn't overcomplicate the first pass).
- Embedded YouTube player using the stored video ID.

### Question bank
- Default flow: user manually picks a domain/subtopic + difficulty, then gets questions one at a time from `questions`, submits an answer, sees correct/incorrect + explanation, moves to next. Each attempt writes a `question_attempts` row.
- Also surface **adaptive suggestions** here (and optionally as a small module on the dashboard): recommend the domain with the lowest current mastery %. Keep this simple — "lowest mastery domain first" logic is enough for now, not a real adaptive algorithm.

### Practice tests
- Section-length, timed drills only for this step (`practice_sections`). Full-length adaptive tests (digital-SAT-style, where module 2 difficulty depends on module 1 performance) are explicitly **out of scope** — a later step.
- Flow: pick a section, timer starts, answer questions, submit, see a results summary (score, time taken, missed questions). Writes a `practice_attempts` row.

### Settings
- Account info from `profiles` (name, email), password change (via Supabase auth).
- Do **not** add daily goal editing yet — `daily_goal` stays a fixed default until onboarding introduces user-configurable settings. Fine to leave a visual placeholder noting it's "coming soon" if the design calls for it, but no functional control yet.
- Logout button here is fine in addition to the nav rail one.

## Security carryover (non-negotiable, same standard as steps 2–3)

- Every new table gets RLS. Content tables: public-read for authenticated users, no client-side writes. Activity tables (`question_attempts`, `practice_attempts`, `user_stats`): strictly scoped to `auth.uid()`, default-deny otherwise.
- All score/mastery/streak calculations happen server-side (Server Components or Server Actions) — never trust a client-submitted score or attempt result without validating it against the actual question/answer server-side first.
- No service_role key anywhere client-accessible. Seed script runs server-side/via migration only.

## Suggested build order

1. DB schema migration (all tables above) + RLS policies + seed script.
2. Shared authenticated layout: left nav rail, session/profile check, logout wiring.
3. Dashboard page (depends on steps 1–2 and gives you a good end-to-end test of the data layer).
4. Explainer videos page.
5. Question bank page + attempt-writing flow.
6. Practice tests page + attempt-writing flow.
7. Settings page.

Test end to end with one seeded user before calling this step done: sign in, see real (seeded) numbers on the dashboard, complete a few questions, watch the domain mastery / streak / today's goal actually update, resume a partially-done section from "continue where you left off."