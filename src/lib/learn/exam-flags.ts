"use client";

/**
 * Mark-for-review flags and crossed-out answer choices.
 *
 * Both are viewer-side annotations over questions the client already has. They
 * are working notes, not answers: nothing here is sent anywhere, nothing here
 * is graded, and losing them costs a student nothing but a little convenience.
 * That is exactly why they live in `sessionStorage` rather than in the
 * database — persisting them would mean a migration, an RPC, and a slice of the
 * autosave rate limit for state that stops mattering the moment the tab closes.
 *
 * ## Why sessionStorage and not React state alone
 *
 * A 35-minute timed module is long enough that an accidental refresh happens.
 * Answers survive one (they autosave server-side); flags kept only in React
 * state would not, and a student who came back to find every review mark gone
 * would reasonably conclude the feature is broken. `sessionStorage` is scoped
 * to the tab, so it dies with the sitting and never leaks between students on a
 * shared computer.
 *
 * ## Why `useSyncExternalStore` and not an effect
 *
 * `sessionStorage` does not exist during the server render, so the value on the
 * first client paint genuinely differs from the server's — the definition of
 * the problem this hook is for. It renders the server snapshot (nothing marked)
 * during hydration and swaps to the stored one immediately after, with no
 * mismatch and no cascading render from a `setState` in an effect.
 *
 * The snapshot has to be referentially stable between reads or React re-renders
 * forever, which is what the module-level cache below is for: parse once per
 * scope, and replace the cached object only when something actually changes.
 *
 * ## Scope keys
 *
 * One entry per surface: `test:<attemptId>:m<moduleNumber>` and
 * `qbank:<batchKey>`. Keying the test by module is what makes module 2 start
 * with a clean sheet — the runner is already remounted across that boundary.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_PREFIX = "decodedsat:exam-flags:";

/** Serialised shape. Arrays rather than Sets — `JSON.stringify` needs them. */
type StoredFlags = {
  marked: string[];
  crossed: Record<string, number[]>;
};

/**
 * The empty value, shared by every scope.
 *
 * One frozen instance, so `getServerSnapshot` returns the same reference every
 * time it is called — a fresh `{}` each render is the classic way to make
 * `useSyncExternalStore` loop.
 */
const EMPTY: StoredFlags = Object.freeze({
  marked: Object.freeze([]) as unknown as string[],
  crossed: Object.freeze({}) as Record<string, number[]>,
});

/**
 * Reads one scope back, tolerating every way this can go wrong.
 *
 * Storage throws outright in some privacy modes rather than returning null, and
 * the stored value could be anything if a previous version wrote a different
 * shape. Neither is worth an error boundary over working notes: an unreadable
 * entry is treated as no entry.
 */
function read(scope: string): StoredFlags {
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${scope}`);
    if (!raw) return EMPTY;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;

    const value = parsed as Partial<StoredFlags>;
    const marked = Array.isArray(value.marked)
      ? value.marked.filter((id): id is string => typeof id === "string")
      : [];

    const crossed: Record<string, number[]> = {};
    if (typeof value.crossed === "object" && value.crossed !== null) {
      for (const [id, choices] of Object.entries(value.crossed)) {
        if (!Array.isArray(choices)) continue;
        crossed[id] = choices.filter(
          (choice): choice is number =>
            Number.isInteger(choice) && choice >= 0 && choice <= 3,
        );
      }
    }

    return { marked, crossed };
  } catch {
    return EMPTY;
  }
}

function persist(scope: string, flags: StoredFlags): void {
  try {
    window.sessionStorage.setItem(
      `${STORAGE_PREFIX}${scope}`,
      JSON.stringify(flags),
    );
  } catch {
    // Full, disabled, or blocked. The flags still work for this page load.
  }
}

/** Parsed value per scope. Stable references are the store's contract. */
const cache = new Map<string, StoredFlags>();
const listeners = new Set<() => void>();

function snapshot(scope: string): StoredFlags {
  let value = cache.get(scope);
  if (value === undefined) {
    value = read(scope);
    cache.set(scope, value);
  }
  return value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(scope: string, next: StoredFlags): void {
  cache.set(scope, next);
  persist(scope, next);
  for (const listener of listeners) listener();
}

export type ExamFlags = {
  isMarked: (questionId: string) => boolean;
  toggleMark: (questionId: string) => void;
  /** Which choices are struck through on this question. */
  crossedFor: (questionId: string) => readonly number[];
  toggleCross: (questionId: string, choice: number) => void;
};

export function useExamFlags(scope: string): ExamFlags {
  const flags = useSyncExternalStore(
    subscribe,
    useCallback(() => snapshot(scope), [scope]),
    // Nothing is marked until the browser tells us otherwise.
    () => EMPTY,
  );

  const toggleMark = useCallback(
    (questionId: string) => {
      const current = snapshot(scope);
      update(scope, {
        ...current,
        marked: current.marked.includes(questionId)
          ? current.marked.filter((id) => id !== questionId)
          : [...current.marked, questionId],
      });
    },
    [scope],
  );

  const toggleCross = useCallback(
    (questionId: string, choice: number) => {
      const current = snapshot(scope);
      const existing = current.crossed[questionId] ?? [];
      const next = existing.includes(choice)
        ? existing.filter((entry) => entry !== choice)
        : [...existing, choice];

      const crossed = { ...current.crossed };
      // Drop the key rather than storing an empty array, so an entry that has
      // been fully un-crossed leaves nothing behind.
      if (next.length === 0) delete crossed[questionId];
      else crossed[questionId] = next;

      update(scope, { ...current, crossed });
    },
    [scope],
  );

  return {
    isMarked: (questionId) => flags.marked.includes(questionId),
    toggleMark,
    crossedFor: (questionId) => flags.crossed[questionId] ?? [],
    toggleCross,
  };
}
