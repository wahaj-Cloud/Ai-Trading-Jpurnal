// Integration test: paper bots on scripted live ticks, with a real Postgres. A Cockpit bot enters
// only when its count starts holding, pays the entry fee and slippage, is charged funding at
// 16:00 UTC, and leaves at its target, its stop (filled where the price jumped to) and its time
// limit; the bot's balance follows. Two entries at once give one trade; a close is booked once.
// With DUMP_PAPER=path the ticks and trades are written out for the independent Python check.
// Run after build.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { enterPaperTrade, settlePaperTrade } from "@atc/coach";
import { createPrismaClient } from "@atc/db";
import { applyLiveToScalpCoin, SCALP_KEY } from "@atc/shared";
import { PaperBotEngine } from "../dist/market/paper-bots.js";
import { LiveBase, readout } from "../dist/market/scalp-readouts.js";
import { scanSetups } from "../dist/setups/scan.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const M = 60_000;
let NOW = Date.UTC(2026, 9, 20, 15, 50);
const close = (a, b, what) =>
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);

// The minute snapshot (gold), with VWAP below the price.
const P0 = 2000;
await db.marketSnapshot.deleteMany({ where: { key: SCALP_KEY } });
const base = {
  symbol: "XAUUSDT",
  rank: 125,
  price: P0,
  vwap: P0 * 0.99,
  vwapDistPct: 1,
  funding: 0.0001,
  frames: {},
  book: { asOf: new Date(NOW).toISOString(), mid: P0, spreadBps: 0.5, bands: [], walls: [] },
  levels: {
    dayHigh: P0 * 1.05,
    dayLow: P0 * 0.95,
    asiaHigh: P0 * 1.04,
    asiaLow: P0 * 0.96,
    asiaOpen: false,
    high24h: P0 * 1.06,
    low24h: P0 * 0.94,
  },
  volatility: { atr5m: 4, atr15m: 8, atr1h: 16, rangeRatio: 1, activity: "normal" },
};
await db.marketSnapshot.create({
  data: {
    key: SCALP_KEY,
    updatedAt: new Date(NOW),
    data: {
      computedAt: new Date(NOW).toISOString(),
      asOf: new Date(NOW).toISOString(),
      universe: 101,
      coins: [base],
    },
  },
});

const cell = (bp) => ({
  bp,
  nf: bp * 1e4,
  vol: 1e6,
  pc: bp / 100,
  oi: bp / 50,
  oiu: bp * 1e3,
  rg: bp > 0 ? "long_buildup" : "neutral",
  st: bp >= 30 ? "strong_buying" : bp >= 10 ? "buying" : "neutral",
  rv: 1,
});
/** One live tick: gold at `p`, buying strongly (`strong`) or quiet, funding `f`. */
const tick = (p, strong, f = 0.0001) => ({
  at: NOW,
  universe: 101,
  coins: [
    {
      s: "XAUUSDT",
      r: 125,
      p,
      h: p,
      l: p,
      f,
      sp: 0.5,
      v: { atr5m: 4, atr15m: 8, rangeRatio: 1, activity: "normal" },
      w: Object.fromEntries(["5m", "15m", "30m", "1h"].map((w) => [w, cell(strong ? 40 : 0)])),
      t: NOW,
    },
  ],
  summary: {},
});

// The count of up readings when buying is strong and when it is quiet, by the same rules.
const lb = new LiveBase(db);
const { inputs } = await lb.refresh(NOW);
const upOf = (t) =>
  readout(
    applyLiveToScalpCoin(base, t.coins[0]),
    "5m",
    inputs,
    new Date(NOW).toISOString(),
    NOW,
    true,
  ).tally;
const strongT = upOf(tick(P0, true));
const quietT = upOf(tick(P0, false));
assert.ok(strongT.up > quietT.up && strongT.up > strongT.down, "strong buying adds up readings");
const minCount = strongT.up;

