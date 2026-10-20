import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/me";

const TABS = [
  ["Overview", "/admin"],
  ["Users", "/admin/users"],
  ["Payments", "/admin/payments"],
  ["Costs & margins", "/admin/costs"],
  ["Scalp thresholds", "/admin/calibration"],
  ["Logs", "/admin/logs"],
  ["Announcements", "/admin/announcements"],
] as const;

/** Admin area: hidden (404) for everyone else; the API enforces the same rule on every call. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (me.role !== "ADMIN") notFound();
  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <nav aria-label="Admin" className="flex flex-wrap gap-1 border-b border-rule pb-3">
        <span className="mr-3 self-center text-xs font-semibold tracking-wide text-coach uppercase">
          Admin
        </span>
        {TABS.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            className="rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-ink-muted hover:bg-raised hover:text-ink"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
