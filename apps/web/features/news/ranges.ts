/**
 * Calendar date ranges ("Today", "Next week"...) as UTC instants, worked out on the trader's own
 * clock so "today" starts at their midnight. Weeks run Monday to Sunday.
 */
export const RANGE_PRESETS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "this-week", label: "This week" },
  { id: "next-week", label: "Next week" },
  { id: "yesterday", label: "Yesterday" },
  { id: "previous-week", label: "Previous week" },
  { id: "this-month", label: "This month" },
  { id: "previous-month", label: "Previous month" },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["id"];

export function isRangePreset(v: unknown): v is RangePreset {
  return RANGE_PRESETS.some((p) => p.id === v);
}

/** Minutes the zone is ahead of UTC at an instant. */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** The instant a calendar day starts on the zone's clock. */
export function zonedMidnight(y: number, m: number, d: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  // Re-check at the result in case a DST change falls between the guess and the answer.
  return new Date(guess - zoneOffsetMinutes(new Date(first), timeZone) * 60_000);
}

/** Today's date (y, m, d) on the zone's clock. */
export function zonedToday(now: Date, timeZone: string): [number, number, number] {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

const addDays = ([y, m, d]: [number, number, number], n: number): [number, number, number] => {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
};

export function rangeFor(
  preset: RangePreset,
  timeZone: string,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const today = zonedToday(now, timeZone);
  const day = (ymd: [number, number, number]) => zonedMidnight(...ymd, timeZone);
  // Monday = 0
  const weekday = (new Date(Date.UTC(today[0], today[1] - 1, today[2])).getUTCDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  const [y, m] = today;
  switch (preset) {
    case "upcoming":
      // The last hour stays in view so a release that just came out shows its actual figure.
      return {
        from: new Date(now.getTime() - 3_600_000),
        to: new Date(now.getTime() + 7 * 86_400_000),
      };
    case "today":
      return { from: day(today), to: day(addDays(today, 1)) };
    case "tomorrow":
      return { from: day(addDays(today, 1)), to: day(addDays(today, 2)) };
    case "yesterday":
      return { from: day(addDays(today, -1)), to: day(today) };
    case "this-week":
      return { from: day(monday), to: day(addDays(monday, 7)) };
    case "next-week":
      return { from: day(addDays(monday, 7)), to: day(addDays(monday, 14)) };
    case "previous-week":
      return { from: day(addDays(monday, -7)), to: day(monday) };
    case "this-month":
      return {
        from: zonedMidnight(y, m, 1, timeZone),
        to: zonedMidnight(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, timeZone),
      };
    case "previous-month":
      return {
        from: zonedMidnight(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 1, timeZone),
        to: zonedMidnight(y, m, 1, timeZone),
      };
  }
}
