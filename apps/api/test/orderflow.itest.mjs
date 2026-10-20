// Integration test: Order Flow and the scalping desk. Both worker scans read fake Binance public
// data (in Binance's own formats) into a real Postgres and Redis; the API serves it with plan
// limits and the trader's open coins. Every figure is checked against an independent
// calculation made here from the raw rows. Run after build.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { Redis } from "ioredis";
import {
  resetOrderflowCache,
  runOrderflow,
  runOrderflowFast,
} from "../../worker/dist/market/orderflow.js";
import { OrderflowService } from "../dist/market/orderflow.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const M1 = 60_000;
const M5 = 300_000;
const NOW = Date.UTC(2026, 9, 18, 12, 6, 10);
const OPEN5 = Math.floor(NOW / M5) * M5; // forming 5-minute candle
const OPEN1 = Math.floor(NOW / M1) * M1; // forming 1-minute candle
const COINS = 130; // more than the 100 scanned

let seed = 11;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const names = Array.from({ length: COINS }, (_, i) =>
  i === 0 ? "BTCUSDT" : i === 1 ? "1000PEPEUSDT" : i === 125 ? "XAUUSDT" : `C${i}USDT`,
);
/** Candles (the last one forming) and open interest each period; one coin has no OI at all. */
function series(i, n, step, open, startPrice) {
  const drift = (rnd() - 0.5) * 0.004;
  const oiDrift = (rnd() - 0.5) * 0.003;
  const tilt = (rnd() - 0.5) * 0.3;
  const candles = [];
  const ois = [];
  let p = startPrice;
  let oi = 1e6 * (1 + rnd());
  for (let k = n - 1; k >= 0; k--) {
    const t = open - k * step;
    const o = p;
    p = p * (1 + drift + (rnd() - 0.5) * 0.004);
    const quote = (1000 + rnd() * 9000) * (k < 6 && i % 4 === 0 ? 6 : 1); // some volume spikes
    const buy = quote * Math.min(1, Math.max(0, 0.5 + tilt + (rnd() - 0.5) * 0.2));
    const base = (quote / ((o + p) / 2)) * (0.999 + rnd() * 0.002);
    const h = Math.max(o, p) * (1 + rnd() * 0.002);
    const l = Math.min(o, p) * (1 - rnd() * 0.002);
    candles.push({ t, o, h, l, c: p, base, quote, buy });
    oi = oi * (1 + oiDrift + (rnd() - 0.5) * 0.002);
    if (i !== 7 && t < open) ois.push({ t, oi });
  }
  return { candles, ois };
}
const raw = new Map();
for (const [i, s] of names.entries()) {
  const price = 10 + rnd() * 100;
  const slow = series(i, 300, M5, OPEN5, price);
  const fast = series(i, 300, M1, OPEN1, price);
  // Coin 9 halted 30 minutes ago: left out of every window.
  if (i === 9) {
    slow.candles = slow.candles.slice(0, -7);
    fast.candles = fast.candles.slice(0, -31);
  }
  raw.set(s, {
    slow,
    fast,
    vol: (COINS - i) * 1e6 + rnd(),
    listed: i === 12 ? NOW - 3600_000 : 0,
    funding: i % 5 === 0 ? null : (rnd() - 0.5) * 0.001,
  });
}
/** A book around the latest price: 60 levels a side, 0.02% apart, with a wall on coin 3. */
function book(symbol) {
  const r = raw.get(symbol);
  const mid = r.fast.candles.at(-1).c;
  const bids = [];
  const asks = [];
  for (let k = 1; k <= 60; k++) {
    bids.push([
      mid * (1 - 0.0002 * k),
      1 + ((k * 7) % 5) + (symbol === "C3USDT" && k === 10 ? 80 : 0),
    ]);
    asks.push([mid * (1 + 0.0002 * k), 1 + ((k * 3) % 4)]);
  }
  return { bids, asks };
}
const json = (body, status = 200) => Response.json(body, { status });
const kline = (c, step) => [
  c.t,
  String(c.o),
  String(c.h),
  String(c.l),
  String(c.c),
  String(c.base),
  c.t + step - 1,
  String(c.quote),
  1,
  "0",
  String(c.buy),
  "0",
];
const fetchFn = async (input) => {
  const url = new URL(String(input));
  const q = (k) => url.searchParams.get(k);
  const r = raw.get(q("symbol"));
  switch (url.pathname) {
    case "/fapi/v1/exchangeInfo":
      return json({
        symbols: [...raw.entries()].map(([symbol, x]) => ({
          symbol,
          baseAsset: symbol.replace("USDT", ""),
          quoteAsset: "USDT",
          // Gold is a TradFi perpetual: outside the top 100 by volume, scanned anyway.
          contractType: symbol === "XAUUSDT" ? "TRADIFI_PERPETUAL" : "PERPETUAL",
          status: "TRADING",
          onboardDate: x.listed,
        })),
      });
    case "/fapi/v1/ticker/24hr":
      return json(
        [...raw.entries()].map(([symbol, x]) => ({ symbol, quoteVolume: String(x.vol) })),
      );
    case "/fapi/v1/premiumIndex":
      return json(
        [...raw.entries()].map(([symbol, x]) => ({
          symbol,
          lastFundingRate: x.funding === null ? "" : String(x.funding),
        })),
      );
    case "/fapi/v1/klines": {
      const fast = q("interval") === "1m";
      const step = fast ? M1 : M5;
      return json(
        (fast ? r.fast : r.slow).candles.slice(-Number(q("limit"))).map((c) => kline(c, step)),
      );
    }
    case "/futures/data/openInterestHist": {
      const from = Number(q("startTime"));
      const to = Number(q("endTime"));
      return json(
        r.slow.ois
          .filter((x) => x.t >= from && x.t <= to)
          .slice(0, 500)
          .map((x) => ({ symbol: q("symbol"), sumOpenInterest: String(x.oi), timestamp: x.t })),
      );
    }
    case "/fapi/v1/openInterest": {
      const last = r.fast.ois.at(-1);
      if (!last) return json({ msg: "none" }, 400);
      return json({ symbol: q("symbol"), openInterest: String(last.oi * 1.01), time: NOW });
    }
    case "/fapi/v1/depth": {
      const b = book(q("symbol"));
      return json({
        T: NOW,
        bids: b.bids.map(([p, x]) => [String(p), String(x)]),
        asks: b.asks.map(([p, x]) => [String(p), String(x)]),
      });
    }
    default:
      return json({ msg: "unknown" }, 404);
  }
};

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
await db.marketSnapshot.deleteMany({
  where: { OR: [{ key: { startsWith: "orderflow:" } }, { key: "scalp:latest" }] },
});
// An hour of earlier 1-minute runs: live open-interest readings already in Redis.
for (const s of names) {
  const key = `of:oi:${s}`;
  await redis.del(key);
  const pts = raw.get(s).fast.ois.filter((x) => x.t >= NOW - 75 * M1);
  if (pts.length) await redis.zadd(key, ...pts.flatMap((x) => [x.t, `${x.t}:${x.oi}`]));
}
resetOrderflowCache();

