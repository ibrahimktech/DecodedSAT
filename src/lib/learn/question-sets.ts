/**
 * Turning a URL into a practice set, and back.
 *
 * Both question-bank pages need the same two operations and have to agree
 * exactly: the picker builds the links, the player reads them, and a
 * disagreement about what `?domain=algebra&subtopic=slope` means would show up
 * as a set that quietly contains the wrong questions.
 *
 * Free of `server-only` and of any database import, so the picker's client
 * component builds the same hrefs the server would read.
 *
 * ## Domains are a shorthand for subtopics
 *
 * A selection travels as domains plus subtopics because that is what the picker
 * offers — tick a whole domain, or pick three subtopics out of it. By the time
 * anything reaches the database there is only one question worth asking, which
 * is "which subtopics", so `resolveSetSelection` flattens the two and
 * everything downstream deals in subtopic slugs alone.
 *
 * A domain and one of its own subtopics selected together is not a conflict:
 * the domain already implies every subtopic under it, so the union is the
 * domain. Ticking a domain is a shorthand, never a narrowing.
 */

import type { Difficulty, Domain, Subtopic } from "./types";
import type { QuestionSetFilters } from "./schemas";

export type SetSelection = {
  /** Domains selected whole, kept so the URL and the picker stay legible. */
  domainSlugs: string[];
  /** Subtopics selected individually. */
  subtopicSlugs: string[];
  difficulties: Difficulty[];
  /** What the data layer takes: domains already flattened into subtopics. */
  filters: QuestionSetFilters;
};

/**
 * Resolves a raw selection against the domain and subtopic tables.
 *
 * Unknown slugs are dropped rather than failing the request — a stale bookmark
 * naming a renamed subtopic should practise the rest of what it names, not
 * error. An empty result means "no filter", which is the whole bank; that is
 * the deliberate meaning of selecting nothing, and it is what the picker's
 * "Practice everything" relies on.
 */
export function resolveSetSelection(
  domains: Domain[],
  subtopics: Subtopic[],
  raw: {
    domainSlugs: string[];
    subtopicSlugs: string[];
    difficulties: Difficulty[];
  },
): SetSelection {
  const knownSubtopicSlugs = new Set(subtopics.map((entry) => entry.slug));

  const domainSlugs = [...new Set(raw.domainSlugs)].filter((slug) =>
    domains.some((domain) => domain.slug === slug),
  );
  const subtopicSlugs = [...new Set(raw.subtopicSlugs)].filter((slug) =>
    knownSubtopicSlugs.has(slug),
  );
  const difficulties = [...new Set(raw.difficulties)];

  const selectedDomainIds = new Set(
    domains
      .filter((domain) => domainSlugs.includes(domain.slug))
      .map((domain) => domain.id),
  );
  const impliedSubtopicSlugs = subtopics
    .filter((subtopic) => selectedDomainIds.has(subtopic.domainId))
    .map((subtopic) => subtopic.slug);

  return {
    domainSlugs,
    subtopicSlugs,
    difficulties,
    filters: {
      subtopicSlugs: [...new Set([...subtopicSlugs, ...impliedSubtopicSlugs])],
      difficulties,
    },
  };
}

/**
 * A fresh seed for a shuffled set.
 *
 * Lives here rather than inline at the call site because generating one is not
 * part of rendering anything — the page calls this once, redirects, and every
 * render after that reads the seed back out of the URL.
 */
export function newSetSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * The canonical URL for a selection.
 *
 * Multi-values are comma-separated so a shared link stays readable, and every
 * list is sorted so the same selection always produces the same string — which
 * is what lets Next dedupe prefetches and stops the address bar reshuffling
 * itself as a student ticks boxes in a different order.
 */
export function buildSetHref(
  path: string,
  selection: Pick<
    SetSelection,
    "domainSlugs" | "subtopicSlugs" | "difficulties"
  >,
  options: { shuffle?: boolean; seed?: number } = {},
): string {
  const params = new URLSearchParams();

  if (selection.domainSlugs.length > 0) {
    params.set("domain", [...selection.domainSlugs].sort().join(","));
  }
  if (selection.subtopicSlugs.length > 0) {
    params.set("subtopic", [...selection.subtopicSlugs].sort().join(","));
  }
  if (selection.difficulties.length > 0) {
    // Ordered by severity rather than alphabetically, so the URL reads the way
    // the picker does.
    const order: Difficulty[] = ["easy", "medium", "hard"];
    params.set(
      "difficulty",
      order.filter((value) => selection.difficulties.includes(value)).join(","),
    );
  }
  if (options.shuffle) params.set("shuffle", "1");
  if (options.seed !== undefined) params.set("seed", String(options.seed));

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
