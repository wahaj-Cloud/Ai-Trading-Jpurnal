import { describe, expect, it } from "vitest";
import { buildLiquidationMap, combineOi, type MapCandle } from "./liquidation-map.js";

const H = 3_600_000;
const flat = (i: number, o: Partial<MapCandle> = {}): MapCandle => ({
  t: i * H,
  h: 100.5,
  l: 99.5,
  c: 100,
  takerBuyShare: 0.5,
  ...o,
});
const mix = [
  { leverage: 10, weight: 0.5 },
  { leverage: 50, weight: 0.5 },
];

describe("combineOi", () => {
  it("adds each exchange's own changes and ignores its first reading", () => {
    const candles = [flat(0), flat(1), flat(2)];
    const r = combineOi(
      candles,
      {
        a: [
          { t: 0, oi: 100 },
          { t: H, oi: 110 },
          { t: 2 * H, oi: 105 },
        ],
        // Starts late, with a gap: its first point is a baseline, not new positions.
        b: [
          { t: H + 5, oi: 50 },
          { t: 2 * H + 5, oi: 70 },
        ],
      },
      H,
    );
    expect(r.delta).toEqual([0, 10, 15]);
    expect(r.total).toEqual([100, 160, 175]);
  });
});

describe("buildLiquidationMap", () => {
  const oi = {
    x: [
      { t: 0, oi: 1000 },
      { t: H, oi: 1010 },
      { t: 2 * H, oi: 1010 },
      { t: 3 * H, oi: 1010 },
    ],
  };

  it("places new longs below and shorts above, by taker share", () => {
    const m = buildLiquidationMap({
      candles: [flat(0), flat(1, { takerBuyShare: 1 }), flat(2), flat(3)],
      oi,
      bucketMs: H,
      bins: 400,
      leverageMix: mix,
      maintenanceMargin: 0,
    });
    expect(m).not.toBeNull();
    // All 10 new coins (~$1,000) went long: 10x at ~90, 50x at ~98.
    expect(m?.totalShortUsd).toBe(0);
    expect(m?.totalLongUsd).toBeCloseTo(1000, 0);
    const prices = m?.clusters.map((c) => Math.round(c.price)).sort();
    expect(prices).toEqual([90, 98]);
    expect(m?.clusters.every((c) => c.side === "long")).toBe(true);
  });

  it("removes levels price trades through, keeps the rest", () => {
    const m = buildLiquidationMap({
      candles: [flat(0), flat(1, { takerBuyShare: 1 }), flat(2, { l: 95 }), flat(3)],
      oi,
      bucketMs: H,
      bins: 400,
      leverageMix: mix,
      maintenanceMargin: 0,
    });
    // The dip to 95 liquidated the 50x longs (~98); the 10x longs (~90) remain.
    expect(m?.totalLongUsd).toBeCloseTo(500, 0);
    expect(m?.clusters.map((c) => Math.round(c.price))).toEqual([90]);
  });

  it("shrinks remaining levels when open interest falls", () => {
    const m = buildLiquidationMap({
      candles: [flat(0), flat(1, { takerBuyShare: 0 }), flat(2), flat(3)],
      oi: {
        x: [
          { t: 0, oi: 1000 },
          { t: H, oi: 1010 },
          { t: 2 * H, oi: 505 },
          { t: 3 * H, oi: 505 },
        ],
      },
      bucketMs: H,
      bins: 400,
      leverageMix: mix,
      maintenanceMargin: 0,
    });
    // Half the open interest closed, so half the shorts' value remains.
    expect(m?.totalShortUsd).toBeCloseTo(500, 0);
  });

  it("encodes intensity on a square-root scale, column by column", () => {
    const m = buildLiquidationMap({
      candles: [flat(0), flat(1, { takerBuyShare: 1 }), flat(2), flat(3)],
      oi,
      bucketMs: H,
      bins: 400,
      leverageMix: mix,
    });
    if (!m) throw new Error("no map");
    const column = (i: number) => m.cells.slice(i * m.bins, (i + 1) * m.bins);
    expect(Math.max(...column(0))).toBe(0);
    expect(Math.max(...column(3))).toBe(255);
    expect(m.cells.length).toBe(4 * 400);
  });

  it("needs at least two candles", () => {
    expect(buildLiquidationMap({ candles: [flat(0)], oi, bucketMs: H })).toBeNull();
  });
});
