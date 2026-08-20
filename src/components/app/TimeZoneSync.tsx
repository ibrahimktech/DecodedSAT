"use client";

/**
 * Tells the server which timezone to print dates in.
 *
 * Renders nothing. On mount it compares the browser's IANA zone with the
 * `dsat_tz` cookie and rewrites it if they differ — which covers the first
 * visit, a student who travels, and the twice-yearly case where a zone's
 * name stays put but its offset moves (the cookie holds the NAME, so DST
 * needs no update at all).
 *
 * Only Progress and the dashboard heatmap read it. Everything else — streak,
 * daily goal, every scoring path — stays UTC, so a missing or stale cookie
 * degrades to "dates group in UTC" and never to anything incorrect.
 *
 * Not `httpOnly`, because the client is what writes it. Nothing is authorised
 * on the strength of this value; see `@/lib/learn/timezone`.
 */

import { useEffect } from "react";
import {
  TIMEZONE_COOKIE,
  TIMEZONE_COOKIE_MAX_AGE,
} from "@/lib/learn/timezone";

function readCookie(name: string): string | null {
  for (const entry of document.cookie.split("; ")) {
    const separator = entry.indexOf("=");
    if (separator === -1) continue;
    if (entry.slice(0, separator) === name) {
      return decodeURIComponent(entry.slice(separator + 1));
    }
  }
  return null;
}

export function TimeZoneSync() {
  useEffect(() => {
    let zone: string;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone) return;

    if (readCookie(TIMEZONE_COOKIE) === zone) return;

    // `Lax` rather than `Strict`: this needs to be present on the ordinary
    // top-level navigation that renders Progress, including one arrived at
    // from an external link.
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      `${TIMEZONE_COOKIE}=${encodeURIComponent(zone)}` +
      `; Path=/; Max-Age=${TIMEZONE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  }, []);

  return null;
}
