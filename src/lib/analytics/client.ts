"use client";

import posthog from "posthog-js";
import {
  ANALYTICS_STORAGE_KEYS,
  ANALYTICS_THRESHOLDS,
} from "@/lib/analytics/constants";
import type {
  AnalyticsContext,
  StudentEventName,
  StudentEventProperties,
} from "@/lib/analytics/events";

const POSTHOG_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || "";
const POSTHOG_HOST = (
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com"
).replace(/\/+$/, "");

let initialized = false;
let actor: AnalyticsContext["actor"] = "anonymous";
let actorCreatedAt: string | undefined;
let contextResolved = false;
const pendingEvents: Array<{
  eventName: StudentEventName;
  properties: StudentEventProperties;
}> = [];

function safeStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function newSessionId(): string {
  return crypto.randomUUID();
}

function safeReferrer(): string {
  try {
    const referrer = new URL(document.referrer);
    return `${referrer.origin}${referrer.pathname}`;
  } catch {
    return "direct";
  }
}

function stripUrlDetails(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

function daysSinceSignup(): number | undefined {
  if (!actorCreatedAt) return undefined;
  const created = new Date(actorCreatedAt);
  if (Number.isNaN(created.valueOf())) return undefined;
  const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const createdUtc = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  return Math.max(0, Math.floor((todayUtc - createdUtc) / 86_400_000));
}

export function getAnalyticsSessionId(): string {
  const storage = safeStorage();
  if (!storage) return newSessionId();

  const now = Date.now();
  const lastActivity = Number(storage.getItem(ANALYTICS_STORAGE_KEYS.lastActivity));
  const expired =
    !Number.isFinite(lastActivity) ||
    now - lastActivity > ANALYTICS_THRESHOLDS.sessionIdleMinutes * 60_000;

  let sessionId = storage.getItem(ANALYTICS_STORAGE_KEYS.sessionId);
  if (!sessionId || expired) {
    sessionId = newSessionId();
    storage.setItem(ANALYTICS_STORAGE_KEYS.sessionId, sessionId);
  }
  storage.setItem(ANALYTICS_STORAGE_KEYS.lastActivity, String(now));
  return sessionId;
}

function initializePostHog(): void {
  if (initialized || !POSTHOG_TOKEN) return;
  posthog.init(POSTHOG_TOKEN, {
    api_host: POSTHOG_HOST,
    ui_host: POSTHOG_HOST.replace(".i.posthog.com", ".posthog.com"),
    defaults: "2026-05-30",
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    // Autocapture keeps click targets/positions for heatmaps without copying
    // visible question or profile text into event properties.
    mask_all_text: true,
    person_profiles: "identified_only",
    session_recording: {
      maskAllInputs: true,
      // DecodedSAT may be used by minors. Replays keep layout/interactions but
      // mask all page text and every input value by default.
      maskTextSelector: "*",
    },
    // Authentication codes and other query values must never reach analytics.
    // UTM attribution is captured separately through an explicit allowlist.
    before_send: (event) => {
      if (!event?.properties) return event;
      const properties = { ...event.properties };
      for (const key of ["$current_url", "$referrer", "$initial_referrer"]) {
        if (key in properties) properties[key] = stripUrlDetails(properties[key]);
      }
      return { ...event, properties };
    },
    loaded: (client) => {
      if (actor === "admin") {
        client.opt_out_capturing();
        client.stopSessionRecording();
      }
    },
  });
  initialized = true;
}

/**
 * Applies trusted server context to the browser tracker. Admins are opted out
 * completely, including when they browse student pages for testing.
 */
export function configureAnalytics(context: AnalyticsContext): void {
  actor = context.actor;
  actorCreatedAt = context.actor === "student" ? context.createdAt : undefined;
  contextResolved = true;

  if (context.actor === "admin") {
    pendingEvents.length = 0;
    safeStorage()?.removeItem(ANALYTICS_STORAGE_KEYS.identifiedUser);
    if (initialized) {
      posthog.reset();
      posthog.opt_out_capturing();
      posthog.stopSessionRecording();
    }
    return;
  }

  initializePostHog();
  if (!initialized) return;

  posthog.opt_in_capturing();
  const storage = safeStorage();
  const previousUser = storage?.getItem(ANALYTICS_STORAGE_KEYS.identifiedUser);

  if (context.actor === "student") {
    if (previousUser && previousUser !== context.userId) posthog.reset();
    posthog.identify(context.userId, {
      account_role: "student",
      ...(context.createdAt ? { created_at: context.createdAt } : {}),
    });
    const registeredUser = storage?.getItem(ANALYTICS_STORAGE_KEYS.registeredUser);
    const createdAt = context.createdAt ? new Date(context.createdAt).valueOf() : Number.NaN;
    if (
      registeredUser !== context.userId &&
      Number.isFinite(createdAt) &&
      Date.now() >= createdAt - 5 * 60_000 &&
      Date.now() - createdAt <= 30 * 60_000
    ) {
      posthog.capture("user_registered", { account_role: "student" });
      storage?.setItem(ANALYTICS_STORAGE_KEYS.registeredUser, context.userId);
    }
    storage?.setItem(ANALYTICS_STORAGE_KEYS.identifiedUser, context.userId);
    const queued = pendingEvents.splice(0);
    for (const event of queued) {
      trackStudentEvent(event.eventName, event.properties);
    }
  } else if (previousUser) {
    posthog.reset();
    storage?.removeItem(ANALYTICS_STORAGE_KEYS.identifiedUser);
  }
}

export function capturePageView(path: string): void {
  try {
    // Never start/capture until the server-authoritative role check resolves.
    if (!contextResolved || actor === "admin") return;
    initializePostHog();
    if (initialized) {
      const query = new URL(window.location.href).searchParams;
      posthog.register_once({
        initial_utm_source: query.get("utm_source") || undefined,
        initial_utm_medium: query.get("utm_medium") || undefined,
        initial_utm_campaign: query.get("utm_campaign") || undefined,
        initial_utm_content: query.get("utm_content") || undefined,
        initial_utm_term: query.get("utm_term") || undefined,
        initial_referrer: safeReferrer(),
        initial_landing_page: window.location.pathname,
      });
      posthog.capture("$pageview", {
        $current_url: `${window.location.origin}${window.location.pathname}`,
      });
    }
    if (actor === "student") touchStudentSession(new URL(path, window.location.origin).pathname);
  } catch {
    // Analytics must never interrupt navigation or learning.
  }
}

function durableWrite(eventName: string, properties: StudentEventProperties): void {
  const payload = JSON.stringify({
    sessionId: getAnalyticsSessionId(),
    eventName,
    properties: {
      ...properties,
      path: properties.path ?? window.location.pathname,
      posthog_session_id:
        initialized && typeof posthog.get_session_id === "function"
          ? posthog.get_session_id()
          : undefined,
    },
  });

  void fetch("/api/analytics/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}

/** The only client API for learning events. Analytics is always non-blocking. */
export function trackStudentEvent(
  eventName: StudentEventName,
  properties: StudentEventProperties = {},
): void {
  try {
    if (!contextResolved) {
      if (pendingEvents.length < 50) pendingEvents.push({ eventName, properties });
      return;
    }
    if (actor !== "student") return;
    initializePostHog();
    const shared = {
      ...properties,
      account_role: "student",
      analytics_session_id: getAnalyticsSessionId(),
      days_since_signup: daysSinceSignup(),
    };
    if (initialized) posthog.capture(eventName, shared);
    durableWrite(eventName, properties);
  } catch {
    // Product actions never depend on analytics availability.
  }
}

/** PostHog-only product event for anonymous acquisition/onboarding surfaces. */
export function trackProductEvent(
  eventName: string,
  properties: Record<string, string | number | boolean | null> = {},
): void {
  try {
    if (!contextResolved || actor === "admin") return;
    initializePostHog();
    if (initialized) posthog.capture(eventName, properties);
  } catch {
    // Product actions never depend on analytics availability.
  }
}

export function touchStudentSession(path: string): void {
  if (actor !== "student") return;
  const url = new URL(window.location.href);
  const referrer = safeReferrer();
  durableWrite("session_touched", {
    path,
    source: "route_change",
    ...Object.fromEntries(
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
        .map((key) => [key, url.searchParams.get(key)])
        .filter((entry): entry is [string, string] => Boolean(entry[1])),
    ),
    referrer: referrer === "direct" ? undefined : referrer,
  } as StudentEventProperties);
}

export function endStudentSession(): void {
  if (actor !== "student") return;
  durableWrite("session_ended", { path: window.location.pathname });
}

export function resetAnalyticsIdentity(): void {
  actor = "anonymous";
  actorCreatedAt = undefined;
  safeStorage()?.removeItem(ANALYTICS_STORAGE_KEYS.identifiedUser);
  if (initialized) posthog.reset();
}
