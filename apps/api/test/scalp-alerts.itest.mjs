// Integration test: scalp alerts, readings recorded each minute, readings at trade entry and the
// threshold review. The worker's readings must equal the Cockpit's for the same plan; alerts must
// fire once when their condition starts holding, rest, and stay quiet around news.
import "reflect-metadata";
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { runScalpReadouts, stampEntryReadouts } from "../../worker/dist/market/scalp-readouts.js";
import { AdminService } from "../dist/admin/admin.service.js";
import { CockpitService } from "../dist/market/cockpit.service.js";
import { FlowService } from "../dist/market/flow.service.js";
import { OrderflowService } from "../dist/market/orderflow.service.js";
import { ScalpAlertsService } from "../dist/market/scalp-alerts.controller.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const M = 60_000;
const T0 = Date.UTC(2026, 9, 20, 10, 0, 30);

await db.$executeRawUnsafe("TRUNCATE users CASCADE");
await db.$executeRawUnsafe(
  "TRUNCATE whale_trades, liquidation_events, liquidation_maps, scalp_readouts",
);
await db.marketSnapshot.deleteMany({
  where: { OR: [{ key: "scalp:latest" }, { key: { startsWith: "desk:" } }] },
});
await db.newsItem.deleteMany({ where: { source: "TEST" } });
await db.economicEvent.deleteMany({ where: { id: { startsWith: "sa-" } } });

const frame = (strength, p, regime = "neutral") => ({
  strength,
  buyPressurePct: p,
  netFlowUsd: p,
  priceChangePct: 0,
  oiChangePct: 0,
  relVolume: 1,
  regime,
});
const lv = (p) => ({
  dayHigh: p * 1.02,
  dayLow: p * 0.98,
  asiaHigh: p * 1.01,
  asiaLow: p * 0.99,
  asiaOpen: false,
  high24h: p * 1.03,
  low24h: p * 0.97,
});
const vol = (a) => ({ atr5m: a, atr15m: a, atr1h: a, rangeRatio: 1, activity: "normal" });
const book = (imb) => ({
  asOf: new Date(T0).toISOString(),
  mid: 1,
  spreadBps: 1,
  bands: [{ pct: 0.25, bidUsd: 1, askUsd: 1, imbalancePct: imb }],
  walls: [],
});
/** BTC strongly bought; ETH mixed; gold sold; C30 past the free plan's top 20. */
function snapshot(at, btcStrong = true) {
  const coins = [
    {
      symbol: "BTCUSDT",
      rank: 1,
      price: 100000,
      vwap: 99500,
      vwapDistPct: 0.5025,
      funding: 0.0001,
      frames: btcStrong
        ? {
            "5m": frame("strong_buying", 30, "long_buildup"),
            "15m": frame("buying", 10, "long_buildup"),
            "30m": frame("buying", 7),
            "1h": frame("buying", 6),
          }
        : {
            "5m": frame("neutral", 1),
            "15m": frame("neutral", 1),
            "30m": frame("neutral", 1),
            "1h": frame("neutral", 1),
          },
      book: book(btcStrong ? 30 : 0),
      levels: lv(100000),
      volatility: vol(100),
    },
    {
      symbol: "ETHUSDT",
      rank: 2,
      price: 4000,
      vwap: 4010,
      vwapDistPct: -0.25,
      funding: 0.0001,
      frames: {
        "5m": frame("buying", 12),
        "15m": frame("selling", -9),
        "30m": frame("neutral", 0),
        "1h": frame("neutral", 0),
      },
      book: book(-5),
      levels: lv(4000),
      volatility: vol(5),
    },
    {
      symbol: "XAUUSDT",
      rank: 45,
      price: 4000,
      vwap: 4020,
      vwapDistPct: -0.5,
      funding: 0.0004,
      frames: {
        "5m": frame("strong_selling", -30, "short_buildup"),
        "15m": frame("selling", -9),
        "30m": frame("selling", -7),
        "1h": frame("selling", -6),
      },
      book: null,
      levels: lv(4000),
      volatility: vol(4),
    },
    {
      symbol: "C30USDT",
      rank: 30,
      price: 1,
      vwap: null,
      vwapDistPct: null,
      funding: null,
      frames: { "5m": frame("buying", 11) },
      book: null,
      levels: null,
      volatility: vol(0.01),
    },
  ];
  return {
    computedAt: new Date(at - 20_000).toISOString(),
    asOf: new Date(Math.floor(at / M) * M).toISOString(),
    universe: 102,
    coins,
  };
}
async function publish(at, strong = true) {
  const s = snapshot(at, strong);
  await db.marketSnapshot.upsert({
    where: { key: "scalp:latest" },
    create: { key: "scalp:latest", updatedAt: new Date(at), data: s },
    update: { updatedAt: new Date(at), data: s },
  });
  return s;
}
await db.marketSnapshot.create({
  data: {
    key: "desk:BTCUSDT",
    updatedAt: new Date(T0),
    data: {
      symbol: "BTCUSDT",
      computedAt: new Date(T0 - 5 * M).toISOString(),
      bias: [{ timeframe: "1h", state: "up", bars: 3, evidence: [] }],
    },
  },
});
await db.marketSnapshot.create({
  data: {
    key: "desk:ETHUSDT",
    updatedAt: new Date(T0),
    data: {
      symbol: "ETHUSDT",
      computedAt: new Date(T0 - 5 * M).toISOString(),
      bias: [{ timeframe: "1h", state: "down", bars: 3, evidence: [] }],
    },
  },
});
const w = (symbol, side, usd, minsAgo) => ({
  exchange: "BINANCE",
  symbol,
  side,
  price: "1",
  qty: "1",
  usd: String(usd),
  fills: 1,
  at: new Date(T0 - minsAgo * M),
});
await db.whaleTrade.createMany({
  data: [w("BTCUSDT", "buy", 5e6, 2), w("ETHUSDT", "sell", 3e6, 1), w("ETHUSDT", "buy", 1e6, 9)],
});
await db.liquidationEvent.createMany({
  data: [
    {
      exchange: "OKX",
      symbol: "BTCUSDT",
      side: "short",
      price: "1",
      qty: "1",
      usd: "900000",
      at: new Date(T0 - 3 * M),
    },
  ],
});

