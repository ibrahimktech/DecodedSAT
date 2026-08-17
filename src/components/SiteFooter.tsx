import Link from "next/link";
import { FoxMascot } from "@/components/FoxMascot";
import { links, site, social } from "@/lib/site";

/**
 * Footer nav points only at sections that actually exist. Social links render
 * only once a real URL is set in `site.ts`, so no dead link ever ships.
 */
const footerLinks = [
  { label: "How it works", href: links.how },
  { label: "Our mission", href: links.mission },
  { label: "Video library", href: links.library },
] as const;

const linkStyle =
  "text-[0.90625rem] font-medium text-muted transition-colors hover:text-accent-hover";

export function SiteFooter() {
  return (
    <footer className="border-t border-hairline bg-background">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-4 px-5 py-7 sm:px-10">
        <div className="flex items-center gap-2.5">
          <FoxMascot variant="head" className="h-8 w-auto" />
          <span className="font-display text-lg font-extrabold text-ink">{site.name}</span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {footerLinks.map(({ label, href }) => (
            <Link key={label} href={href} className={linkStyle}>
              {label}
            </Link>
          ))}
          {social.map(({ label, href }) =>
            href ? (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={linkStyle}
              >
                {label}
              </a>
            ) : null,
          )}
        </nav>

        <p className="w-full text-[0.8125rem] text-muted">
          &copy; 2026 {site.name} &middot; {site.tagline}
        </p>
      </div>
    </footer>
  );
}
