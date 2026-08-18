# Step 5 report — admin panel & content pipeline

Date: 2026-08-18 · Branch: `main` · Build green · Nothing committed.

The admin panel is built end to end: SQL-only admin authorization, bulk JSON
question upload with a per-row import summary, inline question editing, video
management via YouTube oEmbed, a read-only users list, and soft delete/restore
throughout. **Three SQL steps need to happen in the Supabase SQL Editor before
any of it lights up** — see "What you need to do" at the bottom.

---

## What was built

### Authorization model (`supabase/migrations/20260818200000_step5_admin.sql`)

- **`admin_users`** — RLS enabled with **zero policies and zero client
  grants**: default-deny for everyone, including authenticated admins. The
  only way in is a manual `INSERT` in the SQL editor. There is no promote
  button, no API route, no Server Action, no RLS policy that can change who
  is an admin. One documented deviation from house style: this table does
  *not* `force row level security`, because `is_admin()` runs as the table
  owner and forcing RLS onto the owner would deny the one reader the table
  is supposed to have.
- **`is_admin()`** — `SECURITY DEFINER`, empty `search_path`, derives the
  caller from `auth.uid()` only. It is the *single* admin primitive: every
  RLS policy, the proxy, the layouts, and every Server Action ask it and
  nothing else. (The spec's snippet used `search_path = public`; I pinned
  `''` with schema-qualified names — same behavior, stricter, and consistent
  with every other function in the project.)
- **No service_role anywhere.** Every admin read and write goes through the
  admin's own session with the anon key; RLS policies gated on `is_admin()`
  are the enforcement layer.

### Schema additions

- `questions.is_active` / `videos.is_active` (soft delete), default `true`.
- `question_sets` (one row per upload batch) + `questions.question_set_id`
  and `questions.external_id`, with the partial unique index on
  `(question_set_id, external_id)` as the duplicate key.
- `gen_random_uuid()` defaults on `questions.id` / `videos.id` (the seed
  hand-wrote ids; admin rows need the database to mint them).
- New policies: INSERT/UPDATE on `questions`, `videos`, `question_sets`, and
  INSERT on `subtopics` (for `create_new_subtopics`), all gated on
  `is_admin()`; SELECT on `profiles` and `question_attempts` for admins.
- **`admin_questions` view** — the admin read path. The step-4 column grant
  still hides `correct_choice`/`explanation` from every client, and grants
  are per-role, so "admins see the key" can't be a grant. This definer-style
  view (same construct as step 4's `attempted_question_solutions`; the
  Supabase advisor will flag both — expected) releases all columns only when
  `is_admin()` holds. Non-admins get zero rows.
- **`admin_import_question_set(jsonb)`** — the bulk upload as one Postgres
  function = one transaction. Hard-gated on `is_admin()`, re-validates every
  row (the Server Action's Zod pass is the first wall, this is the second),
  resolves domain/subtopic by name or slug case-insensitively, creates
  subtopics only when the file says `create_new_subtopics: true`, skips
  duplicates (including duplicates *within* the file), rejects bad rows
  individually with human-readable reasons, and returns
  `{imported, skipped_duplicates, rejected[]}`.
- **`admin_list_users()`** — profiles + admin badge + per-user attempt count
  in one call; errors for non-admins.

### Cleanup + seed (`supabase/wipe-step5-content.sql`, `supabase/seed.sql`)

- The wipe truncates all questions, videos, practice sections/junctions, and
  attempts. `domains`, `subtopics`, `profiles`, `user_stats` stay.
- `seed.sql` is trimmed to structure only (domains + subtopics + the
  user_stats placeholder), so re-running it can never resurrect the AI filler.
- Per your call: **/practice stays empty** until section management gets its
  own admin pipeline in a later step — the page renders its honest empty
  state.

### Pages (all under `src/app/admin/`, `force-dynamic`, `noindex`)

- **Shell** — `requireAdmin()` in the layout (request-cached; redirects
  non-admins to `/dashboard`), an AdminNav mirroring the student rail with an
  amber "Admin" tag, "View as student" + Logout below the hairline.
- **/admin** — active question / active video / set / user counts, linking to
  the three sub-pages.
- **/admin/questions** — upload panel (drag-and-drop or click, .json, 1 MB /
  500-question caps), full import summary after every upload including the
  rejected-rows table; list filterable by domain, subtopic, set, difficulty,
  status (active/inactive/all) and prompt-text search; inline edit of
  prompt/choices/correct answer/explanation/difficulty/domain/subtopic;
  deactivate/restore.
- **/admin/videos** — paste URL or id → server-side oEmbed lookup (no API
  key; `watch`, `youtu.be`, `shorts`, `embed`, bare id all parse) → title
  pre-filled and editable, description hand-written, domain/subtopic from the
  fixed dropdowns. A private/deleted/invalid video fails inline *before* save,
  and the save action re-verifies against oEmbed anyway. Edit (with
  re-fetch), deactivate/restore, filterable list.
- **/admin/users** — read-only: name, email, signup date, attempts count,
  admin badge. No role controls in the UI, on purpose.

### Redirect flow

- Login: after a successful sign-in the action calls `is_admin()` — admins
  land on `/admin`, everyone else on the dashboard as before. Fails closed:
  if the RPC errors, an admin lands on the student dashboard (and can still
  navigate to /admin), never the reverse.
- Proxy: `/admin/*` requires a session (else → login) and admin (else →
  `/dashboard`). A signed-in admin hitting the login/signup forms is sent to
  `/admin` instead of the dashboard.
- Student pages show admins a slim amber "viewing the student app — Back to
  admin" strip; admins are not locked out of the student surface (flagged
  assumption from the spec — this is the "more useful default" you described;
  say the word if you want a hard lock instead).

