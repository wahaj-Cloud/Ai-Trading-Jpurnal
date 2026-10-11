"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { ADMIN_ITEM, NAV_ITEMS } from "./nav-config";

export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const items = isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-rule bg-panel lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" aria-label="AI Trading Coach home">
          <Wordmark />
        </Link>
      </div>
      <nav aria-label="Main" className="flex-1 px-3 py-2">
        <ul className="grid gap-0.5">
          {items.map(({ label, href, icon: Icon, available }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            if (!available) {
              return (
                <li key={href}>
                  <span
                    aria-disabled="true"
                    className="flex h-9 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-ink-faint"
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="flex-1">{label}</span>
                    <span className="text-xs">Soon</span>
                  </span>
                </li>
              );
            }
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors",
                    active
                      ? "bg-raised text-ink"
                      : "text-ink-muted hover:bg-raised/60 hover:text-ink",
                  )}
                >
                  {active && (
                    <span
                      className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-coach"
                      aria-hidden="true"
                    />
                  )}
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
