// Integration test: trade detail, journal, analytics and live positions against a real Postgres.
// Run after `pnpm build`: DATABASE_URL=postgresql://...localhost... pnpm --filter @atc/api test:integration
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { journalInputSchema } from "@atc/shared";
import { AnalyticsService } from "../dist/analytics/analytics.service.js";
import { AuditService } from "../dist/audit/audit.service.js";
import { OpenPositionsService } from "../dist/open-positions/open-positions.service.js";
import { JournalService } from "../dist/positions/journal.service.js";
import { PositionsService } from "../dist/positions/positions.service.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const client = createPrismaClient(dbUrl);
const prisma = { client };
const positions = new PositionsService(prisma, new AuditService(prisma));
const journal = new JournalService(prisma);
const analytics = new AnalyticsService(prisma);
const live = new OpenPositionsService(prisma);

const expectHttp = async (p, status) => {
  try {
    await p;
    assert.fail("expected error");
  } catch (e) {
    assert.equal(e.getStatus?.(), status, e.message);
  }
};

await client.$executeRawUnsafe("TRUNCATE users CASCADE");
const mk = (n, timezone) =>
  client.user.create({
    data: {
      authProviderId: `ja${n}`,
      email: `ja${n}@x.io`,
      timezone,
      // Unlimited history: these checks use fixed past dates.
      subscription: { create: { planCode: "PREMIUM" } },
      settings: { create: {} },
    },
  });
const alice = await mk(1, "Asia/Karachi");
const bob = await mk(2, "UTC");
const account = await client.exchangeAccount.create({
  data: { userId: alice.id, exchange: "BINANCE", label: "Main", apiKeyHint: "abcd" },
});

let n = 0;
const position = (fields) => {
  n += 1;
  return client.position.create({
    data: {
      userId: alice.id,
      accountId: account.id,
      exchange: "BINANCE",
      source: "FILLS",
      sourceKey: `${account.id}|F:${n}`,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      status: "CLOSED",
      fees: "1",
      funding: "0",
      ...fields,
    },
  });
};
// Closed 20:30 UTC on 1 Sept = 01:30 on 2 Sept in Karachi.
const win = await position({
  openedAt: new Date("2026-09-01T18:00:00Z"),
  closedAt: new Date("2026-09-01T20:30:00Z"),
  entryPrice: "60000",
  exitPrice: "61000",
  quantity: "0.1",
  netPnl: "99",
  holdingSeconds: 9000,
});
const loss = await position({
  openedAt: new Date("2026-09-03T08:00:00Z"),
  closedAt: new Date("2026-09-03T09:00:00Z"),
  entryPrice: "3000",
  exitPrice: "2950",
  quantity: "1",
  symbol: "ETHUSDT",
  baseAsset: "ETH",
  netPnl: "-51",
  holdingSeconds: 3600,
});
await position({
  openedAt: new Date("2026-09-04T08:00:00Z"),
  closedAt: new Date("2026-09-04T09:00:00Z"),
  symbol: "BTCUSD",
  quoteAsset: "USD",
  settleAsset: "BTC",
  netPnl: "0.001",
  exchange: "KUCOIN",
});
await position({ openedAt: new Date(), status: "OPEN", quantity: "0.5", entryPrice: "62000" });

// 1. Detail and journal.
const detail = await positions.detail(alice.id, loss.id);
assert.equal(detail.trade.symbol, "ETHUSDT");
assert.equal(detail.journal, null);
assert.equal(detail.trade.reviewed, false);
assert.equal(detail.risk.rMultiple, null);

const input = journalInputSchema.parse({
  setup: "Breakout",
  tags: ["news", "News", "A+"],
  emotions: ["FOMO", "FOMO"],
  mistakes: ["CHASED_ENTRY"],
  rating: 2,
  notes: "Entered late after the candle closed.",
  stopPrice: "2966",
  targetPrice: "3102",
  screenshotUrls: ["https://www.tradingview.com/x/abc123/"],
});
assert.deepEqual(input.tags, ["News", "A+"], "tags de-duplicated case-insensitively");
const saved = await journal.save(alice.id, loss.id, input);
assert.deepEqual(saved.emotions, ["FOMO"]);
// Double submit of a first save: both succeed, one entry.
await client.journalEntry.deleteMany({ where: { userId: alice.id } });
await Promise.all([journal.save(alice.id, loss.id, input), journal.save(alice.id, loss.id, input)]);
assert.equal(await client.journalEntry.count({ where: { userId: alice.id } }), 1);
const reviewed = await positions.detail(alice.id, loss.id);
assert.equal(reviewed.journal.setup, "Breakout");
assert.equal(reviewed.trade.reviewed, true);
assert.equal(reviewed.trade.rating, 2);
// Risk: entry 3000, stop 2966, 1 ETH -> 34 at risk; -51 / 34 = -1.5R. Target 3102 -> 3:1 planned.
assert.deepEqual(reviewed.risk, { riskAmount: "34", rMultiple: -1.5, plannedRewardRisk: 3 });
assert.deepEqual(reviewed.setupSuggestions, ["Breakout"]);
await journal.save(alice.id, win.id, journalInputSchema.parse({ setup: "Breakout", rating: 5 }));
const page = await positions.list(alice.id, { limit: 50 });
assert.equal(page.items.filter((p) => p.reviewed).length, 2);
console.log("✓ trade detail, journal save, review flags and R multiple");

