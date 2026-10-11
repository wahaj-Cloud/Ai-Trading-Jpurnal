import type { AnalyticsQuery } from "@atc/shared";
import { addDays, localParts, startOfLocalDay } from "./time.js";

export interface ResolvedRange {
  /** Inclusive start instant (UTC), or null for "all time". */
  from: Date | null;
  /** Exclusive end instant (UTC), or null for "up to now". */
  to: Date | null;
  /** First and last local day, for display. */
  fromDay: string | null;
  toDay: string | null;
}

const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 } as const;

/** Turns a range preset or custom days into UTC instants, using the trader's calendar. */
export function resolveRange(
  q: Pick<AnalyticsQuery, "range" | "from" | "to">,
  timeZone: string,
  now: Date,
): ResolvedRange {
  const today = localParts(now, timeZone).date;
  if (q.from || q.to) {
    return {
      from: q.from ? startOfLocalDay(q.from, timeZone) : null,
      to: q.to ? startOfLocalDay(addDays(q.to, 1), timeZone) : null,
      fromDay: q.from ?? null,
      toDay: q.to ?? today,
    };
  }
  if (q.range === "all") return { from: null, to: null, fromDay: null, toDay: today };
  const fromDay =
    q.range === "ytd" ? `${today.slice(0, 4)}-01-01` : addDays(today, 1 - PRESET_DAYS[q.range]);
  return { from: startOfLocalDay(fromDay, timeZone), to: null, fromDay, toDay: today };
}
