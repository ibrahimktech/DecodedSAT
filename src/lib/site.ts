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
 * Link targets. The rest are in-page anchors because the product surfaces they
 * will eventually point at (the question bank, the video library) do not exist
 * yet.
 *
 * `getStarted` and `signIn` are real routes now. They stay relative so they
 * resolve against whatever origin the site is deployed on — the auth pages ship
 * with the landing page, not with the dashboard.
 */
export const links = {
  getStarted: "/auth/signup",
  signIn: "/auth/login",
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
