// Integration test: Scalp Cockpit. A scalping snapshot, Market Flow rows, a trend desk, a
// liquidation map, headlines, a release and the trader's own trades go into a real Postgres; the
// cockpit must join them by the written rules, per plan. Expected values are worked out here by
// hand from the rows inserted. Run after build.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { CockpitService } from "../dist/market/cockpit.service.js";
import { FlowService } from "../dist/market/flow.service.js";
import { OrderflowService } from "../dist/market/orderflow.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const M = 60_000;
const NOW = new Date(Date.UTC(2026, 9, 19, 14, 3, 20)); // New York session
const T = NOW.getTime();

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
await db.$executeRawUnsafe("TRUNCATE whale_trades, liquidation_events, liquidation_maps");
await db.marketSnapshot.deleteMany({
  where: { OR: [{ key: "scalp:latest" }, { key: { startsWith: "desk:" } }] },
});
await db.newsItem.deleteMany({ where: { source: "TEST" } });

await db.economicEvent.deleteMany({ where: { id: { startsWith: "ck-" } } });

const frame = (strength, pressure, regime = "neutral", rel = 1, oi = 0.1) => ({
  strength,
  buyPressurePct: pressure,
  netFlowUsd: pressure * 1000,
  priceChangePct: 0.1,
  oiChangePct: oi,
  relVolume: rel,
  regime,
});
const levels = (p) => ({
  dayHigh: p * 1.02,
  dayLow: p * 0.98,
  asiaHigh: p * 1.01,
  asiaLow: p * 0.99,
  asiaOpen: false,
  high24h: p * 1.03,
  low24h: p * 0.97,
});
const vol = (atr) => ({
  atr5m: atr,
  atr15m: atr * 2,
  atr1h: atr * 4,
  rangeRatio: 1,
  activity: "normal",
});
const coins = [
  {
    symbol: "BTCUSDT",
    rank: 1,
    price: 100000,
    vwap: 99700,
    vwapDistPct: (100000 / 99700 - 1) * 100,
    funding: 0.0001,
    frames: {
      "5m": frame("strong_buying", 30, "long_buildup", 3.1),
      "15m": frame("buying", 9),
      "30m": frame("selling", -7),
      "1h": frame("neutral", 1),
      "4h": frame("buying", 4),
      "24h": frame("neutral", 1),
    },
    book: {
      asOf: NOW.toISOString(),
      mid: 100000,
      spreadBps: 0.5,
      bands: [
        { pct: 0.05, bidUsd: 1, askUsd: 1, imbalancePct: 0 },
        { pct: 0.25, bidUsd: 135, askUsd: 65, imbalancePct: 35 },
      ],
      walls: [],
    },
    levels: levels(100000),
    volatility: vol(50),
  },
  {
    symbol: "XAUUSDT",
    rank: 40,
    price: 4000,
    vwap: 4010,
    vwapDistPct: (4000 / 4010 - 1) * 100,
    funding: 0.0004,
    frames: {
      "15m": frame("strong_selling", -22, "short_buildup"),
      "30m": frame("selling", -7),
      "1h": frame("neutral", -2),
    },
    book: null,
    levels: { ...levels(4000), dayLow: 3998 }, // price within half a 5m range of today's low
    volatility: { ...vol(6), activity: "very_active" },
  },
  {
    symbol: "C5USDT",
    rank: 30,
    price: 1,
    vwap: null,
    vwapDistPct: null,
    funding: null,
    frames: {},
    book: null,
    levels: null,
    volatility: vol(0.01),
  },
];
await db.marketSnapshot.create({
  data: {
    key: "scalp:latest",
    updatedAt: NOW,
    data: {
      computedAt: new Date(T - 40_000).toISOString(),
      asOf: NOW.toISOString(),
      universe: 101,
      coins,
    },
  },
});
await db.marketSnapshot.create({
  data: {
    key: "desk:BTCUSDT",
    updatedAt: NOW,
    data: {
      symbol: "BTCUSDT",
      price: 100000,
      computedAt: new Date(T - 10 * M).toISOString(),
      bias: [
        { timeframe: "1d", state: "range", bars: 3, evidence: [] },
        { timeframe: "4h", state: "up", bars: 2, evidence: [] },
        { timeframe: "1h", state: "up", bars: 5, evidence: [] },
      ],
    },
  },
});
// Market Flow: inside the last 5 minutes, and 10 minutes ago (15m window only).
const whale = (side, usd, minsAgo) => ({
  exchange: "BINANCE",
  symbol: "BTCUSDT",
  side,
  price: "100000",
  qty: String(usd / 100000),
  usd: String(usd),
  fills: 1,
  at: new Date(T - minsAgo * M),
});
await db.whaleTrade.createMany({
  data: [
    whale("buy", 2e6, 1),
    whale("buy", 1e6, 3),
    whale("sell", 1e6, 4),
    whale("sell", 5e6, 10),
    whale("buy", 9e6, 20),
  ],
});
const liq = (side, usd, minsAgo, symbol = "BTCUSDT") => ({
  exchange: "BYBIT",
  symbol,
  side,
  price: "100000",
  qty: "1",
  usd: String(usd),
  at: new Date(T - minsAgo * M),
});
await db.liquidationEvent.createMany({
  data: [liq("short", 400_000, 2), liq("long", 100_000, 2), liq("long", 2e6, 10)],
});
const cluster = (side, price, usd) => ({ side, price, usd });
await db.liquidationMap.create({
  data: {
    symbol: "BTCUSDT",
    window: "24h",
    computedAt: new Date(T - 4 * M),
    data: {
      clusters: [
        cluster("short", 101000, 5e6),
        cluster("short", 100500, 2e6),
        cluster("short", 104000, 9e7), // beyond 3%
        cluster("long", 99000, 3e6),
        cluster("long", 99500, 4e6),
        cluster("long", 100800, 8e6), // a long pool above price is not a long pool below
      ],
    },
  },
});
// Headlines: one story twice within 30 minutes, one 45 minutes ago, one Medium, one too old.
const news = (id, title, minsAgo, impact = "HIGH", cluster = null) => ({
  source: "TEST",
  sourceId: id,
  title,
  publisher: "Test",
  publishedAt: new Date(T - minsAgo * M),
  receivedAt: new Date(T - minsAgo * M),
  category: "world",
  impact,
  tags: [],
  why: "Test",
  clusterId: cluster,
});
const story = "0192f000-0000-7000-8000-000000000001";
await db.newsItem.createMany({
  data: [
    news("a", "Attack on shipping lane", 5, "HIGH", story),
    news("b", "Shipping lane attacked, oil jumps", 8, "HIGH", story),
    news("c", "Central bank surprise", 45),
    news("d", "Minor data", 3, "MEDIUM"),
    news("e", "Yesterday's crisis", 90),
  ],
});
await db.economicEvent.createMany({
  data: [
    {
      id: "ck-cpi",
      title: "CPI m/m",
      currency: "USD",
      impact: "HIGH",
      startsAt: new Date(T + 12 * M),
      source: "test",
      fetchedAt: NOW,
    },
  ],
});

