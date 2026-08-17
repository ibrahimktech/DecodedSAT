/**
 * The three-step decode loop — the most visual weight on the page.
 *
 * Each card shares chrome (numbered tile, step label, heading, body) and then
 * slots in its own demo panel, so the three demos stay literal rather than
 * being squeezed through one over-general prop shape.
 */

import type { ReactNode } from "react";

type StepTone = "default" | "insight";

type StepCardProps = {
  step: number;
  label: string;
  title: string;
  children: ReactNode;
  /** Demo panel rendered under the copy. */
  demo: ReactNode;
  tone?: StepTone;
};

const CARD_TONE = {
  default: "border-hairline bg-surface",
  insight: "border-insight bg-insight-surface shadow-insight",
} as const;

const TILE_TONE = {
  default: "bg-ink text-background",
  insight: "bg-insight text-surface",
} as const;

const LABEL_TONE = {
  default: "text-muted",
  insight: "text-insight-dark",
} as const;

function StepCard({ step, label, title, children, demo, tone = "default" }: StepCardProps) {
  return (
    <div className={`flex flex-col rounded-[1.25rem] border p-7 ${CARD_TONE[tone]}`}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className={`flex size-[2.375rem] flex-none items-center justify-center rounded-[0.6875rem] font-display text-[1.1875rem] font-bold ${TILE_TONE[tone]}`}
        >
          {step}
        </span>
        <span
          className={`font-display text-sm font-bold tracking-[0.02em] uppercase ${LABEL_TONE[tone]}`}
        >
          {label}
        </span>
      </div>

      <h3 className="text-[1.4375rem] font-bold text-ink">{title}</h3>
      <p className="mt-2.5 flex-1 text-base leading-relaxed text-muted">{children}</p>

      <div className="mt-5">{demo}</div>
    </div>
  );
}

/** Step 1 — the question, with the tempting wrong answer already selected. */
function MissedQuestionDemo() {
  const choices = [
    { value: "6", picked: true },
    { value: "4", picked: false },
    { value: "2", picked: false },
  ];

  return (
    <div className="rounded-xl border border-hairline bg-background px-4 py-4">
      <p className="mb-2 text-sm font-semibold text-muted">
        If 3(x&minus;2) = 12, then x =
      </p>
      <div className="flex gap-2">
        {choices.map(({ value, picked }) => (
          <span
            key={value}
            className={`flex-1 rounded-[0.5625rem] border py-2 text-center font-semibold ${
              picked
                ? "border-miss-hairline bg-miss-surface text-miss-ink"
                : "border-hairline bg-surface text-muted"
            }`}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Step 2 — the misconception, named. */
function DiagnosisDemo() {
  return (
    <div className="rounded-xl border border-hairline bg-background px-4 py-4">
      <p className="mb-2 text-[0.78125rem] font-bold tracking-[0.03em] text-ink uppercase">
        Diagnosis
      </p>
      <p className="text-[0.9375rem] leading-normal text-muted">
        You divided before distributing the 3. This is a{" "}
        <span className="font-semibold text-ink">distribution order</span> error.
      </p>
    </div>
  );
}

/** Step 3 — the explainer that closes the gap. */
function TargetedVideoDemo() {
  return (
    <div className="overflow-hidden rounded-xl border border-insight-hairline">
      <div className="stripe-amber flex aspect-video items-center justify-center">
        <span className="flex size-13 items-center justify-center rounded-full bg-insight shadow-play-insight">
          <span className="play-triangle ml-1 text-[1.125rem] text-surface" />
        </span>
      </div>
      <div className="bg-surface px-3.5 py-3">
        <p className="text-[0.90625rem] font-semibold text-ink">
          Distribute first: fixing 3(x&minus;2) mistakes
        </p>
        <p className="mt-0.5 text-[0.8125rem] font-semibold text-insight-dark">
          3:10 &middot; targeted explainer
        </p>
      </div>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-page px-5 py-14 sm:px-10">
      <div className="mx-auto mb-11 max-w-[40rem] text-center">
        <h2 className="text-[2rem] font-extrabold text-ink sm:text-[2.5rem]">
          How DecodedSAT works
        </h2>
        <p className="mt-3.5 text-lg leading-normal text-muted">
          Three steps. Every wrong answer turns into the exact thing you need to watch
          next.
        </p>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-3">
        <StepCard
          step={1}
          label="You get one wrong"
          title="A question trips you up"
          demo={<MissedQuestionDemo />}
        >
          You answer a real SAT-style math question and miss it. Instead of just flashing
          a red X, DecodedSAT holds onto your answer.
        </StepCard>

        <StepCard
          step={2}
          label="We diagnose it"
          title="The real mistake gets named"
          demo={<DiagnosisDemo />}
        >
          DecodedSAT looks at the wrong answer you chose and identifies the specific
          misconception behind it — not just that you&rsquo;re wrong, but where the
          thinking broke.
        </StepCard>

        <StepCard
          step={3}
          label="The fix"
          title="One explainer video, aimed at that gap"
          tone="insight"
          demo={<TargetedVideoDemo />}
        >
          You get a 2&ndash;4 minute explainer video built for that exact mistake. Watch it, understand the topics, learn some tricks and
          the misconception is gone — for good, not just for this question.
        </StepCard>
      </div>
    </section>
  );
}
