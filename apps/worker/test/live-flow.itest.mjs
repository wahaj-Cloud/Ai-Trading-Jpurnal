// Integration test: live order flow. The engine streams fake Binance messages (in Binance's own
// formats) and polls fake REST endpoints, with a real Postgres and Redis. Its published figures are
// checked against a calculation made here from the raw data, and (with DUMP_LIVE=path) the raw data
// and the tick are written out for the independent Python check. Live scalp alerts are fired on a
// tick, once. Run after build.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createPrismaClient } from "@atc/db";
import {
  LIVE_ALIVE_KEY,
  LIVE_FLOW_CHANNEL,
  LIVE_FLOW_KEY,
  planFromQuery,
  SCALP_KEY,
  STRENGTH_THRESHOLDS,
} from "@atc/shared";
import { Redis } from "ioredis";
import { LiveFlowEngine } from "../dist/market/live-flow.js";
import { LiveScalpAlerts, runScalpReadouts } from "../dist/market/scalp-readouts.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
if (
  !/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) ||
  !/\/\/(localhost|127\.0\.0\.1)[:/]/.test(redisUrl)
)
  throw new Error("Integration tests only run against a local DATABASE_URL and REDIS_URL");
const db = createPrismaClient(dbUrl);
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const M1 = 60_000;
const OPEN = Date.UTC(2026, 9, 20, 9, 30); // the minute forming now
let NOW = OPEN + 20_000 + (Number(process.env.LIVE_SEED ?? 99) % 30) * 1_000;
const START = NOW;

let seed = Number(process.env.LIVE_SEED ?? 99);
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const RANKS = {
  BTCUSDT: 1,
  ETHUSDT: 2,
  SOLUSDT: 3,
  C12USDT: 12,
  C20USDT: 20,
  C21USDT: 21,
  C60USDT: 60,
  XAUUSDT: 125,
};
const SYMBOLS = Object.keys(RANKS);

// Raw market: 240 closed 1-minute candles per coin before OPEN, open interest as a function of time.
const raw = new Map();
for (const [i, s] of SYMBOLS.entries()) {
  // Gold leans clearly one way, so the alert below is met whatever the seed.
  const tilt = s === "XAUUSDT" ? 0.3 : (rnd() - 0.5) * 0.4;
  const candles = [];
  let p = 50 + i * 37;
  for (let k = 240; k >= 1; k--) {
    const t = OPEN - k * M1;
    const o = p;
    p *= 1 + (rnd() - 0.5) * 0.004 + tilt * 0.0005;
    const quote = (1000 + rnd() * 9000) * (k <= 4 && i % 3 === 0 ? 5 : 1);
    candles.push({
      t,
      o,
      h: Math.max(o, p) * (1 + rnd() * 0.0015),
      l: Math.min(o, p) * (1 - rnd() * 0.0015),
      c: p,
      base: quote / p,
      quote,
      buy: quote * Math.min(1, Math.max(0, 0.5 + tilt + (rnd() - 0.5) * 0.3)),
    });
  }
  const oiBase = 1e6 * (1 + rnd());
  const oiDrift = (rnd() - 0.5) * 1e-5; // per second
  raw.set(s, { candles, oiAt: (t) => oiBase * (1 + oiDrift * ((t - OPEN) / 1000)), oi: [] });
}

const json = (b, status = 200) => Response.json(b, { status });
let oiCalls = [];
const fetchFn = async (input) => {
  const url = new URL(String(input));
  const s = url.searchParams.get("symbol");
  const r = raw.get(s);
  if (!r) return json({ msg: "unknown" }, 400);
  if (url.pathname === "/fapi/v1/klines") {
    // REST returns the closed history plus the forming candle (which the client drops).
    const rows = r.candles.map((c) => [
      c.t,
      String(c.o),
      String(c.h),
      String(c.l),
      String(c.c),
      String(c.base),
      c.t + M1 - 1,
      String(c.quote),
      10,
      "0",
      String(c.buy),
      "0",
    ]);
    rows.push([OPEN, "1", "1", "1", "1", "1", OPEN + M1 - 1, "1", 1, "0", "1", "0"]);
    return json(rows.slice(-Number(url.searchParams.get("limit"))));
  }
  if (url.pathname === "/fapi/v1/openInterest") {
    oiCalls.push(s);
    const reading = { t: NOW, oi: r.oiAt(NOW) };
    r.oi.push(reading);
    return json({ symbol: s, openInterest: String(reading.oi), time: reading.t });
  }
  return json({}, 404);
};

