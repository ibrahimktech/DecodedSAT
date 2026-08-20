/**
 * Reading the viewer's timezone cookie. Server-only half of
 * `@/lib/learn/timezone` — see that module for why the cookie exists at all,
 * and why nothing is authorised on the strength of it.
 *
 * Split out because the shared half is imported by `<TimeZoneSync />`, a
 * client component, and `next/headers` cannot cross that line.
 */

import "server-only";
import { cookies } from "next/headers";
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  TIMEZONE_COOKIE,
} from "./timezone";

/** The viewer's timezone, or UTC when there is no usable answer. */
export async function getViewerTimeZone(): Promise<string> {
  const store = await cookies();
  const value = store.get(TIMEZONE_COOKIE)?.value;
  if (!value) return DEFAULT_TIME_ZONE;
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}
