// Integration test: database transfer of the live loop. With a realistic market snapshot (100
// coins), a scalp alert, a Cockpit paper bot and a zone alert, one hour of live checks (one tick
// every 10 seconds, the slowest refresh, so every cache is asked) must download each snapshot only
// when it changed (once a minute for the scan, once for zones), and the hour's total transfer must
// stay small. Prints the transfer before (every check re-reading the snapshots) and after.
import assert from "node:assert/strict";
import {
  createPrismaClient,
  egressReport,
  meterClient,
  redisSnapshotMirror,
  setSnapshotMirror,
  snapshotsOf,
  writeSnapshot,
} from "@atc/db";
import { SCALP_KEY, ZONES_KEY } from "@atc/shared";
import { Redis } from "ioredis";
import { PaperBotEngine } from "../dist/market/paper-bots.js";
import { LiveBase, LiveScalpAlerts } from "../dist/market/scalp-readouts.js";
import { ZoneAlerts } from "../dist/market/zones.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
// The worker's client is metered; the scan is written by another client (as by another process).
const db = meterClient(createPrismaClient(dbUrl), "test");
const writer = createPrismaClient(dbUrl);
const START = Date.UTC(2026, 9, 22, 9, 0, 5);
let NOW = START;

const frame = (p) => ({
  strength: p > 10 ? "buying" : "neutral",
  buyPressurePct: p,
  netFlowUsd: p * 1e5,
  priceChangePct: 0.1,
  oiChangePct: 0.2,
  relVolume: 1.1,
  regime: "long_buildup",
});
const coin = (i) => ({
  symbol: i === 0 ? "XAUUSDT" : `C${i}USDT`,
  rank: i === 0 ? 125 : i,
  price: 100 + i,
  vwap: 99 + i,
  vwapDistPct: 1,
  funding: 0.0001,
  frames: Object.fromEntries(
    ["5m", "15m", "30m", "1h", "4h", "24h"].map((w, k) => [w, frame(5 + k)]),
  ),
  book: {
    asOf: new Date(START).toISOString(),
    mid: 100 + i,
    spreadBps: 0.5,
    bands: [0.05, 0.1, 0.25, 0.5, 1].map((pct) => ({
      pct,
      bidUsd: 1e5,
      askUsd: 9e4,
      imbalancePct: 5,
    })),
    walls: [],
  },
  levels: {
    dayHigh: 102 + i,
    dayLow: 98 + i,
    asiaHigh: 101 + i,
    asiaLow: 99 + i,
    asiaOpen: false,
    high24h: 103 + i,
    low24h: 97 + i,
  },
  volatility: { atr5m: 0.5, atr15m: 1, atr1h: 2, rangeRatio: 1, activity: "normal" },
});
const scan = (at) => ({
  computedAt: new Date(at).toISOString(),
  asOf: new Date(at).toISOString(),
  universe: 101,
  coins: Array.from({ length: 101 }, (_, i) => coin(i)),
});
const zones = {
  computedAt: new Date(START).toISOString(),
  markets: Object.fromEntries(
    Array.from({ length: 101 }, (_, i) => [
      i === 0 ? "XAUUSDT" : `C${i}USDT`,
      Object.fromEntries(
        ["1h", "4h"].map((tf) => [
          tf,
          {
            asOf: new Date(START).toISOString(),
            zones: Array.from({ length: 8 }, (_, k) => ({
              side: k % 2 ? "supply" : "demand",
              top: 110 + k,
              bottom: 109 + k,
              t: k,
              tests: 0,
            })),
          },
        ]),
      ),
    ]),
  ),
};
await writeSnapshot(writer, SCALP_KEY, scan(START), new Date(START));
await writeSnapshot(writer, ZONES_KEY, zones, new Date(START));
const scanBytes = JSON.stringify(scan(START)).length;
const zoneBytes = JSON.stringify(zones).length;

const user = await writer.user.create({
  data: {
    authProviderId: `eg${Date.now()}`,
    email: `eg${Date.now()}@x.io`,
    timezone: "UTC",
    subscription: { create: { planCode: "PREMIUM" } },
    settings: { create: {} },
  },
});
await writer.scalpAlert.deleteMany({});
await writer.zoneAlert.deleteMany({});
await writer.scalpAlert.create({
  data: { userId: user.id, symbol: "XAUUSDT", tf: "5m", direction: "ANY", minCount: 12 },
});
await writer.zoneAlert.create({ data: { userId: user.id, symbol: "XAUUSDT", tfs: ["1h", "4h"] } });
await writer.paperBot.create({
  data: {
    userId: user.id,
    name: "b",
    symbol: "XAUUSDT",
    source: "COCKPIT",
    tf: "5m",
    minCount: 12,
  },
});

