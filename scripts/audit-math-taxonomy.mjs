import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this read-only audit.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function exactCount(table) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function allRows(table, columns, orderBy = "id") {
  const rows = [];
  const pageSize = 500;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
}

const countTables = [
  "questions",
  "question_attempts",
  "question_reports",
  "videos",
  "practice_section_questions",
  "practice_test_questions",
  "practice_test_responses",
  "analytics_events",
  "math_migration_questions",
  "math_migration_log",
];

const counts = Object.fromEntries(
  await Promise.all(
    countTables.map(async (table) => [table, await exactCount(table)]),
  ),
);

const [domains, subtopics, questions, videos] = await Promise.all([
  allRows("domains", "id, slug, name, position", "position"),
  allRows("subtopics", "id, domain_id, slug, name, position", "position"),
  allRows(
    "questions",
    "id, external_id, prompt, choices, explanation, difficulty, is_active, subtopic_id, solution_video_id, question_set_id",
  ),
  allRows(
    "videos",
    "id, title, description, subtopic_id, is_active",
  ),
]);

const mode = process.argv[2] ?? "summary";
const subtopicById = new Map(subtopics.map((subtopic) => [subtopic.id, subtopic]));

let output;
if (mode === "preview") {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260906120000_sat_math_skill_taxonomy.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const defaults = new Map([
    ["20000000-0000-4000-8000-000000000011", "20000000-0000-4000-8000-000000000011"],
    ["20000000-0000-4000-8000-000000000012", "20000000-0000-4000-8000-000000000012"],
    ["20000000-0000-4000-8000-000000000013", "20000000-0000-4000-8000-000000000013"],
    ["20000000-0000-4000-8000-000000000021", "20000000-0000-4000-8000-000000000021"],
    ["20000000-0000-4000-8000-000000000022", "20000000-0000-4000-8000-000000000022"],
    ["20000000-0000-4000-8000-000000000023", "20000000-0000-4000-8000-000000000023"],
    ["20000000-0000-4000-8000-000000000031", "20000000-0000-4000-8000-000000000031"],
    ["20000000-0000-4000-8000-000000000032", "20000000-0000-4000-8000-000000000032"],
    ["20000000-0000-4000-8000-000000000033", "20000000-0000-4000-8000-000000000033"],
    ["20000000-0000-4000-8000-000000000041", "20000000-0000-4000-8000-000000000041"],
    ["20000000-0000-4000-8000-000000000042", "20000000-0000-4000-8000-000000000042"],
    ["20000000-0000-4000-8000-000000000043", "20000000-0000-4000-8000-000000000043"],
  ]);
  const targets = new Map();
  const duplicateRuleIds = new Set();
  const arrayRule = /when q\.id = any \(array\[([\s\S]*?)\]::uuid\[\]\) then '([0-9a-f-]{36})'::uuid/g;
  for (const match of migration.matchAll(arrayRule)) {
    for (const id of match[1].match(/[0-9a-f-]{36}/g) ?? []) {
      if (targets.has(id)) duplicateRuleIds.add(id);
      targets.set(id, match[2]);
    }
  }
  const singleRule = /when q\.id = '([0-9a-f-]{36})' then '([0-9a-f-]{36})'::uuid/g;
  for (const match of migration.matchAll(singleRule)) {
    if (targets.has(match[1])) duplicateRuleIds.add(match[1]);
    targets.set(match[1], match[2]);
  }

  const confidenceSection = migration.slice(
    migration.indexOf("end as suggested_subtopic_id"),
    migration.indexOf("end as confidence") + "end as confidence".length,
  );
  const mediumIds = new Set(
    confidenceSection.match(/[0-9a-f-]{36}/g) ?? [],
  );
  const skillNames = new Map([
    ["20000000-0000-4000-8000-000000000011", "Solving linear equations"],
    ["20000000-0000-4000-8000-000000000014", "Understanding linear functions"],
    ["20000000-0000-4000-8000-000000000013", "Graphing linear equations"],
    ["20000000-0000-4000-8000-000000000012", "Solving systems of linear equations"],
    ["20000000-0000-4000-8000-000000000015", "Working with linear inequalities"],
    ["20000000-0000-4000-8000-000000000023", "Understanding nonlinear functions"],
    ["20000000-0000-4000-8000-000000000021", "Solving nonlinear equations and systems"],
    ["20000000-0000-4000-8000-000000000022", "Rewriting and simplifying expressions"],
    ["20000000-0000-4000-8000-000000000031", "Ratios, rates, and unit conversions"],
    ["20000000-0000-4000-8000-000000000032", "Percent problems"],
    ["20000000-0000-4000-8000-000000000033", "Data distributions and averages"],
    ["20000000-0000-4000-8000-000000000034", "Scatterplots and data models"],
    ["20000000-0000-4000-8000-000000000035", "Probability"],
    ["20000000-0000-4000-8000-000000000036", "Statistical estimates and margin of error"],
    ["20000000-0000-4000-8000-000000000037", "Evaluating surveys and experiments"],
    ["20000000-0000-4000-8000-000000000044", "Area, surface area, and volume"],
    ["20000000-0000-4000-8000-000000000041", "Lines, angles, and triangles"],
    ["20000000-0000-4000-8000-000000000043", "Right triangles and trigonometry"],
    ["20000000-0000-4000-8000-000000000042", "Circle geometry"],
  ]);
  const classified = questions.map((question) => {
    const targetId = targets.get(question.id) ?? defaults.get(question.subtopic_id) ?? null;
    return {
      question_id: question.id,
      external_id: question.external_id,
      old_skill: subtopicById.get(question.subtopic_id)?.name ?? null,
      proposed_new_skill: targetId ? skillNames.get(targetId) ?? null : null,
      confidence: targetId ? (mediumIds.has(question.id) ? "MEDIUM" : "HIGH") : "LOW",
      prompt: question.prompt.replace(/\s+/g, " ").trim(),
    };
  });
  const currentQuestionIds = new Set(questions.map((question) => question.id));
  const ruleIdsNotFound = [...targets.keys()].filter(
    (id) => !currentQuestionIds.has(id),
  );
  const bySkill = {};
  const byConfidence = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of classified) {
    const key = row.proposed_new_skill ?? "Uncategorized";
    bySkill[key] = (bySkill[key] ?? 0) + 1;
    byConfidence[row.confidence] += 1;
  }
  output = {
    canonical_skill_count: skillNames.size,
    question_count_before: counts.questions,
    question_count_after: classified.length,
    automatically_migrated: classified.filter(
      (row) => row.confidence === "HIGH" || row.confidence === "MEDIUM",
    ).length,
    byConfidence,
    bySkill,
    duplicateRuleIds: [...duplicateRuleIds],
    ruleIdsNotFound,
    needsReview: classified.filter((row) => row.confidence !== "HIGH"),
  };
} else if (mode === "prompts") {
  const requestedSlug = process.argv[3];
  const lines = questions
    .filter(
      (question) =>
        !requestedSlug ||
        subtopicById.get(question.subtopic_id)?.slug === requestedSlug,
    )
    .map((question) =>
      [
        question.id,
        question.external_id ?? "",
        question.prompt.replace(/\s+/g, " ").trim(),
      ].join("\t"),
    );
  console.log(lines.join("\n"));
  process.exit(0);
} else if (mode === "questions") {
  const requestedSlug = process.argv[3];
  output = questions
    .filter(
      (question) =>
        !requestedSlug ||
        subtopicById.get(question.subtopic_id)?.slug === requestedSlug,
    )
    .map((question) => ({
      id: question.id,
      external_id: question.external_id,
      prompt: question.prompt.replace(/\s+/g, " ").trim(),
      explanation: question.explanation.replace(/\s+/g, " ").trim(),
      difficulty: question.difficulty,
      is_active: question.is_active,
      old_domain: domains.find(
        (domain) =>
          domain.id === subtopicById.get(question.subtopic_id)?.domain_id,
      )?.name,
      old_subtopic: subtopicById.get(question.subtopic_id)?.name,
      old_subtopic_slug: subtopicById.get(question.subtopic_id)?.slug,
    }));
} else if (mode === "videos") {
  output = videos.map((video) => ({
    ...video,
    old_subtopic: subtopicById.get(video.subtopic_id)?.name ?? null,
    old_subtopic_slug: subtopicById.get(video.subtopic_id)?.slug ?? null,
  }));
} else {
  const questionCounts = new Map();
  for (const question of questions) {
    questionCounts.set(
      question.subtopic_id,
      (questionCounts.get(question.subtopic_id) ?? 0) + 1,
    );
  }
  output = {
    generatedAt: new Date().toISOString(),
    counts,
    questionState: {
      active: questions.filter((question) => question.is_active).length,
      inactive: questions.filter((question) => !question.is_active).length,
      exactSolutionVideoLinks: questions.filter(
        (question) => question.solution_video_id !== null,
      ).length,
    },
    domains,
    subtopics: subtopics.map((subtopic) => ({
      ...subtopic,
      question_count: questionCounts.get(subtopic.id) ?? 0,
    })),
  };
}

console.log(
  JSON.stringify(
    output,
    null,
    2,
  ),
);
