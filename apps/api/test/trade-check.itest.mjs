// Integration test: Trade Check. The worker collects every reading from fake public sources (in
// each source's documented format) into a real Postgres; the API judges them and matches the
// trader's past trades with the trend, funding and releases at entry. Every figure is checked
// against an independent calculation made here. Run after build.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { runMarketContext, runMarketHistory } from "../../worker/dist/market/context.js";
import { MarketService } from "../dist/market/market.service.js";
import { TradeCheckService } from "../dist/market/trade-check.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const H = 3_600_000;
const DAY = 24 * H;
const NOW = Date.UTC(2026, 9, 17, 12, 7, 30);

let seed = 3;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
// One price path per timeframe, oldest first, ending near 100.
function path(n, vol) {
  const out = [100];
  for (let i = 1; i < n; i++)
    out.push(out[i - 1] * (1 + (rnd() - 0.5) * vol + Math.sin(i / 30) * vol * 0.2));
  const k = 100 / out[n - 1];
  return out.map((p) => p * k);
}
const P = { "1d": path(1001, 0.05), "4h": path(1501, 0.02), "1w": path(401, 0.1) };
const STEP = { "1d": DAY, "4h": 4 * H, "1w": 7 * DAY };
// Binance weeks open on Monday 00:00 UTC.
const ALIGN = { "1d": 0, "4h": 0, "1w": Date.UTC(1970, 0, 5) % (7 * DAY) };
const kline = (t, step, o, c, takerBuy = 50, v = 100) => [
  t,
  String(o),
  String(Math.max(o, c) * 1.01),
  String(Math.min(o, c) * 0.99),
  String(c),
  String(v),
  t + step - 1,
  "0",
  0,
  String(takerBuy),
  "0",
  "0",
];
const json = (body, status = 200) => Response.json(body, { status });