// 1. Both scans.
const config = { binance: { fetch: fetchFn } };
const res = await runOrderflow({ db, config, now: () => NOW });
assert.equal(res.failed, 0);
assert.equal(res.coins, 100, "99 of the top 100 (one halted) plus gold");
const resFast = await runOrderflowFast({ db, redis, config, now: () => NOW });
assert.equal(resFast.coins, 100);
assert.equal(resFast.books, 20, "the top 20 by volume, less the halted coin, plus gold");
// Rank: place by volume among contracts listed for two days (coin 12 is an hour old).
const eligible = names.filter((_, i) => i !== 12);

// 2. Independent recomputation.
const SPEC = {
  "5m": [5, "fast"],
  "15m": [15, "fast"],
  "30m": [30, "fast"],
  "1h": [60, "fast"],
  "4h": [48, "slow"],
  "24h": [288, "slow"],
};
const TH = {
  "5m": [0.15, 0.2],
  "15m": [0.2, 0.3],
  "30m": [0.25, 0.4],
  "1h": [0.3, 0.5],
  "4h": [0.6, 1],
  "24h": [1.5, 2],
};
const ST = {
  "5m": [10, 25],
  "15m": [8, 20],
  "30m": [6, 15],
  "1h": [5, 12],
  "4h": [3, 8],
  "24h": [2, 5],
};
function expected(symbol, w) {
  const [n, tier] = SPEC[w];
  const r = raw.get(symbol)[tier];
  const step = tier === "fast" ? M1 : M5;
  const open = tier === "fast" ? OPEN1 : OPEN5;
  const closed = r.candles.filter((c) => c.t < open).slice(-(tier === "fast" ? 240 : 288));
  const win = closed.slice(-n);
  const vol = win.reduce((s, c) => s + c.quote, 0);
  const net = win.reduce((s, c) => s + (c.buy - (c.quote - c.buy)), 0);
  const pressure = (net / vol) * 100;
  const price = (win.at(-1).c / win[0].o - 1) * 100;
  const start = win[0].t;
  const sOi = r.ois.find((x) => x.t === start);
  const eOi = r.ois.filter((x) => x.t <= win.at(-1).t + step).at(-1);
  const oiPct = sOi && eOi ? (eOi.oi / sOi.oi - 1) * 100 : null;
  const [tp, to] = TH[w];
  let regime = "neutral";
  if (oiPct !== null && Math.abs(price) >= tp && Math.abs(oiPct) >= to)
    regime =
      oiPct > 0
        ? price > 0
          ? "long_buildup"
          : "short_buildup"
        : price > 0
          ? "short_covering"
          : "long_unwinding";
  const [lean, strong] = ST[w];
  const strength =
    pressure >= strong
      ? "strong_buying"
      : pressure >= lean
        ? "buying"
        : pressure <= -strong
          ? "strong_selling"
          : pressure <= -lean
            ? "selling"
            : "neutral";
  const avg = closed.reduce((s, c) => s + c.quote, 0) / closed.length;
  return {
    vol,
    net,
    pressure,
    price,
    oiPct,
    oiUsd: oiPct === null ? null : (eOi.oi - sOi.oi) * win.at(-1).c,
    regime,
    strength,
    rel: w === "24h" ? null : vol / n / avg,
  };
}
const close = (a, b, what) =>
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);
let checked = 0;
const strengthsSeen = new Set();
for (const w of Object.keys(SPEC)) {
  const row = await db.marketSnapshot.findUnique({ where: { key: `orderflow:${w}` } });
  const snap = row.data;
  assert.equal(snap.universe, 101);
  assert.equal(snap.asOf, new Date(SPEC[w][1] === "fast" ? OPEN1 : OPEN5).toISOString());
  assert.equal(snap.coins.length, 100, w);
  assert.ok(!snap.coins.some((c) => c.symbol === "C9USDT" || c.symbol === "C12USDT"));
  const counts = {};
  for (const c of snap.coins) {
    const e = expected(c.symbol, w);
    close(c.volumeUsd, e.vol, `${w} ${c.symbol} volume`);
    close(c.netFlowUsd, e.net, `${w} ${c.symbol} net`);
    close(c.buyPressurePct, e.pressure, `${w} ${c.symbol} pressure`);
    close(c.priceChangePct, e.price, `${w} ${c.symbol} price`);
    if (e.oiPct === null) assert.equal(c.oiChangePct, null, `${w} ${c.symbol} oi`);
    else {
      close(c.oiChangePct, e.oiPct, `${w} ${c.symbol} oi%`);
      close(c.oiChangeUsd, e.oiUsd, `${w} ${c.symbol} oi$`);
    }
    if (e.rel === null) assert.equal(c.relVolume, null);
    else close(c.relVolume, e.rel, `${w} ${c.symbol} relative volume`);
    assert.equal(c.regime, e.regime, `${w} ${c.symbol} regime`);
    assert.equal(c.strength, e.strength, `${w} ${c.symbol} strength`);
    strengthsSeen.add(c.strength);
    assert.equal(c.rank, eligible.indexOf(c.symbol) + 1);
    const f = raw.get(c.symbol).funding;
    assert.equal(c.funding, f === null ? null : Number(String(f)));
    counts[c.regime] = (counts[c.regime] ?? 0) + 1;
    checked++;
  }
  for (const [k, v] of Object.entries(counts)) assert.equal(snap.counts[k], v);
  assert.equal(snap.buying, snap.coins.filter((c) => c.netFlowUsd > 0).length);
  assert.equal(snap.selling, snap.coins.filter((c) => c.netFlowUsd < 0).length);
}
assert.equal(checked, 100 * 6);
assert.equal(strengthsSeen.size, 5, "every strength level occurs");
console.log(`✓ both scans: ${checked} coin-timeframes match an independent calculation`);

