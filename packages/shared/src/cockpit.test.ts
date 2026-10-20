import { describe, expect, it } from "vitest";
import { buildScalpReadout, nearestLevels, type ReadoutInput } from "./cockpit.js";
import type { ScalpCoinDto, ScalpFrameDto } from "./scalp.js";

const NOW = Date.UTC(2026, 9, 19, 14, 0);
const frame = (p: Partial<ScalpFrameDto>): ScalpFrameDto => ({
  strength: "neutral",
  buyPressurePct: 0,
  netFlowUsd: 0,
  priceChangePct: 0,
  oiChangePct: 0,
  relVolume: 1,
  regime: "neutral",
  ...p,
});
function coin(p: Partial<ScalpCoinDto> = {}): ScalpCoinDto {
  return {
    symbol: "XAUUSDT",
    rank: 5,
    price: 4000,
    vwap: 3990,
    vwapDistPct: (4000 / 3990 - 1) * 100,
    funding: 0.0001,
    frames: {
      "5m": frame({
        strength: "strong_buying",
        buyPressurePct: 30,
        regime: "long_buildup",
        relVolume: 3,
      }),
      "15m": frame({ strength: "buying", buyPressurePct: 9 }),
      "30m": frame({ strength: "selling", buyPressurePct: -7 }),
      "1h": frame({ strength: "neutral", buyPressurePct: 1 }),
    },
    book: {
      asOf: new Date(NOW).toISOString(),
      mid: 4000,
      spreadBps: 6,
      bands: [{ pct: 0.25, bidUsd: 70, askUsd: 30, imbalancePct: 40 }],
      walls: [],
    },
    levels: {
      dayHigh: 4002,
      dayLow: 3950,
      asiaHigh: 3990,
      asiaLow: 3960,
      asiaOpen: false,
      high24h: 4050,
      low24h: 3900,
    },
    volatility: { atr5m: 6, atr15m: 10, atr1h: 20, rangeRatio: 2.2, activity: "very_active" },
    ...p,
  };
}
const input = (p: Partial<ReadoutInput> = {}): ReadoutInput => ({
  tf: "5m",
  coin: coin(),
  now: NOW,
  computedAt: new Date(NOW - 30_000).toISOString(),
  events: [],
  hotHeadlines: 0,
  whales: { buyUsd: 900_000, sellUsd: 100_000, buys: 3, sells: 1 },
  liquidations: { longUsd: 10_000, shortUsd: 50_000 },
  bias1h: "down",
  ...p,
});

describe("buildScalpReadout", () => {
  it("reads every source by its rule and counts the leans", () => {
    const r = buildScalpReadout(input());
    const lean = Object.fromEntries(r.rows.map((x) => [x.key, x.lean]));
    expect(lean).toEqual({
      strength_5m: "up",
      strength_15m: "up",
      strength_1h: "neutral",
      regime: "up",
      funding: "neutral",
      vwap: "up", // +0.25%
      book: "up", // +40%
      whales: "up", // (0.9 − 0.1) / 1.0 = 0.8
      liquidations: "up", // shorts 5× longs
      bias_1h: "down",
    });
    expect(r.tally).toEqual({ up: 7, down: 1, neutral: 2 });
    const flags = r.flags.map((f) => f.key);
    expect(flags).toEqual(["volume", "spread", "activity", "near_today's high"]);
  });

  it("uses 15m, 30m and 1H for the 15-minute view", () => {
    const r = buildScalpReadout(input({ tf: "15m" }));
    expect(r.rows.filter((x) => x.group === "flow").map((x) => [x.key, x.lean])).toEqual([
      ["strength_15m", "up"],
      ["strength_30m", "down"],
      ["strength_1h", "neutral"],
    ]);
  });

  it("applies edges inclusively and treats empty flow as neutral", () => {
    const c = coin({
      vwapDistPct: -0.05,
      funding: 0.00031,
      book: {
        asOf: "",
        mid: 1,
        spreadBps: 1,
        bands: [{ pct: 0.1, bidUsd: 40, askUsd: 60, imbalancePct: -20 }],
        walls: [],
      },
      volatility: { atr5m: null, atr15m: null, atr1h: null, rangeRatio: null, activity: null },
    });
    const r = buildScalpReadout(
      input({
        coin: c,
        whales: { buyUsd: 0, sellUsd: 0, buys: 0, sells: 0 },
        liquidations: { longUsd: 0, shortUsd: 0 },
        bias1h: "range",
      }),
    );
    const lean = Object.fromEntries(r.rows.map((x) => [x.key, x.lean]));
    expect(lean.vwap).toBe("down");
    expect(lean.funding).toBe("down");
    expect(lean.book).toBe("down"); // falls back to the widest band the book reaches
    expect(lean.whales).toBe("neutral");
    expect(lean.liquidations).toBe("neutral");
    expect(lean.bias_1h).toBe("neutral");
  });

  it("warns around releases, fresh headlines and stale data", () => {
    const r = buildScalpReadout(
      input({
        events: [
          {
            title: "CPI m/m",
            currency: "USD",
            startsAt: new Date(NOW + 20 * 60_000).toISOString(),
          },
          { title: "PPI", currency: "USD", startsAt: new Date(NOW + 31 * 60_000).toISOString() },
          { title: "NFP", currency: "USD", startsAt: new Date(NOW - 15 * 60_000).toISOString() },
        ],
        hotHeadlines: 2,
        computedAt: new Date(NOW - 4 * 60_000).toISOString(),
      }),
    );
    const high = r.flags.filter((f) => f.level === "high").map((f) => f.key);
    expect(high).toEqual(["event_CPI m/m", "event_NFP", "headlines", "stale"]);
  });
});

describe("nearestLevels", () => {
  it("finds the closest level on each side", () => {
    const n = nearestLevels(coin());
    expect(n.above).toMatchObject({ label: "Today's high", price: 4002 });
    expect(n.above?.distPct).toBeCloseTo(0.05, 9);
    expect(n.below).toMatchObject({ label: "Asia high", price: 3990 }); // ties with VWAP: first listed
  });
});
