// Integration test: Market Context Desk. The worker builds desks from fake public market data into
// a real Postgres; the API serves them by plan and compares the trader's open positions.
import "reflect-metadata";
import assert from "node:assert/strict";
import { FakeModel } from "@atc/coach";
import { createPrismaClient } from "@atc/db";
import { runMarketDesk } from "../../worker/dist/market/desk.js";
import { MarketService } from "../dist/market/market.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const H = 3_600_000;
const NOW = Date.now();
const LAST = Math.floor(NOW / H) * H;

// Every market climbs steadily with takers buying: drivers lean up.
const fetchFn = async (input) => {
  const url = new URL(String(input));
  const json = (body, status = 200) => Response.json(body, { status });
  if (url.pathname === "/fapi/v1/klines") {
    const start = Number(url.searchParams.get("startTime"));
    const rows = [];
    for (let t = Math.ceil(start / H) * H; t <= LAST && rows.length < 1000; t += H) {
      const p = 100 * (1 + ((t - start) / H) * 0.0006);
      rows.push([
        t,
        String(p),
        String(p * 1.003),
        String(p * 0.997),
        String(p * 1.001),
        "100",
        t + H - 1,
        "0",
        0,
        "58",
        "0",
        "0",
      ]);
    }
    return json(rows);
  }
  if (url.pathname === "/fapi/v1/fundingRate")
    return json([{ fundingTime: NOW - 2 * H, fundingRate: "0.0001" }]);
  return json({}, 404);
};
const config = { binance: { fetch: fetchFn }, bybit: { fetch: fetchFn }, okx: { fetch: fetchFn } };

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
await db.marketSnapshot.deleteMany({ where: { key: { startsWith: "desk:" } } });
await db.economicEvent.deleteMany({ where: { id: { startsWith: "desk-test-" } } });
await db.economicEvent.create({
  data: {
    id: "desk-test-fomc",
    title: "FOMC Statement",
    currency: "USD",
    impact: "HIGH",
    startsAt: new Date(NOW + 90 * 60_000),
    source: "test",
    fetchedAt: new Date(NOW),
  },
});

const mk = async (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `dk${n}`,
      email: `dk${n}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const pro = await mk(2, "PRO");
const exness = await db.exchangeAccount.create({
  data: { userId: pro.id, exchange: "EXNESS", label: "MT5", apiKeyHint: "1234" },
});
await db.openPosition.create({
  data: {
    userId: pro.id,
    accountId: exness.id,
    exchange: "EXNESS",
    externalId: "p1",
    symbol: "XAUUSDm",
    baseAsset: "XAU",
    quoteAsset: "USD",
    settleAsset: "USD",
    direction: "SHORT",
    lots: "0.10",
    syncedAt: new Date(NOW),
  },
});

const service = new MarketService({ client: db }, {});

// 1. Before the worker runs: honest "being prepared".
assert.equal((await service.desk(pro.id, { symbol: "BTCUSDT" })).status, "unavailable");

const model = new FakeModel(() => ({
  text: "Price sits above its averages and takers have been buying.",
}));
const res = await runMarketDesk({ db, config, model, now: () => NOW });
assert.equal(res.saved.length, 5, JSON.stringify(res));
console.log("✓ worker builds a desk for BTC, ETH, SOL, gold and silver");

// 2. Free plan: Bitcoin only.
const freeBtc = await service.desk(free.id, { symbol: "BTCUSDT" });
assert.equal(freeBtc.status, "ok");
assert.deepEqual(freeBtc.allowed, ["BTCUSDT"]);
assert.equal((await service.desk(free.id, { symbol: "XAUUSDT" })).status, "locked");
console.log("✓ free plan opens the Bitcoin desk; other markets are locked");

// 3. Pro: every market; the short gold position is compared with gold's drivers.
const gold = await service.desk(pro.id, { symbol: "XAUUSDT" });
assert.equal(gold.status, "ok");
assert.equal(gold.desk.name, "Gold");
assert.ok(gold.desk.drivers.length >= 3);
assert.equal(gold.desk.nextEvent?.title, "FOMC Statement", "next event read live");
assert.ok(gold.desk.summary);
assert.equal("verdict" in gold.desk, false);
const a = gold.alignment.find((x) => x.positionSymbol === "XAUUSDm");
assert.ok(a, "Exness gold position matched to the gold desk");
assert.equal(a.direction, "SHORT");
assert.ok(a.against > a.with, JSON.stringify(a));
assert.match(a.note, /You're short Gold while \d of \d drivers lean the other way/);
assert.match(a.note, /FOMC Statement is in 1h \d\dm/);
console.log("✓ pro plan: every market; open positions compared with their market's drivers");

// 4. The chart's event chip.
assert.equal((await service.nextEvent())?.title, "FOMC Statement");
console.log("✓ next high-impact event served for the chart countdown");

await db.economicEvent.deleteMany({ where: { id: { startsWith: "desk-test-" } } });
await db.$disconnect();
console.log("All Market Context Desk integration checks passed");
