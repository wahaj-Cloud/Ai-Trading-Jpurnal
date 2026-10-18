// Integration test: market-moving headlines. The worker collects from fake sources (each in its
// documented format) into a real Postgres and real Redis; the API serves the folders and relays
// breaking headlines to the live stream. Run after build.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { Redis } from "ioredis";
import { HeadlineCollector } from "../../worker/dist/news/headlines.js";
import { EconomicLiveService } from "../dist/economic/economic-live.service.js";
import { NewsService } from "../dist/news/news.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const MIN = 60_000;
const H = 60 * MIN;
let NOW = Math.floor(Date.now() / MIN) * MIN;
const sec = (ms) => Math.floor(ms / 1000);
const rfc = (ms) => new Date(ms).toUTCString();

await db.$executeRawUnsafe("TRUNCATE news_items");

// ─── Fake sources ───
let finnhubCalls = [];
const finnhub = {
  general: [
    {
      category: "top news",
      datetime: sec(NOW - 2 * MIN),
      headline: "Russia launches missiles at Kyiv as war escalates",
      id: 101,
      source: "Reuters",
      summary: "",
      url: "https://www.reuters.com/a",
    },
    {
      category: "top news",
      datetime: sec(NOW - 90_000),
      headline: "Russia launches missiles at Kyiv, war escalates further",
      id: 102,
      source: "CNBC",
      summary: "",
      url: "https://www.cnbc.com/a",
    },
    {
      category: "top news",
      datetime: sec(NOW - 3 * MIN),
      headline: "Apple unveils new iPhone colours",
      id: 103,
      source: "MarketWatch",
      summary: "",
      url: "https://www.marketwatch.com/a",
    },
    {
      category: "top news",
      datetime: sec(NOW - 5 * H),
      headline: "Oil prices climb as OPEC+ agrees surprise output cut",
      id: 104,
      source: "Reuters",
      summary: "",
      url: "https://www.reuters.com/b",
    },
  ],
  forex: [],
  crypto: [
    {
      category: "crypto",
      datetime: sec(NOW - MIN),
      headline: "Major exchange hacked, $400 million in ether stolen",
      id: 201,
      source: "CoinDesk",
      summary: "",
      url: "https://www.coindesk.com/a",
    },
    {
      category: "crypto",
      datetime: sec(NOW - 4 * MIN),
      headline: "Analysts eye next resistance level for altcoins",
      id: 202,
      source: "CoinDesk",
      summary: "",
      url: "https://www.coindesk.com/b",
    },
  ],
};
const fedMonetary = `<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary1.htm</link><guid>https://www.federalreserve.gov/newsevents/pressreleases/monetary1.htm</guid><pubDate>${rfc(NOW - 4 * MIN)}</pubDate></item></channel></rss>`;
const fedAll = `<rss><channel><item><title>Federal Reserve issues FOMC statement</title><link>https://www.federalreserve.gov/newsevents/pressreleases/monetary1.htm</link><guid>https://www.federalreserve.gov/newsevents/pressreleases/monetary1.htm</guid><pubDate>${rfc(NOW - 4 * MIN)}</pubDate></item><item><title>Agencies issue joint statement on bank supervision</title><link>https://www.federalreserve.gov/b.htm</link><guid>https://www.federalreserve.gov/b.htm</guid><pubDate>${rfc(NOW - 20 * MIN)}</pubDate></item></channel></rss>`;
const ecb = `<rss><channel><item><title>Christine Lagarde: Interview with Le Monde</title><link>https://www.ecb.europa.eu/i.html</link><guid>https://www.ecb.europa.eu/i.html</guid><pubDate>${rfc(NOW - 10 * MIN)}</pubDate></item></channel></rss>`;
const gdelt = {
  articles: [
    {
      url: "https://www.bbc.com/news/x",
      title: "WHO declares new virus outbreak a public health emergency",
      seendate: new Date(NOW - 6 * MIN)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, ""),
      domain: "bbc.com",
      language: "English",
    },
    {
      url: "https://www.bbc.com/news/y",
      title: "Local council approves new park",
      seendate: new Date(NOW - 6 * MIN)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, ""),
      domain: "bbc.com",
      language: "English",
    },
    {
      url: "https://tinyblog.example/z",
      title: "War is coming says blogger",
      seendate: new Date(NOW - 6 * MIN)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, ""),
      domain: "tinyblog.example",
      language: "English",
    },
  ],
};
// Minute candles: BTC falls 0.1 a minute from 60,000; gold rises 0.05 a minute from 2,600.
const kline = (t, o, c) => [
  t,
  String(o),
  String(Math.max(o, c)),
  String(Math.min(o, c)),
  String(c),
  "1",
  t + MIN - 1,
];
const fetchFn = async (input) => {
  const url = new URL(String(input));
  const text = (body) => new Response(body, { status: 200 });
  const json = (body) => Response.json(body);
  if (url.host === "finnhub.io") {
    finnhubCalls.push(Object.fromEntries(url.searchParams));
    const cat = url.searchParams.get("category");
    const min = Number(url.searchParams.get("minId") ?? 0);
    return json((finnhub[cat] ?? []).filter((r) => r.id > min));
  }
  if (url.pathname === "/feeds/press_monetary.xml") return text(fedMonetary);
  if (url.pathname === "/feeds/press_all.xml") return text(fedAll);
  if (url.pathname === "/feeds/speeches_and_testimony.xml")
    return text("<rss><channel></channel></rss>");
  if (url.pathname === "/rss/press.xml") return text(ecb);
  if (url.host === "api.gdeltproject.org") return json(gdelt);
  if (url.pathname === "/fapi/v1/klines") {
    const start = Number(url.searchParams.get("startTime"));
    const sym = url.searchParams.get("symbol");
    const rows = [];
    for (let i = 0; i < Number(url.searchParams.get("limit")); i++) {
      const t = start + i * MIN;
      if (t > NOW - MIN) break; // only closed minutes exist
      const [o, c] =
        sym === "BTCUSDT" ? [60000 - i * 10, 60000 - (i + 1) * 10] : [2600 + i, 2600 + (i + 1)];
      rows.push(kline(t, o, c));
    }
    return json(rows);
  }
  return new Response("not found", { status: 404 });
};

