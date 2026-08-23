"use client";

/**
 * The reference sheet the digital SAT hands every student at the top of a math
 * module.
 *
 * These formulas are given on the real test, which means a student who spends
 * revision time memorising them is spending it on the wrong thing. Not having
 * the sheet here would quietly teach that habit — and would make every practice
 * question harder than its real counterpart, which is the one way a practice
 * test can be actively misleading.
 *
 * Content matches the official sheet: the area and volume formulas, the two
 * special right triangles, and the three closing facts. Figures are inline SVG
 * in the same 2px `currentColor` stroke style as the nav icons, so they inherit
 * the theme and add no dependency; formulas go through `MathText` so they are
 * typeset by the same KaTeX path as the questions beside them.
 */

import { useCallback, useId, useState } from "react";
import { MathText } from "@/components/app/MathText";
import {
  FloatingPanel,
  toolButtonClassName,
} from "@/components/app/exam/FloatingPanel";

const DEFAULT_WIDTH = 440;
const DEFAULT_HEIGHT = 620;

/** Shared figure geometry. Stroke only — flat, no fills, per the design rules. */
const FIGURE_PROPS = {
  viewBox: "0 0 120 78",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "h-[4.25rem] w-auto text-ink",
  "aria-hidden": true,
} as const;

/** Figure labels: small, muted, and never stroked — they are type, not line. */
const LABEL_PROPS = {
  fill: "currentColor",
  stroke: "none",
  fontSize: 11,
  className: "fill-muted font-sans",
} as const;

type Entry = {
  figure: React.ReactNode;
  /** One or two formulas, as `$…$` math source. */
  formulas: string[];
};

