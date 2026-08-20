"use client";

/**
 * The admin panel's left navigation rail.
 *
 * Mirrors the student NavRail's geometry so switching surfaces doesn't feel
 * like switching products, with an amber "Admin" tag as the constant signal
 * of which side you're on. "View as student" sits with Logout below the
 * hairline — both leave the admin surface, neither is a fifth admin page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/auth/actions";
import { FoxMascot } from "@/components/FoxMascot";

type NavItem = {
  href: string;
  label: string;
  /** Overview is `/admin` itself; prefix-matching it would light everything. */
  exact?: boolean;
  icon: React.ReactNode;
};

/** 20px stroke icons, drawn inline so no icon package is added. */
const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "Overview",
    exact: true,
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/admin/questions",
    label: "Questions",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.3a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.2 1-1.2 1.9" />
        <path d="M12 16.8h.01" />
      </svg>
    ),
  },
  {
    href: "/admin/videos",
    label: "Videos",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m10 9 5 3-5 3z" />
      </svg>
    ),
  },
  {
    href: "/admin/practice-tests",
    label: "Practice tests",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h5M8 12h8M8 16h6" />
      </svg>
    ),
  },
  {
    href: "/admin/video-categories",
    label: "Video categories",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" />
        <path d="M21 9v9a1.5 1.5 0 0 1-1.5 1.5H7" />
      </svg>
    ),
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3.5 20c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
        <path d="M16 8.5a3 3 0 0 1 0 6" />
        <path d="M17.5 15.5c1.9.6 3 2 3.5 4.5" />
      </svg>
    ),
  },
];

const VIEW_AS_STUDENT_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

const LOGOUT_ICON = (
  <svg {...ICON_PROPS}>
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
    <path d="m10 17-5-5 5-5" />
    <path d="M5 12h11" />
  </svg>
);

function itemClassName(active: boolean): string {
  const base =
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.9375rem] font-medium transition-colors " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return active
    ? `${base} bg-accent-chip text-accent`
    : `${base} text-muted hover:bg-background hover:text-ink`;
}

export function AdminNav() {
  const pathname = usePathname();

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const renderItem = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(item) ? "page" : undefined}
      className={itemClassName(isActive(item))}
      title={item.label}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="hidden lg:inline">{item.label}</span>
    </Link>
  );

  return (
    <aside className="sticky top-0 flex h-screen w-[4.25rem] shrink-0 flex-col border-r border-hairline bg-surface px-2 py-5 lg:w-64 lg:px-4">
      <Link
        href="/admin"
        className="mb-6 flex items-center gap-2.5 rounded-xl px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <FoxMascot variant="head" className="h-9 w-auto" />
        <span className="hidden items-center gap-2 lg:flex">
          <span className="font-display text-xl font-extrabold text-ink">
            DecodedSAT
          </span>
          <span className="rounded-lg bg-insight-chip px-2 py-0.5 text-xs font-bold text-insight-dark">
            Admin
          </span>
        </span>
      </Link>

      <nav aria-label="Admin" className="flex flex-col gap-1">
        {NAV_ITEMS.map(renderItem)}
      </nav>

      {/* Below the hairline: ways out of the admin surface. */}
      <div className="mt-auto flex flex-col gap-1 border-t border-hairline pt-2">
        <Link
          href="/dashboard"
          className={itemClassName(false)}
          title="View as student"
        >
          <span className="shrink-0">{VIEW_AS_STUDENT_ICON}</span>
          <span className="hidden lg:inline">View as student</span>
        </Link>

        <form action={signOutAction}>
          <button type="submit" className={`${itemClassName(false)} w-full`}>
            <span className="shrink-0">{LOGOUT_ICON}</span>
            <span className="hidden lg:inline">Log out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
