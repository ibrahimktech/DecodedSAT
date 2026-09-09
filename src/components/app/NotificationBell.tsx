"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/notifications/actions";
import type { AppNotification } from "@/lib/notifications";

export function NotificationBell({
  initialNotifications,
}: {
  initialNotifications: AppNotification[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((item) => item.readAt === null).length;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function markRead(id: string) {
    const readAt = new Date().toISOString();
    setMessage(null);
    setNotifications((items) =>
      items.map((item) => (item.id === id ? { ...item, readAt } : item)),
    );
    startTransition(async () => {
      const result = await markNotificationReadAction({ id });
      if (result.status !== "ok") setMessage(result.message);
    });
  }

  function markAllRead() {
    const readAt = new Date().toISOString();
    setMessage(null);
    setNotifications((items) =>
      items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
    );
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (result.status !== "ok") setMessage(result.message);
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-hairline bg-surface text-ink transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-insight px-1.5 py-0.5 text-center text-[0.6875rem] font-bold leading-none text-ink">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-13 z-40 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-hairline bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <h2 className="font-display text-lg font-bold text-ink">
              Notifications
            </h2>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={pending}
                className="text-xs font-semibold text-accent hover:text-accent-hover disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              You have no notifications yet.
            </p>
          ) : (
            <ul className="max-h-[24rem] overflow-y-auto">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={`border-b border-hairline px-4 py-3 last:border-b-0 ${
                    notification.readAt === null ? "bg-accent-chip" : "bg-surface"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        notification.readAt === null ? "bg-accent" : "bg-hairline"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      {notification.linkUrl ? (
                        <Link
                          href={notification.linkUrl}
                          onClick={() => {
                            if (notification.readAt === null) {
                              markRead(notification.id);
                            }
                            setOpen(false);
                          }}
                          className="text-sm font-medium leading-relaxed text-ink hover:text-accent"
                        >
                          {notification.message}
                        </Link>
                      ) : (
                        <p className="text-sm font-medium leading-relaxed text-ink">
                          {notification.message}
                        </p>
                      )}
                      <time
                        dateTime={notification.createdAt}
                        suppressHydrationWarning
                        className="mt-1 block text-xs text-muted"
                      >
                        {formatDate(notification.createdAt)}
                      </time>
                    </div>
                    {notification.readAt === null && (
                      <button
                        type="button"
                        onClick={() => markRead(notification.id)}
                        disabled={pending}
                        className="shrink-0 text-xs font-semibold text-accent hover:text-accent-hover disabled:opacity-50"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {message && (
            <p role="alert" className="border-t border-miss-hairline bg-miss-surface px-4 py-2 text-xs text-miss-ink">
              {message}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
