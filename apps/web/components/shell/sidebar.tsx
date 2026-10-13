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
    <aside className="surface sticky top-3 my-3 ml-3 hidden h-[calc(100dvh-1.5rem)] w-60 shrink-0 flex-col rounded-[var(--radius-surface)] lg:flex">
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
                    "relative flex h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors",
                    active
                      ? "bg-white/[0.12] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_14px_-6px_rgba(0,0,0,0.5)]"
                      : "text-ink-muted hover:bg-white/[0.06] hover:text-ink",
                  )}
                >
                  {active && (
                    <span
                      className="absolute top-1/2 right-3 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-coach shadow-[0_0_8px_var(--color-coach)]"
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