const fetchFn = async (input) => {
  const url = new URL(String(input));
  const q = (k) => url.searchParams.get(k);
  const symbol = q("symbol") ?? "";
  if (url.host === "fapi.binance.com" || url.host === "") {
    /* fallthrough below */
  }
  switch (`${url.host}${url.pathname}`) {
    case "fapi.binance.com/fapi/v1/klines": {
      const interval = q("interval");
      if (interval === "1h") {
        const start = Number(q("startTime"));
        const rows = [];
        for (let t = Math.ceil(start / H) * H; t + H <= NOW + H; t += H) {
          const last4 = t >= Math.floor(NOW / H) * H - 4 * H;
          rows.push(kline(t, H, 100, 100, last4 ? 60 : 50));
        }
        return json(rows);
      }
      const step = STEP[interval];
      const prices = P[interval];
      const limit = Number(q("limit"));
      const open = Math.floor((NOW - ALIGN[interval]) / step) * step + ALIGN[interval]; // forming
      const rows = [];
      for (let k = 0; k < limit; k++) {
        const t = open - (limit - 1 - k) * step;
        const i = prices.length - limit + k;
        rows.push(kline(t, step, prices[Math.max(0, i - 1)], prices[i]));
      }
      return json(rows);
    }
    case "fapi.binance.com/fapi/v1/ticker/24hr":
      return json({ symbol, lastPrice: "100.50", priceChangePercent: "2.10" });
    case "fapi.binance.com/fapi/v1/premiumIndex":
      if (symbol.includes("_")) return json({ symbol, markPrice: "101.20", indexPrice: "100.00" });
      return json({
        symbol,
        markPrice: "100.4",
        lastFundingRate: "0.00042",
        nextFundingTime: NOW + H,
      });
    case "fapi.binance.com/fapi/v1/fundingRate": {
      const start = Number(q("startTime"));
      const end = Number(q("endTime"));
      const rows = [];
      for (let t = Math.ceil(start / (8 * H)) * 8 * H; t <= end && rows.length < 1000; t += 8 * H)
        rows.push({
          symbol,
          fundingTime: t,
          fundingRate: String(((t / (8 * H)) % 7) * 0.0001 - 0.0002),
        });
      return json(rows);
    }
    case "fapi.binance.com/futures/data/openInterestHist":
      return json(
        Array.from({ length: 25 }, (_, i) => ({
          symbol,
          sumOpenInterest: String(1000 + i * 2),
          timestamp: NOW - (24 - i) * H,
        })),
      );
    case "fapi.binance.com/fapi/v1/exchangeInfo":
      return json({
        symbols: [
          {
            symbol: "BTCUSDT_261225",
            pair: "BTCUSDT",
            contractType: "CURRENT_QUARTER",
            status: "TRADING",
            deliveryDate: NOW + 69 * DAY,
          },
          {
            symbol: "BTCUSDT",
            pair: "BTCUSDT",
            contractType: "PERPETUAL",
            status: "TRADING",
            deliveryDate: 4133404800000,
          },
        ],
      });
    case "fapi.binance.com/futures/data/globalLongShortAccountRatio":
    case "fapi.binance.com/futures/data/topLongShortPositionRatio": {
      const top = url.pathname.includes("top");
      return json(
        Array.from({ length: 500 }, (_, i) => {
          const r = top ? 1 + (i % 50) / 100 : 1.5 + i / 1000;
          return {
            symbol,
            longShortRatio: r.toFixed(4),
            longAccount: (r / (1 + r)).toFixed(4),
            shortAccount: (1 / (1 + r)).toFixed(4),
            timestamp: Math.floor(NOW / H) * H - (499 - i) * H,
          };
        }),
      );
    }
    case "api.exchange.coinbase.com/products/BTC-USD/ticker":
      return json({ price: "100.60" });
    case "api.exchange.coinbase.com/products/ETH-USD/ticker":
    case "api.exchange.coinbase.com/products/SOL-USD/ticker":
      return json({ price: "100.40" });
    case "api.exchange.coinbase.com/products/USDT-USD/ticker":
      return json({ price: "1.0001" });
    case "api.binance.com/api/v3/ticker/price":
      return json({ symbol, price: "100.50" });
    case "www.deribit.com/api/v2/public/get_book_summary_by_currency": {
      const exp = "30OCT26"; // 13 days away
      const result = [];
      for (const k of [80, 90, 95, 100, 105, 110, 120]) {
        const iv = 50 + (100 - k) * 0.4;
        result.push({
          instrument_name: `${q("currency")}-${exp}-${k}-C`,
          open_interest: 10,
          mark_iv: iv,
          underlying_price: 100.5,
        });
        result.push({
          instrument_name: `${q("currency")}-${exp}-${k}-P`,
          open_interest: k < 100 ? 12 : 4,
          mark_iv: iv,
          underlying_price: 100.5,
        });
      }
      return json({ jsonrpc: "2.0", result });
    }
    case "www.deribit.com/api/v2/public/get_volatility_index_data":
      return json({
        jsonrpc: "2.0",
        result: {
          data: [
            [NOW - 25 * H, 48, 48, 48, 48],
            [NOW - 24 * H, 48, 49, 47, 48.5],
            [NOW - H, 52, 53, 51, 52.5],
          ],
          continuation: null,
        },
      });
    case "api.stlouisfed.org/fred/series/observations": {
      const id = q("series_id");
      const base = { DTWEXBGS: 120, DGS10: 4.2, SP500: 5800, NASDAQCOM: 18500, VIXCLS: 18 }[id];
      const obs = [];
      for (let d = 0; d < 20; d++) {
        const date = new Date(Date.UTC(2026, 9, 16) - d * DAY).toISOString().slice(0, 10);
        obs.push({
          realtime_start: date,
          realtime_end: date,
          date,
          value: d === 1 ? "." : String(base * (1 + d * 0.001)),
        });
      }
      return json({ observations: obs });
    }
    case "stablecoins.llama.fi/stablecoincharts/all": {
      const end = Date.UTC(2026, 9, 17) / 1000;
      return json(
        Array.from({ length: 40 }, (_, i) => ({
          date: String(end - (39 - i) * 86400),
          totalCirculatingUSD: { peggedUSD: 250e9 + i * 1e9, peggedEUR: 5e8 },
        })),
      );
    }
    default:
      return json({ msg: "not found" }, 404);
  }
};

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
await db.$executeRawUnsafe(
  "TRUNCATE market_trend_history, funding_rate_history, whale_trades, liquidation_events",
);
await db.marketSnapshot.deleteMany({
  where: {
    OR: [
      { key: { startsWith: "context:" } },
      { key: { startsWith: "desk:" } },
      { key: { in: ["macro", "stablecoins", "flow:status"] } },
    ],
  },
});
await db.economicEvent.deleteMany({ where: { id: { startsWith: "tc-test-" } } });
// The crowd-mood readings come from their own snapshots; set them here so the test never depends
// on what an earlier run left behind.
for (const [key, data] of [
  ["fear_greed", { value: 48, label: "Neutral" }],
  ["global", { btcDominance: 57.2 }],
  ["altcoin_season", { value: 31 }],
])
  await db.marketSnapshot.upsert({
    where: { key },
    create: { key, data, updatedAt: new Date(NOW) },
    update: { data, updatedAt: new Date(NOW) },
  });

