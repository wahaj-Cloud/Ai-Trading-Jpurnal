import type { PrismaClient } from "@atc/db";
import type { OrderflowWindowSnapshot, ScalpSnapshot } from "@atc/shared";
import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it } from "vitest";
import { resetOrderflowCache, runOrderflow, runOrderflowFast, VWAP_KEY } from "./orderflow.js";

const M1 = 60_000;
const M5 = 300_000;
const NOW = Date.UTC(2026, 9, 18, 12, 1, 30);

/** Three contracts: UP rises with buying and growing OI, DN falls with selling, FLAT is flat. */
function fakeFetch(fail: string[] = [], calls: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    const symbol = url.searchParams.get("symbol") ?? "";
    if (fail.includes(symbol)) return json({ msg: "down" }, 503);
    const dir = symbol === "UPUSDT" ? 1 : symbol === "DNUSDT" ? -1 : 0;
    if (url.pathname === "/fapi/v1/exchangeInfo")
      return json({
        symbols: ["UPUSDT", "DNUSDT", "NEWUSDT", "FLATUSDT"].map((s) => ({
          symbol: s,
          baseAsset: s.replace("USDT", ""),
          quoteAsset: "USDT",
          contractType: "PERPETUAL",
          status: "TRADING",
          onboardDate: s === "NEWUSDT" ? NOW - 86_400_000 : 0,
        })),
      });
    if (url.pathname === "/fapi/v1/ticker/24hr")
      return json([
        { symbol: "UPUSDT", quoteVolume: "3000" },
        { symbol: "DNUSDT", quoteVolume: "2000" },
        { symbol: "NEWUSDT", quoteVolume: "9000" },
        { symbol: "FLATUSDT", quoteVolume: "1000" },
      ]);
    if (url.pathname === "/fapi/v1/premiumIndex")
      return json([
        { symbol: "UPUSDT", lastFundingRate: "0.0001" },
        { symbol: "DNUSDT", lastFundingRate: "-0.0002" },
      ]);
    if (url.pathname === "/fapi/v1/klines") {
      const step = url.searchParams.get("interval") === "1m" ? M1 : M5;
      const last = Math.floor(NOW / step) * step - step; // newest closed candle
      const limit = Number(url.searchParams.get("limit"));
      const rows = [];
      for (let k = limit - 2; k >= -1; k--) {
        const t = last - k * step; // k = -1 is the forming candle
        const i = limit - 2 - k;
        const o = 100 * (1 + dir * 0.0005 * i);
        const c = 100 * (1 + dir * 0.0005 * (i + 1));
        const buy = dir > 0 ? "60" : dir < 0 ? "40" : "50";
        rows.push([
          t,
          String(o),
          String(Math.max(o, c) * 1.001),
          String(Math.min(o, c) * 0.999),
          String(c),
          "1",
          t + step - 1,
          "100",
          1,
          "0",
          buy,
          "0",
        ]);
      }
      return json(rows);
    }
    if (url.pathname === "/futures/data/openInterestHist") {
      const start = Number(url.searchParams.get("startTime"));
      const end = Number(url.searchParams.get("endTime"));
      const rows = [];
      for (let t = Math.ceil(start / M5) * M5; t <= Math.min(end, NOW - M5); t += M5) {
        const oi = dir === 0 ? 1000 : 1000 * (1 + 0.001 * ((t - start) / M5));
        rows.push({ symbol, sumOpenInterest: String(oi), timestamp: t });
      }
      return json(rows);
    }
    if (url.pathname === "/fapi/v1/openInterest")
      return json({ symbol, openInterest: dir === 0 ? "1000" : "1100", time: NOW });
    if (url.pathname === "/fapi/v1/depth")
      return json({
        T: NOW,
        bids: [
          ["99.99", "10"],
          ["99.5", "1"],
          ["98.9", "1"],
        ],
        asks: [
          ["100.01", "2"],
          ["100.5", "1"],
          ["101.1", "1"],
        ],
      });
    return json({ msg: "unknown" }, 404);
  }) as typeof fetch;
}

