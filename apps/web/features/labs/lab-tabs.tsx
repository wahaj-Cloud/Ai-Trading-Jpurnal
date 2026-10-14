"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/lab", label: "What-If Lab", badge: "Pro" },
  { href: "/lab/strategy", label: "Strategy Lab", badge: "Premium" },
];

export function LabTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Lab" className="flex gap-1 rounded-full border border-rule p-1 text-sm">
      {TABS.map((t) => {
        const active = t.href === "/lab" ? path === "/lab" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-full px-3 whitespace-nowrap transition-colors",
              active ? "bg-coach/15 font-medium text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
            <span className="rounded-full bg-hi/10 px-1.5 text-[10px] text-ink-faint">
              {t.badge}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
