import { CALENDAR_CURRENCIES, type EconomicEventDto, IMPACTS, type Impact } from "@atc/shared";
import { isRangePreset, type RangePreset } from "./ranges";

/**
 * The economic calendar page's state lives in the URL so filters can be bookmarked and shared.
 * Missing values mean the defaults: upcoming week, high/medium/low impact, every currency, the
 * trader's own timezone.
 */
export interface NewsFilters {
  range: RangePreset;
  impact: Impact[];
  currency: string[];
  tz: "local" | "utc";
}

/** High impact only by default: the releases that actually move crypto and gold. */
export const DEFAULT_IMPACTS: Impact[] = ["HIGH"];

const csv = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(",") : (v ?? ""))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

export function parseNewsFilters(p: Record<string, string | string[] | undefined>): NewsFilters {
  const range = isRangePreset(p.range) ? p.range : "upcoming";
  const impact = IMPACTS.filter((i) => csv(p.impact).includes(i));
  const currency = CALENDAR_CURRENCIES.filter((c) => csv(p.currency).includes(c));
  return {
    range,
    impact: impact.length > 0 ? impact : DEFAULT_IMPACTS,
    currency,
    tz: p.tz === "utc" ? "utc" : "local",
  };
}

/** Link to the page with some filters changed; defaults are left out to keep URLs short. */
export function newsHref(current: NewsFilters, patch: Partial<NewsFilters>): string {
  const f = { ...current, ...patch };
  const q = new URLSearchParams();
  if (f.range !== "upcoming") q.set("range", f.range);
  const impact = IMPACTS.filter((i) => f.impact.includes(i));
  if (impact.length > 0 && impact.join(",") !== DEFAULT_IMPACTS.join(","))
    q.set("impact", impact.join(","));
  const currency = CALENDAR_CURRENCIES.filter((c) => f.currency.includes(c));
  if (currency.length > 0 && currency.length < CALENDAR_CURRENCIES.length)
    q.set("currency", currency.join(","));
  if (f.tz === "utc") q.set("tz", "utc");
  const s = q.toString();
  return s ? `/news?${s}` : "/news";
}

/** Adds the value if missing, removes it if present. Removing the last one restores `fallback`. */
export function toggle<T>(list: readonly T[], value: T, fallback: readonly T[] = []): T[] {
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return next.length > 0 ? next : [...fallback];
}

export interface EventDay {
  /** YYYY-MM-DD on the display clock. */
  key: string;
  label: string;
  events: EconomicEventDto[];
}

const dayKey = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));

/** Events grouped by calendar day on the display clock, with "Today" / "Tomorrow" / "Yesterday". */
export function groupByDay(
  events: readonly EconomicEventDto[],
  timeZone: string,
  now: Date = new Date(),
): EventDay[] {
  const today = dayKey(now.toISOString(), timeZone);
  const shift = (n: number) =>
    dayKey(new Date(now.getTime() + n * 86_400_000).toISOString(), timeZone);
  const named = new Map([
    [today, "Today"],
    [shift(1), "Tomorrow"],
    [shift(-1), "Yesterday"],
  ]);
  const long = new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const days = new Map<string, EventDay>();
  for (const e of [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const key = dayKey(e.startsAt, timeZone);
    let day = days.get(key);
    if (!day) {
      const date = long.format(new Date(`${key}T00:00:00Z`));
      const name = named.get(key);
      day = { key, label: name ? `${name} · ${date}` : date, events: [] };
      days.set(key, day);
    }
    day.events.push(e);
  }
  return [...days.values()];
}

/** The next event still to come (tentative ones count once their day has started). */
export function nextEvent(
  events: readonly EconomicEventDto[],
  now: Date = new Date(),
): EconomicEventDto | null {
  const t = now.getTime();
  return (
    [...events]
      .filter((e) => !e.tentative && new Date(e.startsAt).getTime() >= t)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null
  );
}

/** "in 2h 05m 09s", "in 4m 09s", "in 1d 2h 05m", "now". */
export function formatUntil(ms: number): string {
  if (ms <= 1_000) return "now";
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `in ${d}d ${h}h ${two(m)}m`;
  if (h > 0) return `in ${h}h ${two(m)}m ${two(sec)}s`;
  return `in ${m}m ${two(sec)}s`;
}

/** "04:32" for the last minutes before a release. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
