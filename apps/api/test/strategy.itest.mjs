// Integration test: strategy analysis (market context from candles) against a real Postgres.
// Run after `pnpm build`.
import "reflect-metadata";
import assert from "node:assert/strict";
import { ensureContext, evaluateTrade, FakeModel, reviewTrade, strategyInsights } from "@atc/coach";
import { createPrismaClient } from "@atc/db";
import { processAiJob } from "../../worker/dist/ai/process.js";
import { queueAutoReviews } from "../../worker/dist/ai/schedule.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);

// Synthetic 5-minute market: steady up-trend with pullbacks, then a vertical spike.
const M5 = 300_000;
const T0 = Date.UTC(2026, 8, 20);
const closes = [];
let p = 60_000;
for (let i = 0; i < 400; i++) {
  p += i < 380 ? (i % 10 < 7 ? 25 : -45) : 400;
  closes.push(p);
}
const series = closes.map((c, i) => {
  const o = i ? closes[i - 1] : c;
  return {
    t: T0 + i * M5,
    o,
    h: Math.max(o, c) + 10,
    l: Math.min(o, c) - 10,
    c,
    v: 100 + (i % 7) * 10,
  };
});
const requests = [];
let refuse = false;
const candles = async (exchange, pos, tf, from, to) => {
  requests.push({ exchange, symbol: pos.symbol, tf });
  if (refuse) throw Object.assign(new Error("Invalid symbol"), { status: 400 });
  return series.filter((c) => c.t >= from && c.t <= to);
};
const model = new FakeModel((req) =>
  req.tool
    ? {
        toolInput: {
          summary: "s",
          entryAnalysis: "e",
          exitAnalysis: "x",
          riskAnalysis: "r",
          strategyAnalysis: "You chased a vertical move.",
          mistakes: [],
          positives: [],
          nextTime: "n",
        },
      }
    : { text: "ok" },
);

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
const user = await db.user.create({
  data: {
    authProviderId: "st1",
    email: "st1@x.io",
    subscription: { create: { planCode: "PRO" } },
    settings: { create: {} },
  },
});
const account = await db.exchangeAccount.create({
  data: { userId: user.id, exchange: "BINANCE", label: "Main", apiKeyHint: "abcd" },
});
let n = 0;
const trade = (idx, holdCandles, exitIdx) => {
  n += 1;
  const openedAt = new Date(series[idx].t + 60_000);
  const closedAt = new Date(series[exitIdx].t + 60_000);
  return db.position.create({
    data: {
      userId: user.id,
      accountId: account.id,
      exchange: "BINANCE",
      source: "FILLS",
      sourceKey: `${account.id}|F:s${n}`,
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      settleAsset: "USDT",
      direction: "LONG",
      status: "CLOSED",
      openedAt,
      closedAt,
      entryPrice: String(series[idx].o),
      exitPrice: String(series[exitIdx].c),
      quantity: "0.01",
      fees: "0.5",
      netPnl: String(((series[exitIdx].c - series[idx].o) * 0.01 - 0.5).toFixed(2)),
      holdingSeconds: holdCandles * 300,
    },
  });
};
const pullback = await trade(300, 10, 310); // entry after a pullback, in trend
const chase = await trade(395, 3, 398); // entry deep into the vertical spike

// 1. Context from candles: 5-minute chart for a short hold, trend-aligned pullback entry.
const ctx = await ensureContext(db, candles, user.id, pullback.id);
assert.equal(ctx.timeframe, "5m");
assert.equal(requests[0].tf, "5m");
assert.equal(ctx.checks.find((c) => c.code === "TREND_ALIGNED").ok, true);
assert.equal(ctx.extendedEntry, false);
assert.ok(ctx.excursion.mfe > 0);
const cached = requests.length;
await ensureContext(db, candles, user.id, pullback.id);
assert.equal(requests.length, cached, "stored context is reused");
console.log(
  `✓ market context: ${ctx.timeframe} candles, trend-aligned entry, entry score ${ctx.entryScore}%`,
);

// 2. Chasing the spike: extended entry becomes a FOMO flag and lowers the grade.
const before = await evaluateTrade(db, user.id, chase.id);
await processAiJob(
  { db, model, candles },
  { kind: "MARKET_CONTEXT", userId: user.id, positionId: chase.id },
);
const after = await evaluateTrade(db, user.id, chase.id);
assert.ok(after.flags.some((f) => f.code === "FOMO" && /chased the move/.test(f.evidence)));
assert.ok(after.grade.score < before.grade.score);
console.log("✓ chasing a vertical move is flagged as FOMO from market data alone");

// 3. The AI review receives the market facts and writes the strategy section.
await db.tradeContext.deleteMany({ where: { userId: user.id } });
const review = await reviewTrade({ db, model, candles }, user.id, chase.id);
assert.equal(review.strategyAnalysis, "You chased a vertical move.");
assert.match(
  model.calls.at(-1).messages[0].content,
  /MARKET CONTEXT\n- Timeframe 5m \(BINANCE candles\)/,
);
assert.match(model.calls.at(-1).messages[0].content, /Entry checklist/);
console.log("✓ AI review receives indicator, structure and checklist facts");

// 4. Insights across trades: results with and against each condition.
await ensureContext(db, candles, user.id, pullback.id);
const insights = await strategyInsights(db, user.id, new Date(0));
const extended = insights.find((i) => i.code === "NOT_EXTENDED");
assert.equal(extended.withCheck.trades + extended.againstCheck.trades, 2);
assert.equal(extended.againstCheck.trades, 1);
console.log("✓ strategy insights compare results with and against each entry condition");

// 5. A symbol the exchange refuses is recorded once, not retried forever; auto-queue skips it.
refuse = true;
const delisted = await trade(320, 5, 325);
assert.equal(await ensureContext(db, candles, user.id, delisted.id), null);
assert.equal(
  (await db.tradeContext.findFirst({ where: { positionKey: { endsWith: "s3" } } })).status,
  "UNAVAILABLE",
);
const queued = [];
const fakeQueue = { addBulk: async (jobs) => queued.push(...jobs.map((j) => j.data)) };
await queueAutoReviews(db, fakeQueue, account.id, new Date(series.at(-1).t + 3_600_000), {
  reviews: false,
});
assert.deepEqual(queued, [], "every recent trade already has a stored context");
console.log("✓ refused symbols are recorded as unavailable; analysed trades are not re-queued");

await db.$disconnect();
console.log("All strategy analysis integration checks passed");
