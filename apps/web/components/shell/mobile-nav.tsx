"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV_ITEMS } from "./nav-config";

export function MobileNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => i.mobile);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {items.map(({ label, href, icon: Icon, available }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const content = (
            <>
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="text-[11px]">{label}</span>
            </>
          );
          const cls = "flex h-16 flex-col items-center justify-center gap-1";
          return (
            <li key={href}>
              {available ? (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(cls, active ? "text-coach" : "text-ink-muted")}
                >
                  {content}
                </Link>
              ) : (
                <span aria-disabled="true" className={cn(cls, "text-ink-faint/60")}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
