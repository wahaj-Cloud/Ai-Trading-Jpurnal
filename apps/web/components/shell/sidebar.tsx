"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { isActiveItem, NAV_HOME, type NavItem, navGroups } from "./nav-config";

const COLLAPSED_KEY = "wm-nav-collapsed";

function readCollapsed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function NavLink({
  item,
  pathname,
  nested,
}: {
  item: NavItem;
  pathname: string;
  nested?: boolean;
}) {
  const { label, href, icon: Icon } = item;
  const active = isActiveItem(pathname, item);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm transition-colors",
        nested ? "h-9" : "h-10",
        active
          ? "bg-hi/[0.12] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_14px_-6px_rgba(0,0,0,0.5)]"
          : "text-ink-muted hover:bg-hi/[0.06] hover:text-ink",
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
  );
}

/**
 * Desktop menu: Dashboard, then one folder per area (Journal, Coach and tools, Markets, Account).
 * Folders open and close; the folder of the current page always stays open. What the trader
 * closes is remembered on this device.
 */
export function Sidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const groups = navGroups(isAdmin);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => setCollapsed(readCollapsed()), []);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Private mode: the choice lasts for this visit only.
      }
      return next;
    });

  return (
    <aside className="surface sticky top-3 my-3 ml-3 hidden h-[calc(100dvh-1.5rem)] w-60 shrink-0 flex-col rounded-[var(--radius-surface)] lg:flex">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/dashboard" aria-label="WickMentor home">
          <Wordmark />
        </Link>
      </div>
      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <NavLink item={NAV_HOME} pathname={pathname} />
        <ul className="mt-2 grid gap-1">
          {groups.map((g) => {
            const hasActive = g.items.some((i) => isActiveItem(pathname, i));
            const open = hasActive || !collapsed.includes(g.id);
            const listId = `nav-${g.id}`;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => !hasActive && toggle(g.id)}
                  aria-expanded={open}
                  aria-controls={listId}
                  className={cn(
                    "flex h-8 w-full items-center justify-between rounded-[var(--radius-control)] px-3 text-[11px] font-semibold tracking-wider uppercase transition-colors",
                    hasActive
                      ? "cursor-default text-ink-muted"
                      : "text-ink-faint hover:text-ink-muted",
                  )}
                >
                  {g.label}
                  {!hasActive && (
                    <ChevronDown
                      className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")}
                      aria-hidden="true"
                    />
                  )}
                </button>
                {open && (
                  <ul id={listId} className="grid gap-0.5">
                    {g.items.map((item) => (
                      <li key={item.href}>
                        <NavLink item={item} pathname={pathname} nested />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
