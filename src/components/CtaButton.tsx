import Link from "next/link";

/**
 * The site's only button.
 *
 * Per CLAUDE.md, every "Get started" button is identical everywhere it appears
 * — same colours, shape and size. That is enforced by there being exactly one
 * set of geometry classes here and no size prop. The secondary variant shares
 * that geometry (with a transparent border on primary so the 1px outline does
 * not make the two heights differ) so the pair aligns wherever they sit
 * side by side.
 */

type CtaButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
};

const GEOMETRY =
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl border px-8 py-3.5 " +
  "font-sans text-lg font-semibold leading-6 transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const VARIANTS = {
  primary: "border-transparent bg-accent text-surface hover:bg-accent-hover",
  secondary:
    "border-hairline text-accent hover:border-accent hover:text-accent-hover",
} as const;

export function CtaButton({
  href,
  children,
  variant = "primary",
  className = "",
}: CtaButtonProps) {
  return (
    <Link href={href} className={`${GEOMETRY} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}