class FakeWS {
  static all = [];
  static OPEN = 1;
  OPEN = 1;
  readyState = 0;
  listeners = {};
  constructor(url) {
    this.url = url;
    FakeWS.all.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit("open", {});
    });
  }
  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  emit(type, ev) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.emit("close", {});
  }
  push(msg) {
    this.emit("message", { data: JSON.stringify(msg) });
  }
}

// Clean state.
for (const k of await redis.keys("of:oi:*")) await redis.del(k);
await redis.del("liveflow:leader", LIVE_FLOW_KEY, LIVE_ALIVE_KEY);
await db.marketSnapshot.deleteMany({ where: { key: SCALP_KEY } });

// The 1-minute scan's open-interest readings (one a minute for 75 minutes), loaded at start-up.
for (const s of SYMBOLS) {
  const r = raw.get(s);
  // Some minutes are missing (a slow scan, a restart): the nearest reading may be 2–3 minutes
  // from a window's start, which tests the "within two minutes" rule.
  const gapFrom = 2 + Math.floor(rnd() * 70);
  for (let k = 75; k >= 1; k--) {
    if (rnd() < 0.3 || (k <= gapFrom && k > gapFrom - 4)) continue;
    const t = OPEN - k * M1 + 7_000;
    const v = r.oiAt(t) * (1 + (rnd() - 0.5) * 0.004);
    r.oi.push({ t, oi: v });
    await redis.zadd(`of:oi:${s}`, t, `${t}:${v}`);
  }
}

// The 1-minute scan's snapshot: coins, ranks, VWAP, levels, a book on the top coins.
const scalpCoin = (s) => {
  const last = raw.get(s).candles.at(-1);
  return {
    symbol: s,
    rank: RANKS[s],
    price: last.c,
    vwap: s === "XAUUSDT" ? last.c * 0.9 : last.c,
    vwapDistPct: 0,
    funding: 0.0001,
    frames: {},
    book:
      RANKS[s] <= 20 || s === "XAUUSDT"
        ? { asOf: new Date(OPEN).toISOString(), mid: last.c, spreadBps: 0.5, bands: [], walls: [] }
        : null,
    levels: {
      dayHigh: last.c * 1.01,
      dayLow: last.c * 0.99,
      asiaHigh: last.c * 1.005,
      asiaLow: last.c * 0.995,
      asiaOpen: false,
      high24h: last.c * 1.02,
      low24h: last.c * 0.98,
    },
    volatility: { atr5m: 1, atr15m: 2, atr1h: 3, rangeRatio: 1, activity: "normal" },
  };
};
await db.marketSnapshot.create({
  data: {
    key: SCALP_KEY,
    updatedAt: new Date(OPEN),
    data: {
      computedAt: new Date(OPEN).toISOString(),
      asOf: new Date(OPEN).toISOString(),
      universe: 101,
      coins: SYMBOLS.map(scalpCoin),
    },
  },
});

// 1. Leadership: one engine streams; a second one waits.
const ticks = [];
const engine = new LiveFlowEngine({
  db,
  redis,
  config: { binance: { fetch: fetchFn } },
  WebSocketImpl: FakeWS,
  now: () => NOW,
  onTick: (t) => ticks.push(t),
});
const other = new LiveFlowEngine({
  db,
  redis,
  config: { binance: { fetch: fetchFn } },
  WebSocketImpl: FakeWS,
  now: () => NOW,
});
await engine.leadership();
await other.leadership();
assert.equal(engine.isLeader, true);
assert.equal(other.isLeader, false, "only one worker streams");
await new Promise((r) => setTimeout(r, 5));

