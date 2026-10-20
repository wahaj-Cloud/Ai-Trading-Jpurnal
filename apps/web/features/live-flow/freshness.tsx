"use client";

import { LIVE_STALE_MS } from "@atc/shared";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useMounted } from "@/lib/use-mounted";

const age = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/**
 * How old the numbers on screen are, counting up every second:
 *  - live: "Live · 2s ago" (green, pulsing); over 10 s "Delayed · 25s ago" (amber);
 *  - otherwise: "Updated 3 min ago · every 15 min" (grey; amber when older than `staleAfterMs`).
 */
export function FreshnessBadge({
  at,
  live = false,
  every,
  staleAfterMs,
  className,
}: {
  /** When the figures were computed (ISO or ms); null when unknown. */
  at: string | number | null;
  live?: boolean;
  /** Plain words for the refresh rate of non-live data ("every 15 min"). */
  every?: string;
  staleAfterMs?: number;
  className?: string;
}) {
  const mounted = useMounted();
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const t = at === null ? null : typeof at === "number" ? at : Date.parse(at);
  if (t === null || !Number.isFinite(t)) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-ink-faint", className)}>
        <span className="size-2 rounded-full bg-ink-faint/50" aria-hidden="true" />
        Waiting for data
      </span>
    );
  }
  // Before the page runs in the browser the age is unknown: show the label without a number.
  const ms = mounted && now ? now - t : null;
  const stale =
    ms !== null && ms > (live ? LIVE_STALE_MS : (staleAfterMs ?? Number.POSITIVE_INFINITY));
  return (
    <span
      role="status"
      aria-live="off"
      className={cn(
        "figures inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        stale
          ? "bg-[#f59e0b]/12 text-[#f59e0b]"
          : live
            ? "bg-profit/12 text-profit"
            : "bg-hi/[0.06] text-ink-muted",
        className,
      )}
      title={`${new Date(t).toISOString().replace("T", " ").slice(0, 19)} UTC`}
    >
      {live && !stale ? (
        <span className="live-dot" aria-hidden="true" />
      ) : (
        <span
          className={cn("size-2 rounded-full", stale ? "bg-[#f59e0b]" : "bg-ink-faint")}
          aria-hidden="true"
        />
      )}
      {live ? (stale ? "Delayed" : "Live") : "Updated"}
      {ms !== null && <> · {age(ms)}</>}
      {!live && every && <span className="text-ink-faint"> · {every}</span>}
    </span>
  );
}
