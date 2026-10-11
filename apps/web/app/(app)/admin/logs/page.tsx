import type { AdminAuditRowDto, AdminLogsPage, AdminSyncRowDto } from "@atc/shared";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

export const metadata = { title: "Admin · Logs" };

export default async function AdminLogs({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; failed?: string; cursor?: string }>;
}) {
  const p = await searchParams;
  const view = p.view === "sync" ? "sync" : "audit";
  const cursor = p.cursor && /^[0-9a-f-]{36}$/i.test(p.cursor) ? p.cursor : undefined;
  const failed = p.failed === "true";
  const tab = (v: string, label: string) => (
    <Link
      href={`/admin/logs?view=${v}`}
      aria-current={view === v ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-sm",
        view === v ? "border-coach" : "border-rule text-ink-muted",
      )}
    >
      {label}
    </Link>
  );
  const ts = (s: string) => s.slice(0, 19).replace("T", " ");

  if (view === "sync") {
    const page = await apiFetch<AdminLogsPage<AdminSyncRowDto>>(
      `/v1/admin/logs/sync?${new URLSearchParams({ failed: String(failed), ...(cursor ? { cursor } : {}) })}`,
    );
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <div className="flex flex-wrap gap-2">
          {tab("audit", "Audit log")}
          {tab("sync", "Sync runs")}
          <Link
            href={`/admin/logs?view=sync&failed=${!failed}`}
            className="ml-2 self-center text-sm text-ink-muted underline"
          >
            {failed ? "Show all runs" : "Failures only"}
          </Link>
        </div>
        <ul className="grid gap-1 text-sm">
          {page.items.map((r) => (
            <li
              key={r.id}
              className="rounded-[var(--radius-control)] border border-rule bg-panel px-3 py-2"
            >
              <span className="figures text-xs text-ink-faint">{ts(r.startedAt)}</span>{" "}
              <span
                className={
                  r.status === "FAILED"
                    ? "text-loss"
                    : r.status === "SUCCEEDED"
                      ? "text-profit"
                      : ""
                }
              >
                {r.status.toLowerCase()}
              </span>{" "}
              · {r.exchange} · {r.kind.toLowerCase()} · {r.userEmail}
              {r.errorCode && (
                <span className="block text-xs text-ink-muted">
                  {r.errorCode}: {r.errorMessage}
                </span>
              )}
            </li>
          ))}
        </ul>
        {page.nextCursor && (
          <Link
            href={`/admin/logs?view=sync&failed=${failed}&cursor=${page.nextCursor}`}
            className="text-sm text-ink-muted"
          >
            Older
          </Link>
        )}
      </>
    );
  }
  const page = await apiFetch<AdminLogsPage<AdminAuditRowDto>>(
    `/v1/admin/logs/audit${cursor ? `?cursor=${cursor}` : ""}`,
  );
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
      <div className="flex gap-2">
        {tab("audit", "Audit log")}
        {tab("sync", "Sync runs")}
      </div>
      <ul className="grid gap-1 text-sm">
        {page.items.map((a) => (
          <li
            key={a.id}
            className="rounded-[var(--radius-control)] border border-rule bg-panel px-3 py-2"
          >
            <span className="figures text-xs text-ink-faint">{ts(a.createdAt)}</span>{" "}
            <span className="font-medium">{a.action}</span> · {a.entity}
            {a.entityId ? ` ${a.entityId.slice(0, 8)}` : ""} · {a.actorEmail ?? "system"}
            {a.ip ? <span className="text-ink-faint"> · {a.ip}</span> : null}
          </li>
        ))}
      </ul>
      {page.nextCursor && (
        <Link href={`/admin/logs?cursor=${page.nextCursor}`} className="text-sm text-ink-muted">
          Older
        </Link>
      )}
    </>
  );
}