// 3. Scalping snapshot: VWAP since 00:00 UTC and order books.
const scalp = (await db.marketSnapshot.findUnique({ where: { key: "scalp:latest" } })).data;
assert.equal(scalp.coins.length, 100);
assert.equal(scalp.coins.find((c) => c.symbol === "XAUUSDT").rank, 125);
/** Independent ATR: aligned full bars, true range against the previous close, last 14 averaged. */
function refAtr(candles, step, size) {
  const span = step * size;
  const bars = [];
  for (const x of candles) {
    const k = Math.floor(x.t / span) * span;
    let b = bars.find((y) => y.t === k);
    if (!b) {
      b = { t: k, n: 0, h: -Infinity, l: Infinity, first: x, last: x };
      bars.push(b);
    }
    b.n++;
    b.h = Math.max(b.h, x.h);
    b.l = Math.min(b.l, x.l);
    if (x.t < b.first.t) b.first = x;
    if (x.t > b.last.t) b.last = x;
  }
  const full = bars.filter((b) => b.n === size).sort((a, b) => a.t - b.t);
  const tr = full
    .slice(1)
    .map((b, i) =>
      Math.max(b.h - b.l, Math.abs(b.h - full[i].last.c), Math.abs(b.l - full[i].last.c)),
    );
  return { tr, atr: tr.length >= 14 ? tr.slice(-14).reduce((a, v) => a + v, 0) / 14 : null };
}
const dayStart = Math.floor(OPEN5 / 86_400_000) * 86_400_000;
for (const c of scalp.coins) {
  const r = raw.get(c.symbol);
  const today = r.slow.candles.filter((x) => x.t >= dayStart && x.t < OPEN5);
  const vwap = today.reduce((s, x) => s + x.quote, 0) / today.reduce((s, x) => s + x.base, 0);
  close(c.vwap, vwap, `${c.symbol} vwap`);
  const price = r.fast.candles.filter((x) => x.t < OPEN1).at(-1).c;
  close(c.price, price, `${c.symbol} price`);
  close(c.vwapDistPct, (price / vwap - 1) * 100, `${c.symbol} vwap distance`);
  // Levels: the 5-minute scan's day plus the 1-minute candles since.
  const fast = r.fast.candles.filter((x) => x.t < OPEN1).slice(-240);
  const slow24 = r.slow.candles.filter((x) => x.t < OPEN5 && x.t >= OPEN5 - 86_400_000);
  const fast24 = fast.filter((x) => x.t >= OPEN1 - 86_400_000);
  const fastToday = fast.filter((x) => x.t >= dayStart);
  const asia = [...today, ...fastToday].filter((x) => x.t < dayStart + 7 * 3_600_000);
  const L = c.levels;
  close(L.dayHigh, Math.max(...[...today, ...fastToday].map((x) => x.h)), `${c.symbol} day high`);
  close(L.dayLow, Math.min(...[...today, ...fastToday].map((x) => x.l)), `${c.symbol} day low`);
  close(L.asiaHigh, Math.max(...asia.map((x) => x.h)), `${c.symbol} asia high`);
  close(L.asiaLow, Math.min(...asia.map((x) => x.l)), `${c.symbol} asia low`);
  assert.equal(L.asiaOpen, false);
  close(L.high24h, Math.max(...[...slow24, ...fast24].map((x) => x.h)), `${c.symbol} 24h high`);
  close(L.low24h, Math.min(...[...slow24, ...fast24].map((x) => x.l)), `${c.symbol} 24h low`);
  // Volatility.
  const r5 = refAtr(fast, M1, 5);
  close(c.volatility.atr5m, r5.atr, `${c.symbol} atr 5m`);
  close(c.volatility.atr15m, refAtr(fast, M1, 15).atr, `${c.symbol} atr 15m`);
  const slowClosed = r.slow.candles.filter((x) => x.t < OPEN5).slice(-288);
  close(c.volatility.atr1h, refAtr(slowClosed, M5, 12).atr, `${c.symbol} atr 1h`);
  const ratio =
    r5.tr.slice(-6).reduce((a, v) => a + v, 0) /
    6 /
    (r5.tr.reduce((a, v) => a + v, 0) / r5.tr.length);
  close(c.volatility.rangeRatio, ratio, `${c.symbol} range ratio`);
  const act = ratio < 0.7 ? "quiet" : ratio < 1.3 ? "normal" : ratio < 2 ? "active" : "very_active";
  assert.equal(c.volatility.activity, act);
  assert.equal(Object.keys(c.frames).length, 6);
  for (const w of Object.keys(SPEC))
    assert.equal(c.frames[w].strength, expected(c.symbol, w).strength);
  if (c.rank <= 20 || c.symbol === "XAUUSDT") {
    assert.ok(c.book, `${c.symbol} book`);
    const b = book(c.symbol);
    const mid = (b.bids[0][0] + b.asks[0][0]) / 2;
    // The fake book reaches 1.2% each side: every band is covered.
    assert.deepEqual(
      c.book.bands.map((x) => x.pct),
      [0.05, 0.1, 0.25, 0.5, 1],
    );
    for (const band of c.book.bands) {
      const bid = b.bids
        .filter(([p]) => p >= mid * (1 - band.pct / 100))
        .reduce((s, [p, x]) => s + p * x, 0);
      const ask = b.asks
        .filter(([p]) => p <= mid * (1 + band.pct / 100))
        .reduce((s, [p, x]) => s + p * x, 0);
      close(band.bidUsd, bid, `${c.symbol} bid ${band.pct}`);
      close(band.askUsd, ask, `${c.symbol} ask ${band.pct}`);
    }
    close(c.book.spreadBps, ((b.asks[0][0] - b.bids[0][0]) / mid) * 10_000, "spread");
  } else assert.equal(c.book, null);
}
const c3 = scalp.coins.find((c) => c.symbol === "C3USDT");
assert.equal(c3.book.walls.length, 1);
assert.equal(c3.book.walls[0].side, "bid");
close(c3.book.walls[0].distPct, 0.2, "wall distance");
console.log(
  "✓ scalping desk: VWAP, levels, ATR, activity and order-book bands match (gold included)",
);