### Security carryover

- Every Server Action independently re-establishes admin context server-side
  (session + `is_admin()` RPC) before touching anything, then Zod-validates,
  then rate limits per user id (uploads 10/10 min, edits/toggles 60/min,
  oEmbed lookups 20/min).
- All uploaded text is sanitized (control/format characters stripped,
  bidi-override characters removed, lengths capped) before storage; prompts
  keep their newlines.
- Admin validation errors are deliberately *specific* (the reader is a
  verified admin fixing their own JSON) while everything else stays generic.
- One intentional loosening, for the record: admin error messages aside,
  non-admin callers of admin actions get the same generic message as any
  other failure — no oracle about which wall they hit.

## Verified

- `npm run build` clean (full type-check): all four `/admin` routes dynamic,
  landing page still prerenders static, proxy compiles.
- `npx eslint .` clean — zero warnings.
- Dev-server route smoke test did **not** run this session (a tooling outage
  on my side, not a code issue). First `npm run dev` after applying the SQL,
  spot-check: signed out, `/admin` must 307 to `/auth/login`; signed in as a
  non-admin, `/admin` must land you on `/dashboard`.
- Full end-to-end needs the SQL applied first — blocked on that, not code.

## What you need to do

1. **Supabase Dashboard → SQL Editor**, in this order:
   1. `supabase/wipe-step5-content.sql` — one-off, wipes the AI filler.
   2. `supabase/migrations/20260818200000_step5_admin.sql`
   3. Confirm default-deny on the admin table (must return **zero rows**):
      `select polname from pg_policies where schemaname='public' and tablename='admin_users';`
   4. Authorize yourself (uid from Authentication → Users):
      `insert into public.admin_users (user_id) values ('<your-auth-uid>');`
2. `npm run dev`, then walk the loop:
   - Sign in with your account → you should land on **/admin**.
   - Sign in with (or create) a second, non-admin account → it lands on the
     dashboard, and typing `/admin` bounces it back to `/dashboard`.
   - Upload a small real JSON set (shape per the spec; `create_new_subtopics`
     false unless you mean it) → check the imported/skipped/rejected counts.
   - Re-upload the same file → everything lands in `skipped_duplicates`.
   - Add one real video by URL → title auto-fills; save; it appears in the
     student library.
   - Soft-delete a question → gone from the student question bank, still
     visible under the "Inactive" filter in admin, and "Restore" brings it
     back.
3. The Supabase advisor will now flag **two** definer-style objects
   (`attempted_question_solutions` from step 4, `admin_questions` from this
   step) — both intentional, both filter by the caller's identity themselves.

## Notes & deliberate scope cuts

- Practice sections have no admin pipeline yet (your call) — when that step
  comes, note that deactivating a question that sits inside a live section
  will need handling (the grading function counts section questions from the
  junction table); today that's unreachable since sections are empty.
- The questions list caps at 500 rows per filter view; the filters are the
  intended way to browse, and pagination can come when volume demands it.
- `set_description` is only applied when a set is first created (per spec);
  re-uploads into an existing set ignore it.
- Subtopics created by uploads get generated slugs (collision-suffixed) and
  append to the domain's position order.
