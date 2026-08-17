import Link from "next/link";
import { CtaButton } from "@/components/CtaButton";
import { FoxMascot } from "@/components/FoxMascot";
import { links, site } from "@/lib/site";

/**
 * Sticky floating navbar.
 *
 * The header carries the page background so content scrolling underneath does
 * not show through the 20px inset above the card.
 *
 * Narrow screens shed the secondary items rather than hiding everything behind
 * a menu: the wordmark stays in the accessibility tree via `sr-only` (so the
 * home link keeps its name when only the mascot is visible), and "Get started"
 * — the one action that matters — is never dropped.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 bg-background px-4 pt-4 sm:px-5 sm:pt-5">
      <nav className="mx-auto flex max-w-page items-center justify-between rounded-[1.25rem] border border-hairline bg-surface py-3 pr-3 pl-4 shadow-nav sm:py-3.5 sm:pr-4 sm:pl-5">
        <Link href={links.top} className="flex items-center gap-3">
          <FoxMascot variant="head" className="h-[2.875rem] w-auto" />
          <span className="sr-only font-display text-[1.625rem] font-extrabold tracking-tight text-ink sm:not-sr-only">
            {site.name}
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-3.5">
          <Link
            href={links.mission}
            className="mr-1 hidden text-[1.0625rem] font-medium whitespace-nowrap text-muted transition-colors hover:text-accent-hover lg:inline"
          >
            Our mission
          </Link>
          {/* Wrapper handles the responsive hide: `hidden` on the button itself
              would fight the `inline-flex` in its own base classes. */}
          <div className="hidden md:block">
            <CtaButton href={links.signIn} variant="secondary">
              Sign in
            </CtaButton>
          </div>
          <CtaButton href={links.getStarted}>Get started</CtaButton>
        </div>
      </nav>
    </header>
  );
}
