"use client";

import { LayoutGrid, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { ADMIN_ITEM, NAV_ITEMS, type NavItem } from "./nav-config";

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * Phone navigation: the four most used pages in the bar, and "More" opening a sheet with every
 * other page (journal, reports, news, goals, calculators, exchanges, settings, help, admin).
 */
export function MobileNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const bar = NAV_ITEMS.filter((i) => i.mobile);
  const more: NavItem[] = [...NAV_ITEMS.filter((i) => !i.mobile), ...(isAdmin ? [ADMIN_ITEM] : [])];
  const moreActive = more.some((i) => isActive(pathname, i.href));

  // Close the sheet after navigating.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run on route change only
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const cls = "m-1 flex h-14 flex-col items-center justify-center gap-0.5 rounded-[22px]";
  const on = "bg-hi/[0.12] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]";

  return (
    <>
      <nav
        aria-label="Main"
        className="surface fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 rounded-[28px] px-1 lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {bar.map(({ label, href, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(cls, active ? on : "text-ink-muted")}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span className="text-[11px]">{label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className={cn(
                cls,
                "w-[calc(100%-0.5rem)]",
                moreActive || open ? on : "text-ink-muted",
              )}
            >
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
              <span className="text-[11px]">More</span>
            </button>
          </li>
        </ul>
      </nav>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close menu"
              className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="All pages"
              className="absolute inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] rounded-[28px] border border-rule bg-sheet p-4 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)]"
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="font-semibold">All pages</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-hi/[0.08]"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </button>
              </div>
              <ul className="grid grid-cols-3 gap-2">
                {[...bar, ...more].map(({ label, href, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border text-xs",
                          active
                            ? "border-coach/60 bg-coach/15 text-ink"
                            : "border-rule bg-hi/[0.03] text-ink-muted active:bg-hi/[0.08]",
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