const config = { binance: { fetch: fetchFn }, bybit: { fetch: fetchFn }, okx: { fetch: fetchFn } };
const sources = {
  deribit: { fetch: fetchFn },
  coinbase: { fetch: fetchFn },
  binanceSpot: { fetch: fetchFn },
  fred: { fetch: fetchFn },
  llama: { fetch: fetchFn },
};

// 1. Worker: every reading saved, each equal to an independent calculation.
const res = await runMarketContext({
  db,
  config,
  sources,
  fredApiKey: "f".repeat(32),
  now: () => NOW,
});
assert.deepEqual(res.failed, []);
assert.equal(res.saved.length, 5);
assert.equal(res.macro, true);
assert.equal(res.stablecoins, true);
const btc = (await db.marketSnapshot.findUnique({ where: { key: "context:BTCUSDT" } })).data;
assert.equal(btc.price, 100.5);
assert.equal(btc.fundingRate, 0.00042);
assert.ok(
  Math.abs(btc.oiChange24hPct - (1048 / 1000 - 1) * 100) < 1e-9,
  `oi ${btc.oiChange24hPct}`,
);
// Taker: last 4 closed hours 60/40, the 20 before 50/50.
assert.ok(Math.abs(btc.taker.ratio4h - 1.5) < 1e-12);
assert.ok(Math.abs(btc.taker.ratio24h - (4 * 60 + 20 * 50) / (4 * 40 + 20 * 50)) < 1e-12);
// Basis: 1.2% over 69 days.
assert.ok(Math.abs(btc.basis.basisPct - 1.2) < 1e-9);
assert.ok(Math.abs(btc.basis.annualizedPct - (1.2 * 365) / 69) < 1e-9);
// Coinbase premium.
assert.ok(Math.abs(btc.coinbasePremiumPct - (100.6 / (100.5 * 1.0001) - 1) * 100) < 1e-9);
// Long/short: the account ratio rises every hour, so it sits at the top of its 20 days.
assert.ok(btc.accounts.percentile > 99, `accounts pct ${btc.accounts.percentile}`);
assert.ok(Math.abs(btc.accounts.change24h - (1.5 + 0.499) / (1.5 + 0.475) + 1) < 1e-4);
// Levels: the fake sends 401 daily rows ending with the forming one (price index 1000), so the
// last closed day is index 999 (open 998) and the 400 closed closes are indexes 600..999.
const d1 = P["1d"];
assert.ok(Math.abs(btc.levels.prevDayHigh - Math.max(d1[998], d1[999]) * 1.01) < 1e-9);
assert.ok(Math.abs(btc.levels.prevDayLow - Math.min(d1[998], d1[999]) * 0.99) < 1e-9);
let e = d1.slice(600, 800).reduce((a, b) => a + b, 0) / 200;
for (const c of d1.slice(800, 1000)) e = c * (2 / 201) + e * (1 - 2 / 201);
assert.ok(Math.abs(btc.levels.ema200d - e) / e < 1e-9, "200-day EMA from the 400 closed days");
assert.equal(btc.weeklyBias.timeframe, "1w");
// Options: put/call OI, max pain, skew sign, DVOL.
assert.ok(Math.abs(btc.options.putCallOi - (3 * 12 + 4 * 4) / 70) < 1e-12);
let best = null;
for (const k of [80, 90, 95, 100, 105, 110, 120]) {
  let pain = 0;
  for (const s of [80, 90, 95, 100, 105, 110, 120]) {
    pain += 10 * Math.max(0, k - s) + (s < 100 ? 12 : 4) * Math.max(0, s - k);
  }
  if (!best || pain < best.pain) best = { k, pain };
}
assert.equal(btc.options.maxPain, best.k);
assert.ok(btc.options.skew25d > 0, "puts priced above calls on this smile");
assert.equal(btc.options.dvol, 52.5);
// The latest reading is at NOW−1h; 24 hours before it is NOW−25h (48).
assert.equal(btc.options.dvolChange24h, 4.5);
const sol = (await db.marketSnapshot.findUnique({ where: { key: "context:SOLUSDT" } })).data;
assert.equal(sol.options, null);
assert.equal(sol.basis, null, "no quarterly listed for SOL");
const macro = (await db.marketSnapshot.findUnique({ where: { key: "macro" } })).data;
const vix = macro.series.find((s) => s.id === "VIXCLS");
assert.equal(vix.date, "2026-10-16");
assert.ok(Math.abs(vix.value - 18) < 1e-12);
assert.ok(Math.abs(vix.change - (18 - 18 * 1.007)) < 1e-9, "against the close 7 days earlier");
const stable = (await db.marketSnapshot.findUnique({ where: { key: "stablecoins" } })).data;
assert.equal(stable.totalUsd, 289e9 + 5e8);
assert.ok(Math.abs(stable.change7dPct - (289.5e9 / 282.5e9 - 1) * 100) < 1e-9);
console.log(
  "✓ worker readings match independent sums: OI, taker, basis, premium, ratios, levels, options, macro, stablecoins",
);

