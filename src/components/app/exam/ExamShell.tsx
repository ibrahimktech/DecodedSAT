/**
 * The frame both question surfaces sit in — the practice test runner and the
 * question bank player.
 *
 * Modelled on the real digital SAT: no site navigation, tools and clock pinned
 * to the top, question in a single readable column, and the "where am I"
 * controls pinned to the bottom. A student who has practised here should find
 * nothing surprising about the layout on test day, which is the entire point.
 *
 * Pure layout. It holds no state, knows nothing about timers or questions, and
 * takes everything as slots — which is what lets a graded-as-you-go question
 * bank and a strictly-timed module wear the same chrome without either one
 * bending to fit the other.
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
  /**
   * Bottom-centre: the question navigator pill. Not called `navigator` — that
   * shadows the global of the same name, which the test runner reaches for a
   * few lines away to fire its abandonment beacon.
   */
  questionNav: React.ReactNode;
  /** Bottom-right: Back / Next / Submit. */
  actions: React.ReactNode;
};

export function ExamShell({
  left,
  timer,
  tools,
  children,
  questionNav,
  actions,
}: ExamShellProps) {
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

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>

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
