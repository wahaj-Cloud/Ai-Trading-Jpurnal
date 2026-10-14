/**
 * Live results arrive from the data provider under its own names ("Inflation Rate YoY", "Non Farm
 * Payrolls"); the calendar shows Forex Factory names ("CPI y/y", "Non-Farm Employment Change").
 * These helpers turn a provider message into a release and find the calendar row it belongs to.
 */

export interface ProviderRelease {
  providerId: string;
  title: string;
  currency: string;
  /** 1 low, 2 medium, 3 high. */
  importance: number;
  startsAt: Date;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

export interface CalendarRow {
  id: string;
  title: string;
  currency: string;
  startsAt: Date;
}

const COUNTRY_CURRENCY: Record<string, string> = {
  "united states": "USD",
  "euro area": "EUR",
  germany: "EUR",
  france: "EUR",
  italy: "EUR",
  spain: "EUR",
  "united kingdom": "GBP",
  japan: "JPY",
  australia: "AUD",
  canada: "CAD",
  switzerland: "CHF",
  "new zealand": "NZD",
  china: "CNY",
};

const empty = (v: unknown) =>
  v === undefined ||
  v === null ||
  ["", "null", "none", "nan"].includes(String(v).trim().toLowerCase());
const text = (v: unknown) => (empty(v) ? null : String(v).trim());

/** One provider (Trading Economics) message → a release, or null if it is not a usable one. */
export function parseProviderMessage(raw: unknown): ProviderRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.topic !== undefined && m.topic !== "calendar") return null;
  const title = text(m.event);
  const date = text(m.date);
  const actual = text(m.actual);
  if (!title || !date || !actual) return null;
  const startsAt = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(date) ? date : `${date}Z`);
  if (Number.isNaN(startsAt.getTime())) return null;
  const country = (text(m.country) ?? "").toLowerCase();
  const currency = COUNTRY_CURRENCY[country];
  if (!currency) return null;
  return {
    providerId: String(m.calendarId ?? `${country}|${title}|${date}`),
    title,
    currency,
    importance: Number(text(m.importance) ?? 1) || 1,
    startsAt,
    actual,
    // The provider's docs show the forecast key with a stray trailing space.
    forecast: text(m.forecast ?? m["forecast "] ?? m.teforecast),
    previous: text(m.revised ?? m.previous),
  };
}

const PERIOD = /\b(y\/y|m\/m|q\/q)\b/;

/** Lower-case words with provider vocabulary mapped onto the calendar's. */
export function normalizeTitle(t: string): string {
  return ` ${t.toLowerCase()} `
    .replace(/\byoy\b/g, "y/y")
    .replace(/\bmom\b/g, "m/m")
    .replace(/\bqoq\b/g, "q/q")
    .replace(/core inflation rate/g, "core cpi")
    .replace(/inflation rate/g, "cpi")
    .replace(/non[- ]?farm payrolls?/g, "non-farm employment change")
    .replace(/initial jobless claims/g, "unemployment claims")
    .replace(/(fed |ecb |boe |boj |rba |boc |snb |rbnz )?interest rate decision/g, "rate decision")
    .replace(
      /federal funds rate|official bank rate|cash rate|main refinancing rate|overnight rate|policy rate/g,
      "rate decision",
    )
    .replace(/gdp growth rate/g, "gdp")
    .replace(/[^a-z0-9/ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "the",
  "of",
  "and",
  "s",
  "a",
  "us",
  "prel",
  "final",
  "flash",
  "adv",
  "advance",
]);
const tokens = (t: string) =>
  new Set(
    normalizeTitle(t)
      .split(" ")
      .filter((w) => w && !STOP.has(w)),
  );

/** 0..1 similarity; 0 when both name a period (y/y, m/m, q/q) and they differ. */
export function titleScore(a: string, b: string): number {
  const pa = normalizeTitle(a).match(PERIOD)?.[1];
  const pb = normalizeTitle(b).match(PERIOD)?.[1];
  if (pa && pb && pa !== pb) return 0;
  const ta = tokens(a);
  const tb = tokens(b);
  let both = 0;
  for (const w of ta) if (tb.has(w)) both++;
  const union = ta.size + tb.size - both;
  return union === 0 ? 0 : both / union;
}

/** Calendar rows within this distance of the release time can be the same event. */
const WINDOW_MS = 10 * 60_000;
const MIN_SCORE = 0.34;

/** The calendar row a release belongs to: same currency, close in time, most similar name. */
export function matchRelease(r: ProviderRelease, rows: CalendarRow[]): CalendarRow | null {
  let best: { row: CalendarRow; score: number } | null = null;
  for (const row of rows) {
    if (row.currency !== r.currency) continue;
    if (Math.abs(row.startsAt.getTime() - r.startsAt.getTime()) > WINDOW_MS) continue;
    const score = titleScore(r.title, row.title);
    if (score >= MIN_SCORE && (!best || score > best.score)) best = { row, score };
  }
  return best?.row ?? null;
}
