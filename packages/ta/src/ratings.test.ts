import { moodOf, ratingLevel } from "@atc/shared";
import { describe, expect, it } from "vitest";
import type { Candle } from "./indicators.js";
import { adx, hma, rma, technicalRatings, wma } from "./ratings.js";

const candles = (closes: number[]): Candle[] =>
  closes.map((c, i) => ({
    t: i * 60_000,
    o: i ? (closes[i - 1] as number) : c,
    h: c * 1.002,
    l: c * 0.998,
    c,
    v: 100,
  }));

describe("rating bands and mood", () => {
  it("uses the published ±0.1 / ±0.5 bands", () => {
    expect(ratingLevel(0.51)).toBe("strong_up");
    expect(ratingLevel(0.5)).toBe("up");
    expect(ratingLevel(0.1)).toBe("neutral");
    expect(ratingLevel(-0.1)).toBe("neutral");
    expect(ratingLevel(-0.11)).toBe("down");
    expect(ratingLevel(-0.51)).toBe("strong_down");
  });
  it("reads ADX 25+ as a trend, under 20 as a range", () => {
    expect(moodOf(25, 30, 10)).toBe("trending_up");
    expect(moodOf(30, 10, 30)).toBe("trending_down");
    expect(moodOf(19.9, 30, 10)).toBe("ranging");
    expect(moodOf(22, 30, 10)).toBe("weak_trend");
  });
});

describe("helpers", () => {
  it("RMA seeds with the simple average, then smooths by 1/n", () => {
    expect(rma([1, 2, 3, 4], 3)).toEqual([null, null, 2, (2 * 2 + 4) / 3]);
  });
  it("WMA weights the newest most; HMA follows a straight line exactly", () => {
    expect(wma([1, 2, 3], 3)).toEqual([null, null, (1 + 4 + 9) / 6]);
    const line = Array.from({ length: 30 }, (_, i) => i);
    expect(hma(line, 9).at(-1)).toBeCloseTo(29, 9);
  });
  it("ADX is high and +DI leads in a steady climb", () => {
    const c = candles(Array.from({ length: 120 }, (_, i) => 100 + i));
    const r = adx(c);
    expect(r.adx.at(-1)).toBeGreaterThan(50);
    expect((r.plus.at(-1) as number) > (r.minus.at(-1) as number)).toBe(true);
  });
});

describe("technicalRatings", () => {
  it("in a steady climb every moving average reads up and the mood is a trend up", () => {
    const r = technicalRatings(
      candles(Array.from({ length: 300 }, (_, i) => 100 * 1.003 ** i)),
      "1h",
    );
    expect(r.movingAverages.down).toBe(0);
    expect(r.movingAverages.up).toBeGreaterThanOrEqual(14);
    expect(r.movingAverages.level).toBe("strong_up");
    expect(r.mood).toBe("trending_up");
    expect(r.summary.up + r.summary.down + r.summary.neutral).toBe(26);
  });
  it("in a steady fall every moving average reads down", () => {
    const r = technicalRatings(
      candles(Array.from({ length: 300 }, (_, i) => 100 * 0.997 ** i)),
      "1h",
    );
    // Hull MA leads price, so on a curved fall it dips just under price: the one exception.
    expect(r.movingAverages.items.filter((x) => x.signal !== -1).map((x) => x.name)).toEqual([
      "Hull MA (9)",
    ]);
    expect(r.movingAverages.level).toBe("strong_down");
    expect(r.mood).toBe("trending_down");
  });
  it("leaves indicators without enough history out of the count", () => {
    const r = technicalRatings(
      candles(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i))),
      "1M",
    );
    const ma200 = r.movingAverages.items.find((x) => x.name === "SMA (200)");
    expect(ma200?.value).toBeNull();
    expect(r.movingAverages.up + r.movingAverages.down + r.movingAverages.neutral).toBeLessThan(15);
  });
});
