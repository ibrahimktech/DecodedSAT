import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Social preview card.
 *
 * Satori (the renderer behind `ImageResponse`) resolves neither Tailwind
 * classes nor CSS custom properties, so the palette is written out literally
 * here. These values mirror the `@theme` block in `globals.css` — change both
 * together. This is the one place in the project where literal hex is expected.
 */
const palette = {
  background: "#f1efe8",
  surface: "#ffffff",
  hairline: "#d3d1c7",
  ink: "#04342c",
  muted: "#5f5e5a",
  accent: "#1d9e75",
  insight: "#ef9f27",
  insightSurface: "#fff7ec",
  insightDark: "#ba7517",
};

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: palette.background,
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: palette.ink,
              letterSpacing: "-0.02em",
            }}
          >
            {site.name}
          </div>

          <div
            style={{
              marginTop: 36,
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.1,
              color: palette.ink,
              letterSpacing: "-0.02em",
              maxWidth: 900,
            }}
          >
            We find out why you missed it — then hand you the two-minute fix.
          </div>

          <div
            style={{
              marginTop: 28,
              fontSize: 30,
              lineHeight: 1.4,
              color: palette.muted,
              maxWidth: 820,
            }}
          >
            Targeted SAT math questions, Desmos lessons, and a short explainer aimed at
            your exact mistake.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: palette.accent,
              color: palette.surface,
              fontSize: 28,
              fontWeight: 600,
              padding: "16px 34px",
              borderRadius: 14,
            }}
          >
            {site.tagline}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: palette.insightSurface,
              border: `2px solid ${palette.insight}`,
              color: palette.insightDark,
              fontSize: 28,
              fontWeight: 600,
              padding: "16px 34px",
              borderRadius: 14,
            }}
          >
            decodedsat.com
          </div>

          <div
            style={{
              display: "flex",
              flex: 1,
              height: 2,
              backgroundColor: palette.hairline,
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
