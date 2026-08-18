"use client";

/**
 * The signed-in app's left navigation rail.
 *
 * Order is fixed by the step spec: the four product pages in sequence,
 * Settings pinned lower, and Logout separated below Settings by a hairline —
 * it is a different class of action (leaves the app) and must not read as a
 * fifth sibling of the pages.
 *
 * Client component only for `usePathname()` (active-state highlighting); the
 * sign-out form posts straight to the existing Server Action.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/auth/actions";
import { FoxMascot } from "@/components/FoxMascot";

type NavItem = {
  href: string;
  label: string;
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
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
      </svg>
    ),
  },
  {
    href: "/videos",
    label: "Explainer videos",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m10 9 5 3-5 3z" />
      </svg>
    ),
  },
  {
    href: "/questions",
    label: "Question bank",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.3a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.2 1-1.2 1.9" />
        <path d="M12 16.8h.01" />
      </svg>
    ),
  },
  {
    href: "/practice",
    label: "Practice tests",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2.5 2.5" />
        <path d="M9 2h6" />
      </svg>
    ),
  },
];

const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
};

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

export function NavRail() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const renderItem = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isActive(item.href) ? "page" : undefined}
      className={itemClassName(isActive(item.href))}
      title={item.label}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="hidden lg:inline">{item.label}</span>
    </Link>
  );

  return (
    <aside className="sticky top-0 flex h-screen w-[4.25rem] shrink-0 flex-col border-r border-hairline bg-surface px-2 py-5 lg:w-64 lg:px-4">
      <Link
        href="/dashboard"
        className="mb-6 flex items-center gap-2.5 rounded-xl px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <FoxMascot variant="head" className="h-9 w-auto" />
        <span className="hidden font-display text-xl font-extrabold text-ink lg:inline">
          DecodedSAT
        </span>
      </Link>

      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV_ITEMS.map(renderItem)}
      </nav>

      {/* Settings sits low, apart from the everyday pages. */}
      <div className="mt-auto flex flex-col gap-1">
        {renderItem(SETTINGS_ITEM)}

        {/* Hairline before logout: leaving the app is not another page. */}
        <form action={signOutAction} className="mt-2 border-t border-hairline pt-2">
          <button type="submit" className={`${itemClassName(false)} w-full`}>
            <span className="shrink-0">{LOGOUT_ICON}</span>
            <span className="hidden lg:inline">Log out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
