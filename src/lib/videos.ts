/**
 * Sample explainers shown in the video library preview.
 *
 * Placeholder content for the landing page — there is no video backend yet.
 * When one exists this module is the seam to replace: keep the `SampleVideo`
 * shape and swap the constant for a fetch (static/ISR, per CLAUDE.md caching).
 */

/** Which flat colour family a card uses. Maps to theme tokens, never raw hex. */
export type VideoTone = "accent" | "insight";

export type SampleVideo = {
  /** Video title. */
  title: string;
  /** Short category label shown as a chip on the thumbnail. */
  tag: string;
  /** Colour family: `accent` for Desmos technique, `insight` for mistake types. */
  tone: VideoTone;
  /** Runtime, `m:ss`. */
  length: string;
  /** Topic breadcrumb shown under the title. */
  meta: string;
};

export const sampleVideos: readonly SampleVideo[] = [
  {
    title: "Desmos: solve any system in 10 seconds",
    tag: "Desmos trick",
    tone: "accent",
    length: "2:45",
    meta: "desmos · graphing",
  },
  {
    title: "Sign errors when you factor quadratics",
    tag: "Mistake type",
    tone: "insight",
    length: "3:20",
    meta: "algebra · factoring",
  },
  {
    title: "Distributing before you divide",
    tag: "Mistake type",
    tone: "insight",
    length: "3:10",
    meta: "algebra · linear eq.",
  },
  {
    title: "Desmos: reading a table as a regression",
    tag: "Desmos trick",
    tone: "accent",
    length: "4:05",
    meta: "desmos · data",
  },
] as const;
