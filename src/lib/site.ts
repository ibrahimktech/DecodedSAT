/**
 * Single source of truth for site-level copy and every outbound/anchor link
 * target used by the landing page. Nothing here is secret — it is all public
 * marketing metadata, so it is safe to import from client and server alike.
 */

export const site = {
  name: "DecodedSAT",
  tagline: "Free SAT Math, decoded.",
  url: "https://decodedsat.com",
  description:
    "DecodedSAT figures out why you missed an SAT math question, then sends you a short explainer video that fixes that exact gap — not another pile of random practice problems. Free.",
} as const;

/**
 * Link targets. These are in-page anchors for now because the product surfaces
 * they will eventually point at (the question bank, auth) do not exist yet.
 *
 * To send "Get started" out to YouTube instead, change `getStarted` to that URL
 * — every button on the page reads from this one value.
 */
export const links = {
  getStarted: "#how",
  signIn: "#top",
  library: "#library",
  /** No library page exists yet, so "Browse all" explains how videos reach you. */
  browseAll: "#how",
  mission: "#mission",
  how: "#how",
  top: "#top",
} as const;

/**
 * Social profiles. Left `null` deliberately: the footer renders a link only
 * when a real URL is present, so no placeholder or dead link ever ships. Fill
 * these in when the channels are live.
 */
export const social: { label: string; href: string | null }[] = [
  { label: "YouTube", href: null },
  { label: "Instagram", href: null },
];
