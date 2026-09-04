import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Baloo_2, Figtree, Noto_Serif } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { site } from "@/lib/site";
import "./globals.css";

/**
 * Fonts are self-hosted by `next/font` — no runtime request to Google, no
 * render-blocking stylesheet, and no third-party origin to allow in the CSP.
 */
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

const baloo = Baloo_2({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-baloo",
  display: "swap",
});

/** College Board's published digital-assessment content typeface. */
const notoSerif = Noto_Serif({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-noto-serif",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: [
    "SAT math",
    "SAT prep",
    "Desmos",
    "free SAT practice",
    "SAT math explainers",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#f1efe8",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${baloo.variable} ${notoSerif.variable}`}
    >
      <body className="antialiased">
        <Suspense fallback={children}>
          <AnalyticsProvider>{children}</AnalyticsProvider>
        </Suspense>
      </body>
    </html>
  );
}