// Streams: every coin's 1-minute candle and mark price on the market route; best bid/ask on the
// public route for the top 20, gold and silver only.
const urls = FakeWS.all.map((w) => w.url);
const market = urls.find((u) => u.includes("@kline_1m"));
assert.ok(market?.startsWith("wss://fstream.binance.com/market/stream?streams="));
for (const s of SYMBOLS) assert.ok(market.includes(`${s.toLowerCase()}@kline_1m`), s);
assert.ok(urls.some((u) => u.endsWith("streams=!markPrice@arr@1s")));
const book = urls.find((u) => u.includes("@bookTicker"));
assert.ok(book.startsWith("wss://fstream.binance.com/public/stream?streams="));
assert.deepEqual(
  book
    .split("=")[1]
    .split("/")
    .map((x) => x.replace("@bookTicker", "").toUpperCase())
    .sort(),
  ["BTCUSDT", "C12USDT", "C20USDT", "ETHUSDT", "SOLUSDT", "XAUUSDT"],
);
for (const s of SYMBOLS) assert.equal(engine.state(s).closed.length, 240, `${s} seeded`);
console.log(
  "✓ one engine leads; klines and mark price for every coin, spreads for the top 20 and gold",
);

// 2. Live messages: the forming candle, funding, best bid and ask.
const ws = (part) => FakeWS.all.find((w) => w.url.includes(part));
const forming = new Map();
const klineMsg = (s, c, closed) => ({
  stream: `${s.toLowerCase()}@kline_1m`,
  data: {
    e: "kline",
    E: NOW,
    s,
    k: {
      t: c.t,
      T: c.t + M1 - 1,
      s,
      i: "1m",
      o: String(c.o),
      c: String(c.c),
      h: String(c.h),
      l: String(c.l),
      v: String(c.base),
      n: 5,
      x: closed,
      q: String(c.quote),
      V: "0",
      Q: String(c.buy),
      B: "0",
    },
  },
});
for (const s of SYMBOLS) {
  const last = raw.get(s).candles.at(-1);
  const quote = 3000 + rnd() * 3000;
  const c = {
    t: OPEN,
    o: last.c,
    c: last.c * (1 + (rnd() - 0.4) * 0.004),
    h: last.c * 1.003,
    l: last.c * 0.998,
    base: quote / last.c,
    quote,
    buy: s === "XAUUSDT" ? quote : quote * rnd(),
  };
  forming.set(s, c);
  ws("@kline_1m").push(klineMsg(s, c, false));
}
const funding = Object.fromEntries(
  SYMBOLS.map((s) => [s, s === "XAUUSDT" ? -0.0005 : Number(((rnd() - 0.4) * 0.001).toFixed(8))]),
);
ws("markPrice").push({
  stream: "!markPrice@arr@1s",
  data: SYMBOLS.map((s) => ({
    e: "markPriceUpdate",
    E: NOW,
    s,
    p: "1",
    r: String(funding[s]),
    T: 0,
  })),
});
const quotes = {};
for (const s of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "C12USDT", "C20USDT", "XAUUSDT"]) {
  const mid = forming.get(s).c;
  quotes[s] = { bid: mid * (1 - 0.00002 * (1 + rnd())), ask: mid * (1 + 0.00002 * (1 + rnd())) };
  ws("@bookTicker").push({
    stream: `${s.toLowerCase()}@bookTicker`,
    data: {
      e: "bookTicker",
      u: 1,
      s,
      b: String(quotes[s].bid),
      B: "1",
      a: String(quotes[s].ask),
      A: "1",
      T: NOW,
      E: NOW,
    },
  });
}

