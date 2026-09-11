/** The canonical SAT Math taxonomy shown to students and admins. */
export const SAT_MATH_SKILLS = [
  {
    domainSlug: "algebra",
    skills: [
      ["solving-linear-equations", "Solving linear equations"],
      ["understanding-linear-functions", "Understanding linear functions"],
      ["graphing-linear-equations", "Graphing linear equations"],
      [
        "solving-systems-of-linear-equations",
        "Solving systems of linear equations",
      ],
      ["working-with-linear-inequalities", "Working with linear inequalities"],
    ],
  },
  {
    domainSlug: "advanced-math",
    skills: [
      ["understanding-nonlinear-functions", "Understanding nonlinear functions"],
      [
        "solving-nonlinear-equations-and-systems",
        "Solving nonlinear equations and systems",
      ],
      [
        "rewriting-and-simplifying-expressions",
        "Rewriting and simplifying expressions",
      ],
    ],
  },
  {
    domainSlug: "problem-solving-data-analysis",
    skills: [
      [
        "ratios-rates-and-unit-conversions",
        "Ratios, rates, and unit conversions",
      ],
      ["percent-problems", "Percent problems"],
      ["data-distributions-and-averages", "Data distributions and averages"],
      ["scatterplots-and-data-models", "Scatterplots and data models"],
      ["probability", "Probability"],
      [
        "statistical-estimates-and-margin-of-error",
        "Statistical estimates and margin of error",
      ],
      [
        "evaluating-surveys-and-experiments",
        "Evaluating surveys and experiments",
      ],
    ],
  },
  {
    domainSlug: "geometry-trigonometry",
    skills: [
      ["area-surface-area-and-volume", "Area, surface area, and volume"],
      ["lines-angles-and-triangles", "Lines, angles, and triangles"],
      [
        "right-triangles-and-trigonometry",
        "Right triangles and trigonometry",
      ],
      ["circle-geometry", "Circle geometry"],
    ],
  },
] as const;

/**
 * Old bookmarks continue to resolve after canonical slugs replace the
 * original seed slugs.
 */
export const LEGACY_SKILL_SLUG_ALIASES: Readonly<Record<string, string>> = {
  "linear-equations": "solving-linear-equations",
  "systems-of-equations": "solving-systems-of-linear-equations",
  "linear-functions-graphs": "graphing-linear-equations",
  quadratics: "solving-nonlinear-equations-and-systems",
  "exponents-radicals": "rewriting-and-simplifying-expressions",
  "functions-transformations": "understanding-nonlinear-functions",
  "ratios-proportions": "ratios-rates-and-unit-conversions",
  percentages: "percent-problems",
  statistics: "data-distributions-and-averages",
  triangles: "lines-angles-and-triangles",
  circles: "circle-geometry",
  trigonometry: "right-triangles-and-trigonometry",
};

export function canonicalSkillSlug(slug: string): string {
  return LEGACY_SKILL_SLUG_ALIASES[slug] ?? slug;
}
