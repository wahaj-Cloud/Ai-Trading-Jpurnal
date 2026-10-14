import { describe, expect, it } from "vitest";
import { bollinger, heikinAshi, macd } from "./indicators.js";

describe("bollinger", () => {
  it("is the average ± 2 standard deviations", () => {
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(b.mid[7]).toBe(5);
    expect(b.upper[7]).toBe(9);
    expect(b.lower[7]).toBe(1);
    expect(b.upper[6]).toBeNull();
  });
});

describe("macd", () => {
  it("is zero on a flat series and starts once the slow EMA exists", () => {
    const m = macd(new Array(40).fill(10), 12, 26, 9);
    expect(m.macd[24]).toBeNull();
    expect(m.macd[25]).toBe(0);
    expect(m.signal[33]).toBe(0);
    expect(m.signal[32]).toBeNull();
    expect(m.hist[39]).toBe(0);
  });
  it("is positive in an uptrend", () => {
    const m = macd(
      Array.from({ length: 60 }, (_, i) => 100 + i),
      12,
      26,
      9,
    );
    expect(m.macd[59]).toBeGreaterThan(0);
  });
});

describe("heikinAshi", () => {
  it("averages each candle and chains opens", () => {
    const ha = heikinAshi([
      { t: 0, o: 10, h: 12, l: 9, c: 11, v: 1 },
      { t: 1, o: 11, h: 14, l: 10, c: 13, v: 1 },
    ]);
    expect(ha[0]).toMatchObject({ o: 10.5, c: 10.5, h: 12, l: 9 });
    expect(ha[1]?.o).toBe(10.5);
    expect(ha[1]?.c).toBe(12);
  });
});
