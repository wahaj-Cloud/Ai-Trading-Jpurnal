// Integration test: the paper bots API. Plan limits; a Cockpit bot only on a market the plan
// covers; a setup bot only on the trader's own setup and one of its markets; results, the balance
// line and breakdowns from the stored trades; closing by hand at the live price (refused without
// one); start again; pause; another trader's bot is invisible.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { LIVE_FLOW_KEY, SCALP_KEY } from "@atc/shared";
import { Redis } from "ioredis";
import { LiveFlowService } from "../dist/market/live-flow.service.js";
import { PaperBotsService } from "../dist/market/paper-bots.controller.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const redis = new Redis(redisUrl);
const close = (a, b, what) =>
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);

const coin = (symbol, rank, price) => ({ symbol, rank, price });
await db.marketSnapshot.deleteMany({ where: { key: SCALP_KEY } });
await db.marketSnapshot.create({
  data: {
    key: SCALP_KEY,
    updatedAt: new Date(),
    data: {
      computedAt: new Date().toISOString(),
      asOf: new Date().toISOString(),
      universe: 101,
      coins: [
        coin("ETHUSDT", 2, 3000),
        coin("BTCUSDT", 1, 60000),
        coin("C30USDT", 30, 1),
        coin("XAUUSDT", 125, 2000),
      ],
    },
  },
});
await redis.del(LIVE_FLOW_KEY);

