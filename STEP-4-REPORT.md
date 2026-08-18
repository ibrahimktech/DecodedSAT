# Step 4 report — dashboard & core app pages

Date: 2026-08-18 · Branch: `main` · Build + lint green · Nothing committed.

All five authenticated pages are built behind a shared nav-rail layout, DB-backed end to end.
**Two SQL files need to be run in the Supabase SQL Editor before any of it lights up** — see
"What you need to do" at the bottom.

---

## What was built

### Database (`supabase/migrations/20260818100000_step4_learning.sql` + `supabase/seed.sql`)

**Content tables** — `domains`, `subtopics`, `questions`, `videos`, `practice_sections`,
`practice_section_questions`. Authenticated users can read; nobody can write from a client —
rows come from the seed only. The seed provides the 4 fixed SAT math domains, 12 subtopics,
36 real questions (3 per subtopic, easy/medium/hard, with explanations), 8 placeholder videos,
and 3 timed sections of 9 questions each.

**Activity tables** — `question_attempts`, `practice_attempts`, `user_stats`. Default-deny RLS:
you can SELECT your own rows and nothing else. There are **no client write grants at all** —
every write goes through a `security definer` function that recomputes results server-side:

| Function | Job |
|---|---|
| `submit_question_attempt(question, choice)` | Grades one bank answer against the real key, records it, returns verdict + explanation |
| `start_practice_attempt(section)` | Opens a run (or resumes the unexpired one — no row stacking) |
| `submit_practice_attempt(attempt, answers)` | Validates every answer belongs to the section, computes score and elapsed time from the server's own clock, writes per-question attempts + the result in one transaction |
| `domain_mastery()` / `current_streak()` | Read-time metrics (security *invoker* — RLS applies) |

Three details worth knowing:

- **The answer key is unreadable by clients.** The grant on `questions` is column-scoped;
  `correct_choice` and `explanation` can't be selected through the API, so the key can't be
  scraped before answering — not even by our own server code, which holds no service key.
  Post-attempt review reads the `attempted_question_solutions` view, which releases solutions
  only for questions you've attempted or sections you've completed.
- **`is_correct` cannot be forged.** A BEFORE INSERT trigger recomputes it from the key on
  every attempt row, whatever the caller claimed. Attempt rows are immutable (no update path).
- **Nothing stores a counter that can drift.** Streak and mastery are computed from attempt
  rows at read time (mastery over a rolling last-50-attempts window per domain, in SQL with a
  window function). `user_stats` holds only the onboarding-shaped columns:
  `current_score_estimate` (seeded to a placeholder 540 so the card renders), `target_score`
  (deliberately NULL — the card shows an empty state, no fake number), `daily_goal` (fixed 20).
  A trigger creates the row for every new profile; the seed backfills existing ones.

### Pages (all under `src/app/(app)/`, all `force-dynamic`, all `noindex`)

- **Shared layout + nav rail** — Dashboard / Explainer videos / Question bank / Practice tests,
  Settings pinned lower, Logout separated below a hairline. Auth check via a new request-cached
  `requireUser()` (`src/lib/auth/require-user.ts`) so layout + page share one `getUser()` call.
- **Dashboard** — greeting with date + streak badge, score-estimate card, empty-state target
  card, today's goal vs `daily_goal` with progress bar, "continue where you left off"
  (unfinished timed run first, else last-practised subtopic), domain mastery bars for all four
  domains, and a "focus next: lowest mastery domain" pointer.
- **Explainer videos** — domain filter chips, `?subtopic=` deep links, click-to-load embedded
  player via `youtube-nocookie.com` (thumbnail only until pressed play).
- **Question bank** — chip-based domain/subtopic/difficulty picker (plain links, zero client
  state), a "recommended for you" card (lowest-mastery domain), then a one-at-a-time player:
  answer → server-graded verdict + explanation → on a miss, a link to that subtopic's explainer
  video. Batches favour never-attempted questions, then least-recently-attempted.
- **Practice tests** — section list with last/best scores and Start/Resume; timed runner with
  countdown, question palette, unanswered-count confirm, and auto-submit at zero (the server
  grants 60s grace for the request to land); results page with score, time, and per-question
  review — missed questions get the explanation and a video link. Results are read entirely
  from the DB, so the page survives refresh and revisits.
- **Settings** — account info from `profiles`, password change (Zod client feedback, server
  re-validation, 5/hour rate limit, `supabase.auth.updateUser`), a "coming soon" daily-goal
  placeholder (no functional control, per the spec), sign out.

### Security carryover

- RLS enabled **and forced** on every new table in the same migration that creates it; grants
  revoked before being re-granted narrowly. All definer functions pin `search_path = ''` and
  derive the caller from `auth.uid()`, never from an argument.
- Every action validates with Zod and rate limits per **user id** (bank submits 40/min,
  practice start/submit 10/10min, password 5/hour) on the existing limiter.
- No score, verdict, or elapsed time from the client is ever stored — the client timer is
  presentation only.
- `src/proxy.ts` now guards all five route prefixes (still the convenience layer; pages and
  RLS remain the real checks). CSP gained exactly two vendor entries for the video library:
  `frame-src` + `www.youtube-nocookie.com`, `img-src` + `i.ytimg.com`.

## Verified

- `npm run build` and `npm run lint` clean. Landing page still prerenders static; all app
  routes dynamic.
- Dev-server smoke test: `/` 200 · all five app routes 307 → `/auth/login` when signed out ·
  `/auth/login` 200.
- Full signed-in flow needs the SQL applied first (below) — blocked on that, not on code.

## What you need to do

1. **Supabase Dashboard → SQL Editor**, run top-to-bottom, in order (both are idempotent):
   1. `supabase/migrations/20260818100000_step4_learning.sql`
   2. `supabase/seed.sql`
   *(Step 3 taught us the failure mode here: a migration that exists in the repo but was never
   applied. Don't skip this.)*
2. `npm run dev`, sign in with your confirmed user, then walk the loop:
   - Dashboard shows the seeded **540** estimate, an empty target card, `0/20` today, empty
     mastery bars.
   - Question bank → pick Algebra → answer a few (get one wrong on purpose — you should see
     the explanation and a "watch the explainer" link).
   - Back on the dashboard: today's goal, streak (now 1), and Algebra mastery have moved.
   - Practice tests → start the Algebra drill, answer a couple, leave the page — the dashboard
     now offers **Resume** with the remaining clock. Resume, submit, and check the results
     review; the score also lands back on the practice list as "Last".
   - Settings → change password, sign out, sign back in with the new one.
3. The Supabase advisor will flag `attempted_question_solutions` as a SECURITY DEFINER view —
   that's intentional (it must read columns clients can't, and it filters by `auth.uid()`
   itself); the comment in the migration explains.

## Notes & deliberate scope cuts

- No weak-area insight card, no full-length adaptive tests, no daily-goal editing, no
  onboarding — all explicitly later steps. Nothing was stubbed with fake content.
- Streak/"today" use UTC day boundaries (documented in the migration); good enough until
  onboarding gives us a timezone.
- The 8 seeded videos use real, embeddable public YouTube ids (API demo clips / Big Buck
  Bunny) so the player demonstrably works; titles/descriptions say they're placeholders.
- Visual styling is intentionally functional-first with the existing tokens — the Claude
  Design mockup you mentioned can restyle these pages without touching data flow.
