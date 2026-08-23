"use client";

/**
 * The Desmos graphing calculator, in a floating panel the student can move
 * and resize.
 *
 * Mounted on every question bank question and every practice test question.
 * This app is math-only, so the calculator is always relevant — the same
 * reasoning the real digital SAT applies when it gives you one for the whole
 * math section rather than per question.
 *
 * ## Why an iframe and not the JavaScript API
 *
 * This used to load `calculator.js` from Desmos with an API key and drive it
 * through `Desmos.GraphingCalculator(element, options)`. That integration could
 * not be made to work in production, for a reason that had nothing to do with
 * the key: the bundle initialises with an unguarded top-level
 *
 *     const __dcg_shared_module_exports__ = eval(__dcg_shared_module_source__);
 *
 * and compiles expressions with `new Function(...)`. Both need `'unsafe-eval'`
 * in this page's Content-Security-Policy. `next dev` grants that for React's
 * own callstack reconstruction, so it worked locally and failed the moment
 * NODE_ENV flipped — and granting it in production meant handing the two most
 * content-heavy routes a policy barely stronger than none.
 *
 * Embedding instead moves every one of those scripts into `desmos.com`'s
 * origin, where they run under Desmos's CSP rather than ours. So this app needs
 * no `'unsafe-eval'`, no `worker-src blob:`, no third-party `script-src`, and
 * no API key — `frame-src` is the entire allowance. That is a better security
 * position than the version that worked, not merely a workaround for one that
 * did not.
 *
 * ## What it costs
 *
 * The API surface. There is no `GraphingCalculator(el, options)` any more, so:
 *
 * - `images: false` cannot be set. The real digital SAT does not offer image
 *   upload; the embedded calculator does. Cosmetic, not a correctness problem.
 * - `destroy()` is gone. Closing the panel unmounts the iframe, which is a
 *   harder teardown than `destroy()` ever was.
 * - `resize()` is gone, and unnecessary: an iframe reflows with its box, which
 *   is why `FloatingPanel` is no longer handed an `onResized` callback.
 *
 * ## Dragging over an iframe
 *
 * An iframe swallows pointer events, which normally breaks drag-to-move the
 * instant the cursor crosses it. `FloatingPanel` uses pointer capture rather
 * than window listeners precisely so the events keep arriving anyway — that
 * behaviour predates this change and is what makes the panel still draggable.
 */

import { useCallback, useId, useState } from "react";
import {
  FloatingPanel,
  toolButtonClassName,
} from "@/components/app/exam/FloatingPanel";

/** Enough room for the expression list and a usable graph beside it. */
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 560;

/**
 * The full graphing calculator.
 *
 * Deliberately NOT `?embed`, which is what the site's own share dialog hands
 * out. That flag loads a different bundle entirely — `calculator_embed.js`
 * instead of `shared_calculator_desktop.js` — and it is a read-only preview of
 * a saved graph: axes, no expression list, no keypad, and an "edit graph on
 * desmos" link out. It exists to show a finished graph on a blog, not to be
 * calculated in.
 *
 * No graph id, so every open starts blank — a previous question's working is
 * not something to carry into the next one.
 */
const CALCULATOR_SRC = "https://www.desmos.com/calculator";

/**
 * What the embedded page is allowed to do.
 *
 * Generous on purpose: Desmos needs scripts, its own origin (for the storage
 * its expression list uses), modals for the settings menu, and downloads for
 * image export. The directive that matters is the one NOT listed —
 * `allow-top-navigation` — so nothing inside the frame can navigate a student
 * out of a timed module.
 */
const SANDBOX = [
  "allow-scripts",
  "allow-same-origin",
  "allow-forms",
  "allow-modals",
  "allow-downloads",
  "allow-popups",
].join(" ");

const CALCULATOR_ICON = (
  <svg
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <rect x="4" y="2.5" width="16" height="19" rx="2" />
    <path d="M8 7h8" />
    <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
    <path d="M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01" />
    <path d="M8.5 18.5h7" />
  </svg>
);

export function CalculatorPanel() {
  const [open, setOpen] = useState(false);
  /**
   * Reset on every open. The iframe is unmounted when the panel closes, so a
   * reopen genuinely reloads it and has to wait again — a `loaded` flag that
   * survived the close would show an empty panel as though it were ready.
   */
  const [loaded, setLoaded] = useState(false);

  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLoaded(false);
          setOpen((wasOpen) => !wasOpen);
        }}
        aria-expanded={open}
        aria-controls={panelId}
        className={toolButtonClassName(open)}
      >
        {CALCULATOR_ICON}
        Calculator
      </button>

      <FloatingPanel
        id={panelId}
        title="Calculator"
        open={open}
        onClose={close}
        defaultWidth={DEFAULT_WIDTH}
        defaultHeight={DEFAULT_HEIGHT}
      >
        <div className="relative h-full">
          {/* Sits behind the iframe and is covered by it once it paints, so
              there is no swap and nothing shifts. If Desmos is unreachable this
              is what stays on screen — honest about waiting rather than
              claiming a failure the page cannot actually detect. */}
          {!loaded && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-[0.9375rem] text-muted">
              Loading the calculator…
            </p>
          )}

          <iframe
            src={CALCULATOR_SRC}
            title="Desmos graphing calculator"
            sandbox={SANDBOX}
            onLoad={() => setLoaded(true)}
            className="relative h-full w-full border-0"
          />
        </div>
      </FloatingPanel>
    </>
  );
}
