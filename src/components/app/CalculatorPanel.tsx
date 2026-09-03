"use client";

/**
 * Desmos is docked beside the live question on desktop so neither surface
 * obscures the other. Narrow screens retain the movable panel because there
 * is not enough horizontal space for two usable columns.
 *
 * The calculator stays in an iframe instead of using Desmos's JavaScript API:
 * that keeps its `unsafe-eval` requirement inside desmos.com rather than
 * weakening this application's Content-Security-Policy.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  FloatingPanel,
  toolButtonClassName,
} from "@/components/app/exam/FloatingPanel";

const MOBILE_WIDTH = 720;
const MOBILE_HEIGHT = 560;
const DESKTOP_QUERY = "(min-width: 1024px)";
const CALCULATOR_SRC = "https://www.desmos.com/calculator";

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

export function CalculatorToggle({
  open,
  onToggle,
  controlsId,
}: {
  open: boolean;
  onToggle: () => void;
  controlsId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controlsId}
      className={toolButtonClassName(open)}
    >
      {CALCULATOR_ICON}
      Calculator
    </button>
  );
}

/** Rendered by ExamShell's side-panel slot only while the calculator is open. */
export function CalculatorPanel({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const docked = useDesktopDock();

  useEffect(() => {
    if (!docked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [docked, onClose]);

  if (!docked) {
    return (
      <FloatingPanel
        id={id}
        title="Calculator"
        open
        onClose={onClose}
        defaultWidth={MOBILE_WIDTH}
        defaultHeight={MOBILE_HEIGHT}
      >
        <CalculatorFrame />
      </FloatingPanel>
    );
  }

  return (
    <section
      id={id}
      aria-label="Calculator"
      className="flex h-full min-h-96 flex-col overflow-hidden bg-surface"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-4 py-3">
        <div>
          <p className="font-semibold text-ink">Calculator</p>
          <p className="text-xs text-muted">Docked beside the question</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close calculator"
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-background hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            width={20}
            height={20}
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
      <CalculatorFrame />
    </section>
  );
}

function CalculatorFrame() {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative min-h-0 flex-1">
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
  );
}

function subscribeToDesktopQuery(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function desktopSnapshot(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function useDesktopDock(): boolean {
  return useSyncExternalStore(
    subscribeToDesktopQuery,
    desktopSnapshot,
    () => false,
  );
}