// 3. Open interest: every coin at first, then the top coins every 5 s, the rest every 15 s.
oiCalls = [];
await engine.pollOpenInterest();
assert.equal(oiCalls.length, SYMBOLS.length);
for (const step of [5_000, 5_000, 5_000]) {
  NOW += step;
  oiCalls = [];
  await engine.pollOpenInterest();
  const slow = oiCalls.filter((s) => s === "C21USDT" || s === "C60USDT");
  assert.equal(oiCalls.length - slow.length, 6, "top coins and gold every 5 seconds");
  assert.equal(slow.length, NOW - START >= 15_000 ? 2 : 0, "the rest every 15 seconds");
}
assert.equal(
  await redis.zcard("of:oi:BTCUSDT"),
  raw.get("BTCUSDT").oi.filter((r) => r.t >= NOW - 75 * M1).length,
  "readings shared with the minute scan; older than 75 minutes dropped",
);
console.log(
  "✓ open interest every 5 s (top 20, gold) and 15 s (others), stored for the minute scan",
);

// 4. The tick, against a calculation made here from the raw data.
const sub = new Redis(redisUrl);
const published = new Promise((resolve) => {
  sub.on("message", (_c, m) => resolve(JSON.parse(m)));
});
await sub.subscribe(LIVE_FLOW_CHANNEL);
const tick = await engine.tick();
const pub = await published;
const stored = JSON.parse(await redis.get(LIVE_FLOW_KEY));
assert.equal(await redis.get(LIVE_ALIVE_KEY), "1");
assert.equal(pub.at, NOW);
assert.equal(stored.coins.length, SYMBOLS.length);
assert.equal(ticks.length, 1, "alerts hook called with the tick");

const close = (a, b, what, tol = 1e-8) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);
const N = { "5m": 5, "15m": 15, "30m": 30, "1h": 60 };
let checked = 0;
for (const s of SYMBOLS) {
  const r = raw.get(s);
  const f = forming.get(s);
  const all = [...r.candles, f];
  const coin = stored.coins.find((c) => c.s === s);
  assert.equal(coin.r, RANKS[s]);
  close(coin.p, f.c, `${s} price`);
  close(coin.f, funding[s], `${s} funding`);
  if (quotes[s]) {
    const { bid, ask } = quotes[s];
    close(coin.sp, ((ask - bid) / ((ask + bid) / 2)) * 10_000, `${s} spread`);
  } else assert.equal(coin.sp, null);
  for (const [w, n] of Object.entries(N)) {
    const win = all.slice(-n);
    const vol = win.reduce((a, c) => a + c.quote, 0);
    const buy = win.reduce((a, c) => a + c.buy, 0);
    const cell = coin.w[w];
    close(cell.vol, vol, `${s} ${w} volume`);
    close(cell.nf, 2 * buy - vol, `${s} ${w} net`);
    const bp = ((2 * buy - vol) / vol) * 100;
    close(cell.bp, bp, `${s} ${w} pressure`);
    close(cell.pc, (f.c / win[0].o - 1) * 100, `${s} ${w} price`);
    const [lean, strong] = [STRENGTH_THRESHOLDS[w].lean, STRENGTH_THRESHOLDS[w].strong];
    const st =
      bp >= strong
        ? "strong_buying"
        : bp >= lean
          ? "buying"
          : bp <= -strong
            ? "strong_selling"
            : bp <= -lean
              ? "selling"
              : "neutral";
    assert.equal(cell.st, st, `${s} ${w} strength`);
    const avg = r.candles.reduce((a, c) => a + c.quote, 0) / r.candles.length;
    const elapsed = Math.min(1, Math.max(1 / 60, (NOW - OPEN) / M1));
    close(cell.rv, vol / (n - 1 + elapsed) / avg, `${s} ${w} pace`);
    checked++;
  }
}
assert.equal(checked, SYMBOLS.length * 4);
console.log(
  `✓ live windows match an independent calculation (${checked} coin-windows), published and stored`,
);

