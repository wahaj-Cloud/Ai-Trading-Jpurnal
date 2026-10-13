/**
 * Major trading centres and their regular hours in their own local time (Mon–Fri). Used for the
 * live session clock; DST is handled because every check runs in the centre's own timezone.
 */
export interface Market {
  id: "SYDNEY" | "TOKYO" | "LONDON" | "NEW_YORK";
  label: string;
  timeZone: string;
  /** Opening and closing time in the market's own clock, minutes after midnight. */
  open: number;
  close: number;
}

export const MARKETS: readonly Market[] = [
  { id: "SYDNEY", label: "Sydney", timeZone: "Australia/Sydney", open: 7 * 60, close: 16 * 60 },
  { id: "TOKYO", label: "Tokyo", timeZone: "Asia/Tokyo", open: 9 * 60, close: 18 * 60 },
  { id: "LONDON", label: "London", timeZone: "Europe/London", open: 8 * 60, close: 17 * 60 },
  { id: "NEW_YORK", label: "New York", timeZone: "America/New_York", open: 8 * 60, close: 17 * 60 },
];

/** Weekday (0 = Sunday) and minutes after midnight of an instant on a timezone's wall clock. */
export function wallClock(at: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export interface MarketStatus {
  market: Market;
  open: boolean;
  /** Minutes until it opens (when closed) or closes (when open). */
  minutesToChange: number;
  /** Its local time now, "HH:MM". */
  localTime: string;
}

const isTradingDay = (weekday: number) => weekday >= 1 && weekday <= 5;

export function marketStatus(market: Market, at: Date): MarketStatus {
  const { weekday, minutes } = wallClock(at, market.timeZone);
  const localTime = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const open = isTradingDay(weekday) && minutes >= market.open && minutes < market.close;
  if (open) return { market, open, minutesToChange: market.close - minutes, localTime };

  // Next opening: today if before the open on a trading day, otherwise the next trading day.
  if (isTradingDay(weekday) && minutes < market.open) {
    return { market, open, minutesToChange: market.open - minutes, localTime };
  }
  let days = 1;
  while (!isTradingDay((weekday + days) % 7)) days++;
  return {
    market,
    open,
    minutesToChange: days * 1440 - minutes + market.open,
    localTime,
  };
}

export function formatCountdown(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