const pub = new Redis(redisUrl, { family: 0 });
const published = [];
const redis = {
  publish: async (ch, msg) => {
    published.push(JSON.parse(msg));
    return pub.publish(ch, msg);
  },
  set: (...a) => pub.set(...a),
  eval: (...a) => pub.eval(...a),
};
await pub.del("news:leader");

// The API side listens on Redis like in production.
const live = new EconomicLiveService({ NODE_ENV: "development", REDIS_URL: redisUrl });
await live.onModuleInit();
const relayed = [];
live.headlines$.subscribe((h) => relayed.push(h));

const collector = new HeadlineCollector({
  db,
  redis,
  finnhubKey: "f".repeat(20),
  binance: { fetch: fetchFn },
  fetchFn,
  now: () => NOW,
});
assert.equal(await collector.tickLeadership(), true);
const other = new HeadlineCollector({ db, redis, fetchFn, now: () => NOW });
assert.equal(await other.tickLeadership(), false, "only one collector at a time");

// 1. Collect from every source.
await collector.pollFinnhub();
await collector.pollCentralBanks();
await collector.pollGdelt();
const rows = await db.newsItem.findMany({ orderBy: { publishedAt: "asc" } });
const by = (t) => rows.find((r) => r.title.startsWith(t));
assert.equal(by("Russia launches missiles at Kyiv as").impact, "HIGH");
assert.equal(by("Russia launches missiles at Kyiv as").category, "world");
assert.equal(
  by("Russia launches missiles at Kyiv,").clusterId,
  by("Russia launches missiles at Kyiv as").id,
  "same story grouped",
);
assert.equal(by("Major exchange hacked").category, "crypto");
assert.equal(by("Major exchange hacked").impact, "HIGH");
assert.equal(by("Federal Reserve issues FOMC statement").impact, "HIGH");
assert.equal(
  rows.filter((r) => r.title === "Federal Reserve issues FOMC statement").length,
  1,
  "the same release from two Fed feeds is stored once",
);
assert.equal(by("Christine Lagarde").category, "central-banks");
assert.equal(by("WHO declares new virus outbreak").impact, "HIGH");
assert.equal(by("Local council"), undefined, "GDELT keeps only Medium/High");
assert.equal(by("War is coming"), undefined, "GDELT keeps only well-known newsrooms");
assert.equal(by("Apple unveils").impact, "LOW");
console.log("✓ sources collected, rated and filed; the same story is grouped; GDELT noise dropped");

