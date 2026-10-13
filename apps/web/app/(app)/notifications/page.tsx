import { NOTIFICATION_KINDS, type NotificationsPage } from "@atc/shared";
import Link from "next/link";
import { MarkAllRead } from "@/features/notifications/mark-all";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getMe } from "@/lib/me";

export const metadata = { title: "Notifications" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NotificationsPageView({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const q = cursor && UUID.test(cursor) ? `?cursor=${cursor}` : "";
  const [page, me] = await Promise.all([
    apiFetch<NotificationsPage>(`/v1/notifications${q}`),
    getMe(),
  ]);
  const when = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: me.timezone,
  });
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {page.unread} unread.{" "}
            <Link
              href="/settings#notifications"
              className="underline underline-offset-4 hover:text-ink"
            >
              Email preferences
            </Link>
          </p>
        </div>
        <MarkAllRead disabled={page.unread === 0} />
      </header>
      {page.items.length === 0 ? (
        <p className="rounded-[var(--radius-surface)] surface p-8 text-center text-sm text-ink-muted">
          Nothing yet. Risk warnings, reminders, reports and coaching notes appear here.
        </p>
      ) : (
        <ul className="grid gap-2">
          {page.items.map((n) => (
            <li
              key={n.id}
              className={cn(
                "rounded-[var(--radius-surface)] border bg-panel px-4 py-3",
                n.read ? "border-rule" : "border-coach/50",
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {!n.read && <span className="sr-only">Unread: </span>}
                  {n.link ? (
                    <Link href={n.link} className="hover:underline">
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                </p>
                <p className="text-xs text-ink-faint">
                  {NOTIFICATION_KINDS[n.kind]} · {when.format(new Date(n.createdAt))}
                </p>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor && (
        <Link
          href={`/notifications?cursor=${page.nextCursor}`}
          className="text-sm text-ink-muted hover:text-ink"
        >
          Older notifications
        </Link>
      )}
    </div>
  );
}
