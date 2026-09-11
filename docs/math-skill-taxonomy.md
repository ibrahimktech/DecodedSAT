# SAT Math skill taxonomy migration

## Architecture

DecodedSAT already had a normalized `domains -> subtopics -> questions`
relationship. The `subtopics` table is retained as the physical skills table
and `questions.subtopic_id` remains the foreign key. This avoids rewriting
question, attempt, report, practice-test, analytics, and video relationships.
Student- and admin-facing copy now calls these rows **skills**.

The migration reuses all 12 original skill UUIDs for their nearest canonical
replacement and adds 7 UUIDs. Old slugs are stored in
`subtopic_slug_aliases`, and the application canonicalizes old bookmark
values.

## Canonical taxonomy

1. Algebra
   - Solving linear equations
   - Understanding linear functions
   - Graphing linear equations
   - Solving systems of linear equations
   - Working with linear inequalities
2. Advanced Math
   - Understanding nonlinear functions
   - Solving nonlinear equations and systems
   - Rewriting and simplifying expressions
3. Problem-Solving and Data Analysis
   - Ratios, rates, and unit conversions
   - Percent problems
   - Data distributions and averages
   - Scatterplots and data models
   - Probability
   - Statistical estimates and margin of error
   - Evaluating surveys and experiments
4. Geometry and Trigonometry
   - Area, surface area, and volume
   - Lines, angles, and triangles
   - Right triangles and trigonometry
   - Circle geometry

## Read-only production preview

The configured Supabase project was read on 2026-09-06. No remote writes were
performed.

- Questions before/after classification: **471 / 471**
- HIGH confidence: **454**
- MEDIUM confidence (applied, pending admin review): **17**
- LOW confidence (not automatically applied): **0**
- Uncategorized: **0**
- Existing question-bank attempts: **660** at the final read-only snapshot
- Existing practice-test responses: **39**
- Existing question reports: **3**
- Existing practice-test question links: **110**
- Existing videos: **3**
- Existing analytics events: **1,311** at the final read-only snapshot
- Question active state: **169 active / 302 inactive**
- Direct question-to-video mappings: **1**

Attempt and event totals are live and may increase while students use the
site. The stable migration invariant is that the taxonomy migration issues no
DML against either table and aborts if a protected relationship count changes
during its transaction.

The 17 review rows are:

- `0c8ba2b0-fb06-4f65-9323-16a3deb178b5`
- `1e318f31-1a60-4cfd-b168-fa3069d12bd7`
- `4a9d46d6-4421-4df0-ab45-b4c85729eb4c`
- `5d99c711-b9b5-4261-886a-87920b7ef45c`
- `611270ff-3727-41fa-a30c-98ec68d3f9fa`
- `76d727fb-71c0-4870-bfe6-6ddb674c93ec`
- `a9a3d84e-0188-4a22-ae4a-6d882babe40a`
- `b1d230af-eeee-4736-9be4-8b42c5985d35`
- `b3c6b477-bb9c-45a1-aa36-697e53106c94`
- `bd601174-04fb-4ab9-9495-b12ae22ecb18`
- `d398b253-dc1d-48b1-b9b2-a3fb69202c36`
- `daab0574-f2ee-421d-8f0d-8c8361df2f41`
- `edb5e04c-5033-4d4b-8f0d-7e0acee280e7`
- `f5025841-51b9-4f1d-a0a5-d44538c83181`
- `f61afa6c-9f14-4f60-ba21-bd673616a2bb`
- `f7dc559b-abd8-420d-85df-78677343cdf2`
- `ff45b453-2cbc-4bf3-b28a-2279d7aeb0ad`

Use `/admin/questions?status=all&review=needs-review` after deployment to
accept or change them. The stored report includes the question ID, old domain
and skill, proposed domain and skill, confidence, reason, and review status.

## Safety properties

The migration changes only `questions.subtopic_id`. Before doing so it records
protected row counts and a fingerprint of every other question field. It
aborts the transaction if question content/IDs or any protected relationship
count changes. LOW-confidence rows are never applied automatically.

Attempts and analytics contain `question_id`, not a skill snapshot. Historical
accuracy therefore rolls up through each question's new skill automatically;
no attempt backfill is needed. `questions.solution_video_id` and all video rows
are untouched. Videos that used an old skill UUID keep that FK because the 12
original UUIDs are reused.

## Deployment and verification

Apply all pending migrations in order:

```sh
supabase db push
```

Then inspect the report as an admin or in the SQL editor:

```sql
select confidence, status, count(*)
from public.admin_question_skill_migration_report
group by confidence, status
order by confidence, status;

select proposed_new_domain, proposed_new_skill, count(*)
from public.admin_question_skill_migration_report
group by proposed_new_domain, proposed_new_skill
order by proposed_new_domain, proposed_new_skill;

select count(*) from public.questions;
```

The taxonomy migration needs no new environment variable, Storage bucket, or
manual Supabase Dashboard configuration. Do not deploy application code before
the database migration, because the application queries the new `active` and
review columns.

For a fresh read-only audit against the configured project:

```sh
node --env-file=.env.local scripts/audit-math-taxonomy.mjs summary
node --env-file=.env.local scripts/audit-math-taxonomy.mjs preview
```
