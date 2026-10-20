import { describe, expect, it } from "vitest";
import type { OrderflowCoinDto } from "./orderflow.js";
import {
  alignmentOf,
  breadthPct,
  coinRead,
  divergenceOf,
  fundingStateOf,
  marketLean,
  marketRead,
  relVolumeText,
} from "./orderflow-read.js";

const coin = (p: Partial<OrderflowCoinDto>): OrderflowCoinDto => ({
  symbol: "BTCUSDT",
  rank: 1,
  price: 100,
  volumeUsd: 1e6,
  priceChangePct: 0,
  oiChangePct: 0,
  oiChangeUsd: 0,
  netFlowUsd: 0,
  buyPressurePct: 0,
  regime: "neutral",
  strength: "neutral",
  relVolume: 1,
  funding: 0.0001,
  series: { pressure: [], price: [], oi: null },
  ...p,
});

describe("market breadth and lean", () => {
  it("needs 60% of coins and the dollar total on the same side", () => {
    expect(breadthPct(0, 0)).toBeNull();
    expect(breadthPct(60, 40)).toBe(60);
    expect(marketLean(60, 40, 1)).toBe("up");
    expect(marketLean(59, 41, 1)).toBe("mixed");
    expect(marketLean(70, 30, -1)).toBe("mixed"); // many small coins buying, big ones selling
    expect(marketLean(40, 60, -5)).toBe("down");
    expect(marketLean(0, 0, 0)).toBe("mixed");
  });
});

describe("absorption", () => {
  // 5m: price moves under 0.15% are flat; buying from 10%, strong from 25%.
  it("price against the market orders", () => {
    expect(divergenceOf({ priceChangePct: 0.15, buyPressurePct: -10 }, "5m")).toBe("up_on_selling");
    expect(divergenceOf({ priceChangePct: 0.14, buyPressurePct: -10 }, "5m")).toBeNull();
    expect(divergenceOf({ priceChangePct: 0.2, buyPressurePct: -9.9 }, "5m")).toBeNull();
    expect(divergenceOf({ priceChangePct: -0.3, buyPressurePct: 12 }, "5m")).toBe("down_on_buying");
  });
  it("strong pressure that did not move price", () => {
    expect(divergenceOf({ priceChangePct: 0.1, buyPressurePct: 25 }, "5m")).toBe("buying_absorbed");
    expect(divergenceOf({ priceChangePct: 0.1, buyPressurePct: 24 }, "5m")).toBeNull();
    expect(divergenceOf({ priceChangePct: -0.1, buyPressurePct: -30 }, "5m")).toBe(
      "selling_absorbed",
    );
    // A real move with the pressure is not absorption.
    expect(divergenceOf({ priceChangePct: 0.5, buyPressurePct: 30 }, "5m")).toBeNull();
  });
  it("uses each window's own sizes", () => {
    // 1D: price moves under 1.5% are flat, buying from 2%.
    expect(divergenceOf({ priceChangePct: 1.4, buyPressurePct: -3 }, "24h")).toBeNull();
    expect(divergenceOf({ priceChangePct: 1.5, buyPressurePct: -2 }, "24h")).toBe("up_on_selling");
  });
});

describe("funding", () => {
  it("matches the Scalp Cockpit thresholds", () => {
    expect(fundingStateOf(null)).toBeNull();
    expect(fundingStateOf(0.0003)).toBe("longs_crowded");
    expect(fundingStateOf(0.00029)).toBeNull();
    expect(fundingStateOf(-0.0001)).toBe("shorts_crowded");
    expect(fundingStateOf(-0.00009)).toBeNull();
  });
});

describe("relative volume text", () => {
  it("rounds down so 2.5× always means unusual", () => {
    expect(relVolumeText(2.49)).toBe("2.4×");
    expect(relVolumeText(2.5)).toBe("2.5×");
    expect(relVolumeText(0.3)).toBe("0.3×");
    expect(relVolumeText(1)).toBe("1.0×");
  });
});

