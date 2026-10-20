import { describe, expect, it } from "vitest";
import { calibrate, percentile } from "./calibration.js";
import type { ReadoutRecord } from "./scalp-alerts.js";

const rec = (p5: number, price: number): ReadoutRecord => [0, 0, 0, 0, 0, 0, p5, p5, p5, p5, price];

describe("percentile", () => {
  it("uses the nearest rank", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(v, 50)).toBe(5);
    expect(percentile(v, 90)).toBe(9);
    expect(percentile(v, 95)).toBe(10);
  });
});

describe("calibrate", () => {
  it("measures the spread, the label shares and the price 15 minutes later", () => {
    const M = 60_000;
    // BTC every 5 minutes: pressure cycles 0, 12, −30, 4; price rises 1% after the +12 readings.
    const rows = Array.from({ length: 8 }, (_, i) => ({
      at: i * 5 * M,
      data: {
        BTCUSDT: rec([0, 12, -30, 4][i % 4] as number, 100 + i),
        XAUUSDT: rec(1, 4000),
      },
    }));
    const c = calibrate(rows);
    expect(c.minutes).toBe(8);
    const crypto5 = c.groups[0]?.windows[0];
    expect(crypto5?.samples).toBe(8);
    // |values| sorted: 0,0,4,4,12,12,30,30
    expect(crypto5?.absPercentiles).toEqual({ p50: 4, p75: 12, p90: 30, p95: 30 });
    expect(crypto5?.shareNow).toEqual({
      strong_selling: 0.25,
      selling: 0,
      neutral: 0.5,
      buying: 0.25,
      strong_buying: 0,
    });
    expect(crypto5?.suggested).toEqual({ lean: 4, strong: 30 });
    // "Buying" at i = 1 and 5; 15 minutes later is i = 4 and (none: i = 8 missing).
    const buying = crypto5?.forward15m.find((f) => f.strength === "buying");
    expect(buying?.samples).toBe(1);
    expect(buying?.avgPct).toBeCloseTo((104 / 101 - 1) * 100, 9);
    expect(buying?.upShare).toBe(1);
    const metals = c.groups[1]?.windows[0];
    expect(metals?.samples).toBe(8);
    expect(metals?.shareNow.neutral).toBe(1);
  });
});