// 4. API: plans and the trader's own coins.
const mk = (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `of${n}`,
      email: `of${n}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const pro = await mk(2, "PRO");
const acct = await db.exchangeAccount.create({
  data: { userId: pro.id, exchange: "OKX", label: "OKX", apiKeyHint: "1234" },
});
await db.openPosition.createMany({
  data: [
    ["PEPE-USDT-SWAP", "PEPE"],
    ["C40-USDT-SWAP", "C40"],
  ].map(([symbol, base]) => ({
    userId: pro.id,
    accountId: acct.id,
    exchange: "OKX",
    externalId: symbol,
    symbol,
    baseAsset: base,
    quoteAsset: "USDT",
    settleAsset: "USDT",
    direction: "LONG",
    syncedAt: new Date(NOW),
  })),
});
const svc = new OrderflowService({ client: db });
const f = await svc.get(free.id, { window: "5m" });
assert.equal(f.limit, 20);
assert.equal(f.coins.length, 20, "top 20 (rank 10 halted) plus gold, on every plan");
assert.ok(f.coins.every((c) => c.rank <= 20 || c.symbol === "XAUUSDT"));
assert.equal(f.hidden, 80);
assert.equal(f.buying + f.selling, 100, "market-wide counts stay complete");
assert.deepEqual(f.mine, []);
const p = await svc.get(pro.id, { window: "4h" });
assert.equal(p.limit, null);
assert.equal(p.coins.length, 100);
assert.deepEqual(p.mine.sort(), ["1000PEPEUSDT", "C40USDT"]);
// Every window of every shown coin, straight from each window's own scan.
assert.deepEqual(Object.keys(f.across).sort(), f.coins.map((c) => c.symbol).sort());
let acrossChecked = 0;
for (const w of Object.keys(SPEC)) {
  const snapW = (await db.marketSnapshot.findUnique({ where: { key: `orderflow:${w}` } })).data;
  for (const c of snapW.coins) {
    const cell = p.across[c.symbol][w];
    assert.deepEqual(cell, { p: c.buyPressurePct, s: c.strength, r: c.regime }, `${c.symbol} ${w}`);
    acrossChecked++;
  }
}
assert.equal(acrossChecked, 600);
const fs = await svc.scalp(free.id, new Date(NOW));
assert.equal(fs.coins.length, 20);
assert.ok(fs.coins.some((c) => c.symbol === "XAUUSDT"));
assert.equal(fs.hidden, 80);
const ps = await svc.scalp(pro.id, new Date(NOW));
assert.equal(ps.coins.length, 100);
// News risk: high-impact US releases from 15 minutes ago to 4 hours ahead.
await db.economicEvent.deleteMany({ where: { id: { startsWith: "of-test-" } } });
const ev = (id, title, mins, impact = "HIGH", currency = "USD") => ({
  id: `of-test-${id}`,
  title,
  currency,
  impact,
  startsAt: new Date(NOW + mins * M1),
  source: "test",
  fetchedAt: new Date(NOW),
});
await db.economicEvent.createMany({
  data: [
    ev("a", "CPI m/m", 10),
    ev("b", "Retail sales", -5),
    ev("c", "Old release", -20),
    ev("d", "ECB rate", 30, "HIGH", "EUR"),
    ev("e", "Minor data", 40, "LOW"),
    ev("f", "Far away", 300),
  ],
});
const withNews = await svc.scalp(pro.id, new Date(NOW));
assert.deepEqual(
  withNews.events.map((e) => e.title),
  ["Retail sales", "CPI m/m"],
);
await db.economicEvent.deleteMany({ where: { id: { startsWith: "of-test-" } } });
assert.deepEqual(ps.mine.sort(), ["1000PEPEUSDT", "C40USDT"]);
console.log(
  "✓ API: free plan gets the top 20 coins plus gold, held coins marked, news risk window",
);

// 5. Failures keep the last good figures; a stale 5-minute scan drops 4H/1D from the desk.
const before = await db.marketSnapshot.findUnique({ where: { key: "orderflow:4h" } });
const broken = async (input) =>
  String(input).includes("klines") ? json({ msg: "down" }, 503) : fetchFn(input);
await assert.rejects(
  runOrderflow({ db, config: { binance: { fetch: broken } }, now: () => NOW + M5 }),
  /only 0 of 101/,
);
const after = await db.marketSnapshot.findUnique({ where: { key: "orderflow:4h" } });
assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
// Pretend the 5-minute scan last succeeded 30 minutes ago.
for (const key of ["orderflow:4h", "orderflow:24h", "orderflow:vwap"]) {
  const r = await db.marketSnapshot.findUnique({ where: { key } });
  const old = new Date(NOW - 30 * M1).toISOString();
  await db.marketSnapshot.update({
    where: { key },
    data: {
      data: { ...r.data, ...(key === "orderflow:vwap" ? { asOf: old } : { computedAt: old }) },
    },
  });
}
await runOrderflowFast({ db, redis, config, now: () => NOW });
const late = (await db.marketSnapshot.findUnique({ where: { key: "scalp:latest" } })).data;
assert.ok(late.coins.every((c) => !c.frames["4h"] && !c.frames["24h"] && c.vwap === null));
const lateOf = await svc.get(pro.id, { window: "5m" });
assert.ok(
  Object.values(lateOf.across).every((x) => x["5m"] && x["1h"] && !x["4h"] && !x["24h"]),
  "a 30-minute-old scan is left out of the matrix",
);
console.log("✓ a failed scan leaves the last good figures; stale 4H/1D are not shown as current");

await db.marketSnapshot.deleteMany({
  where: { OR: [{ key: { startsWith: "orderflow:" } }, { key: "scalp:latest" }] },
});
const empty = await svc.scalp(pro.id);
assert.equal(empty.computedAt, null);
assert.equal((await svc.get(pro.id, { window: "24h" })).coins.length, 0);
for (const s of names) await redis.del(`of:oi:${s}`);
await redis.quit();
await db.$disconnect();
console.log("All Order Flow and scalping integration checks passed");