describe("timeframe alignment", () => {
  const cell = (s: OrderflowCoinDto["strength"]) => ({ p: 0, s, r: "neutral" as const });
  it("5m, 15m and 1H", () => {
    expect(
      alignmentOf({ "5m": cell("buying"), "15m": cell("strong_buying"), "1h": cell("buying") }),
    ).toBe("up");
    expect(
      alignmentOf({ "5m": cell("selling"), "15m": cell("selling"), "1h": cell("strong_selling") }),
    ).toBe("down");
    expect(
      alignmentOf({ "5m": cell("buying"), "15m": cell("neutral"), "1h": cell("selling") }),
    ).toBe("conflict");
    expect(alignmentOf({ "5m": cell("buying"), "15m": cell("buying") })).toBe("mixed");
    // Other windows do not count.
    expect(
      alignmentOf({
        "5m": cell("buying"),
        "15m": cell("buying"),
        "1h": cell("buying"),
        "4h": cell("strong_selling"),
      }),
    ).toBe("up");
  });
});

describe("market read", () => {
  it("counts and describes the shown coins", () => {
    const coins = [
      coin({ symbol: "A", regime: "long_buildup", oiChangeUsd: 5e6, relVolume: 3 }),
      coin({ symbol: "B", regime: "long_buildup", oiChangeUsd: 1e6, funding: 0.0005 }),
      coin({ symbol: "C", regime: "short_covering", oiChangeUsd: -2e6, funding: -0.0002 }),
      coin({
        symbol: "D",
        regime: "neutral",
        oiChangePct: null,
        oiChangeUsd: null,
        priceChangePct: 0.5,
        buyPressurePct: -15,
      }),
    ];
    const r = marketRead({ window: "5m", coins, buying: 70, selling: 30, netFlowUsd: 2e6 });
    expect(r.lean).toBe("up");
    expect(r.breadth).toBe(70);
    expect(r.opening).toBe(2);
    expect(r.closing).toBe(1);
    expect(r.oiNetUsd).toBe(4e6);
    expect(r.unusual).toBe(1);
    expect(r.absorbing).toBe(1);
    expect(r.longsCrowded).toBe(1);
    expect(r.shortsCrowded).toBe(1);
    expect(r.headline).toContain("70%");
    const text = r.points.map((p) => p.text).join(" | ");
    expect(text).toContain("70 of 100 coins");
    expect(text).toContain("bought $2M more");
    expect(text).toContain("Open interest rose by $4M");
    expect(text).toContain("Long build-up in 2 coins");
    expect(text).toContain("2 coins are adding positions and 1 are closing");
    // No buy/sell instruction and no forecast wording.
    expect(text).not.toMatch(/\b(buy now|sell now|bullish|bearish|will)\b/i);
  });
  it("handles an empty market", () => {
    const r = marketRead({ window: "1h", coins: [], buying: 0, selling: 0, netFlowUsd: 0 });
    expect(r.lean).toBe("mixed");
    expect(r.oiNetUsd).toBeNull();
    expect(r.points).toEqual([]);
  });
});

describe("coin read", () => {
  it("covers flow, positions, absorption, funding, activity and timeframes", () => {
    const c = coin({
      strength: "selling",
      buyPressurePct: -12,
      priceChangePct: 0.4,
      oiChangePct: 0.6,
      regime: "long_buildup",
      funding: 0.0004,
      relVolume: 2.6,
    });
    const r = coinRead(c, "5m", {
      "5m": { p: -12, s: "selling", r: "long_buildup" },
      "15m": { p: 3, s: "neutral", r: "neutral" },
      "1h": { p: 7, s: "buying", r: "long_buildup" },
    });
    const text = r.map((p) => p.text);
    expect(text[0]).toContain("Selling");
    expect(text[0]).toContain("−12.0%");
    expect(text[1]).toContain("Long build-up");
    expect(text[2]).toContain("limit");
    expect(text[3]).toContain("+0.0400%");
    expect(text[4]).toContain("2.6×");
    expect(text[5]).toContain("pull apart");
    expect(r.map((p) => p.tone)).toEqual(["down", "up", "up", "warn", "warn", "warn"]);
  });
  it("says when open interest is missing", () => {
    const r = coinRead(coin({ oiChangePct: null }), "1h");
    expect(r[1]?.text).toContain("not available");
    expect(r).toHaveLength(2);
  });
});