const user = await db.user.create({
  data: {
    authProviderId: `paper${Date.now()}`,
    email: `paper${Date.now()}@x.io`,
    timezone: "UTC",
    subscription: { create: { planCode: "PREMIUM" } },
    settings: { create: {} },
  },
});
const rules = {
  stopRanges: 1.5,
  targetR: 2,
  maxHoldMin: 60,
  riskPct: 1,
  feeBps: 5,
  slippageBps: 2,
};
const bot = await db.paperBot.create({
  data: {
    userId: user.id,
    name: "Gold count",
    symbol: "XAUUSDT",
    source: "COCKPIT",
    tf: "5m",
    direction: "UP",
    minCount,
    noNews: false,
    ...rules,
    startEquity: 10_000,
    equity: 10_000,
    // As the API creates it: waits for the rule to start holding.
    lastMet: true,
  },
});

const engine = new PaperBotEngine({ db, now: () => NOW }, new LiveBase(db));
const log = [];
const step = async (p, strong, f = 0.0001, label = "") => {
  const t = tick(p, strong, f);
  const r = await engine.onTick(t);
  log.push({ now: NOW, p, f, strong, label, ...r });
  return r;
};
const trades = () =>
  db.paperTrade.findMany({ where: { botId: bot.id }, orderBy: { entryAt: "asc" } });

// 1. Holding already when created: no entry. Quiet, then strong again: enters.
assert.deepEqual(await step(P0, true), { opened: 0, closed: 0 });
NOW += 1_000;
await step(P0, false);
assert.equal((await db.paperBot.findUnique({ where: { id: bot.id } })).lastMet, false);
NOW += 1_000;
assert.deepEqual(await step(P0, true, 0.0001, "enter"), { opened: 1, closed: 0 });
let [t1] = await trades();
const e1 = P0 * 1.0002;
close(t1.entryPrice, e1, "entry pays slippage");
close(t1.stop, e1 - 6, "stop 1.5 ranges");
close(t1.target, e1 + 12, "target 2R");
close(t1.qty, 100 / 6, "1% risk");
close(t1.fees, ((100 / 6) * e1 * 5) / 1e4, "entry fee");
assert.equal(t1.status, "OPEN");
assert.deepEqual(t1.entryNote, {
  kind: "cockpit",
  up: strongT.up,
  down: strongT.down,
  total: strongT.up + strongT.down + strongT.neutral,
});
console.log(`✓ enters when the count (${minCount} up) starts holding, never part-way`);

// 2. Still holding and already in a trade: nothing more.
NOW += 1_000;
assert.deepEqual(await step(P0 + 1, true), { opened: 0, closed: 0 });
assert.equal((await trades()).length, 1);

// 3. Funding at 16:00 UTC on the live price and rate.
NOW = Date.UTC(2026, 9, 20, 16, 0, 2);
await step(P0 + 2, false, 0.0003, "funding");
[t1] = await trades();
close(t1.funding, (100 / 6) * (P0 + 2) * 0.0003, "funding charged once");
assert.equal(t1.fundedUntil.getTime(), Date.UTC(2026, 9, 20, 16));
NOW += 1_000;
await step(P0 + 2, false, 0.0003);
close((await trades())[0].funding, (100 / 6) * (P0 + 2) * 0.0003, "not charged twice");
console.log("✓ funding charged at 16:00 UTC, once");

// 4. Target: closes exactly at the target, after both fees and funding; the balance follows.
NOW += 1_000;
assert.deepEqual(await step(e1 + 12.5, false, 0.0003, "target"), { opened: 0, closed: 1 });
[t1] = await trades();
assert.equal(t1.status, "CLOSED");
assert.equal(t1.exitReason, "TARGET");
close(t1.exitPrice, e1 + 12, "target fill");
const fees1 = ((100 / 6) * e1 * 5) / 1e4 + ((100 / 6) * (e1 + 12) * 5) / 1e4;
const pnl1 = 12 * (100 / 6) - fees1 - (100 / 6) * (P0 + 2) * 0.0003;
close(t1.pnl, pnl1, "target profit");
close(t1.rMultiple, pnl1 / 100, "R");
let eq = 10_000 + pnl1;
close((await db.paperBot.findUnique({ where: { id: bot.id } })).equity, eq, "balance");
console.log("✓ target fill exact, fees and funding taken off, balance updated");