// A second run within the hour does not call FRED or DefiLlama again.
const again = await runMarketContext({
  db,
  config,
  sources,
  fredApiKey: "f".repeat(32),
  now: () => NOW + 15 * 60_000,
});
assert.equal(again.macro, false);
assert.equal(again.stablecoins, false);

// 2. History: trend after every closed candle and every settled funding rate.
const hist = await runMarketHistory({ db, config, now: () => NOW });
assert.deepEqual(hist.failed, []);
assert.ok(hist.trendRows > 5 * 1000, `trend rows ${hist.trendRows}`);
assert.ok(hist.fundingRows > 5 * 1100);
const newest = await db.marketTrendHistory.findFirst({
  where: { symbol: "BTCUSDT", timeframe: "4h" },
  orderBy: { at: "desc" },
});
assert.ok(
  newest.at.getTime() <= NOW && newest.at.getTime() > NOW - 4 * H,
  "latest closed 4h candle only",
);
const again2 = await runMarketHistory({ db, config, now: () => NOW });
assert.equal(again2.fundingRows, 0, "no duplicates");
assert.equal(again2.trendRows, 0);
console.log(
  "✓ history: trend after each closed daily/4h candle and settled funding, no duplicates",
);

// 3. The page: Pro user with past trades on BTC.
const mk = (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `tc${n}`,
      email: `tc${n}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const pro = await mk(2, "PRO");
await db.economicEvent.create({
  data: {
    id: "tc-test-cpi",
    title: "CPI y/y",
    currency: "USD",
    impact: "HIGH",
    startsAt: new Date(NOW + 80 * 60_000),
    source: "test",
    fetchedAt: new Date(NOW),
  },
});
const pastEvents = [];
for (let d = 5; d < 300; d += 17) {
  const t = new Date(NOW - d * DAY + 3 * H);
  pastEvents.push({
    id: `tc-test-${d}`,
    title: "NFP",
    currency: "USD",
    impact: "HIGH",
    startsAt: t,
    source: "test",
    fetchedAt: new Date(NOW),
  });
}
await db.economicEvent.createMany({ data: pastEvents });
await db.marketSnapshot.create({
  data: {
    key: "desk:BTCUSDT",
    updatedAt: new Date(NOW),
    data: {
      symbol: "BTCUSDT",
      name: "Bitcoin",
      price: 100.4,
      change24hPct: 2,
      computedAt: new Date(NOW - 5 * 60_000).toISOString(),
      drivers: [],
      leans: { up: 0, down: 0, neutral: 0 },
      summary: null,
      summaryAt: null,
      nextEvent: null,
      recentEvents: [],
      bias: [
        { timeframe: "1d", state: "up", bars: 4, evidence: [] },
        { timeframe: "4h", state: "down", bars: 2, evidence: [] },
        { timeframe: "1h", state: "range", bars: 1, evidence: [] },
      ],
    },
  },
});
const trades = [];
for (let i = 0; i < 160; i++) {
  const openedAt = new Date(NOW - Math.floor(rnd() * 330 * DAY));
  const net = ((rnd() - 0.45) * 200).toFixed(2);
  trades.push({
    userId: pro.id,
    exchange: "BINANCE",
    source: "FILLS",
    sourceKey: `tc|${i}`,
    symbol: i % 9 === 0 ? "ETHUSDT" : i % 2 ? "BTCUSDT" : "BTC-USDT-SWAP",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    settleAsset: i === 5 ? "BTC" : "USDT",
    direction: rnd() < 0.5 ? "LONG" : "SHORT",
    status: "CLOSED",
    openedAt,
    closedAt: new Date(openedAt.getTime() + H),
    netPnl: net,
  });
}
await db.position.createMany({ data: trades });

const svc = new TradeCheckService({ client: db }, new MarketService({ client: db }, {}));
const out = await svc.check(pro.id, { symbol: "BTCUSDT" }, new Date(NOW + 60_000));
assert.equal(out.status, "ok");
const c = out.check;
assert.deepEqual(out.allowed.length, 5);
assert.ok(c.factors.length >= 25, `factors ${c.factors.length}`);
const f = Object.fromEntries(c.factors.map((x) => [x.key, x]));
assert.equal(f.funding.lean, "short", "0.042% per settlement is crowded longs");
assert.equal(f.ls_accounts.lean, "short");
assert.equal(f.taker.lean, "long");
assert.equal(f.coinbase_premium.lean, "long");
assert.equal(f.bias_1d.lean, "long");
assert.equal(f.bias_4h.lean, "short");
assert.equal(c.flags[0].key, "event");
assert.equal(c.flags[0].level, "high");
assert.ok(
  c.missing.some((m) => m.includes("Whale")),
  "flow not live in this test",
);
const tally = { long: 0, short: 0, neutral: 0 };
for (const x of c.factors) if (x.lean !== "info") tally[x.lean]++;
assert.deepEqual(c.tally, tally);
console.log(
  `✓ page: ${c.factors.length} readings, tally ${tally.long}/${tally.short}/${tally.neutral}, release flagged first`,
);

// 4. "Your record": recomputed here by a plain scan of the stored history.
const trend = await db.marketTrendHistory.findMany({
  where: { symbol: "BTCUSDT" },
  orderBy: { at: "asc" },
});
const fund = await db.fundingRateHistory.findMany({
  where: { symbol: "BTCUSDT" },
  orderBy: { at: "asc" },
});
const evs = await db.economicEvent.findMany({ where: { impact: "HIGH" } });
const scan = (rows, t, maxAge, tf) => {
  let hit = null;
  for (const r of rows) if ((!tf || r.timeframe === tf) && r.at.getTime() <= t) hit = r;
  return hit && t - hit.at.getTime() <= maxAge ? hit : null;
};
const groups = {};
const add = (k, net) => {
  groups[k] ??= { trades: 0, wins: 0, losses: 0, cents: 0 };
  groups[k].trades++;
  if (net > 0) groups[k].wins++;
  else if (net < 0) groups[k].losses++;
  groups[k].cents += Math.round(net * 100);
};
let matched = 0;
for (const t of trades) {
  if (t.settleAsset !== "USDT" || t.symbol === "ETHUSDT") continue;
  const at = t.openedAt.getTime();
  const a = scan(trend, at, DAY + 60_000, "1d");
  const b = scan(trend, at, 4 * H + 60_000, "4h");
  const r = scan(fund, at, 9 * H);
  if (!a && !b && !r) continue;
  matched++;
  const net = Number(t.netPnl);
  const rel = (s) =>
    s === "range" ? "range" : (s === "up") === (t.direction === "LONG") ? "with" : "against";
  if (a) add(`d1_${rel(a.state)}`, net);
  if (b) add(`h4_${rel(b.state)}`, net);
  add(
    evs.some((e) => Math.abs(e.startsAt.getTime() - at) <= 2 * H) ? "event_near" : "event_clear",
    net,
  );
  if (r) {
    const rate = Number(r.rate);
    add(
      (t.direction === "LONG" ? rate > 0.0003 : rate < -0.0001)
        ? "funding_crowded"
        : "funding_normal",
      net,
    );
  }
}
assert.equal(out.record.total, matched);
assert.ok(matched > 100, `matched ${matched}`);
for (const g of out.record.groups) {
  const x = groups[g.key] ?? { trades: 0, wins: 0, losses: 0, cents: 0 };
  assert.equal(g.trades, x.trades, g.key);
  assert.equal(Math.round(Number(g.netPnl) * 100), x.cents, `${g.key} net`);
  const wr = x.wins + x.losses ? Number((x.wins / (x.wins + x.losses)).toFixed(4)) : null;
  assert.equal(g.winRate, wr, `${g.key} win rate`);
}
assert.ok(groups.event_near?.trades > 0, "some trades sit near a release");
// Now: daily up, 4h down, release in 79 minutes, funding crowded for longs.
assert.deepEqual(out.record.now.long, ["d1_with", "h4_against", "event_near", "funding_crowded"]);
assert.deepEqual(out.record.now.short, ["d1_against", "h4_with", "event_near", "funding_normal"]);
console.log(
  `✓ your record: ${matched} trades matched to trend, funding and releases; every group equals an independent scan`,
);

// 5. Plans.
const locked = await svc.check(free.id, { symbol: "ETHUSDT" }, new Date(NOW));
assert.equal(locked.status, "locked");
assert.equal((await svc.check(free.id, { symbol: "BTCUSDT" }, new Date(NOW))).status, "ok");
// Stale readings are never shown as current.
const stale = await svc.check(pro.id, { symbol: "BTCUSDT" }, new Date(NOW + 3 * H));
assert.equal(stale.check.factors.filter((x) => x.key === "funding").length, 0);
console.log("✓ plans enforced; stale readings left out");

// 6. Live flow: counted after a worker restart as long as stored history covers 24 hours.
const T = NOW + 60_000;
await db.marketSnapshot.create({
  data: {
    key: "flow:status",
    updatedAt: new Date(T),
    data: {
      since: new Date(T - 2 * H).toISOString(),
      updatedAt: new Date(T - 60_000).toISOString(),
      exchanges: {},
    },
  },
});
const noHistory = await svc.check(pro.id, { symbol: "BTCUSDT" }, new Date(T));
assert.equal(
  noHistory.check.factors.some((x) => x.key === "whales"),
  false,
  "no 24h history yet",
);
await db.liquidationEvent.create({
  data: {
    exchange: "BINANCE",
    symbol: "BTCUSDT",
    side: "long",
    price: "100",
    qty: "1",
    usd: "2500.00",
    at: new Date(T - 25 * H),
  },
});
await db.liquidationEvent.create({
  data: {
    exchange: "OKX",
    symbol: "BTCUSDT",
    side: "short",
    price: "100",
    qty: "1",
    usd: "1234.56",
    at: new Date(T - 3 * H),
  },
});
await db.whaleTrade.create({
  data: {
    exchange: "BYBIT",
    symbol: "BTCUSDT",
    side: "buy",
    price: "100",
    qty: "5000",
    usd: "500000.00",
    fills: 3,
    at: new Date(T - H),
  },
});
const live = await svc.check(pro.id, { symbol: "BTCUSDT" }, new Date(T));
const liq = live.check.factors.find((x) => x.key === "liquidations");
assert.ok(liq, "flow counted once history covers 24h");
assert.equal(liq.value, "Longs $0 · shorts $1.2K", "only the last 24 hours are summed");
assert.equal(
  live.check.factors.find((x) => x.key === "whales").lean,
  "neutral",
  "under 5 whale orders",
);

// 7. Look-alike tickers never count as the market (SOLV is not Solana).
await db.position.createMany({
  data: [
    {
      userId: pro.id,
      exchange: "BINANCE",
      source: "FILLS",
      sourceKey: "tc|solv",
      symbol: "SOLVUSDT",
      baseAsset: "SOLV",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      status: "CLOSED",
      openedAt: new Date(NOW - 3 * DAY),
      closedAt: new Date(NOW - 3 * DAY + H),
      netPnl: "10",
    },
    {
      userId: pro.id,
      exchange: "OKX",
      source: "FILLS",
      sourceKey: "tc|sol",
      symbol: "SOL-USDT-SWAP",
      baseAsset: "SOL",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      status: "CLOSED",
      openedAt: new Date(NOW - 3 * DAY),
      closedAt: new Date(NOW - 3 * DAY + H),
      netPnl: "-7",
    },
  ],
});
const solRec = (await svc.check(pro.id, { symbol: "SOLUSDT" }, new Date(T))).record;
assert.equal(solRec.total, 1, "only the real Solana trade");
const solEvent = solRec.groups.filter((g) => g.key.startsWith("event_") && g.trades > 0);
assert.equal(solEvent.length, 1);
assert.equal(solEvent[0].netPnl, "-7.00");
console.log("✓ live flow after a restart counts once 24h is covered; look-alike tickers excluded");

await db.economicEvent.deleteMany({ where: { id: { startsWith: "tc-test-" } } });
await db.$disconnect();
console.log("All Trade Check integration checks passed");
