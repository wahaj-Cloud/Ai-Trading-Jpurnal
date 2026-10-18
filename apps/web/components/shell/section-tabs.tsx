"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { groupOf, isActiveItem } from "./nav-config";

/**
 * The tabs of the current folder (for example Markets: Live Charts, Trade Check, Market Desk,
 * Market Flow, Market Pulse, News), so related pages are one click apart on every screen size.
 */
export function SectionTabs({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const group = groupOf(pathname, isAdmin);
  if (!group || group.items.length < 2) return null;
  return (
    <nav aria-label={group.label} className="mx-auto mb-5 max-w-7xl">
      <ul className="-mx-3 flex gap-1 overflow-x-auto border-b border-rule px-3 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {group.items.map((item) => {
          const { label, href, icon: Icon } = item;
          const active = isActiveItem(pathname, item);
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-10 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "border-coach font-medium text-ink"
                    : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