const base = new LiveBase(db);
const alerts = new LiveScalpAlerts({ db, notify: async () => {}, now: () => NOW }, base);
const paper = new PaperBotEngine({ db, now: () => NOW }, base);
const za = new ZoneAlerts({
  db,
  notify: async () => {},
  limits: (u, n) => base.limits(u, n),
  now: () => NOW,
});
const tick = () => ({
  at: NOW,
  universe: 101,
  coins: [
    {
      s: "XAUUSDT",
      r: 125,
      p: 100,
      h: 100,
      l: 100,
      f: 0.0001,
      sp: 0.5,
      v: { atr5m: 0.5, atr15m: 1, rangeRatio: 1, activity: "normal" },
      w: {},
      t: NOW,
    },
  ],
  summary: {},
});

const cache = snapshotsOf(db);
let rewrites = 0;
let checks = 0;
for (let s = 0; s < 3600; s += 10) {
  NOW = START + s * 1000;
  // The minute scan rewrites its snapshot once a minute.
  if (s > 0 && s % 60 === 0) {
    await writeSnapshot(writer, SCALP_KEY, scan(NOW), new Date(NOW));
    rewrites++;
  }
  const t = tick();
  await Promise.all([
    alerts.onTick(t),
    paper.onTick(t),
    za.check(new Map([["XAUUSDT", { price: 100, rank: 125 }]])),
  ]);
  checks++;
}
const totalMb = egressReport().reduce((a, r) => a + r.mb, 0);
// Downloads: the scan at the start plus each rewrite; zones once.
assert.equal(cache.stats.misses, rewrites + 2, `snapshot downloads (${cache.stats.misses})`);
// Before: every 10-second refresh re-read the scan (alerts and bots shared one read) and zones
// were re-read every 30 seconds.
const beforeMb = (checks * scanBytes + (checks / 3) * zoneBytes) / 1_048_576;
console.log(
  `✓ one live hour, worst case (scan written by another process, no Redis copy): ${totalMb.toFixed(2)} MB from the database (was about ${beforeMb.toFixed(1)} MB); snapshots downloaded ${cache.stats.misses} times for ${checks} checks`,
);
console.log("  top queries:", JSON.stringify(egressReport().slice(0, 5)));
assert.ok(totalMb < beforeMb / 5, "at least 5× less transfer");

// The website's reads: with the worker writing a Redis copy, a page reading the scan every minute
// (it changes every minute) never downloads it from Postgres.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
setSnapshotMirror(redisSnapshotMirror(redis));
const api = createPrismaClient(dbUrl);
const pages = snapshotsOf(api);
for (let m = 0; m < 60; m++) {
  await writeSnapshot(writer, SCALP_KEY, scan(START + m * 60_000), new Date(START + m * 60_000));
  const got = await pages.get(SCALP_KEY);
  assert.equal(got.data.computedAt, new Date(START + m * 60_000).toISOString());
  assert.equal(
    (await pages.get(SCALP_KEY)).data.coins.length,
    101,
    "a second read is served from memory",
  );
}
assert.equal(pages.stats.misses, 0, "no snapshot downloaded from Postgres");
assert.equal(pages.stats.mirrored, 60);
// A rewrite outside the mirror (or a mirror gone) still answers correctly from Postgres.
setSnapshotMirror(null);
await writeSnapshot(writer, SCALP_KEY, scan(START + 99 * 60_000), new Date(START + 99 * 60_000));
setSnapshotMirror(redisSnapshotMirror(redis));
assert.equal(
  (await pages.get(SCALP_KEY)).data.computedAt,
  new Date(START + 59 * 60_000).toISOString(),
  "the mirror's copy until it changes",
);
await redis.del(`snap:v:${SCALP_KEY}`);
assert.equal(
  (await pages.get(SCALP_KEY)).data.computedAt,
  new Date(START + 99 * 60_000).toISOString(),
  "no mirror copy: Postgres",
);
setSnapshotMirror(null);
await redis.del(`snap:d:${SCALP_KEY}`, `snap:v:${ZONES_KEY}`, `snap:d:${ZONES_KEY}`);
await redis.quit();
await api.$disconnect();
console.log("✓ pages read market snapshots from Redis: 60 minutes, 0 database downloads");

await writer.scalpAlert.deleteMany({});
await writer.zoneAlert.deleteMany({});
await writer.user.delete({ where: { id: user.id } });
await writer.marketSnapshot.deleteMany({ where: { key: { in: [SCALP_KEY, ZONES_KEY] } } });
await writer.$disconnect();
await db.$disconnect();
console.log("All database transfer checks passed");