const ENTRIES: Entry[] = [
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <circle cx="42" cy="39" r="28" />
        <circle cx="42" cy="39" r="1.75" fill="currentColor" />
        <path d="M42 39h28" />
        <text {...LABEL_PROPS} x="53" y="35">
          r
        </text>
      </svg>
    ),
    formulas: ["$A = \\pi r^2$", "$C = 2\\pi r$"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <rect x="14" y="16" width="72" height="46" />
        <text {...LABEL_PROPS} x="46" y="74">
          ℓ
        </text>
        <text {...LABEL_PROPS} x="92" y="43">
          w
        </text>
      </svg>
    ),
    formulas: ["$A = \\ell w$"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <path d="M14 62h72L54 16z" />
        <path d="M54 16v46" strokeDasharray="4 3" />
        <path d="M54 56h6v6" strokeWidth="1.25" />
        <text {...LABEL_PROPS} x="46" y="74">
          b
        </text>
        <text {...LABEL_PROPS} x="42" y="42">
          h
        </text>
      </svg>
    ),
    formulas: ["$A = \\tfrac{1}{2}bh$"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <path d="M20 62h62L20 16z" />
        <path d="M20 54h8v8" strokeWidth="1.25" />
        <text {...LABEL_PROPS} x="48" y="74">
          a
        </text>
        <text {...LABEL_PROPS} x="8" y="42">
          b
        </text>
        <text {...LABEL_PROPS} x="56" y="34">
          c
        </text>
      </svg>
    ),
    formulas: ["$c^2 = a^2 + b^2$"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <path d="M24 62h60L24 20z" />
        <path d="M24 54h8v8" strokeWidth="1.25" />
        <text {...LABEL_PROPS} x="50" y="74">
          x√3
        </text>
        <text {...LABEL_PROPS} x="12" y="44">
          x
        </text>
        <text {...LABEL_PROPS} x="58" y="36">
          2x
        </text>
        <text {...LABEL_PROPS} x="27" y="33">
          60°
        </text>
        <text {...LABEL_PROPS} x="66" y="59">
          30°
        </text>
      </svg>
    ),
    formulas: ["30°-60°-90°"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <path d="M24 62h56L24 20z" />
        <path d="M24 54h8v8" strokeWidth="1.25" />
        <text {...LABEL_PROPS} x="48" y="74">
          s
        </text>
        <text {...LABEL_PROPS} x="12" y="44">
          s
        </text>
        <text {...LABEL_PROPS} x="56" y="34">
          s√2
        </text>
        <text {...LABEL_PROPS} x="28" y="33">
          45°
        </text>
        <text {...LABEL_PROPS} x="61" y="59">
          45°
        </text>
      </svg>
    ),
    formulas: ["45°-45°-90°"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <path d="M14 26h56v36H14z" />
        <path d="M14 26 32 14h56L70 26" />
        <path d="M70 62 88 50V14" />
        <text {...LABEL_PROPS} x="38" y="74">
          ℓ
        </text>
        <text {...LABEL_PROPS} x="94" y="38">
          h
        </text>
        <text {...LABEL_PROPS} x="76" y="22">
          w
        </text>
      </svg>
    ),
    formulas: ["$V = \\ell wh$"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <ellipse cx="50" cy="20" rx="30" ry="9" />
        <path d="M20 20v38M80 20v38" />
        <path d="M20 58a30 9 0 0 0 60 0" />
        <path d="M50 20h30" strokeDasharray="4 3" />
        <text {...LABEL_PROPS} x="60" y="17">
          r
        </text>
        <text {...LABEL_PROPS} x="88" y="43">
          h
        </text>
      </svg>
    ),
    formulas: ["$V = \\pi r^2 h$"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <circle cx="50" cy="39" r="27" />
        <ellipse cx="50" cy="39" rx="27" ry="9" strokeDasharray="4 3" />
        <path d="M50 39h27" />
        <text {...LABEL_PROPS} x="60" y="35">
          r
        </text>
      </svg>
    ),
    formulas: ["$V = \\tfrac{4}{3}\\pi r^3$"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <path d="M20 58 50 12l30 46" />
        <ellipse cx="50" cy="58" rx="30" ry="9" />
        <path d="M50 12v46" strokeDasharray="4 3" />
        <path d="M50 58h30" strokeDasharray="4 3" />
        <text {...LABEL_PROPS} x="62" y="55">
          r
        </text>
        <text {...LABEL_PROPS} x="38" y="42">
          h
        </text>
      </svg>
    ),
    formulas: ["$V = \\tfrac{1}{3}\\pi r^2 h$"],
  },
  {
    figure: (
      <svg {...FIGURE_PROPS}>
        <path d="M16 54h50v14H16z" />
        <path d="M16 54 34 42h50L66 54" />
        <path d="M66 68 84 56V42" />
        <path d="M50 10 16 54M50 10l16 44M50 10 84 42M50 10 34 42" />
        <path d="M50 10v38" strokeDasharray="4 3" />
        <text {...LABEL_PROPS} x="38" y="34">
          h
        </text>
        <text {...LABEL_PROPS} x="90" y="54">
          w
        </text>
        <text {...LABEL_PROPS} x="38" y="76">
          ℓ
        </text>
      </svg>
    ),
    formulas: ["$V = \\tfrac{1}{3}\\ell wh$"],
  },
];

const CLOSING_FACTS = [
  "The number of degrees of arc in a circle is $360$.",
  "The number of radians of arc in a circle is $2\\pi$.",
  "The sum of the measures in degrees of the angles of a triangle is $180$.",
];

const REFERENCE_ICON = (
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
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v14.5" />
    <path d="M6.5 16H19v3.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15" />
    <path d="M9 7.5h6" />
  </svg>
);

export function ReferenceSheet() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        aria-controls={panelId}
        className={toolButtonClassName(open)}
      >
        {REFERENCE_ICON}
        Reference
      </button>

      <FloatingPanel
        id={panelId}
        title="Reference sheet"
        open={open}
        onClose={close}
        defaultWidth={DEFAULT_WIDTH}
        defaultHeight={DEFAULT_HEIGHT}
      >
        <div className="h-full overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            {ENTRIES.map((entry, index) => (
              <figure key={index} className="flex flex-col items-center gap-1.5">
                {entry.figure}
                <figcaption className="flex flex-col items-center gap-0.5 text-center text-[0.9375rem] text-ink">
                  {entry.formulas.map((formula) => (
                    <MathText key={formula} text={formula} />
                  ))}
                </figcaption>
              </figure>
            ))}
          </div>

          <ul className="mt-6 flex flex-col gap-2 border-t border-hairline pt-4">
            {CLOSING_FACTS.map((fact) => (
              <li key={fact}>
                <MathText
                  text={fact}
                  className="text-[0.875rem] leading-relaxed text-muted"
                />
              </li>
            ))}
          </ul>
        </div>
      </FloatingPanel>
    </>
  );
}
