/**
 * Splitting question content into text and math runs.
 *
 * Question content is plain text with LaTeX spans delimited by `$...$`, and a
 * literal dollar sign written as `\$`. The migration in
 * `20260820100000_math_latex.sql` is what puts content into that shape;
 * everything authored afterwards is expected to arrive that way already (the
 * admin upload help text says so).
 *
 * Free of React and of `katex` on purpose: the splitter is pure string work,
 * so it can be unit-reasoned about, reused by the plain-text helper below,
 * and imported from a Server Component without dragging a renderer along.
 *
 * ## Why `\$` matters
 *
 * SAT questions are full of prices. Given `A shirt costs $20 and a hat $15`,
 * a naive split on `$` reads " and a hat " as math and renders the sentence as
 * gibberish. Escaping every literal dollar before any delimiter is introduced
 * is what makes the delimiters unambiguous — see the migration's header.
 */

export type MathSegment =
  | { type: "text"; value: string }
  | { type: "math"; value: string };

/**
 * Splits on unescaped `$`, alternating text and math.
 *
 * An unterminated span — an authoring typo, or a stray dollar the migration
 * did not catch — is emitted as literal text rather than swallowing the rest
 * of the string into a math run. A visible `$` in the prompt is a bug someone
 * reports; a silently truncated question is one nobody notices.
 */
export function splitMathSegments(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let text = "";
  /** Non-null exactly while inside a math run. */
  let math: string | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    // `\$` is a literal dollar in both contexts, never a delimiter. Inside
    // math it stays escaped, because that is also how LaTeX spells it.
    if (char === "\\" && input[index + 1] === "$") {
      if (math === null) text += "$";
      else math += "\\$";
      index += 1;
      continue;
    }

    if (char === "$") {
      if (math === null) {
        if (text !== "") {
          segments.push({ type: "text", value: text });
          text = "";
        }
        math = "";
      } else {
        // Empty spans (`$$`) carry no content and would render as a stray gap.
        if (math !== "") segments.push({ type: "math", value: math });
        math = null;
      }
      continue;
    }

    if (math === null) text += char;
    else math += char;
  }

  if (math !== null) text += `$${math}`;
  if (text !== "") segments.push({ type: "text", value: text });

  return segments;
}

/** True when the string contains at least one complete math span. */
export function hasMath(input: string): boolean {
  return splitMathSegments(input).some((segment) => segment.type === "math");
}

/**
 * A readable, renderer-free approximation of the content.
 *
 * For the places HTML cannot go: `<title>`, `aria-label`, admin list rows,
 * and the in-process title search on the video and question lists. It is
 * deliberately lossy — it exists so a human reading a plain-text context sees
 * something sensible, not so the math survives intact.
 */
export function mathToPlainText(input: string): string {
  return splitMathSegments(input)
    .map((segment) => {
      if (segment.type === "text") return segment.value;
      return segment.value
        .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√$1")
        .replace(/\^\{([^{}]*)\}/g, "^$1")
        .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")
        .replace(/\\pi\b/g, "π")
        .replace(/\\leq\b/g, "≤")
        .replace(/\\geq\b/g, "≥")
        .replace(/\\neq\b/g, "≠")
        .replace(/\\approx\b/g, "≈")
        .replace(/\\pm\b/g, "±")
        .replace(/\\times\b/g, "×")
        .replace(/\\div\b/g, "÷")
        .replace(/\\infty\b/g, "∞")
        .replace(/\\circ\b/g, "°")
        .replace(/\\cong\b/g, "≅")
        .replace(/\\angle\b/g, "∠")
        .replace(/\\\$/g, "$")
        .replace(/[{}]/g, "")
        .replace(/\\[A-Za-z]+/g, "")
        .trim();
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}
