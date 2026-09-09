import { NotificationBell } from "@/components/app/NotificationBell";
import type { AppNotification } from "@/lib/notifications";

export function AppHeader({
  notifications,
}: {
  notifications: AppNotification[];
}) {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-end border-b border-hairline bg-background px-4 sm:px-8 lg:px-10">
      <NotificationBell initialNotifications={notifications} />
    </header>
  );
}
