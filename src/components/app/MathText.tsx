/**
 * Renders question content — prompts, choices, explanations — with its math
 * typeset.
 *
 * Used everywhere question text appears: the question bank player, the
 * practice test runner, answer review, and the admin question list.
 *
 * ## Why `katex` and not `react-katex`
 *
 * `katex.renderToString()` is a pure string function with no React
 * dependency, no ref juggling and no effect, so this component renders
 * identically on the server and the client and produces no hydration
 * mismatch. `react-katex` wraps the same call in a component that has, across
 * versions, rendered into a ref inside an effect — which is a blank flash on
 * first paint and an SSR/CSR divergence waiting to happen. The spec calls for
 * `renderToString` directly, and this is why.
 *
 * ## Why `dangerouslySetInnerHTML` is safe here
 *
 * The HTML is not user content; it is KaTeX's own output, generated from the
 * segment string. KaTeX escapes what it emits, and `trust: false` (its
 * default, restated below for the reader) refuses the commands that could
 * produce a URL or an element — `\href`, `\url`, `\includegraphics`. The
 * text between the spans never goes near this path: it is returned as a React
 * child and escaped normally.
 *
 * Question content is admin-authored in the first place, but that is a reason
 * to keep the guarantee, not to rely on it.
 */

import katex from "katex";
import { splitMathSegments } from "@/lib/math/segments";

/**
 * Rendered math, keyed by the exact source string.
 *
 * The same handful of expressions are re-rendered on every keystroke-free
 * re-render of the player, and typesetting is the expensive part of this
 * component. Bounded so a long session cannot grow it without limit; when the
 * cap is hit the whole map is dropped rather than evicted one by one, which
 * is cheaper and, for a cache this small, indistinguishable.
 */
const RENDER_CACHE = new Map<string, string>();
const RENDER_CACHE_LIMIT = 500;

function renderMath(source: string): string {
  const cached = RENDER_CACHE.get(source);
  if (cached !== undefined) return cached;

  let html: string;
  try {
    html = katex.renderToString(source, {
      // A malformed expression renders in red inside the flow instead of
      // throwing. One bad question must not blank a whole page.
      throwOnError: false,
      // No \href, \url or \includegraphics. This is KaTeX's default; it is
      // written out because it is the property that makes the innerHTML below
      // safe, and a default worth depending on is worth stating.
      trust: false,
      // Unicode and other non-strict input warn rather than fail. The
      // migration converts the common glyphs, but content authored by hand
      // may still carry one.
      strict: false,
      displayMode: false,
      output: "htmlAndMathml",
    });
  } catch {
    // renderToString can still throw on input that defeats throwOnError.
    // Falling back to the raw source keeps the question readable.
    html = "";
  }

  if (RENDER_CACHE.size >= RENDER_CACHE_LIMIT) RENDER_CACHE.clear();
  RENDER_CACHE.set(source, html);
  return html;
}

type MathTextProps = {
  text: string;
  /**
   * Wrapper element. Prompts and explanations sit inside a `<p>` already, so
   * they default to a span — a `<p>` inside a `<p>` is invalid HTML and React
   * will not warn about it here.
   */
  as?: "span" | "div" | "p";
  className?: string;
};

export function MathText({ text, as: Wrapper = "span", className }: MathTextProps) {
  const segments = splitMathSegments(text);

  return (
    <Wrapper className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={index}>{segment.value}</span>;
        }

        const html = renderMath(segment.value);

        // Empty means KaTeX gave up entirely — show the source so the content
        // is still readable and the breakage is visible to whoever authored it.
        if (html === "") {
          return <span key={index}>{segment.value}</span>;
        }

        return (
          <span
            key={index}
            // KaTeX output, generated from `segment.value`. See the header note
            // on why this is not a user-content injection point.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </Wrapper>
  );
}
