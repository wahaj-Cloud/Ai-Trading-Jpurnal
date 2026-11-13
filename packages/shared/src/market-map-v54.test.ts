import { describe, expect, it } from "vitest";
import { cardCandlesTtlMs } from "./coin-candles.js";
import { replayCoins, sectorSymbols, seriesPointTime } from "./market-map.js";
import { downsample, ORDERFLOW_SPEC } from "./orderflow.js";
import { setupInputSchema, setupPatchSchema } from "./setups.js";
import { cardZones, currentZoneSets, nearestCardZone, type ZoneSet } from "./zones.js";

const coin = (symbol: string, path: number[]) => ({
  symbol,
  priceChangePct: path.at(-1) ?? 0,
  volumeUsd: 1,
  path,
});

describe("replay", () => {
  it("reads every coin's move a number of points back, aligned at now", () => {
    const coins = [coin("A", [0, 1, 2, 3]), coin("B", [0, -1, -2]), coin("C", [5])];
    expect(replayCoins(coins, 0).map((c) => c.priceChangePct)).toEqual([3, -2, 5]);
    expect(replayCoins(coins, 1).map((c) => [c.symbol, c.priceChangePct])).toEqual([
      ["A", 2],
      ["B", -1],
    ]);
    expect(replayCoins(coins, 3).map((c) => c.symbol)).toEqual(["A"]);
  });

  it("times each series point at its candle's close", () => {
    const asOf = Date.UTC(2026, 9, 23, 12, 0);
    for (const w of ["5m", "1h", "4h", "24h"] as const) {
      const { candles, candleMs } = ORDERFLOW_SPEC[w];
      const closes = Array.from({ length: candles }, (_, i) => asOf - (candles - 1 - i) * candleMs);
      const kept = downsample(closes, 60);
      kept.forEach((t, i) => {
        expect(seriesPointTime(w, asOf, i, kept.length)).toBe(t);
      });
    }
  });
});

describe("sector setups", () => {
  const listings = [
    { symbol: "FETUSDT", quoteVolume: 5 },
    { symbol: "TAOUSDT", quoteVolume: 9 },
    { symbol: "DOGEUSDT", quoteVolume: 100 },
    { symbol: "1000PEPEUSDT", quoteVolume: 50 },
    { symbol: "RENDERUSDT", quoteVolume: 9 },
    { symbol: "FETUSDC", quoteVolume: 99 },
  ];
  it("lists a sector's coins, most traded first, capped", () => {
    expect(sectorSymbols("ai", listings)).toEqual(["RENDERUSDT", "TAOUSDT", "FETUSDT"]);
    expect(sectorSymbols("ai", listings, 2)).toEqual(["RENDERUSDT", "TAOUSDT"]);
    expect(sectorSymbols("memes", listings)).toEqual(["DOGEUSDT", "1000PEPEUSDT"]);
  });

  const base = {
    name: "AI longs",
    timeframe: "1h",
    rule: {
      version: 1,
      direction: "long",
      all: [{ type: "ema_trend", fast: 5, slow: 20, direction: "up" }],
    },
  };
  it("accepts coins, sectors or both, but not neither", () => {
    expect(setupInputSchema.parse({ ...base, symbols: [], sectors: ["ai", "ai"] }).sectors).toEqual(
      ["ai"],
    );
    expect(setupInputSchema.parse({ ...base, symbols: ["BTCUSDT"] }).sectors).toEqual([]);
    expect(setupInputSchema.safeParse({ ...base, symbols: [] }).success).toBe(false);
    expect(setupInputSchema.safeParse({ ...base, symbols: [], sectors: ["other"] }).success).toBe(
      false,
    );
    expect(
      setupInputSchema.safeParse({ ...base, symbols: [], sectors: ["ai", "memes", "defi", "rwa"] })
        .success,
    ).toBe(false);
  });
  it("a patch changes only what it names (no defaults filled in)", () => {
    expect(setupPatchSchema.parse({ name: "x" })).toEqual({ name: "x" });
    expect(setupPatchSchema.safeParse({ symbols: [], sectors: [] }).success).toBe(false);
    expect(setupPatchSchema.parse({ symbols: [] })).toEqual({ symbols: [] });
  });
});

describe("zones on market-map cards", () => {
  const now = Date.UTC(2026, 9, 23, 12, 0);
  const set = (asOfAgoH: number, zones: ZoneSet["zones"]): ZoneSet => ({
    asOf: new Date(now - asOfAgoH * 3_600_000).toISOString(),
    zones,
  });
  const z = (side: "supply" | "demand", bottom: number, top: number, tests = 0) => ({
    side,
    bottom,
    top,
    tests,
    t: bottom,
  });
  it("drops records three candles late", () => {
    const sets = currentZoneSets({ "1h": set(4, []), "4h": set(11, []) }, now);
    expect(Object.keys(sets)).toEqual(["4h"]);
    expect(currentZoneSets({ "1h": set(2, []), "4h": set(13, []) }, now)).toHaveProperty("1h");
  });
  it("picks the nearest supply above and demand below across 1H and 4H", () => {
    const m = {
      "1h": set(0, [z("supply", 102, 103, 1), z("demand", 95, 96), z("supply", 90, 91)]),
      "4h": set(0, [z("supply", 101, 101.5), z("demand", 97, 98, 2)]),
    };
    expect(cardZones(m, 100)).toEqual({
      supply: { tf: "4h", top: 101.5, bottom: 101, fresh: true },
      demand: { tf: "4h", top: 98, bottom: 97, fresh: false },
    });
    // Equal distance: the higher timeframe.
    const tie = { "1h": set(0, [z("supply", 101, 102)]), "4h": set(0, [z("supply", 101, 105)]) };
    expect(cardZones(tie, 100).supply?.tf).toBe("4h");
  });
  it("the card shows the nearer zone from the live price", () => {
    const zones = cardZones({ "1h": set(0, [z("supply", 102, 103), z("demand", 97, 99)]) }, 100);
    const near = nearestCardZone(zones, 100);
    expect(near?.side).toBe("demand");
    expect(near?.distPct).toBeCloseTo(-1, 12);
    expect(nearestCardZone(zones, 101.5)?.side).toBe("supply");
    expect(nearestCardZone(zones, 98)).toMatchObject({ side: "demand", distPct: 0 });
    expect(nearestCardZone(undefined, 100)).toBeNull();
  });
});

describe("coin-card candles cache", () => {
  it("lasts until just after the next close, at least 5 seconds", () => {
    const t = Date.UTC(2026, 9, 23, 10, 7, 30);
    expect(cardCandlesTtlMs("15m", t)).toBe(7 * 60_000 + 30_000 + 3_000);
    expect(cardCandlesTtlMs("1h", t)).toBe(52 * 60_000 + 30_000 + 3_000);
    expect(cardCandlesTtlMs("15m", Date.UTC(2026, 9, 23, 10, 14, 59, 999))).toBe(5_000);
  });
});