// 5. Stop: the price jumps through the stop and fills where it is, less slippage.
NOW += 1_000;
await step(P0, false);
NOW += 1_000;
assert.equal((await step(P0, true, 0.0001, "enter")).opened, 1);
let t2 = (await trades())[1];
const e2 = P0 * 1.0002;
close(t2.qty, (eq * 0.01) / 6, "sized on the new balance");
NOW += 1_000;
assert.equal((await step(e2 - 9, false, 0.0001, "stop")).closed, 1);
t2 = (await trades())[1];
assert.equal(t2.exitReason, "STOP");
close(t2.exitPrice, (e2 - 9) * 0.9998, "gap fill");
assert.ok(t2.rMultiple < -1, "a gap costs more than 1R");
eq += t2.pnl;
console.log("✓ stop through a gap fills at the price, not the stop");

// 6. Time limit: out after 60 minutes at the price, less slippage.
NOW += 1_000;
await step(P0, false);
NOW += 1_000;
await step(P0, true, 0.0001, "enter");
const entered = NOW;
NOW = entered + 59 * M;
assert.equal((await step(P0 + 1, false, 0.0001)).closed, 0);
NOW = entered + 60 * M;
assert.equal((await step(P0 + 1, false, 0.0001, "time")).closed, 1);
const t3 = (await trades())[2];
assert.equal(t3.exitReason, "TIME");
close(t3.exitPrice, (P0 + 1) * 0.9998, "time fill");
eq += t3.pnl;
close((await db.paperBot.findUnique({ where: { id: bot.id } })).equity, eq, "balance after three");
console.log("✓ time limit closes at the price after 60 minutes");

// 7. Two entries at the same moment give one trade; a close is booked once.
NOW += M;
const both = await Promise.all([
  enterPaperTrade(db, bot.id, {
    side: "SHORT",
    price: P0,
    range: 4,
    at: NOW,
    note: { kind: "setup", matched: ["x"] },
  }),
  enterPaperTrade(db, bot.id, {
    side: "SHORT",
    price: P0,
    range: 4,
    at: NOW,
    note: { kind: "setup", matched: ["x"] },
  }),
]);
assert.equal(both.filter(Boolean).length, 1, "one open trade per bot");
const t4 = (await trades())[3];
assert.equal(t4.side, "SHORT");
close(t4.entryPrice, P0 * 0.9998, "short entry slippage");
const once = await Promise.all([
  settlePaperTrade(db, t4, 5, { exitPrice: P0, reason: "MANUAL", at: NOW }),
  settlePaperTrade(db, t4, 5, { exitPrice: P0, reason: "MANUAL", at: NOW }),
]);
assert.deepEqual(once.sort(), [false, true]);
eq += (await trades())[3].pnl;
close((await db.paperBot.findUnique({ where: { id: bot.id } })).equity, eq, "booked once");
console.log("✓ never two open trades; a close is booked once");

// 8. A paused bot does not enter.
await db.paperBot.update({ where: { id: bot.id }, data: { enabled: false } });
const paused = new PaperBotEngine({ db, now: () => NOW }, new LiveBase(db));
NOW += 1_000;
await paused.onTick(tick(P0, false));
NOW += 1_000;
assert.deepEqual(await paused.onTick(tick(P0, true)), { opened: 0, closed: 0 });
assert.equal(
  await enterPaperTrade(db, bot.id, {
    side: "LONG",
    price: P0,
    range: 4,
    at: NOW,
    note: { kind: "setup", matched: [] },
  }),
  null,
);
console.log("✓ a paused bot does not enter");

