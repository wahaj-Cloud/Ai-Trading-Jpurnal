import { createHash } from "node:crypto";
import type { NewsSource } from "@atc/shared";
import { readCapped, resolveFetch } from "../http.js";
import { type ClientOptions, ExchangeHttpError, ExchangeNetworkError } from "../types.js";

/**
 * Headline sources. Each parser turns one source's documented format into the same shape; the
 * worker classifies, de-duplicates and stores them.
 *  - Finnhub market news (Reuters, CNBC, MarketWatch, …): general, forex and crypto sections.
 *  - Official central-bank RSS: Federal Reserve press releases and speeches, ECB press releases.
 *  - GDELT DOC API: worldwide news monitoring, used for wars, crises and pandemics.
 *  - Trading Economics news stream (when the account's plan includes it).
 */

export interface RawHeadline {
  source: NewsSource;
  /** Unique within the source. */
  sourceId: string;
  title: string;
  summary: string | null;
  url: string | null;
  publisher: string;
  publishedAt: number;
  /** The source's own section, if it has one ("general", "crypto", …). */
  sourceCategory: string | null;
  /** Provider importance 0–3 (Trading Economics only). */
  importance: number | null;
  /** An official monetary-policy release (FOMC statement, minutes, ECB decision). */
  monetaryPolicy: boolean;
}

export interface NewsSourceOptions extends ClientOptions {
  baseUrl?: string;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

async function get(
  o: ClientOptions,
  url: string,
  accept = "application/json",
  /** Public feeds may redirect; a request carrying a key never follows one. */
  follow = false,
): Promise<string> {
  const f = resolveFetch(o);
  let res: Response;
  try {
    res = await f(url, {
      headers: { Accept: accept, "User-Agent": "WickMentor/1.0 (+https://wickmentor.com)" },
      redirect: follow ? "follow" : "error",
      signal: AbortSignal.timeout(o.timeoutMs ?? 15_000),
    });
  } catch (err) {
    throw new ExchangeNetworkError(err);
  }
  const text = await readCapped(res, 8 * 1024 * 1024);
  if (!res.ok) throw new ExchangeHttpError(res.status, null, text.slice(0, 200));
  return text;
}

const hashId = (...parts: string[]) =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);

// ─── Finnhub ───

export const FINNHUB_CATEGORIES = ["general", "forex", "crypto"] as const;
export type FinnhubCategory = (typeof FINNHUB_CATEGORIES)[number];

/** Finnhub /news rows: { category, datetime (unix s), headline, id, image, related, source, summary, url }. */
export function parseFinnhubNews(rows: unknown, section: FinnhubCategory): RawHeadline[] {
  if (!Array.isArray(rows)) return [];
  const out: RawHeadline[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const id = Number(r.id);
    const t = Number(r.datetime);
    const title = clean(String(r.headline ?? ""));
    if (!Number.isFinite(id) || !Number.isFinite(t) || t <= 0 || !title) continue;
    out.push({
      source: "FINNHUB",
      sourceId: String(id),
      title,
      summary: clean(String(r.summary ?? "")) || null,
      url: typeof r.url === "string" && /^https?:\/\//.test(r.url) ? r.url : null,
      publisher: clean(String(r.source ?? "")) || "Finnhub",
      publishedAt: t * 1000,
      sourceCategory: section,
      importance: null,
      monetaryPolicy: false,
    });
  }
  return out;
}

export async function fetchFinnhubNews(
  o: NewsSourceOptions & { apiKey: string },
  section: FinnhubCategory,
  minId?: number,
): Promise<RawHeadline[]> {
  const base = o.baseUrl ?? "https://finnhub.io/api/v1";
  const q = new URLSearchParams({ category: section, token: o.apiKey });
  if (minId) q.set("minId", String(minId));
  const text = await get(o, `${base}/news?${q}`);
  try {
    return parseFinnhubNews(JSON.parse(text), section);
  } catch {
    throw new ExchangeHttpError(502, null, "Finnhub: unreadable news");
  }
}

// ─── RSS / Atom ───

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code =
          e[1]?.toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  if (m) return clean(decode(m[1] ?? ""));
  // Atom links: <link href="..."/>
  if (name === "link") {
    const l = /<link\b[^>]*\bhref="([^"]+)"[^>]*\/?>/i.exec(block);
    return l ? clean(decode(l[1] ?? "")) : null;
  }
  return null;
}

/** RSS 2.0 <item> or Atom <entry> elements → headlines. Items without a date or title are skipped. */
export function parseFeed(
  xml: string,
  source: NewsSource,
  publisher: string,
  opts: { monetaryPolicy?: (title: string) => boolean; section?: string } = {},
): RawHeadline[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const out: RawHeadline[] = [];
  for (const b of blocks) {
    const title = tag(b, "title");
    const link = tag(b, "link");
    const date = tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date");
    const t = date ? Date.parse(date) : Number.NaN;
    if (!title || !Number.isFinite(t)) continue;
    const id = tag(b, "guid") ?? tag(b, "id") ?? link ?? hashId(title, String(t));
    out.push({
      source,
      sourceId: id.slice(0, 200),
      title,
      summary: tag(b, "description") ?? tag(b, "summary"),
      url: link && /^https?:\/\//.test(link) ? link : null,
      publisher,
      publishedAt: t,
      sourceCategory: opts.section ?? null,
      importance: null,
      monetaryPolicy: opts.monetaryPolicy?.(title) ?? false,
    });
  }
  return out;
}

export interface CentralBankFeed {
  source: "FED" | "ECB";
  url: string;
  publisher: string;
  section: string;
  monetaryPolicy: (title: string) => boolean;
}

