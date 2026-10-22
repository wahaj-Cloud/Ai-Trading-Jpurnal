// Integration test: supply/demand zones with a real Postgres. 1H and 4H zones for every scanned
// market from a simulated Binance (one price path, so both timeframes agree), refreshed only when
// a new candle has closed (and only once the exchange has published it); zone alerts fire when
// the price arrives in a watched zone, once, with a rest per zone and the plan's coins only;
// trades are stamped with the zones their entry price was inside. Run after build.
import assert from "node:assert/strict";
import { createPrismaClient } from "@atc/db";
import { SCALP_KEY, ZONES_KEY } from "@atc/shared";
import { supplyDemandZones } from "@atc/ta";
import { runZoneScan, stampEntryZones, ZoneAlerts } from "../dist/market/zones.js";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl))
  throw new Error("Integration tests only run against a local DATABASE_URL");
const db = createPrismaClient(dbUrl);
const H = 3_600_000;
const M = 60_000;
const H4 = 4 * H;
let NOW = Date.UTC(2026, 9, 21, 8, 0, 30);

// One 1-hour price path per symbol (quiet stretches and sharp legs), 4H built from it.
function pathFor(seed, p0) {
  let s = seed;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const end = Date.UTC(2026, 9, 21, 12);
  const n = 4400;
  const out = [];
  let p = p0;
  let regime = 0;
  let left = 0;
  for (let i = 0; i < n; i++) {
    if (left-- <= 0) {
      regime = r() < 0.12 ? (r() < 0.5 ? 1 : -1) : 0;
      left = regime ? 1 + Math.floor(r() * 3) : 4 + Math.floor(r() * 20);
    }
    const o = p;
    p = o * (1 + regime * (0.006 + r() * 0.006) + (r() - 0.5) * 0.004);
    out.push({
      t: end - (n - i) * H,
      o,
      c: p,
      h: Math.max(o, p) * (1 + r() * 0.0015),
      l: Math.min(o, p) * (1 - r() * 0.0015),
    });
  }
  return out;
}
const PATHS = { XAUUSDT: pathFor(7, 2600), BTCUSDT: pathFor(11, 60000), C30USDT: pathFor(13, 2) };
function candles(symbol, tf, limit, until) {
  const step = tf === "1h" ? H : H4;
  const map = new Map();
  for (const c of PATHS[symbol]) {
    if (c.t >= until) break;
    const k = Math.floor(c.t / step) * step;
    const a = map.get(k);
    if (!a) map.set(k, { ...c, t: k });
    else {
      a.h = Math.max(a.h, c.h);
      a.l = Math.min(a.l, c.l);
      a.c = c.c;
    }
  }
  return [...map.values()].slice(-limit);
}
// What the exchange has published: candles opening before this time (the forming one included).
let published = NOW;
let calls = 0;
const fetchFn = async (input) => {
  calls++;
  const u = new URL(String(input));
  const tf = u.searchParams.get("interval");
  const step = tf === "1h" ? H : H4;
  const rows = candles(
    u.searchParams.get("symbol"),
    tf,
    Number(u.searchParams.get("limit")),
    published,
  ).map((c) => [c.t, String(c.o), String(c.h), String(c.l), String(c.c), "1", c.t + step - 1]);
  return new Response(JSON.stringify(rows), { status: 200 });
};
const config = { binance: { fetch: fetchFn } };
const closedTa = (symbol, tf, now) => {
  const step = tf === "1h" ? H : H4;
  return candles(symbol, tf, 1001, now)
    .filter((c) => c.t + step <= now)
    .slice(-1000)
    .map((c) => ({ ...c, v: 1 }));
};

await db.marketSnapshot.deleteMany({ where: { key: { in: [SCALP_KEY, ZONES_KEY] } } });
await db.zoneHistory.deleteMany({});
await db.zoneAlert.deleteMany({});
const scan = (coins) =>
  db.marketSnapshot.create({
    data: {
      key: SCALP_KEY,
      updatedAt: new Date(NOW),
      data: { computedAt: new Date(NOW).toISOString(), coins },
    },
  });
await scan([
  { symbol: "BTCUSDT", rank: 1, price: 0 },
  { symbol: "C30USDT", rank: 30, price: 0 },
  { symbol: "XAUUSDT", rank: 125, price: 0 },
]);