// 9. Setup bots: the scanner enters at the close of the candle the setup matched on, sized on the
// candle's 14-bar ATR; with the setup's alerts off, no alert is sent.
const H = 3_600_000;
const SCAN_NOW = Date.UTC(2026, 9, 20, 18, 0, 30);
const rows = [];
for (let k = 120; k >= 0; k--) {
  // Steady climb with a fixed 6-dollar range: the 14-bar ATR is exactly 6.
  const t = Math.floor(SCAN_NOW / H) * H - k * H;
  const o = 1000 + (120 - k) * 2;
  rows.push([t, String(o), String(o + 4), String(o - 2), String(o + 2), "10", t + H - 1, "1"]);
}
const fakeFetch = async (input) => {
  const url = new URL(String(input));
  assert.equal(url.pathname, "/fapi/v1/klines");
  return new Response(JSON.stringify(rows), { status: 200 });
};
const setup = await db.setup.create({
  data: {
    userId: user.id,
    name: "EMA climb",
    exchange: "BINANCE",
    symbols: ["SOLUSDT"],
    timeframe: "1h",
    rule: {
      version: 1,
      direction: "long",
      all: [{ type: "ema_trend", fast: 5, slow: 20, direction: "up" }],
    },
    ruleVersion: 1,
    isActive: false,
  },
});
const sbot = await db.paperBot.create({
  data: {
    userId: user.id,
    name: "Setup bot",
    symbol: "SOLUSDT",
    source: "SETUP",
    tf: "1h",
    setupId: setup.id,
    ...rules,
    maxHoldMin: 240,
    startEquity: 5_000,
    equity: 5_000,
  },
});
const kv = new Map();
const redisFake = { get: async (k) => kv.get(k) ?? null, set: async (k, v) => kv.set(k, v) };
const sent = [];
const res = await scanSetups({
  db,
  redis: redisFake,
  config: { binance: { fetch: fakeFetch } },
  notify: async (n) => sent.push(n),
  now: () => SCAN_NOW,
});
assert.equal(res.alerts, 0, "alerts off: none sent");
assert.equal(sent.length, 0);
assert.equal(await db.setupAlert.count({ where: { setupId: setup.id } }), 0);
const st = await db.paperTrade.findFirst({ where: { botId: sbot.id } });
assert.ok(st, "the setup bot entered");
const lastClose = 1000 + 119 * 2 + 2;
close(st.entryPrice, lastClose * 1.0002, "entry at the signal close + slippage");
close(st.stop, st.entryPrice - 1.5 * 6, "stop on the 14-bar ATR");
close(st.qty, (5_000 * 0.01) / 9, "sized on the bot's balance");
assert.equal(st.entryAt.getTime(), Math.floor(SCAN_NOW / H) * H, "entered at the candle close");
assert.equal(st.side, "LONG");
assert.deepEqual(st.entryNote.kind, "setup");
// The same candle again (another scan this hour): no second trade.
kv.clear();
await scanSetups({
  db,
  redis: redisFake,
  config: { binance: { fetch: fakeFetch } },
  notify: async (n) => sent.push(n),
  now: () => SCAN_NOW + 30_000,
});
assert.equal(await db.paperTrade.count({ where: { botId: sbot.id } }), 1);
console.log("✓ setup bots enter at the matching candle's close, alerts stay off");

if (process.env.DUMP_PAPER)
  writeFileSync(
    process.env.DUMP_PAPER,
    JSON.stringify({
      rules,
      startEquity: 10_000,
      log,
      trades: (await trades()).map((t) => ({
        ...t,
        entryAt: t.entryAt.getTime(),
        exitAt: t.exitAt?.getTime() ?? null,
        fundedUntil: t.fundedUntil?.getTime() ?? null,
      })),
      equity: (await db.paperBot.findUnique({ where: { id: bot.id } })).equity,
    }),
  );

await db.user.delete({ where: { id: user.id } });
await db.marketSnapshot.deleteMany({ where: { key: SCALP_KEY } });
await db.$disconnect();
console.log("All paper bot integration checks passed");