const mk = (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `pb${n}${Date.now()}`,
      email: `pb${n}${Date.now()}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const pro = await mk(2, "PRO");
const live = new LiveFlowService({ NODE_ENV: "development", REDIS_URL: redisUrl }, { client: db });
await live.onModuleInit();
const svc = new PaperBotsService({ client: db }, live);

const cockpitBot = (symbol, extra = {}) => ({
  source: "COCKPIT",
  name: "Count bot",
  symbol,
  tf: "5m",
  direction: "ANY",
  minCount: 7,
  noNews: true,
  stopRanges: 1.5,
  targetR: 2,
  maxHoldMin: 60,
  riskPct: 1,
  feeBps: 5,
  slippageBps: 2,
  startEquity: 10_000,
  ...extra,
});

// 1. Markets and plan limits.
const page0 = await svc.list(free.id);
assert.deepEqual(
  page0.markets,
  ["BTCUSDT", "ETHUSDT", "XAUUSDT"],
  "Free: top 20 plus gold, by rank",
);
assert.equal(page0.limit, 1);
assert.equal(page0.live, false);
await assert.rejects(svc.create(free.id, cockpitBot("C30USDT")), /top 20 coins/);
await assert.rejects(svc.create(free.id, cockpitBot("DOGEUSDT")), /not in the scan/);
const fb = await svc.create(free.id, cockpitBot("XAUUSDT"));
assert.equal(fb.equity, 10_000);
assert.equal((await db.paperBot.findUnique({ where: { id: fb.id } })).lastMet, true);
await assert.rejects(svc.create(free.id, cockpitBot("BTCUSDT")), /keeps 1 paper bot/);
console.log(
  "✓ Free keeps one bot on the top 20, gold and silver; it waits for its rule to start holding",
);

// 2. Setup bots: the trader's own setup, one of its markets, its timeframe.
const setup = await db.setup.create({
  data: {
    userId: pro.id,
    name: "EMA climb",
    exchange: "BINANCE",
    symbols: ["SOLUSDT", "BTCUSDT"],
    timeframe: "15m",
    rule: {
      version: 1,
      direction: "long",
      all: [{ type: "ema_trend", fast: 5, slow: 20, direction: "up" }],
    },
    ruleVersion: 1,
  },
});
const sb = (setupId, symbol) => ({
  source: "SETUP",
  name: "Setup bot",
  symbol,
  setupId,
  stopRanges: 1,
  targetR: 3,
  maxHoldMin: 240,
  riskPct: 0.5,
  feeBps: 4,
  slippageBps: 1,
  startEquity: 2_000,
});
await assert.rejects(svc.create(free.id, sb(setup.id, "SOLUSDT")), /keeps 1|Setup not found/);
await assert.rejects(svc.create(pro.id, sb(setup.id, "ETHUSDT")), /setup's markets/);
const pb = await svc.create(pro.id, sb(setup.id, "SOLUSDT"));
assert.equal(pb.tf, "15m");
assert.equal(pb.setupName, "EMA climb");
console.log("✓ a setup bot uses the trader's own setup, one of its markets and its timeframe");

// 3. Results from stored trades: stats, balance line, breakdowns.
const t = (h, side, pnl, r, reason) => ({
  botId: pb.id,
  symbol: "SOLUSDT",
  side,
  entryAt: new Date(Date.UTC(2026, 9, 19, h)),
  exitAt: new Date(Date.UTC(2026, 9, 19, h, 30)),
  entryPrice: 100,
  exitPrice: 101,
  stop: 99,
  target: 103,
  qty: 10,
  riskUsd: 10,
  fees: 0.5,
  funding: 0.1,
  pnl,
  rMultiple: r,
  exitReason: reason,
  status: "CLOSED",
});
await db.paperTrade.createMany({
  data: [
    t(2, "LONG", 30, 3, "TARGET"),
    t(9, "SHORT", -10, -1, "STOP"),
    t(14, "LONG", -10, -1, "STOP"),
    t(15, "LONG", 5, 0.5, "TIME"),
  ],
});
await db.paperBot.update({ where: { id: pb.id }, data: { equity: 2_015 } });
const d = await svc.get(pro.id, pb.id);
assert.equal(d.stats.trades, 4);
assert.equal(d.stats.winRatePct, 50);
assert.equal(d.stats.netPnl, 15);
close(d.stats.profitFactor, 35 / 20, "profit factor");
close(d.stats.avgR, 0.375, "average R");
close(d.stats.maxDrawdownPct, (20 / 2030) * 100, "deepest drop");
assert.deepEqual(
  d.curve.map((p) => p.equity),
  [2000, 2030, 2020, 2010, 2015],
);
assert.deepEqual(
  d.bySession.map((r) => [r.key, r.trades, r.netPnl]),
  [
    ["asia", 1, 30],
    ["london", 1, -10],
    ["new_york", 2, -5],
  ],
);
assert.deepEqual(
  d.byExit.map((r) => [r.key, r.trades]),
  [
    ["STOP", 2],
    ["TARGET", 1],
    ["TIME", 1],
  ],
);
assert.equal(d.trades[0].pnl, 5, "newest first");
assert.equal(d.real, null);
assert.match(d.maturity.text, /Too early to judge/);
console.log("✓ results, balance line and breakdowns from the stored trades");

// 4. Closing by hand: refused without a live price, then at the live price less slippage.
const open = await db.paperTrade.create({
  data: {
    botId: pb.id,
    symbol: "SOLUSDT",
    side: "SHORT",
    entryAt: new Date(),
    entryPrice: 150,
    stop: 152,
    target: 144,
    qty: 5,
    riskUsd: 10,
    fees: 0.3,
    funding: -0.2,
  },
});
await assert.rejects(svc.close(pro.id, pb.id), /live price is not available/);
await redis.set(
  LIVE_FLOW_KEY,
  JSON.stringify({
    at: Date.now(),
    universe: 101,
    coins: [{ s: "SOLUSDT", p: 149, w: {} }],
    summary: {},
  }),
);
assert.equal((await svc.list(pro.id)).live, true);
const after = await svc.close(pro.id, pb.id);
const row = await db.paperTrade.findUnique({ where: { id: open.id } });
assert.equal(row.exitReason, "MANUAL");
close(row.exitPrice, 149 * 1.0001, "short buys back above the price");
const fees = 0.3 + (5 * row.exitPrice * 4) / 1e4;
close(row.pnl, (150 - row.exitPrice) * 5 - fees + 0.2, "manual result");
close(after.equity, 2_015 + row.pnl, "balance");
await assert.rejects(svc.close(pro.id, pb.id), /no open trade/);
console.log("✓ closing by hand uses the live price, and only with one");

// 5. Pause, start again, ownership, delete.
assert.equal((await svc.update(pro.id, pb.id, { enabled: false })).enabled, false);
const reset = await svc.reset(pro.id, pb.id);
assert.equal(reset.equity, 2_000);
assert.equal(reset.stats.trades, 0);
assert.equal(await db.paperTrade.count({ where: { botId: pb.id } }), 0);
await assert.rejects(svc.get(free.id, pb.id), /not found/);
await assert.rejects(svc.reset(free.id, pb.id), /not found/);
await assert.rejects(svc.remove(free.id, pb.id), /not found/);
await svc.remove(pro.id, pb.id);
assert.equal(await db.paperBot.count({ where: { id: pb.id } }), 0);
// Deleting a setup leaves its bots (they stop entering), never breaks them.
const pb2 = await svc.create(pro.id, sb(setup.id, "BTCUSDT"));
await db.setup.delete({ where: { id: setup.id } });
assert.equal((await svc.get(pro.id, pb2.id)).setupName, null);
console.log("✓ pause, start again, delete; another trader's bot is invisible");

await live.onModuleDestroy();
await db.user.deleteMany({ where: { id: { in: [free.id, pro.id] } } });
await db.marketSnapshot.deleteMany({ where: { key: SCALP_KEY } });
await redis.del(LIVE_FLOW_KEY);
await redis.quit();
await db.$disconnect();
console.log("All paper bot API checks passed");