function fakeDb() {
  const saved = new Map<string, unknown>();
  const db = {
    marketSnapshot: {
      upsert: (a: { where: { key: string }; create: { data: unknown } }) => {
        saved.set(a.where.key, a.create.data);
        return Promise.resolve();
      },
      findMany: (a: { where: { key: { in: string[] } } }) =>
        Promise.resolve(
          a.where.key.in.filter((k) => saved.has(k)).map((key) => ({ key, data: saved.get(key) })),
        ),
      findUnique: (a: { where: { key: string } }) =>
        Promise.resolve(saved.has(a.where.key) ? { data: saved.get(a.where.key) } : null),
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  return { db, saved };
}

/** The handful of sorted-set commands the scan uses. */
function fakeRedis() {
  const sets = new Map<string, Map<string, number>>();
  const set = (k: string) => {
    let m = sets.get(k);
    if (!m) {
      m = new Map();
      sets.set(k, m);
    }
    return m;
  };
  const range = (k: string, min: number) =>
    [...set(k)]
      .filter(([, s]) => s >= min)
      .sort((a, b) => a[1] - b[1])
      .map(([m]) => m);
  const redis = {
    zcount: async (k: string, min: number) => range(k, min).length,
    multi() {
      const ops: Array<() => unknown> = [];
      const m = {
        zadd: (k: string, s: number, member: string) => {
          ops.push(() => set(k).set(member, s));
          return m;
        },
        zremrangebyscore: (k: string, _a: string, max: number) => {
          ops.push(() => {
            for (const [mem, s] of set(k)) if (s <= max) set(k).delete(mem);
          });
          return m;
        },
        pexpire: () => m,
        zrangebyscore: (k: string, min: number) => {
          ops.push(() => range(k, min));
          return m;
        },
        exec: async () => ops.map((op) => [null, op()]),
      };
      return m;
    },
  } as unknown as Redis;
  return { redis, sets };
}

beforeEach(() => resetOrderflowCache());

describe("runOrderflow (5-minute scan)", () => {
  it("saves 4H and 1D with groups, strength, relative volume and funding, plus VWAPs", async () => {
    const { db, saved } = fakeDb();
    const res = await runOrderflow({
      db,
      config: { binance: { fetch: fakeFetch() } },
      now: () => NOW,
    });
    expect(res).toMatchObject({ coins: 3, failed: 0 });
    expect([...saved.keys()].sort()).toEqual(["orderflow:24h", "orderflow:4h", VWAP_KEY].sort());
    const w = saved.get("orderflow:24h") as OrderflowWindowSnapshot;
    expect(w.universe).toBe(3);
    expect(w.coins.map((c) => [c.symbol, c.rank, c.regime, c.strength])).toEqual([
      ["UPUSDT", 1, "long_buildup", "strong_buying"],
      ["DNUSDT", 2, "short_buildup", "strong_selling"],
      ["FLATUSDT", 3, "neutral", "neutral"],
    ]);
    expect(w.coins[0]?.netFlowUsd).toBeCloseTo(288 * 20, 6);
    expect(w.coins[0]?.funding).toBe(0.0001);
    expect(w.coins[2]?.funding).toBeNull();
    const h4 = saved.get("orderflow:4h") as OrderflowWindowSnapshot;
    expect(h4.coins[0]?.relVolume).toBeCloseTo(1, 9);
    const vw = saved.get(VWAP_KEY) as { vwap: Record<string, number> };
    // Every candle trades 1 coin for $100, so today's VWAP is exactly 100.
    expect(vw.vwap.FLATUSDT).toBeCloseTo(100, 9);
  });

  it("keeps the old snapshot when too few coins answer", async () => {
    const { db, saved } = fakeDb();
    await expect(
      runOrderflow({
        db,
        config: { binance: { fetch: fakeFetch(["UPUSDT", "DNUSDT"]) } },
        now: () => NOW,
      }),
    ).rejects.toThrow(/only 1 of 3/);
    expect(saved.size).toBe(0);
  });
});

describe("runOrderflowFast (1-minute scan)", () => {
  it("fills 5m–1H from 1-minute candles and live open interest, and joins everything for scalping", async () => {
    const { db, saved } = fakeDb();
    const { redis, sets } = fakeRedis();
    const config = { binance: { fetch: fakeFetch() } };
    await runOrderflow({ db, config, now: () => NOW });
    const res = await runOrderflowFast({ db, redis, config, now: () => NOW });
    expect(res).toMatchObject({ coins: 3, failed: 0, books: 3 });
    for (const w of ["5m", "15m", "30m", "1h"]) expect(saved.has(`orderflow:${w}`)).toBe(true);
    const m5 = saved.get("orderflow:5m") as OrderflowWindowSnapshot;
    expect(m5.coins[0]).toMatchObject({ symbol: "UPUSDT", strength: "buying" });
    expect(m5.coins[0]?.buyPressurePct).toBeCloseTo(20, 9);
    // Open interest history was seeded from the 5-minute history, then the live reading added.
    expect(sets.get("of:oi:UPUSDT")?.size).toBeGreaterThan(10);
    const h1 = saved.get("orderflow:1h") as OrderflowWindowSnapshot;
    expect(h1.coins[0]?.oiChangePct).not.toBeNull();

    const scalp = saved.get("scalp:latest") as ScalpSnapshot;
    expect(scalp.coins.map((c) => c.symbol)).toEqual(["UPUSDT", "DNUSDT", "FLATUSDT"]);
    const up = scalp.coins[0];
    expect(Object.keys(up?.frames ?? {}).sort()).toEqual(
      ["15m", "1h", "24h", "30m", "4h", "5m"].sort(),
    );
    expect(up?.frames["5m"]?.strength).toBe("buying");
    expect(up?.frames["24h"]?.strength).toBe("strong_buying");
    const flat = scalp.coins[2];
    expect(flat?.vwapDistPct).toBeCloseTo(0, 9);
    // Book: $999.90 bid vs $200.02 ask within 0.05%; reach is 1% on both sides.
    expect(up?.book?.bands.map((b) => b.pct)).toEqual([0.05, 0.1, 0.25, 0.5, 1]);
    expect(up?.book?.bands[0]?.bidUsd).toBeCloseTo(999.9, 9);
    expect(up?.book?.bands[0]?.askUsd).toBeCloseTo(200.02, 9);
  });

  it("leaves 4H and 1D out of the scalping view when the 5-minute scan is stale", async () => {
    const { db, saved } = fakeDb();
    const { redis } = fakeRedis();
    const config = { binance: { fetch: fakeFetch() } };
    await runOrderflow({ db, config, now: () => NOW - 30 * M1 });
    resetOrderflowCache();
    await runOrderflowFast({ db, redis, config, now: () => NOW });
    const scalp = saved.get("scalp:latest") as ScalpSnapshot;
    expect(scalp.coins[0]?.frames["4h"]).toBeUndefined();
    expect(scalp.coins[0]?.vwap).toBeNull();
  });

  it("reuses the coin list for 5 minutes", async () => {
    const { db } = fakeDb();
    const { redis } = fakeRedis();
    const calls: string[] = [];
    const config = { binance: { fetch: fakeFetch([], calls) } };
    await runOrderflowFast({ db, redis, config, now: () => NOW });
    await runOrderflowFast({ db, redis, config, now: () => NOW + M1 });
    expect(calls.filter((c) => c === "/fapi/v1/ticker/24hr")).toHaveLength(1);
  });
});
