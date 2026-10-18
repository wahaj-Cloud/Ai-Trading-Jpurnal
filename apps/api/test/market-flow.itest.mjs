// Integration test: Market Flow. The worker's collector writes whale trades and liquidations from
// stream messages into a real Postgres; the API's summaries and feeds must match sums computed here
// independently, bucket by bucket. Run after build.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { FlowCollector } from "../../worker/dist/market/flow-collector.js";
import { FlowService } from "../dist/market/flow.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const H = 3_600_000;
const NOW = Date.now();

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
await db.$executeRawUnsafe("TRUNCATE whale_trades, liquidation_events");
await db.marketSnapshot.deleteMany({
  where: { key: { in: ["flow:status", "desk:BTCUSDT", "desk:ETHUSDT"] } },
});
const mk = (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `fl${n}`,
      email: `fl${n}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const pro = await mk(2, "PRO");

// 1. Collector → database: stream messages become rows with exact sizes.
const lock = { held: null };
let clock = NOW;
const collector = new FlowCollector({
  db,
  redis: {
    set: async (_k, v) => {
      if (lock.held) return null;
      lock.held = v;
      return "OK";
    },
    eval: async (_s, _n, _k, t) => (lock.held === t ? 1 : 0),
  },
  WebSocketImpl: class {
    addEventListener() {}
    send() {}
    close() {}
  },
  fetchFn: async () =>
    Response.json({ data: [{ instId: "BTC-USDT-SWAP", ctVal: "0.01", ctType: "linear" }] }),
  now: () => clock,
});
await collector.tickLeadership();
const { parseBinance, parseBybit } = await import("@atc/exchange-adapters");
collector.ingest(
  "BINANCE",
  parseBinance({
    data: { e: "aggTrade", s: "BTCUSDT", p: "60000", q: "3", T: NOW - 1000, m: false },
  }),
);
collector.ingest(
  "BINANCE",
  parseBinance({
    data: { e: "aggTrade", s: "BTCUSDT", p: "60100", q: "2", T: NOW - 1000, m: false },
  }),
);
collector.ingest(
  "BYBIT",
  parseBybit({
    topic: "allLiquidation.BTCUSDT",
    data: [{ T: NOW - 500, s: "BTCUSDT", S: "Sell", v: "1.5", p: "61000" }],
  }),
);
clock += 1_000;
collector.collectIdle();
assert.deepEqual(await collector.flush(), { whales: 1, liquidations: 1 });
const stored = await db.whaleTrade.findFirstOrThrow();
assert.equal(stored.usd.toString(), "300200");
assert.equal(stored.qty.toString(), "5");
assert.equal(stored.fills, 2);
assert.equal(stored.price.toFixed(2), "60040.00");
await collector.saveStatus();
await collector.stop();
console.log(
  "✓ collector: fills of one order added up ($300,200 at $60,040 avg), liquidation stored, status saved",
);

// 2. A known random history, then compare every figure with an independent calculation.
await db.$executeRawUnsafe("TRUNCATE whale_trades, liquidation_events");
let seed = 11;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const whales = [];
const liqs = [];
const EX = ["BINANCE", "BYBIT", "OKX"];
for (let i = 0; i < 600; i++) {
  const at = new Date(NOW - Math.floor(rnd() * 30 * H));
  const symbol = rnd() < 0.8 ? "BTCUSDT" : "ETHUSDT";
  whales.push({
    exchange: EX[Math.floor(rnd() * 3)],
    symbol,
    side: rnd() < 0.5 ? "buy" : "sell",
    price: "60000",
    qty: "5",
    usd: (250_000 + Math.floor(rnd() * 5_000_000) / 100).toFixed(2),
    fills: 1,
    at,
  });
  liqs.push({
    exchange: EX[Math.floor(rnd() * 3)],
    symbol,
    side: rnd() < 0.5 ? "long" : "short",
    price: "60000",
    qty: "1",
    usd: (1_000 + Math.floor(rnd() * 20_000_000) / 100).toFixed(2),
    at: new Date(NOW - Math.floor(rnd() * 30 * H)),
  });
}
await db.whaleTrade.createMany({ data: whales });
await db.liquidationEvent.createMany({ data: liqs });
const svc = new FlowService({ client: db });
const cents = (v) => Math.round(Number(v) * 100);
for (const window of ["1h", "4h", "24h"]) {
  const span = { "1h": H, "4h": 4 * H, "24h": 24 * H }[window];
  const now = new Date(NOW);
  const from = NOW - span;
  const s = await svc.summary(pro.id, { symbol: "BTCUSDT", window }, now);
  const inW = (r) => r.symbol === "BTCUSDT" && r.at.getTime() >= from && r.at.getTime() <= NOW;
  const w = whales.filter(inW);
  const l = liqs.filter(inW);
  const total = (rows, pred) => rows.filter(pred).reduce((a, r) => a + cents(r.usd), 0);
  assert.equal(
    cents(s.whales.buyUsd),
    total(w, (r) => r.side === "buy"),
    `${window} whale buys`,
  );
  assert.equal(
    cents(s.whales.sellUsd),
    total(w, (r) => r.side === "sell"),
    `${window} whale sells`,
  );
  assert.equal(s.whales.buys + s.whales.sells, w.length);
  assert.equal(
    cents(s.liquidations.longUsd),
    total(l, (r) => r.side === "long"),
    `${window} long liqs`,
  );
  assert.equal(
    cents(s.liquidations.shortUsd),
    total(l, (r) => r.side === "short"),
  );
  for (const e of s.liquidations.byExchange) {
    assert.equal(
      cents(e.longUsd),
      total(l, (r) => r.exchange === e.exchange && r.side === "long"),
    );
  }
  const biggest = l.reduce((m, r) => (Number(r.usd) > Number(m?.usd ?? -1) ? r : m), null);
  assert.equal(cents(s.liquidations.largest?.usd ?? 0), cents(biggest?.usd ?? 0));
  // Buckets: 12 equal slices of the window.
  const size = span / 12;
  s.series.forEach((b, i) => {
    const inB = (r) => Math.min(11, Math.floor((r.at.getTime() - from) / size)) === i;
    assert.equal(
      cents(b.whaleBuyUsd),
      total(w, (r) => inB(r) && r.side === "buy"),
      `${window} bucket ${i}`,
    );
    assert.equal(
      cents(b.longLiqUsd),
      total(l, (r) => inB(r) && r.side === "long"),
    );
  });
}
console.log(
  "✓ summaries for 1h, 4h and 24h match independent sums: totals, exchanges, largest, every bucket",
);

// 3. Feeds: newest first, filters, paging without gaps or repeats.
const seen = new Set();
let cursor;
let last = null;
let pages = 0;
do {
  const p = await svc.whales(pro.id, { symbol: "BTCUSDT", side: "buy", cursor });
  for (const r of p.items) {
    assert.equal(r.side, "buy");
    if (last) assert.ok(r.at <= last, "newest first by trade time");
    last = r.at;
    assert.ok(!seen.has(r.id));
    seen.add(r.id);
  }
  cursor = p.nextCursor ?? undefined;
  pages++;
} while (cursor);
assert.equal(seen.size, whales.filter((r) => r.symbol === "BTCUSDT" && r.side === "buy").length);
assert.ok(pages > 1);
const big = await svc.liquidations(pro.id, { symbol: "ETHUSDT", minUsd: 150_000, exchange: "OKX" });
assert.ok(big.items.every((r) => r.usd >= 150_000 && r.exchange === "OKX"));
console.log("✓ feeds: filters and paging complete with no repeats");

// 4. Plans: Free sees BTC and ETH only.
assert.equal((await svc.summary(free.id, { symbol: "SOLUSDT", window: "24h" })).locked, true);
assert.equal((await svc.whales(free.id, { symbol: "SOLUSDT" })).locked, true);
assert.equal((await svc.summary(free.id, { symbol: "ETHUSDT", window: "24h" })).locked, false);

// 5. Dashboard bias table: trend bias from the desk, 24h whale net and liquidations.
await db.marketSnapshot.create({
  data: {
    key: "desk:BTCUSDT",
    updatedAt: new Date(),
    data: {
      symbol: "BTCUSDT",
      price: 61000,
      change24hPct: 1.5,
      computedAt: new Date().toISOString(),
      bias: [
        { timeframe: "1d", state: "up", bars: 12, evidence: [] },
        { timeframe: "4h", state: "range", bars: 3, evidence: [] },
        { timeframe: "1h", state: "down", bars: 5, evidence: [] },
      ],
    },
  },
});
const b = await svc.bias(free.id, new Date(NOW));
assert.deepEqual(b.allowed, ["BTCUSDT"]);
const row = b.items[0];
assert.deepEqual(
  row.bias.map((x) => x.state),
  ["up", "range", "down"],
);
const day = (r) => r.symbol === "BTCUSDT" && r.at.getTime() >= NOW - 24 * H;
const sum = (rows, side) =>
  rows.filter((r) => day(r) && r.side === side).reduce((a, r) => a + cents(r.usd), 0);
assert.equal(cents(row.whaleNet24hUsd), sum(whales, "buy") - sum(whales, "sell"));
assert.equal(cents(row.liquidations24h.longUsd), sum(liqs, "long"));
assert.equal((await svc.bias(pro.id, new Date(NOW))).allowed.length, 5);
console.log("✓ plans enforced; dashboard bias table matches desk bias and 24h sums");

await db.$disconnect();
console.log("All Market Flow integration checks passed");