// 2. Announcements: new Medium/High only, never the old ones, each once, relayed by the API.
const titles = published.map((p) => p.item.title);
assert.ok(titles.includes("Major exchange hacked, $400 million in ether stolen"));
assert.ok(titles.includes("Federal Reserve issues FOMC statement"));
assert.ok(!titles.includes("Apple unveils new iPhone colours"), "Low is not announced");
assert.ok(
  !titles.some((t) => t.startsWith("Oil prices")),
  "a 5-hour-old story is stored, not announced",
);
assert.equal(
  titles.filter((t) => t.startsWith("Russia launches")).length,
  1,
  "one alert per story",
);
await new Promise((r) => setTimeout(r, 300));
assert.deepEqual(
  relayed.map((r) => r.item.id).sort(),
  published.map((p) => p.item.id).sort(),
  "API relays every announcement",
);
const before = published.length;
finnhubCalls = [];
await collector.pollFinnhub();
await collector.pollCentralBanks();
assert.equal(published.length, before, "nothing announced twice");
assert.equal(
  finnhubCalls.find((c) => c.category === "general")?.minId,
  "104",
  "asks only for newer Finnhub items",
);
console.log("✓ alerts: new Medium/High once each, relayed live through Redis to the API");

// 3. A later, more serious report raises the story's rating.
finnhub.general.push({
  category: "top news",
  datetime: sec(NOW),
  headline: "Apple unveils new iPhone colours",
  id: 105,
  source: "Reuters",
  summary: "",
  url: "https://www.reuters.com/c",
});
await collector.ingest([
  {
    source: "TRADINGECONOMICS",
    sourceId: "te-1",
    title: "Apple unveils new iPhone colours",
    summary: null,
    url: null,
    publisher: "Trading Economics",
    publishedAt: NOW,
    sourceCategory: null,
    importance: 3,
    monetaryPolicy: false,
  },
]);
assert.equal(
  (await db.newsItem.findUnique({ where: { id: by("Apple unveils").id } })).impact,
  "HIGH",
);
console.log("✓ a more serious report of the same story raises its rating");

// 4. Market reaction after 15 and 60 minutes, against an independent calculation.
NOW += 70 * MIN;
assert.ok((await collector.measureReactions()) >= 3);
const hack = await db.newsItem.findUnique({ where: { id: by("Major exchange hacked").id } });
const p0 = Math.floor(hack.publishedAt.getTime() / MIN) * MIN;
const btcOpen = 60000; // first candle opens at the publication minute
const btc15 = 60000 - 16 * 10; // close of the minute 15 later (i = 15)
const btc60 = 60000 - 61 * 10;
assert.ok(Math.abs(hack.reaction.btc15m - (btc15 / btcOpen - 1) * 100) < 1e-9);
assert.ok(Math.abs(hack.reaction.btc60m - (btc60 / btcOpen - 1) * 100) < 1e-9);
assert.ok(Math.abs(hack.reaction.gold60m - ((2600 + 61) / 2600 - 1) * 100) < 1e-9);
assert.ok(p0 <= hack.publishedAt.getTime());
console.log(
  "✓ BTC and gold moves 15 and 60 minutes after each High story match an independent calculation",
);

// 5. API folders.
const svc = new NewsService({ client: db });
const top = await svc.list({ folder: "top", impact: "ALL", limit: 40 });
assert.ok(top.items.every((i) => i.impact === "HIGH"));
assert.ok(
  top.items.some((i) => i.category === "world") &&
    top.items.some((i) => i.category === "crypto") &&
    top.items.some((i) => i.category === "central-banks"),
);
const russia = top.items.find((i) => i.title.startsWith("Russia launches"));
assert.equal(russia.alsoReportedBy, 1);
assert.equal(top.items.filter((i) => i.title.startsWith("Russia launches")).length, 1);
const cb = await svc.list({ folder: "central-banks", impact: "ALL", limit: 40 });
assert.ok(cb.items.every((i) => i.category === "central-banks"));
assert.equal(cb.items.length, 3);
const cbHigh = await svc.list({ folder: "central-banks", impact: "HIGH", limit: 40 });
assert.deepEqual(
  cbHigh.items.map((i) => i.title),
  ["Federal Reserve issues FOMC statement"],
);
// Paging, newest first, no repeats.
const seen = new Set();
let cursor;
let last = Infinity;
do {
  const p = await svc.list({ folder: "world", impact: "ALL", limit: 1, cursor });
  for (const i of p.items) {
    assert.ok(Date.parse(i.publishedAt) <= last);
    last = Date.parse(i.publishedAt);
    assert.ok(!seen.has(i.id));
    seen.add(i.id);
  }
  cursor = p.nextCursor ?? undefined;
} while (cursor);
assert.equal(seen.size, await db.newsItem.count({ where: { category: "world", clusterId: null } }));
console.log("✓ folders: Top = High from every folder, one row per story, filters and paging");

// 6. Retention.
await db.newsItem.update({
  where: { id: by("Oil prices").id },
  data: { publishedAt: new Date(NOW - 31 * 24 * H) },
});
assert.equal(await collector.cleanup(), 1);

await collector.stop();
await live.onModuleDestroy();
await pub.quit();
await db.$disconnect();
console.log("All news integration checks passed");