const mk = (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `ck${n}`,
      email: `ck${n}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const prem = await mk(2, "PREMIUM");
const exness = await db.exchangeAccount.create({
  data: { userId: prem.id, exchange: "EXNESS", label: "MT5", apiKeyHint: "1234" },
});
// Gold scalps on Exness: 12 within the last 180 days held ≤ 60 min, plus ones that must not count.
const day = 86_400_000;
const trades = [];
const expect = { trades: 0, wins: 0, net: 0, hold: 0, sessions: {} };
const sess = (d) => {
  const h = d.getUTCHours();
  return h < 7 ? "ASIA" : h < 13 ? "LONDON" : h < 21 ? "NEW_YORK" : "OFF_HOURS";
};
for (let i = 0; i < 12; i++) {
  const opened = new Date(T - (i + 1) * 3 * day + (i % 4) * 6 * 3_600_000 + 7 * 3_600_000);
  const held = (5 + i * 4) * M;
  const pnl = i % 3 === 0 ? -12.5 : 20 + i;
  trades.push({ opened, held, pnl, base: "XAU", settle: "USD", symbol: "XAUUSD" });
  expect.trades++;
  if (pnl > 0) expect.wins++;
  expect.net += pnl;
  expect.hold += held;
  const s = sess(opened);
  expect.sessions[s] = expect.sessions[s] ?? { trades: 0, wins: 0, net: 0 };
  expect.sessions[s].trades++;
  if (pnl > 0) expect.sessions[s].wins++;
  expect.sessions[s].net += pnl;
}
trades.push({
  opened: new Date(T - 2 * day),
  held: 2 * 3_600_000,
  pnl: 500,
  base: "XAU",
  settle: "USD",
  symbol: "XAUUSD",
}); // swing
trades.push({
  opened: new Date(T - 200 * day),
  held: 10 * M,
  pnl: 500,
  base: "XAU",
  settle: "USD",
  symbol: "XAUUSD",
}); // too old
trades.push({
  opened: new Date(T - 3 * day),
  held: 10 * M,
  pnl: 500,
  base: "XAG",
  settle: "USD",
  symbol: "XAGUSD",
}); // silver
await db.position.createMany({
  data: trades.map((t, i) => ({
    userId: prem.id,
    exchange: "EXNESS",
    source: "FILLS",
    sourceKey: `ck|${i}`,
    symbol: t.symbol,
    baseAsset: t.base,
    quoteAsset: "USD",
    settleAsset: t.settle,
    direction: i % 2 ? "LONG" : "SHORT",
    status: "CLOSED",
    openedAt: t.opened,
    closedAt: new Date(t.opened.getTime() + t.held),
    netPnl: t.pnl.toFixed(2),
  })),
});
await db.openPosition.create({
  data: {
    userId: prem.id,
    accountId: exness.id,
    exchange: "EXNESS",
    externalId: "p1",
    symbol: "XAUUSD",
    baseAsset: "XAU",
    quoteAsset: "USD",
    settleAsset: "USD",
    direction: "SHORT",
    lots: "0.10",
    entryPrice: "4012.5",
    syncedAt: NOW,
  },
});

const prisma = { client: db };
const svc = new CockpitService(prisma, new OrderflowService(prisma), new FlowService(prisma));

// 1. Bitcoin, 5 minutes, Premium.
const b5 = await svc.get(prem.id, { symbol: "BTCUSDT", tf: "5m" }, NOW);
const lean = (dto) => Object.fromEntries(dto.rows.map((r) => [r.key, r.lean]));
assert.deepEqual(lean(b5), {
  strength_5m: "up",
  strength_15m: "up",
  strength_1h: "neutral",
  regime: "up",
  funding: "neutral",
  vwap: "up",
  book: "up", // the ±0.25% band: +35%
  whales: "up", // last 5 min: bought 3M, sold 1M → (3 − 1) / 4 = 0.5
  liquidations: "up", // shorts 400K = 4× longs 100K
  bias_1h: "up",
});
assert.deepEqual(b5.tally, { up: 8, down: 0, neutral: 2 });
assert.deepEqual(b5.whales, { buyUsd: 3e6, sellUsd: 1e6, buys: 2, sells: 1 });
assert.deepEqual(b5.liquidations, { longUsd: 100_000, shortUsd: 400_000 });
assert.equal(b5.liqAbove.price, 101000);
assert.equal(b5.liqAbove.usd, 5e6);
assert.equal(b5.liqBelow.price, 99500);
assert.equal(b5.levelAbove.label, "Asia high");
assert.equal(b5.levelBelow.label, "VWAP");
assert.equal(b5.session, "New York (London overlap until 16:00 UTC)");
assert.deepEqual(
  b5.headlines.map((h) => h.title),
  ["Attack on shipping lane", "Central bank surprise"],
);
const flagKeys = b5.flags.map((f) => f.key);
assert.ok(flagKeys.includes("event_CPI m/m"), "CPI in 12 minutes");
assert.ok(flagKeys.includes("headlines"), "a high-impact story 5 minutes ago");
assert.ok(flagKeys.includes("volume"), "5m volume 3.1×");
assert.equal(b5.btcCorr24h, null);
assert.deepEqual(b5.locked, []);
console.log(
  "✓ Bitcoin 5m: ten readings by their rules, whales and liquidations over 5 minutes only",
);

// 2. Bitcoin, 15 minutes: the older whale sale and long liquidation now count.
const b15 = await svc.get(prem.id, { symbol: "BTCUSDT", tf: "15m" }, NOW);
const l15 = lean(b15);
assert.equal(l15.strength_15m, "up");
assert.equal(l15.strength_30m, "down");
assert.equal(l15.whales, "down"); // bought 3M, sold 6M → −0.33
assert.equal(l15.liquidations, "down"); // longs 2.1M ≥ 2 × shorts 0.4M
assert.equal(l15.regime, "neutral");
console.log("✓ Bitcoin 15m: the 15-minute window reads the older flow");

// 3. Gold, 15 minutes, Premium: no book or flow feed rows, own scalps and open position.
const g = await svc.get(prem.id, { symbol: "XAUUSDT", tf: "15m" }, NOW);
const lg = lean(g);
assert.equal(lg.strength_15m, "down");
assert.equal(lg.regime, "down"); // short build-up
assert.equal(lg.funding, "down"); // 0.04% > 0.03%
assert.equal(lg.vwap, "down");
assert.equal(lg.book, undefined);
assert.equal(lg.whales, "neutral"); // a Market Flow market with nothing in the window
assert.ok(g.flags.some((f) => f.key === "activity"));
assert.ok(g.flags.some((f) => f.key === "near_today's low"));
assert.equal(g.name, "Gold");
const r = g.record;
assert.equal(r.trades, expect.trades);
assert.equal(r.wins, expect.wins);
assert.equal(Number(r.netPnl), Math.round(expect.net * 100) / 100);
assert.ok(Math.abs(r.avgHoldMin - expect.hold / expect.trades / M) < 1e-9);
assert.equal(r.enough, true);
for (const s of r.sessions) {
  const e = expect.sessions[s.id];
  assert.equal(s.trades, e.trades, s.id);
  assert.equal(Number(s.netPnl), Math.round(e.net * 100) / 100, s.id);
  assert.ok(Math.abs(s.winRate - e.wins / e.trades) < 1e-12);
}
assert.equal(
  r.sessions.reduce((a, s) => a + s.trades, 0),
  expect.trades,
);
assert.deepEqual(g.open, [
  { direction: "SHORT", entryPrice: "4012.5", unrealizedPnl: null, exchange: "EXNESS" },
]);
console.log("✓ Gold 15m: readings, warnings, Exness gold scalps by session and the open short");

// 4. Free plan: gold is shown, flow and the map are not; a coin past the top 20 is locked.
const fg = await svc.get(free.id, { symbol: "XAUUSDT", tf: "5m" }, NOW);
assert.ok(fg.coin);
assert.ok(fg.locked.includes("whale orders and liquidations"));
assert.ok(fg.locked.includes("liquidation map"));
assert.ok(fg.locked.includes("trend bias"));
assert.equal(fg.whales, null);
assert.equal(fg.record, null);
const fc = await svc.get(free.id, { symbol: "C5USDT", tf: "5m" }, NOW);
assert.equal(fc.coin, null);
assert.deepEqual(fc.rows, []);
assert.ok(fc.locked[0].startsWith("this market"));
const fb = await svc.get(free.id, { symbol: "BTCUSDT", tf: "5m" }, NOW);
assert.deepEqual(fb.locked, []);
assert.equal(fb.liqAbove.price, 101000);
console.log("✓ Free plan: gold shown, paid parts locked, coins past the top 20 locked");

// 5. A stale trend is not read.
await db.marketSnapshot.update({
  where: { key: "desk:BTCUSDT" },
  data: {
    data: {
      symbol: "BTCUSDT",
      computedAt: new Date(T - 3 * 3_600_000).toISOString(),
      bias: [{ timeframe: "1h", state: "down", bars: 1, evidence: [] }],
    },
  },
});
const stale = await svc.get(prem.id, { symbol: "BTCUSDT", tf: "5m" }, NOW);
assert.equal(lean(stale).bias_1h, undefined);
assert.deepEqual(stale.bias, []);
console.log("✓ a trend older than 2 hours is left out");

// 6. Indicator gauges: shown while fresh (three refreshes plus 3 minutes), hidden when stale.
const rating = (tf, minsAgo) => ({
  tf,
  lastCandle: T,
  computedAt: new Date(T - minsAgo * M).toISOString(),
  summary: { score: 0.6, level: "strong_up", up: 20, down: 3, neutral: 3, items: [] },
  oscillators: { score: 0.2, level: "up", up: 5, down: 3, neutral: 3, items: [] },
  movingAverages: { score: 1, level: "strong_up", up: 15, down: 0, neutral: 0, items: [] },
  adx: 31,
  plusDi: 28,
  minusDi: 12,
  mood: "trending_up",
});
await db.marketSnapshot.upsert({
  where: { key: "ratings:latest" },
  create: {
    key: "ratings:latest",
    updatedAt: NOW,
    data: {
      BTCUSDT: {
        "5m": rating("5m", 5),
        "15m": rating("15m", 7),
        "1h": rating("1h", 17),
        "1d": rating("1d", 47),
      },
    },
  },
  update: {
    data: {
      BTCUSDT: {
        "5m": rating("5m", 5),
        "15m": rating("15m", 7),
        "1h": rating("1h", 17),
        "1d": rating("1d", 47),
      },
    },
  },
});
const withGauges = await svc.get(prem.id, { symbol: "BTCUSDT", tf: "5m" }, NOW);
// 5m allows 6 minutes, 15m 6, 1H 18, 1D 48.
assert.deepEqual(Object.keys(withGauges.ratings).sort(), ["1d", "1h", "5m"]);
assert.equal(withGauges.ratings["1h"].mood, "trending_up");
const lockedGauges = await svc.get(free.id, { symbol: "C5USDT", tf: "5m" }, NOW);
assert.equal(lockedGauges.ratings, null);
await db.marketSnapshot.deleteMany({ where: { key: "ratings:latest" } });
console.log("✓ indicator gauges: fresh timeframes shown, stale ones left out");

// Supply/demand zones on the levels ladder: nearest per timeframe, a stale record left out.
{
  const price = b5.coin.price;
  const H = 3_600_000;
  const z = (side, lo, hi, tests, t) => ({ side, bottom: price * lo, top: price * hi, tests, t });
  await db.marketSnapshot.upsert({
    where: { key: "zones:latest" },
    create: { key: "zones:latest", updatedAt: NOW, data: {} },
    update: { data: {} },
  });
  await db.marketSnapshot.update({
    where: { key: "zones:latest" },
    data: {
      data: {
        computedAt: NOW.toISOString(),
        markets: {
          BTCUSDT: {
            "1h": {
              asOf: new Date(Math.floor(NOW.getTime() / H) * H).toISOString(),
              zones: [
                z("supply", 1.01, 1.012, 0, 1),
                z("supply", 1.03, 1.032, 0, 2),
                z("supply", 1.05, 1.052, 1, 3),
                z("demand", 0.99, 0.992, 2, 4),
                z("demand", 0.999, 1.001, 0, 5), // price inside
              ],
            },
            // Last refreshed 20 hours ago: not shown as current.
            "4h": {
              asOf: new Date(NOW.getTime() - 20 * H).toISOString(),
              zones: [z("supply", 1.02, 1.03, 0, 9)],
            },
          },
        },
      },
    },
  });
  const withZones = await svc.get(prem.id, { symbol: "BTCUSDT", tf: "5m" }, NOW);
  assert.deepEqual(
    withZones.zones.map((x) => [x.tf, x.side, x.tests, Number(x.distPct.toFixed(6))]),
    [
      ["1h", "supply", 0, 1],
      ["1h", "supply", 0, 3],
      ["1h", "demand", 0, 0],
      ["1h", "demand", 2, Number(((0.992 - 1) * 100).toFixed(6))],
    ],
  );
  const noZones = await svc.get(prem.id, { symbol: "ETHUSDT", tf: "5m" }, NOW);
  assert.deepEqual(noZones.zones, []);
  await db.marketSnapshot.deleteMany({ where: { key: "zones:latest" } });
  console.log("✓ levels ladder: nearest 1H/4H zones each side, a stale record left out");
}

await db.economicEvent.deleteMany({ where: { id: { startsWith: "ck-" } } });
await db.newsItem.deleteMany({ where: { source: "TEST" } });
await db.$executeRawUnsafe("TRUNCATE whale_trades, liquidation_events, liquidation_maps");
await db.marketSnapshot.deleteMany({
  where: { OR: [{ key: "scalp:latest" }, { key: { startsWith: "desk:" } }] },
});
await db.$disconnect();
console.log("All Scalp Cockpit integration checks passed");
