"use client";

/**
 * A draggable, resizable panel that floats over the question.
 *
 * Extracted from `CalculatorPanel`, which had all of this inline before the
 * reference sheet needed the identical behaviour. Both tools open over a live
 * question, both have to be movable out of the way of the thing being read, and
 * both have to be impossible to lose off the edge of the screen — so the
 * geometry lives here once and neither caller thinks about pointer events.
 *
 * ## Geometry rules
 *
 * Opens at the requested size, clamped to the viewport. Dragged by its header,
 * resized from the bottom-right corner, and clamped on every gesture so the
 * panel can neither be shrunk into uselessness nor pushed somewhere its header
 * — the only handle that drags it back — cannot be reached. Position and size
 * reset per page load; nothing about them is persisted.
 */

import { useCallback, useEffect, useState } from "react";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 280;
/** Header height — kept on screen so a panel can always be dragged back. */
const GRAB_MARGIN = 44;

type Geometry = { x: number; y: number; width: number; height: number };

type FloatingPanelProps = {
  /** Shown in the header and used as the panel's accessible name. */
  title: string;
  id?: string;
  open: boolean;
  onClose: () => void;
  defaultWidth: number;
  defaultHeight: number;
  /**
   * Called after a drag or resize settles. Only needed by contents that lay
   * themselves out imperatively — Desmos re-measures on demand, not on its own.
   */
  onResized?: () => void;
  children: React.ReactNode;
};

export function FloatingPanel({
  title,
  id,
  open,
  onClose,
  defaultWidth,
  defaultHeight,
  onResized,
  children,
}: FloatingPanelProps) {
  /**
   * Null until the panel is opened.
   *
   * The initial position depends on `window`, which does not exist during the
   * server render — so it is computed on open rather than at mount, and the
   * panel renders nothing until it has one.
   */
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  /**
   * Recomputing the opening position is an adjustment to a prop change, so it
   * happens during render rather than in an effect. An effect would paint the
   * panel at a stale position for one frame first, and would be a `setState`
   * in an effect for no reason — React's own "adjusting state when a prop
   * changes" pattern is exactly this.
   *
   * `open` is driven by a `useState(false)` in every caller, so this branch
   * cannot be reached during a server render, where `window` does not exist.
   */
  const [openedAs, setOpenedAs] = useState(false);
  if (open !== openedAs) {
    setOpenedAs(open);
    setGeometry(open ? initialGeometry(defaultWidth, defaultHeight) : null);
  }

  // --- Keep the panel inside the window when the window changes -------------
  useEffect(() => {
    if (!open) return;

    const onResize = () => {
      setGeometry((current) => (current ? clamp(current) : current));
      onResized?.();
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, onResized]);

  // --- Escape closes, matching every other dismissible surface --------------
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  /**
   * Drag and resize share one pointer loop.
   *
   * Pointer capture rather than window listeners: the events keep arriving even
   * when the cursor outruns the panel or crosses an iframe inside it, and they
   * stop cleanly when the button is released anywhere at all.
   */
  const startPointerGesture = useCallback(
    (event: React.PointerEvent<HTMLElement>, mode: "move" | "resize") => {
      if (event.button !== 0 || !geometry) return;
      event.preventDefault();

      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startY = event.clientY;
      const start = geometry;

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;

        setGeometry(
          clamp(
            mode === "move"
              ? { ...start, x: start.x + dx, y: start.y + dy }
              : {
                  ...start,
                  width: start.width + dx,
                  height: start.height + dy,
                },
          ),
        );
      };

      const onUp = () => {
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        onResized?.();
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [geometry, onResized],
  );

  if (!open || !geometry) return null;

  return (
    <section
      id={id}
      aria-label={title}
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface shadow-nav"
    >
      <header
        onPointerDown={(event) => startPointerGesture(event, "move")}
        className="flex shrink-0 cursor-grab items-center justify-between gap-3 border-b border-hairline bg-background px-4 py-2.5 select-none active:cursor-grabbing"
      >
        <span className="text-sm font-semibold text-ink">{title}</span>
        <button
          type="button"
          onClick={onClose}
          // The header is a drag surface; without this the pointerdown that
          // precedes the click starts a drag and the click is eaten.
          onPointerDown={(event) => event.stopPropagation()}
          aria-label={`Close ${title.toLowerCase()}`}
          className="rounded-lg p-1 text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1">{children}</div>

      <button
        type="button"
        onPointerDown={(event) => startPointerGesture(event, "resize")}
        aria-label={`Resize ${title.toLowerCase()}`}
        className="absolute right-0 bottom-0 h-6 w-6 cursor-nwse-resize text-hairline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M20 10 10 20M20 16l-4 4" />
        </svg>
      </button>
    </section>
  );
}

/** Opens large and toward the right, then clamped to whatever the viewport is. */
function initialGeometry(
  defaultWidth: number,
  defaultHeight: number,
): Geometry {
  const width = Math.min(
    defaultWidth,
    Math.max(MIN_WIDTH, window.innerWidth - 48),
  );
  const height = Math.min(
    defaultHeight,
    Math.max(MIN_HEIGHT, window.innerHeight - 96),
  );

  return {
    width,
    height,
    x: Math.max(16, window.innerWidth - width - 32),
    y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
  };
}

/**
 * Keeps the panel usable: never smaller than it can be worked in, never larger
 * than the window, and never dragged so far that its header — the only way to
 * drag it back — leaves the screen.
 */
function clamp(geometry: Geometry): Geometry {
  const width = Math.min(
    Math.max(geometry.width, MIN_WIDTH),
    Math.max(MIN_WIDTH, window.innerWidth - 16),
  );
  const height = Math.min(
    Math.max(geometry.height, MIN_HEIGHT),
    Math.max(MIN_HEIGHT, window.innerHeight - 16),
  );

  return {
    width,
    height,
    x: Math.min(Math.max(geometry.x, GRAB_MARGIN - width), window.innerWidth - GRAB_MARGIN),
    y: Math.min(Math.max(geometry.y, 0), window.innerHeight - GRAB_MARGIN),
  };
}

/**
 * The shared look for a tool toggle in the exam header — calculator, reference
 * sheet, and anything added beside them. One definition so the pair cannot
 * drift apart, in the spirit of `ctaClassName`.
 */
export function toolButtonClassName(active: boolean): string {
  const base =
    "inline-flex flex-col items-center gap-0.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return active
    ? `${base} border-accent bg-accent-chip text-accent`
    : `${base} border-transparent text-muted hover:bg-background hover:text-ink`;
}
