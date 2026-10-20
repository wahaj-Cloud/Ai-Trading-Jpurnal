// Integration test: the live order-flow stream. Tickets carry the plan; each page receives only its
// part of a tick (the plan's coins plus gold and silver, one market for the Cockpit, flow lines for
// the Order Flow window only); new ticks arrive as they are published; a bad ticket is refused.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { LIVE_FLOW_CHANNEL, LIVE_FLOW_KEY, liveViewOf } from "@atc/shared";
import { Redis } from "ioredis";
import { firstValueFrom, take, toArray } from "rxjs";
import { LiveFlowService } from "../dist/market/live-flow.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const redis = new Redis(redisUrl);

const cell = (bp) => ({
  bp,
  nf: bp * 10,
  vol: 1000,
  pc: 0.1,
  oi: 0.2,
  oiu: 5,
  rg: "neutral",
  st: "neutral",
  rv: 1,
  ser: [1, 2, 3],
});
const coin = (s, r) => ({
  s,
  r,
  p: 100,
  h: 101,
  l: 99,
  f: 0.0001,
  sp: null,
  v: { atr5m: 1, atr15m: 2, rangeRatio: 1, activity: "normal" },
  w: { "5m": cell(5), "15m": cell(-3), "30m": cell(1), "1h": cell(2) },
  t: 1,
});
const summary = { buying: 3, selling: 1, netFlowUsd: 40, counts: {} };
const tick = (at) => ({
  at,
  universe: 101,
  coins: [coin("BTCUSDT", 1), coin("C15USDT", 15), coin("C30USDT", 30), coin("XAUUSDT", 125)],
  summary: { "5m": summary, "15m": summary, "30m": summary, "1h": summary },
});
await redis.set(LIVE_FLOW_KEY, JSON.stringify(tick(1000)));

const mk = (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `lf${n}${Date.now()}`,
      email: `lf${n}${Date.now()}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const pro = await mk(2, "PRO");

const svc = new LiveFlowService({ NODE_ENV: "development", REDIS_URL: redisUrl }, { client: db });
await svc.onModuleInit();

// Tickets: random, two minutes, plan inside.
const tf = await svc.ticket(free.id);
const tp = await svc.ticket(pro.id);
assert.match(tf.ticket, /^[a-f0-9]{48}$/);
assert.notEqual(tf.ticket, tp.ticket);
const ttl = await redis.ttl(`live:ticket:${tf.ticket}`);
assert.ok(ttl > 100 && ttl <= 120, `ticket lives two minutes (${ttl})`);
assert.deepEqual(JSON.parse(await redis.get(`live:ticket:${tf.ticket}`)), {
  userId: free.id,
  cap: 20,
});
console.log("✓ tickets: random, two minutes, with the plan's coin limit");

// The first message is the latest tick, cut for the page and plan.
const first = async (q) => (await firstValueFrom(svc.stream(q))).data;
const scalpFree = await first({ ticket: tf.ticket, view: "scalp" });
assert.equal(scalpFree.at, 1000);
assert.deepEqual(
  scalpFree.coins.map((c) => c.s),
  ["BTCUSDT", "C15USDT", "XAUUSDT"],
  "Free: top 20 plus gold",
);
assert.ok(scalpFree.coins.every((c) => Object.values(c.w).every((x) => x.ser === undefined)));
const ofPro = await first({ ticket: tp.ticket, view: "orderflow", w: "15m" });
assert.equal(ofPro.coins.length, 4, "Pro: every coin");
assert.deepEqual(ofPro.coins[0].w["15m"].ser, [1, 2, 3]);
assert.equal(ofPro.coins[0].w["5m"].ser, undefined);
assert.deepEqual(ofPro.summary, summary);
assert.deepEqual(ofPro, liveViewOf(tick(1000), { view: "orderflow", w: "15m" }, null));
assert.equal(
  (await first({ ticket: tf.ticket, view: "cockpit", s: "C30USDT" })).coins.length,
  0,
  "a market past the plan is not sent",
);
assert.equal((await first({ ticket: tp.ticket, view: "cockpit", s: "C30USDT" })).coins.length, 1);
console.log("✓ each page gets its part within the plan (coins, one Cockpit market, flow lines)");

// New ticks arrive as the worker publishes them.
const two = firstValueFrom(
  svc.stream({ ticket: tp.ticket, view: "scalp" }).pipe(take(2), toArray()),
);
await new Promise((r) => setTimeout(r, 200));
await redis.publish(LIVE_FLOW_CHANNEL, JSON.stringify(tick(2000)));
const got = await two;
assert.deepEqual(
  got.map((m) => m.data.at),
  [1000, 2000],
);
console.log("✓ published ticks are pushed straight on");

// A wrong or expired ticket is refused.
await assert.rejects(
  firstValueFrom(svc.stream({ ticket: "ab".repeat(24), view: "scalp" })),
  /expired/,
);
console.log("✓ an unknown ticket is refused");

await svc.onModuleDestroy();
await db.user.deleteMany({ where: { id: { in: [free.id, pro.id] } } });
await redis.del(LIVE_FLOW_KEY);
await redis.quit();
await db.$disconnect();
console.log("All live stream integration checks passed");
