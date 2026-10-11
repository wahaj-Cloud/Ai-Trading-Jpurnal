import { Bell } from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

/** Server-rendered bell with the unread count; refreshed on navigation. */
export async function NotificationBell() {
  const { unread } = await apiFetch<{ unread: number }>("/v1/notifications/unread-count").catch(
    () => ({ unread: 0 }),
  );
  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-ink-muted hover:bg-raised hover:text-ink"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {unread > 0 && (
        <span className="figures absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-coach px-1 text-center text-[10px] font-semibold leading-4 text-coach-ink">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