const mk = (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `sa${n}`,
      email: `sa${n}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const free = await mk(1, "FREE");
const pro = await mk(2, "PRO");
const prisma = { client: db };
const alerts = new ScalpAlertsService(prisma);
const cockpit = new CockpitService(prisma, new OrderflowService(prisma), new FlowService(prisma));

// 1. Alert rules and plan limits through the API service.
await publish(T0);
const a1 = await alerts.create(pro.id, {
  symbol: "BTCUSDT",
  tf: "5m",
  direction: "ANY",
  minCount: 7,
  noNews: false,
  cooldownMin: 10,
  planStopRanges: 2,
  planTargetR: 3,
  planRiskUsd: 40,
});
assert.deepEqual([a1.planStopRanges, a1.planTargetR, a1.planRiskUsd], [2, 3, 40]);
const a2 = await alerts.create(pro.id, {
  symbol: "BTCUSDT",
  tf: "5m",
  direction: "UP",
  minCount: 7,
  noNews: true,
  cooldownMin: 10,
});
const a3 = await alerts.create(pro.id, {
  symbol: "XAUUSDT",
  tf: "15m",
  direction: "UP",
  minCount: 3,
  noNews: false,
  cooldownMin: 10,
});
const fEth = await alerts.create(free.id, {
  symbol: "ETHUSDT",
  tf: "5m",
  direction: "ANY",
  minCount: 3,
  noNews: false,
  cooldownMin: 10,
});
await assert.rejects(
  alerts.create(free.id, {
    symbol: "BTCUSDT",
    tf: "5m",
    direction: "ANY",
    minCount: 5,
    noNews: true,
    cooldownMin: 30,
  }),
  /keeps 1 scalp alert/,
);
await db.scalpAlert.delete({ where: { id: fEth.id } });
await assert.rejects(
  alerts.create(free.id, {
    symbol: "C30USDT",
    tf: "5m",
    direction: "ANY",
    minCount: 5,
    noNews: true,
    cooldownMin: 30,
  }),
  /top 20 coins, gold and silver/,
);
await assert.rejects(
  alerts.create(free.id, {
    symbol: "NOPEUSDT",
    tf: "5m",
    direction: "ANY",
    minCount: 5,
    noNews: true,
    cooldownMin: 30,
  }),
  /not in the scan/,
);
const _fGold = await alerts.create(free.id, {
  symbol: "XAUUSDT",
  tf: "5m",
  direction: "DOWN",
  minCount: 3,
  noNews: false,
  cooldownMin: 10,
});
assert.equal((await alerts.list(free.id)).limit, 1);
console.log("✓ alert limits: Free keeps 1, coins past the top 20 refused, gold allowed");

// 2. First check: readings recorded, alerts that hold fire once.
const sent = [];
const deps = (at) => ({
  db,
  now: () => at,
  notify: async (n) => {
    sent.push(n);
  },
});
const r1 = await runScalpReadouts(deps(T0), snapshot(T0));
assert.equal(r1.recorded, 4);
const row = await db.scalpReadout.findUnique({ where: { at: new Date(Math.floor(T0 / M) * M) } });
// The worker's counts must equal the Cockpit's for the same market (full plan).
for (const [sym, tf, i] of [
  ["BTCUSDT", "5m", 0],
  ["BTCUSDT", "15m", 3],
  ["ETHUSDT", "5m", 0],
  ["XAUUSDT", "15m", 3],
]) {
  const c = await cockpit.get(pro.id, { symbol: sym, tf }, new Date(T0));
  const rec = row.data[sym];
  assert.deepEqual(
    [rec[i], rec[i + 1], rec[i + 2]],
    [c.tally.up, c.tally.down, c.tally.up + c.tally.down + c.tally.neutral],
    `${sym} ${tf}`,
  );
}
assert.deepEqual(row.data.BTCUSDT.slice(6), [30, 10, 7, 6, 100000]);
const titles = sent.map((n) => n.title).sort();
// BTC 5m: strength ×3 up, regime up, funding neutral, VWAP up, book up, whales up, liquidations up, trend up = 9 up of 10.
assert.deepEqual(titles, [
  "BTC: 9 of 10 readings lean up on 5m",
  "BTC: 9 of 10 readings lean up on 5m",
  "Gold: 6 of 6 readings lean down on 5m", // Free: no whale feed or trend for gold
]);
assert.ok(sent.every((n) => n.kind === "SCALP_ALERT" && n.body.includes("not a signal")));
assert.ok(sent.some((n) => n.link.startsWith("/cockpit?s=BTCUSDT&tf=5m&entry=")));
// Every alert carries the trader's plan for both sides, never a side of its own.
assert.ok(sent.every((n) => /long → stop .+ short → stop .+ is your call\./.test(n.body)));
assert.ok(sent.every((n) => n.link.endsWith("#plan")));
const sized = sent.find((n) => n.dedupeKey.startsWith(`scalp:${a1.id}`));
const lost = Number(/Size [\d.]+ \(about \$(\d+\.\d\d) lost at the stop/.exec(sized.body)?.[1]);
assert.ok(lost > 30 && lost <= 40, `size keeps the loss within $40 (${lost})`);
assert.match(sized.link, /&sr=2&tr=3&at=\d+&risk=40#plan$/);
// Gold 15m "UP" does not hold (it leans down).
assert.ok(!sent.some((n) => n.userId === pro.id && n.title.startsWith("Gold")));
console.log(
  "✓ worker readings equal the Cockpit's; alerts that hold fire once (with direction respected)",
);

// Free plan readings for gold leave out trend and paid flow: same as the Free Cockpit.
const freeGold = await cockpit.get(free.id, { symbol: "XAUUSDT", tf: "5m" }, new Date(T0));
assert.equal(freeGold.tally.down, 6);
assert.equal(freeGold.rows.length, 6);

// 3. Still holding a minute later: no repeat.
sent.length = 0;
await runScalpReadouts(deps(T0 + M), snapshot(T0 + M));
assert.equal(sent.length, 0);
// Stops holding, then holds again before the rest is over: quiet; after it: fires.
await runScalpReadouts(deps(T0 + 2 * M), snapshot(T0 + 2 * M, false));
await runScalpReadouts(deps(T0 + 3 * M), snapshot(T0 + 3 * M));
assert.equal(sent.filter((n) => n.title.startsWith("BTC")).length, 0, "resting");
await runScalpReadouts(deps(T0 + 4 * M), snapshot(T0 + 4 * M, false));
await runScalpReadouts(deps(T0 + 11 * M), snapshot(T0 + 11 * M));
// The whale and liquidation rows have aged out of 5m by now: 7 of 10 up.
assert.deepEqual(
  sent.filter((n) => n.title.startsWith("BTC")).map((n) => n.title),
  ["BTC: 7 of 10 readings lean up on 5m", "BTC: 7 of 10 readings lean up on 5m"],
);
console.log("✓ no repeats while it holds; rests for its cooldown; fires again after");

// 4. News: the "quiet around news" alert stays quiet; the other one does not.
sent.length = 0;
await db.economicEvent.create({
  data: {
    id: "sa-cpi",
    title: "CPI m/m",
    currency: "USD",
    impact: "HIGH",
    startsAt: new Date(T0 + 40 * M),
    source: "test",
    fetchedAt: new Date(T0),
  },
});
await runScalpReadouts(deps(T0 + 25 * M), snapshot(T0 + 25 * M, false));
await runScalpReadouts(deps(T0 + 26 * M), snapshot(T0 + 26 * M));
const btc = sent.filter((n) => n.title.startsWith("BTC"));
assert.equal(btc.length, 1);
assert.equal(
  btc[0].dedupeKey.startsWith(`scalp:${a1.id}`),
  true,
  "only the alert that ignores news",
);
assert.ok(btc[0].body.includes("CPI m/m"));
await db.economicEvent.deleteMany({ where: { id: { startsWith: "sa-" } } });
console.log("✓ a news warning keeps 'quiet around news' alerts quiet");

// Paused alerts are not checked; updating an alert resets it.
await alerts.update(pro.id, a1.id, { enabled: false });
assert.equal((await db.scalpAlert.findUnique({ where: { id: a1.id } })).lastMet, false);
await alerts.remove(pro.id, a3.id);
await assert.rejects(alerts.remove(free.id, a2.id), /not found/i);

// 5. Readings at entry and the record split.
const _acct = await db.exchangeAccount.create({
  data: { userId: pro.id, exchange: "BINANCE", label: "B", apiKeyHint: "1" },
});
const pos = (k, base, openedAt, direction, pnl, heldMin = 10) => ({
  userId: pro.id,
  exchange: "BINANCE",
  source: "FILLS",
  sourceKey: `sa|${k}`,
  symbol: `${base}USDT`,
  baseAsset: base,
  quoteAsset: "USDT",
  settleAsset: "USDT",
  direction,
  status: "CLOSED",
  openedAt: new Date(openedAt),
  closedAt: new Date(openedAt + heldMin * M),
  netPnl: pnl,
});
await db.position.createMany({
  data: [
    pos("a", "BTC", T0 + 15_000, "LONG", "50"), // minute T0: 9 up, 0 down → with
    pos("b", "BTC", T0 + M + 40_000, "SHORT", "-20"), // minute T0+1m → against
    pos("c", "BTC", T0 + 2 * M + 5_000, "LONG", "5"), // minute T0+2m: neutral BTC (2 up? see record) → by counts
    pos("d", "BTC", T0 + 6 * M, "LONG", "7"), // no record at +6m; +5m none; +4m exists → uses +4m
    pos("e", "DOGE", T0 + 15_000, "LONG", "1"), // not scanned → none
    pos("f", "BTC", T0 - 20 * 86_400_000, "LONG", "1"), // too old: left alone
    pos("g", "BTC", T0 + 30 * M, "LONG", "1"), // no record within 3 minutes: left for later
  ],
});
const stamped = await stampEntryReadouts(db, T0 + 40 * M);
assert.equal(stamped, 5);
const get = async (k) =>
  (await db.position.findFirst({ where: { sourceKey: `sa|${k}` } })).entryReadout;
const recAt = async (m) =>
  (await db.scalpReadout.findUnique({ where: { at: new Date(Math.floor(T0 / M) * M + m * M) } }))
    .data.BTCUSDT;
const ea = await get("a");
const ra = await recAt(0);
assert.deepEqual(ea.tf5, { up: ra[0], down: ra[1], total: ra[2] });
assert.deepEqual(ea.tf15, { up: ra[3], down: ra[4], total: ra[5] });
assert.equal(ea.at, new Date(Math.floor(T0 / M) * M).toISOString());
assert.equal((await get("d")).at, new Date(Math.floor(T0 / M) * M + 4 * M).toISOString());
assert.deepEqual(await get("e"), { none: true });
assert.equal(await get("f"), null);
assert.equal(await get("g"), null);
const rec = (await cockpit.get(pro.id, { symbol: "BTCUSDT", tf: "5m" }, new Date(T0 + 40 * M)))
  .record;
assert.equal(rec.readings.stamped, 4);
const expectAlign = async (k, dir) => {
  const e = await get(k);
  return e.tf5.up === e.tf5.down
    ? "mixed"
    : (dir === "LONG") === e.tf5.up > e.tf5.down
      ? "with"
      : "against";
};
const want = {};
for (const [k, dir, pnl] of [
  ["a", "LONG", 50],
  ["b", "SHORT", -20],
  ["c", "LONG", 5],
  ["d", "LONG", 7],
]) {
  const g = await expectAlign(k, dir);
  want[g] = want[g] ?? { trades: 0, net: 0, wins: 0 };
  want[g].trades++;
  want[g].net += pnl;
  if (pnl > 0) want[g].wins++;
}
for (const g of rec.readings.groups) {
  assert.equal(g.trades, want[g.key].trades, g.key);
  assert.equal(Number(g.netPnl), want[g.key].net, g.key);
  assert.equal(g.winRate, want[g.key].wins / want[g.key].trades);
}
assert.equal(
  rec.readings.groups.reduce((s, g) => s + g.trades, 0),
  4,
);
console.log(
  "✓ trades stamped with the minute's readings (3-minute look-back), record split by them",
);

// 6. Threshold review over the recorded minutes.
const admin = new AdminService(prisma, {}, {});
const cal = await admin.scalpCalibration(7, T0 + 40 * M);
assert.ok(cal.minutes >= 1);
const crypto5 = cal.groups[0].windows[0];
assert.equal(crypto5.window, "5m");
assert.ok(crypto5.samples > 0);
const shares = Object.values(crypto5.shareNow).reduce((a, b) => a + b, 0);
assert.ok(Math.abs(shares - 1) < 1e-9);
assert.equal(cal.groups[1].label, "Gold and silver");
console.log("✓ threshold review reads the recorded minutes");

await db.$executeRawUnsafe("TRUNCATE whale_trades, liquidation_events, scalp_readouts");
await db.marketSnapshot.deleteMany({
  where: { OR: [{ key: "scalp:latest" }, { key: { startsWith: "desk:" } }] },
});
await db.$disconnect();
console.log("All scalp alert and readings integration checks passed");
