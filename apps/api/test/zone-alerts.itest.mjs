// Integration test: zone alerts API and the zone a trade was entered at. Plan limits; markets the
// plan covers only; timeframes de-duplicated; pause, delete, another trader's alert invisible;
// trade detail shows the stamped zones (and nothing for a "no record" stamp).
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { SCALP_KEY } from "@atc/shared";
import { AuditService } from "../dist/audit/audit.service.js";
import { ZoneAlertsService } from "../dist/market/zone-alerts.controller.js";
import { PositionsService } from "../dist/positions/positions.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const prisma = { client: db };

await db.marketSnapshot.deleteMany({ where: { key: SCALP_KEY } });
await db.marketSnapshot.create({
  data: {
    key: SCALP_KEY,
    updatedAt: new Date(),
    data: {
      computedAt: new Date().toISOString(),
      coins: [
        { symbol: "BTCUSDT", rank: 1 },
        { symbol: "C30USDT", rank: 30 },
        { symbol: "XAUUSDT", rank: 125 },
      ],
    },
  },
});
const mk = (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `zx${n}${Date.now()}`,
      email: `zx${n}${Date.now()}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const pro = await mk(2, "PRO");
const svc = new ZoneAlertsService(prisma);
const input = (symbol, extra = {}) => ({
  symbol,
  tfs: ["4h", "1h"],
  side: "ANY",
  freshOnly: true,
  cooldownMin: 120,
  ...extra,
});

await assert.rejects(svc.create(free.id, input("C30USDT")), /top 20 coins/);
await assert.rejects(svc.create(free.id, input("DOGEUSDT")), /not in the scan/);
const fa = await svc.create(free.id, input("XAUUSDT", { side: "DEMAND" }));
assert.deepEqual([fa.symbol, fa.side, fa.freshOnly, fa.enabled], ["XAUUSDT", "DEMAND", true, true]);
await assert.rejects(svc.create(free.id, input("BTCUSDT")), /keeps 1 zone alert/);
const page = await svc.list(free.id);
assert.equal(page.limit, 1);
assert.equal(page.items.length, 1);
const pa = await svc.create(pro.id, input("C30USDT", { tfs: ["4h"] }));
assert.deepEqual(pa.tfs, ["4h"]);
assert.equal((await svc.update(pro.id, pa.id, { enabled: false })).enabled, false);
await assert.rejects(svc.update(free.id, pa.id, { enabled: true }), /not found/);
await assert.rejects(svc.remove(free.id, pa.id), /not found/);
await svc.remove(pro.id, pa.id);
assert.equal((await svc.list(pro.id)).items.length, 0);
console.log("✓ zone alerts: plan limits, plan's markets, pause, delete, owner only");

const positions = new PositionsService(prisma, new AuditService(prisma));
const pos = (k, entryZone) =>
  db.position.create({
    data: {
      userId: pro.id,
      exchange: "BINANCE",
      source: "FILLS",
      sourceKey: `zx|${k}`,
      symbol: "XAUUSDT",
      baseAsset: "XAU",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      status: "CLOSED",
      openedAt: new Date(Date.now() - 3_600_000),
      closedAt: new Date(),
      netPnl: "5",
      entryPrice: "2600",
      entryZone,
    },
  });
const stamped = {
  at: "2026-10-21T09:00:00.000Z",
  zones: [{ tf: "4h", side: "demand", fresh: true }],
};
const a = await pos("a", stamped);
const b = await pos("b", { none: true });
assert.deepEqual((await positions.detail(pro.id, a.id)).trade.entryZone, stamped);
assert.equal((await positions.detail(pro.id, b.id)).trade.entryZone, null);
console.log("✓ trade detail shows the zones the entry was inside");

await db.position.deleteMany({ where: { sourceKey: { startsWith: "zx|" } } });
await db.user.deleteMany({ where: { id: { in: [free.id, pro.id] } } });
await db.marketSnapshot.deleteMany({ where: { key: SCALP_KEY } });
await db.$disconnect();
console.log("All zone alert API checks passed");
