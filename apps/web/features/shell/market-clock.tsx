"use client";

import { ChevronDown, Clock } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  formatCountdown,
  MARKETS,
  type Market,
  marketStatus,
  wallClock,
} from "@/features/dashboard/market-hours";
import { cn } from "@/lib/cn";
import { MarketFlag } from "./flags";
import { useDismiss } from "./use-dismiss";

type Choice = Market["id"] | "LOCAL";
const KEY = "wm-clock";
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Top-bar clock: a chosen market's local time (or your own), with a menu of every major market,
 * its time and whether it is open. The choice is remembered on this device.
 */
export function MarketClock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  const [choice, setChoice] = useState<Choice>("NEW_YORK");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Choice | null;
      if (saved === "LOCAL" || MARKETS.some((m) => m.id === saved)) setChoice(saved as Choice);
    } catch {
      // storage unavailable: keep the default
    }
    setNow(new Date());
    // Tick on the minute boundary, then every minute.
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const pick = (c: Choice) => {
    setChoice(c);
    setOpen(false);
    try {
      localStorage.setItem(KEY, c);
    } catch {
      // ignore
    }
  };

  const tzLabel =
    timeZone === "UTC" ? "UTC" : (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
  const market = MARKETS.find((m) => m.id === choice);
  const label = market ? market.label : tzLabel;
  const time = now ? hhmm(wallClock(now, market ? market.timeZone : timeZone).minutes) : "--:--";
  const status = now && market ? marketStatus(market, now) : null;

  return (
    <div ref={box} className="relative hidden shrink-0 sm:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="flex h-9 items-center gap-2 rounded-full px-3 text-sm transition-colors hover:bg-hi/[0.08]"
      >
        {market ? (
          <MarketFlag id={market.id} />
        ) : (
          <Clock className="h-4 w-4 text-ink-muted" aria-hidden="true" />
        )}
        <span className="figures font-medium text-coach">
          {label} · {time}
        </span>
        {status && (
          <>
            <span
              className={cn("h-1.5 w-1.5 rounded-full", status.open ? "bg-profit" : "bg-ink-faint")}
              aria-hidden="true"
            />
            <span className="sr-only">{status.open ? "open" : "closed"}</span>
          </>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-ink-faint" aria-hidden="true" />
      </button>

      {open && now && (
        <div
          id={listId}
          role="listbox"
          aria-label="Clock"
          className="pop absolute top-[calc(100%+0.5rem)] right-0 z-40 w-72 rounded-[var(--radius-surface)] p-2"
        >
          {MARKETS.map((m) => {
            const s = marketStatus(m, now);
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={choice === m.id}
                onClick={() => pick(m.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-sm",
                  choice === m.id ? "bg-hi/[0.1]" : "hover:bg-hi/[0.06]",
                )}
              >
                <MarketFlag id={m.id} />
                <span className="flex-1">
                  <span className="block font-medium">{m.label}</span>
                  <span className="block text-xs text-ink-faint">
                    {s.open
                      ? `Open · closes in ${formatCountdown(s.minutesToChange)}`
                      : `Closed · opens in ${formatCountdown(s.minutesToChange)}`}
                  </span>
                </span>
                <span className="figures font-medium">{s.localTime}</span>
                <span
                  className={cn("h-2 w-2 rounded-full", s.open ? "bg-profit" : "bg-ink-faint/60")}
                  aria-hidden="true"
                />
              </button>
            );
          })}
          <div className="my-1 h-px bg-rule" />
          <button
            type="button"
            role="option"
            aria-selected={choice === "LOCAL"}
            onClick={() => pick("LOCAL")}
            className={cn(
              "flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-sm",
              choice === "LOCAL" ? "bg-hi/[0.1]" : "hover:bg-hi/[0.06]",
            )}
          >
            <Clock className="h-4 w-4 text-ink-muted" aria-hidden="true" />
            <span className="flex-1 font-medium">Your time ({tzLabel})</span>
            <span className="figures font-medium">{hhmm(wallClock(now, timeZone).minutes)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
