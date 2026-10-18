"use client";

import { type DeskEventDto, deskSymbolOf, untilLabel } from "@atc/shared";
import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { getNextEventAction } from "../actions";

const REFRESH_MS = 10 * 60_000;

/**
 * "USD CPI in 1h 23m" in the chart toolbar: the next high-impact release, so a trader sees the
 * volatility coming before entering. Links to the Market Desk for desk markets, else the calendar.
 */
export function NextEventChip({ symbol }: { symbol: string }) {
  const [event, setEvent] = useState<DeskEventDto | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = () => void getNextEventAction().then((e) => alive && setEvent(e));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Once a release passes, fetch the next one.
  const at = event ? Date.parse(event.startsAt) : 0;
  useEffect(() => {
    if (event && at <= now) void getNextEventAction().then(setEvent);
  }, [event, at, now]);

  if (!event || at <= now) return null;
  const ms = at - now;
  const soon = ms < 3_600_000;
  const desk = deskSymbolOf(symbol);
  return (
    <Link
      href={desk ? `/desk?s=${desk}` : "/news"}
      title={`Next high-impact release: ${event.currency} ${event.title}, ${new Date(event.startsAt).toLocaleString()}`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap",
        soon
          ? "border-[#f5b84d]/60 bg-[#f5b84d]/10 text-ink"
          : "border-rule text-ink-muted hover:text-ink",
      )}
    >
      <CalendarClock className={cn("h-4 w-4", soon && "text-[#f5b84d]")} aria-hidden="true" />
      <span className="max-w-[11rem] truncate">
        {event.currency} {event.title}
      </span>
      <span className="figures">{untilLabel(ms)}</span>
    </Link>
  );
}