// 1. First scan: both timeframes for every market, equal to the zones of the closed candles.
let res = await runZoneScan({ db, config, now: () => NOW });
assert.deepEqual(res, { refreshed: 6, failed: 0, markets: 3 });
const snap = async () => (await db.marketSnapshot.findUnique({ where: { key: ZONES_KEY } })).data;
let s = await snap();
let compared = 0;
for (const sym of Object.keys(PATHS))
  for (const tf of ["1h", "4h"]) {
    const want = supplyDemandZones(closedTa(sym, tf, NOW)).map((z) => ({
      side: z.side,
      top: z.top,
      bottom: z.bottom,
      t: z.t,
      tests: z.tests,
    }));
    assert.deepEqual(s.markets[sym][tf].zones, want, `${sym} ${tf}`);
    assert.equal(s.markets[sym][tf].asOf, new Date(Math.floor(NOW / H) * H).toISOString());
    compared += want.length;
  }
assert.ok(compared > 10, `enough zones to compare (${compared})`);
assert.equal(await db.zoneHistory.count(), 6);
console.log(
  `✓ 1H and 4H zones for every scanned market equal the closed candles' zones (${compared})`,
);

// 2. Nothing new has closed: no request. Next hour: 1H only. 4H boundary: both.
calls = 0;
NOW += 20 * M;
published = NOW;
res = await runZoneScan({ db, config, now: () => NOW });
assert.equal(res.refreshed, 0);
assert.equal(calls, 0, "no request until a candle closes");
NOW = Date.UTC(2026, 9, 21, 9, 0, 20);
published = Date.UTC(2026, 9, 21, 8); // the exchange is late: no 08:00-09:00 candle yet
res = await runZoneScan({ db, config, now: () => NOW });
assert.equal(res.refreshed, 0, "waits for the exchange to publish the closed candle");
published = NOW;
res = await runZoneScan({ db, config, now: () => NOW });
assert.equal(res.refreshed, 3, "1H only");
s = await snap();
assert.equal(s.markets.XAUUSDT["1h"].asOf, "2026-10-21T09:00:00.000Z");
assert.equal(s.markets.XAUUSDT["4h"].asOf, "2026-10-21T08:00:00.000Z");
NOW = Date.UTC(2026, 9, 21, 12, 1);
published = NOW;
res = await runZoneScan({ db, config, now: () => NOW });
assert.equal(res.refreshed, 6, "1H and 4H at 12:00");
console.log("✓ refreshed only after a candle closes and is published; 4H every four hours");

// 3. Zone alerts.
const mk = async (n, plan) =>
  db.user.create({
    data: {
      authProviderId: `za${n}${Date.now()}`,
      email: `za${n}${Date.now()}@x.io`,
      timezone: "UTC",
      subscription: { create: { planCode: plan } },
      settings: { create: {} },
    },
  });
const pro = await mk(1, "PRO");
const free = await mk(2, "FREE");
s = await snap();
const pickFresh = (sym, side) => {
  for (const tf of ["4h", "1h"]) {
    const z = s.markets[sym][tf].zones.find((x) => x.side === side && x.tests === 0);
    if (z) return { tf, z };
  }
  return null;
};
const demand = pickFresh("XAUUSDT", "demand") ?? pickFresh("XAUUSDT", "supply");
assert.ok(demand, "a fresh zone to test with");
const side = demand.z.side;
const mid = (demand.z.top + demand.z.bottom) / 2;
const away = side === "demand" ? demand.z.top * 1.05 : demand.z.bottom * 0.95;
// Somewhere not inside any zone of either timeframe, for "away" checks.
const insideAny = (p) =>
  ["1h", "4h"].some((tf) => s.markets.XAUUSDT[tf].zones.some((z) => p >= z.bottom && p <= z.top));
let outside = away;
for (let k = 0; insideAny(outside) && k < 200; k++) outside *= side === "demand" ? 1.003 : 0.997;
assert.ok(!insideAny(outside));

const alert = await db.zoneAlert.create({
  data: {
    userId: pro.id,
    symbol: "XAUUSDT",
    tfs: [demand.tf],
    side: side === "demand" ? "DEMAND" : "SUPPLY",
    freshOnly: true,
    cooldownMin: 120,
  },
});
const other = await db.zoneAlert.create({
  data: {
    userId: pro.id,
    symbol: "XAUUSDT",
    tfs: ["1h", "4h"],
    side: side === "demand" ? "SUPPLY" : "DEMAND",
    freshOnly: false,
  },
});
const beyond = await db.zoneAlert.create({
  data: { userId: free.id, symbol: "C30USDT", tfs: ["1h", "4h"], side: "ANY", freshOnly: false },
});
const sent = [];
const limits = async (userId) =>
  userId === free.id
    ? { marketPulseCoins: 20, setupAlertEmail: 0 }
    : { marketPulseCoins: -1, setupAlertEmail: 1 };