// 5. A closed minute extends the history; a skipped minute is refilled from REST.
const settle = () => new Promise((r) => setImmediate(r));
const fin = forming.get("BTCUSDT");
ws("@kline_1m").push(klineMsg("BTCUSDT", fin, true));
await settle();
assert.equal(engine.state("BTCUSDT").closed.length, 241);
assert.equal(engine.state("BTCUSDT").forming, null);
assert.equal(engine.state("BTCUSDT").needsSeed, false);
ws("@kline_1m").push(klineMsg("ETHUSDT", { ...forming.get("ETHUSDT"), t: OPEN + 2 * M1 }, true));
await settle();
assert.equal(engine.state("ETHUSDT").needsSeed, true, "a gap triggers a refill");
console.log("✓ closed minutes extend the history; a gap is refilled from REST");

// 6. Scalp alerts within seconds: met on the live tick, sent once, quiet while still met.
const user = await db.user.create({
  data: {
    authProviderId: `live${Date.now()}`,
    email: `live${Date.now()}@x.io`,
    timezone: "UTC",
    subscription: { create: { planCode: "PRO" } },
    settings: { create: {} },
  },
});
// Only this test's alert (a test database).
await db.scalpAlert.deleteMany({});
const alert = await db.scalpAlert.create({
  data: {
    userId: user.id,
    symbol: "XAUUSDT",
    tf: "5m",
    minCount: 1,
    direction: "ANY",
    noNews: false,
    cooldownMin: 30,
  },
});
const sent = [];
const live = new LiveScalpAlerts({ db, notify: async (n) => sent.push(n), now: () => NOW });
assert.equal(await live.onTick(tick), 1);
assert.equal(sent.length, 1);
assert.match(sent[0].title, /^Gold: \d+ of \d+ readings lean (up|down) on 5m$/);
// The one-tap plan rides on the link: the live price and typical range when it fired, the rules.
assert.match(sent[0].link, /^\/cockpit\?s=XAUUSDT&tf=5m&entry=.+#plan$/);
const plan = planFromQuery(
  Object.fromEntries(new URL(sent[0].link, "https://x.io").searchParams.entries()),
);
const gold = tick.coins.find((c) => c.s === "XAUUSDT");
const ten = (v) => Number(v.toPrecision(10));
assert.equal(plan.entry, ten(gold.p));
assert.equal(plan.atr5m, ten(gold.v.atr5m ?? 1));
assert.deepEqual(plan.rules, { stopRanges: 1.5, targetR: 2, riskUsd: null });
assert.equal(plan.at, NOW);
assert.match(sent[0].body, /Your plan from .+ long → stop .+ short → stop .+ is your call\./);
NOW += 1_000;
assert.equal(await live.onTick(tick), 0, "no repeat while the count still holds");
const row = await db.scalpAlert.findUnique({ where: { id: alert.id } });
assert.equal(row.lastMet, true);
assert.ok(row.lastFiredAt);
// The minute run only records while the live engine checks alerts.
const minute = await runScalpReadouts(
  { db, notify: async (n) => sent.push(n), now: () => NOW },
  JSON.parse(
    JSON.stringify((await db.marketSnapshot.findUnique({ where: { key: SCALP_KEY } })).data),
  ),
  { alerts: false },
);
assert.equal(minute.alerts, 0);
assert.equal(sent.length, 1);
console.log("✓ scalp alerts fire within a second of the count being met, once");

if (process.env.DUMP_LIVE)
  writeFileSync(
    process.env.DUMP_LIVE,
    JSON.stringify({
      now: tick.at,
      coins: SYMBOLS.map((s) => ({
        symbol: s,
        rank: RANKS[s],
        closed: raw.get(s).candles,
        forming: forming.get(s),
        oi: raw.get(s).oi,
        funding: funding[s],
        quote: quotes[s] ?? null,
      })),
      tick: stored,
    }),
  );

// 7. Stopping releases the lock for another worker.
await engine.stop();
await other.leadership();
assert.equal(other.isLeader, true, "another worker takes over");
await other.stop();
await db.scalpAlert.deleteMany({ where: { userId: user.id } });
await db.user.delete({ where: { id: user.id } });
await sub.quit();
await redis.quit();
await db.$disconnect();
console.log("All live order flow integration checks passed");
