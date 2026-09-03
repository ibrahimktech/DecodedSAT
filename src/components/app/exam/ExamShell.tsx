"use client";

import { useRef, useState, type CSSProperties } from "react";

/**
 * The frame both question surfaces sit in — the practice test runner and the
 * question bank player.
 *
 * Modelled on the real digital SAT: no site navigation, tools and clock pinned
 * to the top, question in a single readable column, and the "where am I"
 * controls pinned to the bottom. A student who has practised here should find
 * nothing surprising about the layout on test day, which is the entire point.
 *
 * It knows nothing about timers or questions and takes everything as slots.
 * The only state it owns is the optional desktop tool pane width, keeping that
 * resizing behaviour identical in the question bank and timed test runner.
 *
 * The bars are `sticky` rather than `fixed` so a long prompt scrolls between
 * them without needing the body to be a scroll container, and so nothing has to
 * reserve padding for a bar it cannot measure.
 */

type ExamShellProps = {
  /** Top-left: the way out, and what this module or filter set is. */
  left: React.ReactNode;
  /** Top-centre: the clock. Centred by grid, so its width cannot shift it. */
  timer: React.ReactNode;
  /** Top-right: calculator, reference sheet. */
  tools: React.ReactNode;
  children: React.ReactNode;
  /** Desktop workspace beside the question, currently used by Desmos. */
  sidePanel?: React.ReactNode;
  /**
   * Bottom-centre: the question navigator pill. Not called `navigator` — that
   * shadows the global of the same name, which the test runner reaches for a
   * few lines away to fire its abandonment beacon.
   */
  questionNav: React.ReactNode;
  /** Bottom-right: Back / Next / Submit. */
  actions: React.ReactNode;
};

const DEFAULT_SIDE_WIDTH = 48;
const MIN_SIDE_WIDTH = 30;
const MAX_SIDE_WIDTH = 65;
const KEYBOARD_RESIZE_STEP = 2;

function clampSideWidth(value: number): number {
  return Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, value));
}

export function ExamShell({
  left,
  timer,
  tools,
  children,
  sidePanel,
  questionNav,
  actions,
}: ExamShellProps) {
  const splitRef = useRef<HTMLDivElement>(null);
  const [sideWidth, setSideWidth] = useState(DEFAULT_SIDE_WIDTH);
  const [resizing, setResizing] = useState(false);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !splitRef.current) return;
    event.preventDefault();

    const target = event.currentTarget;
    const bounds = splitRef.current.getBoundingClientRect();
    target.setPointerCapture(event.pointerId);
    setResizing(true);

    const resizeTo = (clientX: number) => {
      const width = ((bounds.right - clientX) / bounds.width) * 100;
      setSideWidth(clampSideWidth(width));
    };

    const onMove = (moveEvent: PointerEvent) => resizeTo(moveEvent.clientX);
    const onUp = (upEvent: PointerEvent) => {
      if (target.hasPointerCapture(upEvent.pointerId)) {
        target.releasePointerCapture(upEvent.pointerId);
      }
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      setResizing(false);
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") {
      nextWidth = sideWidth + KEYBOARD_RESIZE_STEP;
    } else if (event.key === "ArrowRight") {
      nextWidth = sideWidth - KEYBOARD_RESIZE_STEP;
    } else if (event.key === "Home") {
      nextWidth = MIN_SIDE_WIDTH;
    } else if (event.key === "End") {
      nextWidth = MAX_SIDE_WIDTH;
    }

    if (nextWidth === null) return;
    event.preventDefault();
    setSideWidth(clampSideWidth(nextWidth));
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        {/* Three equal columns rather than `justify-between`: the clock stays
            optically centred on the page no matter how wide the slots beside
            it grow, which is what makes hiding and showing it not move. */}
        <div className="mx-auto grid w-full max-w-page grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">{left}</div>
          <div className="flex justify-center">{timer}</div>
          <div className="flex items-center justify-end gap-1">{tools}</div>
        </div>
      </header>

      <div
        ref={splitRef}
        style={
          sidePanel
            ? ({ "--exam-side-width": `${sideWidth}%` } as CSSProperties)
            : undefined
        }
        className={`mx-auto grid w-full flex-1 items-start ${
          sidePanel
            ? "max-w-[96rem] lg:grid-cols-[minmax(20rem,1fr)_0.75rem_minmax(20rem,var(--exam-side-width))]"
            : "max-w-3xl"
        }`}
      >
        <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {children}
        </main>
        {sidePanel && (
          <>
            <div
              role="separator"
              aria-label="Resize question and calculator"
              aria-orientation="vertical"
              aria-valuemin={MIN_SIDE_WIDTH}
              aria-valuemax={MAX_SIDE_WIDTH}
              aria-valuenow={Math.round(sideWidth)}
              aria-valuetext={`Calculator uses ${Math.round(sideWidth)} percent of the workspace`}
              tabIndex={0}
              title="Drag to resize the question and calculator"
              onPointerDown={startResize}
              onDoubleClick={() => setSideWidth(DEFAULT_SIDE_WIDTH)}
              onKeyDown={resizeWithKeyboard}
              className="relative z-50 hidden h-[calc(100vh-8rem)] min-h-96 cursor-col-resize touch-none items-center justify-center self-start border-x border-hairline bg-background outline-none select-none lg:sticky lg:top-16 lg:flex focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
            >
              <span
                className="flex h-12 w-1.5 flex-col items-center justify-center gap-1 rounded-full bg-hairline"
                aria-hidden
              >
                <span className="size-0.5 rounded-full bg-muted" />
                <span className="size-0.5 rounded-full bg-muted" />
                <span className="size-0.5 rounded-full bg-muted" />
              </span>
            </div>
            <aside className="lg:sticky lg:top-16 lg:h-[calc(100vh-8rem)] lg:min-h-96">
              {sidePanel}
            </aside>
          </>
        )}
      </div>

      {resizing && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 hidden cursor-col-resize lg:block"
        />
      )}

      <footer className="sticky bottom-0 z-30 border-t border-hairline bg-surface">
        <div className="mx-auto grid w-full max-w-page grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-3 sm:px-5">
          <div />
          <div className="flex justify-center">{questionNav}</div>
          <div className="flex items-center justify-end gap-2">{actions}</div>
        </div>
      </footer>
    </div>
  );
}

/**
 * The compact button geometry the exam bars use.
 *
 * Deliberately not `ctaClassName` — that is the landing page's one big button,
 * sized for a marketing hero, and four of them across a toolbar would be
 * absurd. This is the same idea applied at bar scale: one definition, so Back
 * and Next cannot drift apart.
 */
export function examButtonClassName(
  variant: "primary" | "secondary" = "secondary",
): string {
  const base =
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl border px-5 py-2 " +
    "text-[0.9375rem] font-semibold transition-colors " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
    "disabled:cursor-not-allowed disabled:opacity-40";

  return variant === "primary"
    ? `${base} border-transparent bg-accent text-surface hover:bg-accent-hover`
    : `${base} border-hairline bg-surface text-ink hover:border-accent hover:text-accent`;
}
