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
      className="surface fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 rounded-[28px] px-1 lg:hidden"
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
          const cls = "m-1 flex h-14 flex-col items-center justify-center gap-0.5 rounded-[22px]";
          return (
            <li key={href}>
              {available ? (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    cls,
                    active
                      ? "bg-white/[0.12] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                      : "text-ink-muted",
                  )}
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
