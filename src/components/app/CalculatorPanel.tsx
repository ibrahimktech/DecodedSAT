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
 * ## Where the dragging went
 *
 * The panel geometry — drag, resize, clamping, Escape — now lives in
 * `FloatingPanel`, shared with the reference sheet. What stays here is the part
 * that is actually about Desmos: loading its script once, mounting and
 * destroying the calculator, and telling it to re-measure after a gesture,
 * which it only ever does on demand.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  FloatingPanel,
  toolButtonClassName,
} from "@/components/app/exam/FloatingPanel";
import { DESMOS_API_KEY } from "@/lib/env";

/** Enough room for the expression list and a usable graph beside it. */
const DEFAULT_WIDTH = 720;
const DEFAULT_HEIGHT = 560;

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

  const close = useCallback(() => setOpen(false), []);

  /**
   * Desmos only re-lays-out on demand; without this the graph keeps whatever
   * dimensions it had when the gesture started.
   */
  const onResized = useCallback(() => calculatorRef.current?.resize(), []);

  // No key, no calculator, no trace of one.
  if (DESMOS_API_KEY === "") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
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
        onResized={onResized}
      >
        {failed ? (
          <p className="flex h-full items-center justify-center px-6 text-center text-[0.9375rem] text-muted">
            The calculator couldn&apos;t load. Check your connection and reopen
            it.
            {process.env.NODE_ENV !== "production" && (
              <>
                {" "}
                (Developer note: check the console — a blocked script looks
                identical to a network failure from here.)
              </>
            )}
          </p>
        ) : (
          <div ref={hostRef} className="h-full" />
        )}
      </FloatingPanel>
    </>
  );
}
