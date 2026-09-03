"use client";

/**
 * The interactive half of the dashboard heatmap: the grid of day squares and
 * the tooltip that follows the pointer across them.
 *
 * Split from `<ActivityHeatmap />` so all the date work stays on the server.
 * Every string this renders — the day label, the counts — arrives precomputed,
 * so the client never formats a date and there is no timezone for the two
 * sides to disagree about.
 *
 * ## Why not the `title` attribute
 *
 * `title` is what this used to use, and browsers impose a fixed delay of
 * roughly a second before showing it, with no way to configure it. Reading a
 * heatmap means sweeping across many days quickly, and a one-second toll per
 * square makes that unusable. The native tooltip also can't be styled, so it
 * arrives as an OS-grey box that belongs to no design system.
 *
 * This appears on the first pointer event with no delay at all; the only
 * animation is a 100ms fade and lift, which reads as responsiveness rather
 * than as waiting. `motion-reduce` drops even that.
 *
 * ## Accessibility
 *
 * The tooltip is `aria-hidden`: it is a pointer affordance and its text is
 * already on every square as `sr-only` content, so a screen reader gets the
 * same sentence without a live region firing on every mouse move. The squares
 * are not focusable — 84 tab stops in the middle of a dashboard costs keyboard
 * users far more than it gives them, and the same information is one heading
 * away on the Progress page.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapCell = {
  dateKey: string;
  level: HeatmapLevel;
  /** The whole sentence: "Thu, Aug 20: 3 questions, 3 correct, 0 wrong". */
  summary: string;
};

/**
 * Fill and border per level.
 *
 * Every filled level carries a border a shade darker than its own fill. At
 * level 1 the fill is nearly the page colour, so without the outline a day
 * with a few questions on it is indistinguishable from a day with none —
 * which is exactly the distinction the grid exists to draw.
 */
export const LEVEL_CLASS: Record<HeatmapLevel, string> = {
  0: "bg-background border-hairline",
  1: "bg-accent-chip border-accent/45",
  2: "bg-accent/35 border-accent/60",
  3: "bg-accent/65 border-accent/85",
  4: "bg-accent border-accent-hover",
};

/** Above the square unless there is no room, in which case below it. */
const FLIP_THRESHOLD_PX = 72;
const OFFSET_PX = 8;
/** Keeps the bubble off the viewport edges when a day sits near one. */
const EDGE_MARGIN_PX = 8;

type Tip = {
  summary: string;
  centerX: number;
  y: number;
  above: boolean;
};

export function HeatmapGrid({
  weeks,
  weekdayLabels,
}: {
  weeks: (HeatmapCell | null)[][];
  weekdayLabels: readonly string[];
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [visible, setVisible] = useState(false);
  const [left, setLeft] = useState(0);

  const tooltipRef = useRef<HTMLDivElement | null>(null);

  /**
   * Clamp horizontally once the bubble's real width is known.
   *
   * In a layout effect rather than an effect: this runs before paint, so the
   * corrected position is the first one drawn and the tooltip never appears
   * off-centre for a frame.
   */
  useLayoutEffect(() => {
    if (!tip) return;
    const width = tooltipRef.current?.offsetWidth ?? 0;
    const half = width / 2;
    const min = half + EDGE_MARGIN_PX;
    const max = window.innerWidth - half - EDGE_MARGIN_PX;
    setLeft(Math.min(Math.max(tip.centerX, min), Math.max(min, max)));
  }, [tip]);

  const hide = useCallback(() => setVisible(false), []);

  // The grid scrolls sideways and the page scrolls down; either leaves a
  // fixed-position bubble pointing at nothing.
  useEffect(() => {
    if (!visible) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [visible, hide]);

  const show = (event: React.PointerEvent<HTMLElement>, cell: HeatmapCell) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const above = rect.top > FLIP_THRESHOLD_PX;
    setTip({
      summary: cell.summary,
      centerX: rect.left + rect.width / 2,
      y: above ? rect.top - OFFSET_PX : rect.bottom + OFFSET_PX,
      above,
    });
    setVisible(true);
  };

  return (
    <>
      <div className="mt-3 overflow-x-auto" onPointerLeave={hide}>
        <div className="flex gap-1 sm:gap-2">
          <ul
            aria-hidden
            className="flex shrink-0 flex-col gap-1 pt-0.5 text-[0.625rem] leading-[0.875rem] font-medium text-muted"
          >
            {weekdayLabels.map((label, index) => (
              <li key={label} className="h-3.5">
                {index % 2 === 1 ? label : ""}
              </li>
            ))}
          </ul>

          <div className="flex gap-[3px] sm:gap-1">
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-1">
                {week.map((cell, dayIndex) =>
                  cell ? (
                    <span
                      key={cell.dateKey}
                      onPointerEnter={(event) => show(event, cell)}
                      className={`h-3.5 w-3.5 rounded-[0.1875rem] border transition-transform duration-100 ease-out hover:scale-125 motion-reduce:transition-none motion-reduce:hover:scale-100 ${LEVEL_CLASS[cell.level]}`}
                    >
                      <span className="sr-only">{cell.summary}</span>
                    </span>
                  ) : (
                    <span
                      key={`pad-${dayIndex}`}
                      aria-hidden
                      className="h-3.5 w-3.5"
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Always mounted so it can transition; invisible and inert until a
          square is hovered. */}
      <div
        ref={tooltipRef}
        aria-hidden
        role="presentation"
        className={`pointer-events-none fixed z-50 whitespace-nowrap rounded-lg border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-ink-inverse shadow-nav transition duration-100 ease-out motion-reduce:transition-none ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        style={{
          left,
          top: tip?.y ?? 0,
          transform: `translate(-50%, ${tip?.above ? "-100%" : "0"}) scale(${
            visible ? 1 : 0.96
          })`,
        }}
      >
        {tip?.summary}
      </div>
    </>
  );
}
