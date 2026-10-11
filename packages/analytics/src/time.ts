/**
 * Timezone arithmetic with the built-in Intl API (no dependency). Daily totals, calendars and
 * time-of-day charts must follow the trader's own clock, not the server's.
 */

export interface LocalParts {
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM */
  month: string;
  /** 0-23 */
  hour: number;
  /** 0 = Monday ... 6 = Sunday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function parts(at: Date, timeZone: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(at)) out[p.type] = p.value;
  return out;
}

export function localParts(at: Date, timeZone: string): LocalParts {
  const p = parts(at, timeZone);
  const date = `${p.year}-${p.month}-${p.day}`;
  return {
    date,
    month: date.slice(0, 7),
    hour: Number(p.hour) % 24,
    weekday: WEEKDAYS[p.weekday ?? "Mon"] ?? 0,
  };
}

/** Milliseconds the zone is ahead of UTC at a given instant (e.g. +5 h for Asia/Karachi). */
function offsetMs(at: number, timeZone: string): number {
  const p = parts(new Date(at), timeZone);
  const wall = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** The UTC instant at which a local calendar day begins (handles DST changes). */
export function startOfLocalDay(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wallMidnight = Date.UTC(y, m - 1, d);
  const first = wallMidnight - offsetMs(wallMidnight, timeZone);
  return new Date(wallMidnight - offsetMs(first, timeZone));
}

/** Calendar arithmetic on YYYY-MM-DD strings. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