// 2. Tenant isolation.
await expectHttp(positions.detail(bob.id, loss.id), 404);
await expectHttp(journal.save(bob.id, loss.id, journalInputSchema.parse({})), 404);
await expectHttp(journal.remove(bob.id, loss.id), 404);
console.log("✓ another user cannot read or write this journal");

// 3. The journal survives the sync engine rebuilding the trade (same source key, new row).
const { id: _old, createdAt: _c, updatedAt: _u, ...copy } = loss;
await client.position.delete({ where: { id: loss.id } });
const rebuilt = await client.position.create({ data: copy });
assert.notEqual(rebuilt.id, loss.id);
assert.equal((await positions.detail(alice.id, rebuilt.id)).journal.rating, 2);
console.log("✓ journal entry survives a rebuild of its trade");

// 4. Analytics: timezone days, USD-only totals, journal breakdowns.
const now = new Date("2026-09-10T12:00:00Z");
const report = await analytics.report(alice.id, { range: "all" }, now);
assert.equal(report.range.timezone, "Asia/Karachi");
assert.equal(report.summary.trades, 2, "open and coin-settled trades excluded");
assert.equal(report.summary.netPnl, "48");
assert.equal(report.summary.winRate, 0.5);
assert.equal(report.summary.profitFactor, 1.9412);
assert.deepEqual(report.excluded, { trades: 1, assets: ["BTC"] });
assert.deepEqual(
  report.daily.map((d) => d.date),
  ["2026-09-02", "2026-09-03"],
);
assert.equal(report.summary.avgR, -1.5);
assert.deepEqual(
  report.bySetup.map((b) => [b.key, b.trades, b.pnl]),
  [["Breakout", 2, "48"]],
);
assert.deepEqual(
  report.byMistake.map((b) => b.key),
  ["CHASED_ENTRY"],
);
const week = await analytics.report(alice.id, { range: "7d" }, now);
assert.equal(week.summary.trades, 0, "range filter");
assert.deepEqual(week.thisMonth, { pnl: "48", trades: 2 }, "this month ignores the period shown");
const custom = await analytics.report(
  alice.id,
  { range: "all", from: "2026-09-03", to: "2026-09-03" },
  now,
);
assert.equal(custom.summary.netPnl, "-51");
assert.equal((await analytics.report(bob.id, { range: "all" }, now)).summary.trades, 0);
console.log("✓ analytics: trader's timezone, USD-only totals, ranges, journal breakdowns");

// 5. Live open positions: only active accounts; totals in USD; liquidation distance.
await client.openPosition.createMany({
  data: [
    {
      userId: alice.id,
      accountId: account.id,
      exchange: "BINANCE",
      externalId: "BTCUSDT:BOTH",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      quantity: "0.5",
      entryPrice: "62000",
      markPrice: "64000",
      unrealizedPnl: "1000",
      liquidationPrice: "48000",
      syncedAt: new Date("2026-09-10T11:55:00Z"),
    },
    {
      userId: alice.id,
      accountId: account.id,
      exchange: "BINANCE",
      externalId: "ETHUSDT:BOTH",
      symbol: "ETHUSDT",
      baseAsset: "ETH",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "SHORT",
      quantity: "1",
      entryPrice: "3000",
      markPrice: "3100",
      unrealizedPnl: "-100",
      syncedAt: new Date("2026-09-10T11:56:00Z"),
    },
  ],
});
const open = await live.list(alice.id);
assert.deepEqual(
  open.items.map((p) => [p.symbol, p.notional]),
  [
    ["BTCUSDT", "32000"],
    ["ETHUSDT", "3100"],
  ],
);
assert.equal(open.unrealizedPnl, "900");
assert.equal(open.items[0].liquidationDistance, 0.25);
assert.equal(open.asOf, "2026-09-10T11:55:00.000Z");
await client.exchangeAccount.update({ where: { id: account.id }, data: { status: "INVALID" } });
assert.equal((await live.list(alice.id)).items.length, 0, "inactive accounts hidden");
assert.equal((await live.list(bob.id)).items.length, 0);
console.log(
  "✓ live positions: largest first, USD total, liquidation distance, active accounts only",
);

// 6. Deleting the journal, then the account, cleans up.
await journal.remove(alice.id, rebuilt.id);
assert.equal((await positions.detail(alice.id, rebuilt.id)).journal, null);
await client.exchangeAccount.delete({ where: { id: account.id } });
assert.equal(await client.journalEntry.count({ where: { userId: alice.id } }), 0);
assert.equal(await client.openPosition.count({ where: { userId: alice.id } }), 0);
console.log("✓ journal delete; removing an exchange account removes its notes and live positions");

await client.$disconnect();
console.log("All journal and analytics integration checks passed");
