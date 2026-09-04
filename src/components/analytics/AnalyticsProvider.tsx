"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  capturePageView,
  configureAnalytics,
  endStudentSession,
} from "@/lib/analytics/client";
import type { AnalyticsContext } from "@/lib/analytics/events";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/analytics/context", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("analytics context unavailable");
        return (await response.json()) as AnalyticsContext;
      })
      .then((context) => {
        if (cancelled) return;
        configureAnalytics(context);
        capturePageView(window.location.pathname + window.location.search);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname, query]);

  useEffect(() => {
    const onPageHide = () => endStudentSession();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  return children;
}