const za = new ZoneAlerts({ db, notify: async (n) => sent.push(n), limits, now: () => NOW });
const at = (xau, c30 = 1) =>
  new Map([
    ["XAUUSDT", { price: xau, rank: 125 }],
    ["C30USDT", { price: c30, rank: 30 }],
  ]);
// A start while already inside learns the position only.
assert.equal(await za.check(at(mid)), 0, "no alert for being inside at start-up");
NOW += 1000;
assert.equal(await za.check(at(outside)), 0);
NOW += 1000;
assert.equal(await za.check(at(mid)), 1, "arrives in the zone: one alert");
const n = sent[0];
assert.equal(n.userId, pro.id);
assert.equal(n.kind, "ZONE_ALERT");
assert.equal(n.title, `Gold reached a fresh ${demand.tf.toUpperCase()} ${side} zone`);
assert.match(n.body, /is inside .+ \(.+, first return\)\. .+ A record, not a signal to trade\./);
assert.equal(n.link, "/cockpit?s=XAUUSDT&tf=5m#levels");
assert.equal(n.allowEmail, true);
NOW += 1000;
assert.equal(await za.check(at(mid)), 0, "no repeat while inside");
NOW += 1000;
await za.check(at(outside));
NOW += 1000;
assert.equal(await za.check(at(mid)), 0, "the same zone rests for its cooldown");
NOW += 121 * M;
await za.check(at(outside));
NOW += 1000;
assert.equal(await za.check(at(mid)), 1, "after the rest it can alert again");
assert.ok(!sent.some((x) => x.dedupeKey.includes(other.id)), "the other side never alerts here");
assert.ok(
  !sent.some((x) => x.dedupeKey.includes(beyond.id)),
  "a coin past the plan is not checked",
);
const row = await db.zoneAlert.findUnique({ where: { id: alert.id } });
assert.equal(row.lastZoneKey, `${demand.tf}:${side}:${demand.z.t}`);
console.log("✓ zone alerts: on arrival, once, rest per zone, plan's coins only");

// 4. Trades stamped with the zones their entry was inside.
const pos = (k, base, openedAt, direction, entryPrice) => ({
  userId: pro.id,
  exchange: "BINANCE",
  source: "FILLS",
  sourceKey: `zn|${k}`,
  symbol: `${base}USDT`,
  baseAsset: base,
  quoteAsset: "USDT",
  settleAsset: "USDT",
  direction,
  status: "CLOSED",
  openedAt: new Date(openedAt),
  closedAt: new Date(openedAt + 30 * M),
  netPnl: "1",
  entryPrice: String(entryPrice),
});
const T = Date.UTC(2026, 9, 21, 9, 30);
const hist1 = (
  await db.zoneHistory.findUnique({
    where: {
      symbol_tf_at: { symbol: "XAUUSDT", tf: "1h", at: new Date(Date.UTC(2026, 9, 21, 9)) },
    },
  })
).zones;
const z1 = hist1[0];
await db.position.createMany({
  data: [
    pos("in", "XAU", T, z1.side === "demand" ? "LONG" : "SHORT", (z1.top + z1.bottom) / 2),
    pos("out", "XAU", T + M, "LONG", z1.top * 3),
    pos("nodata", "DOGE", Date.UTC(2026, 9, 21, 7), "LONG", 0.2),
    pos("young", "DOGE", Date.UTC(2026, 9, 21, 11, 30), "LONG", 0.2),
  ],
});
const stamped = await stampEntryZones(db, Date.UTC(2026, 9, 21, 12, 5));
assert.ok(stamped >= 3, "ours stamped (other recent trades in the database may be too)");
const get = async (k) =>
  (await db.position.findFirst({ where: { sourceKey: `zn|${k}` } })).entryZone;
const ein = await get("in");
assert.equal(ein.at, "2026-10-21T09:00:00.000Z", "the zones known at entry (09:00 1H close)");
assert.ok(
  ein.zones.some((x) => x.tf === "1h" && x.side === z1.side && x.fresh === (z1.tests === 0)),
);
assert.deepEqual((await get("out")).zones, []);
assert.deepEqual(await get("nodata"), { none: true });
assert.equal(await get("young"), null);
console.log("✓ trades stamped with the 1H/4H zones their entry price was inside");

await db.position.deleteMany({ where: { sourceKey: { startsWith: "zn|" } } });
await db.user.deleteMany({ where: { id: { in: [pro.id, free.id] } } });
await db.marketSnapshot.deleteMany({ where: { key: { in: [SCALP_KEY, ZONES_KEY] } } });
await db.zoneHistory.deleteMany({});
await db.$disconnect();
console.log("All zone integration checks passed");