/** Official feeds, monetary-policy feeds first so their items are stored with that flag. */
export const CENTRAL_BANK_FEEDS: CentralBankFeed[] = [
  {
    source: "FED",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml",
    publisher: "Federal Reserve",
    section: "monetary",
    monetaryPolicy: () => true,
  },
  {
    source: "FED",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    publisher: "Federal Reserve",
    section: "press",
    monetaryPolicy: (t) => /\bFOMC\b|monetary policy|discount rate/i.test(t),
  },
  {
    source: "FED",
    url: "https://www.federalreserve.gov/feeds/speeches_and_testimony.xml",
    publisher: "Federal Reserve",
    section: "speeches",
    monetaryPolicy: () => false,
  },
  {
    source: "ECB",
    url: "https://www.ecb.europa.eu/rss/press.xml",
    publisher: "European Central Bank",
    section: "press",
    monetaryPolicy: (t) => /monetary policy decisions?|monetary policy statement/i.test(t),
  },
];

export async function fetchCentralBankFeed(
  o: ClientOptions,
  feed: CentralBankFeed,
): Promise<RawHeadline[]> {
  const xml = await get(o, feed.url, "application/rss+xml, application/xml, text/xml", true);
  return parseFeed(xml, feed.source, feed.publisher, {
    monetaryPolicy: feed.monetaryPolicy,
    section: feed.section,
  });
}

// ─── GDELT ───

/** Well-known newsrooms; GDELT also lists thousands of small sites, which are left out. */
export const GDELT_DOMAINS = new Set([
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "cnbc.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "aljazeera.com",
  "cnn.com",
  "france24.com",
  "dw.com",
  "npr.org",
  "abcnews.go.com",
  "cbsnews.com",
  "nbcnews.com",
  "axios.com",
  "politico.com",
  "politico.eu",
  "marketwatch.com",
  "barrons.com",
  "economist.com",
  "nikkei.com",
  "asia.nikkei.com",
  "scmp.com",
  "timesofisrael.com",
  "kyivindependent.com",
  "coindesk.com",
  "theblock.co",
  "cointelegraph.com",
  "decrypt.co",
]);

export const GDELT_QUERY =
  '(war OR invasion OR missile OR airstrike OR "nuclear" OR pandemic OR outbreak OR lockdown OR coup OR "state of emergency" OR "bank collapse" OR sanctions OR tariffs OR "default" OR ceasefire OR "martial law") sourcelang:english';

/** "20260319T083000Z" → ms. */
export function parseGdeltDate(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m
    ? Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6]),
      )
    : Number.NaN;
}

const domainOf = (d: string) => d.toLowerCase().replace(/^www\./, "");

/** GDELT ArtList JSON → headlines from well-known newsrooms only. */
export function parseGdelt(body: unknown): RawHeadline[] {
  const arts = (body as { articles?: Array<Record<string, unknown>> } | null)?.articles;
  if (!Array.isArray(arts)) return [];
  const out: RawHeadline[] = [];
  for (const a of arts) {
    const domain = domainOf(String(a.domain ?? ""));
    const url = String(a.url ?? "");
    const title = clean(String(a.title ?? ""));
    const t = parseGdeltDate(String(a.seendate ?? ""));
    if (!GDELT_DOMAINS.has(domain) || !/^https?:\/\//.test(url) || !title || !Number.isFinite(t))
      continue;
    if (a.language && String(a.language).toLowerCase() !== "english") continue;
    out.push({
      source: "GDELT",
      sourceId: hashId(url),
      title,
      summary: null,
      url,
      publisher: domain,
      publishedAt: t,
      sourceCategory: null,
      importance: null,
      monetaryPolicy: false,
    });
  }
  return out;
}

export async function fetchGdelt(
  o: NewsSourceOptions,
  timespan = "30min",
  query = GDELT_QUERY,
): Promise<RawHeadline[]> {
  const base = o.baseUrl ?? "https://api.gdeltproject.org/api/v2/doc/doc";
  const q = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    sort: "datedesc",
    maxrecords: "100",
    timespan,
  });
  const text = await get(o, `${base}?${q}`, "application/json", true);
  if (!text.trim().startsWith("{")) return []; // GDELT answers errors as plain text
  try {
    return parseGdelt(JSON.parse(text));
  } catch {
    return [];
  }
}

// ─── Trading Economics news stream ───

/** A message from the Trading Economics stream with topic "news" → headline, or null. */
export function parseTradingEconomicsNews(raw: unknown, now = Date.now()): RawHeadline | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.topic !== "news") return null;
  const title = clean(String(m.title ?? ""));
  if (!title) return null;
  const dateRaw = typeof m.date === "string" ? m.date : null;
  const parsed = dateRaw
    ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(dateRaw) ? dateRaw : `${dateRaw}Z`)
    : Number.NaN;
  const publishedAt = Number.isFinite(parsed) ? parsed : now;
  const url =
    typeof m.url === "string"
      ? m.url.startsWith("http")
        ? m.url
        : `https://tradingeconomics.com${m.url.startsWith("/") ? "" : "/"}${m.url}`
      : null;
  const importance = Number(m.importance);
  return {
    source: "TRADINGECONOMICS",
    sourceId: String(m.id ?? url ?? hashId(title, String(publishedAt))).slice(0, 200),
    title,
    summary: clean(String(m.description ?? "")) || null,
    url,
    publisher: "Trading Economics",
    publishedAt,
    sourceCategory: typeof m.category === "string" ? m.category : null,
    importance: Number.isFinite(importance) ? importance : null,
    monetaryPolicy: false,
  };
}
