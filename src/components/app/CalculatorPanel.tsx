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
 * ## When there is no API key
 *
 * `NEXT_PUBLIC_DESMOS_API_KEY` is empty until one is issued. In that state
 * this component renders `null` — no toggle button, no script tag, no failed
 * request, nothing in the console. Practice works exactly as it does today
 * and the calculator appears the moment the variable is set, with no code
 * change. That is deliberate: a half-loaded calculator that errors mid-test
 * would be worse than no calculator.
 *
 * ## Geometry
 *
 * Opens large (spec section 7: "not a cramped corner widget"), draggable by
 * its header, resizable from the bottom-right corner, and clamped so it can
 * neither be shrunk into uselessness nor dragged somewhere it cannot be
 * grabbed back from. Position and size reset per page load, which the spec
 * explicitly defers persisting.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DESMOS_API_KEY } from "@/lib/env";

/** Enough room for the expression list and a usable graph beside it. */
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 560;
const MIN_WIDTH = 340;
const MIN_HEIGHT = 300;
/** Header height — kept on screen so a panel can always be dragged back. */
const GRAB_MARGIN = 44;

type Geometry = { x: number; y: number; width: number; height: number };

/** The sliver of the Desmos API this component touches. */
type DesmosCalculator = {
  resize: () => void;
  destroy: () => void;
};

type DesmosGlobal = {
  GraphingCalculator: (
    element: HTMLElement,
    options?: Record<string, unknown>,
  ) => DesmosCalculator;
};

declare global {
  interface Window {
    Desmos?: DesmosGlobal;
  }
}

/**
 * One script tag per page, shared by every mount.
 *
 * The panel unmounts on every question change; re-injecting the script each
 * time would re-download it and redefine the global. Holding the promise at
 * module scope makes the first mount pay for it and the rest await the same
 * result.
 */
let scriptPromise: Promise<DesmosGlobal> | null = null;

function loadDesmos(): Promise<DesmosGlobal> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<DesmosGlobal>((resolve, reject) => {
    if (window.Desmos) {
      resolve(window.Desmos);
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.desmos.com/api/v1.9/calculator.js?apiKey=${encodeURIComponent(
      DESMOS_API_KEY,
    )}`;
    script.async = true;
    script.onload = () => {
      if (window.Desmos) resolve(window.Desmos);
      else reject(new Error("Desmos loaded without defining its global"));
    };
    script.onerror = () => {
      // Let a later mount retry rather than caching the failure forever.
      scriptPromise = null;
      reject(new Error("Desmos script failed to load"));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/** Opens centred-right and large, then clamped to whatever the viewport is. */
function initialGeometry(): Geometry {
  const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 48));
  const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - 96));
  return {
    width,
    height,
    x: Math.max(16, window.innerWidth - width - 32),
    y: Math.max(16, Math.round((window.innerHeight - height) / 2)),
  };
}

export function CalculatorPanel() {
  const [open, setOpen] = useState(false);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [failed, setFailed] = useState(false);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const calculatorRef = useRef<DesmosCalculator | null>(null);
  const panelId = useId();

  // --- Mount the calculator while the panel is open -------------------------
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    loadDesmos()
      .then((Desmos) => {
        if (cancelled || !hostRef.current || calculatorRef.current) return;
        calculatorRef.current = Desmos.GraphingCalculator(hostRef.current, {
          // Matches what the real digital SAT provides.
          expressions: true,
          keypad: true,
          settingsMenu: true,
          expressionsTopbar: true,
          border: false,
          autosize: true,
          // Off for two reasons that happen to agree: the real digital SAT
          // does not let students add images, and leaving it on would require
          // `img-src blob:` in the CSP for a feature nobody here wants.
          images: false,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Logged, not just flagged. The panel can only say "it didn't load",
        // because from inside the page a blocked script and an offline network
        // are indistinguishable — the console is where the difference actually
        // shows up, as a Content-Security-Policy violation naming the
        // directive at fault.
        console.error("[calculator] Desmos failed to load", error);
        setFailed(true);
      });

    return () => {
      cancelled = true;
      calculatorRef.current?.destroy();
      calculatorRef.current = null;
    };
  }, [open]);

  // --- Keep the panel inside the window when the window changes -------------
  useEffect(() => {
    if (!open) return;

    const onResize = () => {
      setGeometry((current) => (current ? clamp(current) : current));
      calculatorRef.current?.resize();
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  // --- Escape closes, matching every other dismissible surface --------------
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) setGeometry(initialGeometry());
      return !wasOpen;
    });
  }, []);

  /**
   * Drag and resize share one pointer loop.
   *
   * Pointer capture rather than window listeners: the events keep arriving
   * even when the cursor outruns the panel or crosses the Desmos iframe, and
   * they stop cleanly when the button is released anywhere at all.
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
        // Desmos only re-lays-out on demand; without this the graph keeps the
        // dimensions it had when the drag started.
        calculatorRef.current?.resize();
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [geometry],
  );

  // No key, no calculator, no trace of one.
  if (DESMOS_API_KEY === "") return null;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3.5 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
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
        {open ? "Hide calculator" : "Calculator"}
      </button>

      {open && geometry && (
        <section
          id={panelId}
          aria-label="Desmos graphing calculator"
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
            <span className="text-sm font-semibold text-ink">Calculator</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              // The header is a drag surface; without this the pointerdown
              // that precedes the click starts a drag and the click is eaten.
              onPointerDown={(event) => event.stopPropagation()}
              aria-label="Close calculator"
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

          {failed ? (
            <p className="flex flex-1 items-center justify-center px-6 text-center text-[0.9375rem] text-muted">
              The calculator couldn&apos;t load. Check your connection and
              reopen it.
              {process.env.NODE_ENV !== "production" && (
                <>
                  {" "}
                  (Developer note: check the console — a blocked script looks
                  identical to a network failure from here.)
                </>
              )}
            </p>
          ) : (
            <div ref={hostRef} className="min-h-0 flex-1" />
          )}

          <button
            type="button"
            onPointerDown={(event) => startPointerGesture(event, "resize")}
            aria-label="Resize calculator"
            className="absolute right-0 bottom-0 h-6 w-6 cursor-nwse-resize text-hairline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M20 10 10 20M20 16l-4 4" />
            </svg>
          </button>
        </section>
      )}
    </>
  );
}

/**
 * Keeps the panel usable: never smaller than it can be worked in, never
 * larger than the window, and never dragged so far that its header — the only
 * way to drag it back — leaves the screen.
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
