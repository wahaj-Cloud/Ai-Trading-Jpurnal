"use client";

import { CalendarDays, Coins, CornerDownLeft, LayoutGrid, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { searchContextAction } from "./actions";
import { buildResults, type SearchGroup, type SearchItem } from "./search-items";

const ICONS: Record<SearchGroup, typeof Search> = {
  Ask: Sparkles,
  Pages: LayoutGrid,
  Coins: Coins,
  Months: CalendarDays,
};
const GROUP_LABEL: Record<SearchGroup, string> = {
  Ask: "Ask your coach",
  Pages: "Pages and tools",
  Coins: "Your coins",
  Months: "Months",
};

/**
 * Search anything or ask the coach, from every page. Ctrl/⌘ K or "/" focuses it. Typing a
 * question puts "Ask AI Coach" first; a coin, page or month name jumps straight there.
 */
export function CommandBar({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [ctx, setCtx] = useState<{ symbols: string[]; currentMonth: string } | null>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const onKey = (e: globalThis.KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  // Load the trader's coins the first time the search opens.
  useEffect(() => {
    if (open && !ctx) void searchContextAction().then(setCtx);
  }, [open, ctx]);

  const results = useMemo(
    () =>
      buildResults({
        query,
        symbols: ctx?.symbols ?? [],
        currentMonth: ctx?.currentMonth ?? new Date().toISOString().slice(0, 7),
        isAdmin,
      }),
    [query, ctx, isAdmin],
  );

  const go = (item: SearchItem | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery("");
    input.current?.blur();
    router.push(item.href);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  let lastGroup: SearchGroup | null = null;

  return (
    <div ref={box} className="relative min-w-0 flex-1 sm:max-w-xl">
      <div className="flex h-10 items-center gap-2 rounded-full border border-hi/12 bg-well px-3.5 shadow-[inset_0_2px_6px_rgba(0,0,0,0.35),0_1px_0_rgba(255,255,255,0.06)] transition-colors focus-within:border-coach/70 focus-within:bg-hi/[0.04]">
        <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? optionId(active) : undefined}
          aria-label="Search or ask your coach"
          placeholder="Search or ask anything…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          maxLength={500}
        />
        <kbd className="hidden shrink-0 rounded-md border border-hi/15 bg-hi/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-ink-faint sm:inline">
          {isMac ? "⌘" : "Ctrl"} K
        </kbd>
      </div>

      {open && results.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          className="pop absolute inset-x-0 top-[calc(100%+0.5rem)] z-40 max-h-[70vh] overflow-y-auto rounded-[var(--radius-surface)] p-2 sm:right-auto sm:w-[min(36rem,calc(100vw-2rem))]"
        >
          {results.map((item, i) => {
            const Icon = ICONS[item.group];
            const header = item.group !== lastGroup ? GROUP_LABEL[item.group] : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && (
                  <p className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wider text-ink-faint uppercase">
                    {header}
                  </p>
                )}
                <div
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(item)}
                  onKeyDown={() => {}}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-sm",
                    i === active
                      ? "bg-hi/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
                      : "text-ink-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      item.group === "Ask"
                        ? "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-coach)_70%,white),var(--color-coach))] text-coach-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
                        : "bg-hi/[0.08] text-ink-muted",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", i === active && "text-ink")}>
                    {item.label}
                  </span>
                  {item.hint && (
                    <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">
                      {item.hint}
                    </span>
                  )}
                  {i === active && (
                    <CornerDownLeft
                      className="h-3.5 w-3.5 shrink-0 text-ink-faint"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
