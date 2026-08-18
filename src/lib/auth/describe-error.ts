/**
 * Renders a thrown value as one readable line for a server log.
 *
 * Exists because `console.error("...", { error })` looks like it logs the
 * cause and does not: Next's development logger serialises object arguments
 * to `{}`, so the message, the code and the stack all vanish and the line
 * reads `[auth] signup threw {}`. Interpolating a string survives that.
 *
 * Server-side only, by convention rather than by `server-only` — the callers
 * are all actions and route handlers. Nothing this returns is ever sent to a
 * client; the auth surfaces answer with `GENERIC_ERROR_MESSAGE` regardless.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause ? ` <- caused by ${String(error.cause)}` : "";
    return `${error.name}: ${error.message}${cause}\n${error.stack ?? ""}`;
  }
  return typeof error === "string" ? error : JSON.stringify(error);
}
