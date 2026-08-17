/**
 * The DecodedSAT student-fox mascot.
 *
 * Two crops of the same artwork: `head` for the navbar/footer lockup and the
 * mission panel, `full` for the hero.
 *
 * Rendered as a plain `<img>` rather than `next/image` on purpose — these are
 * vectors, so the image optimiser has nothing to resize or re-encode, and
 * routing SVG through it would mean enabling `dangerouslyAllowSVG`.
 */

const VARIANTS = {
  full: { src: "/fox-full.svg", width: 440, height: 620 },
  head: { src: "/fox-head.svg", width: 250, height: 302 },
} as const;

type FoxMascotProps = {
  variant: keyof typeof VARIANTS;
  className?: string;
  /**
   * Accessible label. Omit for decorative uses where adjacent text already
   * names the thing (the navbar and footer wordmark lockups).
   */
  alt?: string;
};

export function FoxMascot({ variant, className = "", alt = "" }: FoxMascotProps) {
  const { src, width, height } = VARIANTS[variant];

  return (
    // eslint-disable-next-line @next/next/no-img-element -- vector asset, see above
    <img
      src={src}
      width={width}
      height={height}
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      className={className}
    />
  );
}
