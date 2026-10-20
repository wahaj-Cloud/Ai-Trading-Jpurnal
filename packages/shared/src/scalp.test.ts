import { describe, expect, it } from "vitest";
import type { DeltaCandle } from "./orderflow.js";
import {
  aggregate,
  atr,
  bookPressure,
  classifyActivity,
  mergeLevels,
  scalpLevels,
  sessionAt,
  shortTermAlignment,
  shortVolatility,
  trueRanges,
} from "./scalp.js";

const at = new Date("2026-10-19T12:00:00Z");

describe("bookPressure", () => {
  it("sums dollar value per band, measures the spread and finds walls", () => {
    // Mid 100. Bids every 0.01 down to 99.00, asks up to 101.00; one big bid at 99.80.
    const bids: Array<[number, number]> = [];
    const asks: Array<[number, number]> = [];
    for (let i = 0; i <= 100; i++) {
      const bp = Math.round((99.99 - i * 0.01) * 100) / 100;
      bids.push([bp, bp === 99.8 ? 100 : 1]);
      asks.push([Math.round((100.01 + i * 0.01) * 100) / 100, 2]);
    }
    const b = bookPressure(bids, asks, at);
    expect(b?.mid).toBe(100);
    expect(b?.spreadBps).toBeCloseTo(2, 9);
    // Reach: bids to 98.99 (1.01%), asks to 101.01: every band fits.
    expect(b?.bands.map((x) => x.pct)).toEqual([0.05, 0.1, 0.25, 0.5, 1]);
    const b01 = b?.bands[1];
    // Within 0.1%: bids 99.90…99.99 (10 levels), asks 100.01…100.10 (10 levels).
    const bidUsd = bids.filter(([p]) => p >= 99.9).reduce((s, [p, q]) => s + p * q, 0);
    const askUsd = asks.filter(([p]) => p <= 100.1).reduce((s, [p, q]) => s + p * q, 0);
    expect(b01?.bidUsd).toBeCloseTo(bidUsd, 9);
    expect(b01?.askUsd).toBeCloseTo(askUsd, 9);
    expect(b01?.imbalancePct).toBeCloseTo(((bidUsd - askUsd) / (bidUsd + askUsd)) * 100, 9);
    expect(b?.walls).toHaveLength(1);
    expect(b?.walls[0]).toMatchObject({ side: "bid", price: 99.8 });
    expect(b?.walls[0]?.distPct).toBeCloseTo(0.2, 9);
  });

  it("only reports bands the book reaches on both sides", () => {
    const b = bookPressure(
      [
        [99.99, 1],
        [99.9, 1],
      ],
      [
        [100.01, 1],
        [100.5, 1],
      ],
      at,
    );
    expect(b?.bands.map((x) => x.pct)).toEqual([0.05, 0.1]); // bids reach exactly 0.1%
  });

  it("rejects empty or crossed books", () => {
    expect(bookPressure([], [[1, 1]], at)).toBeNull();
    expect(bookPressure([[2, 1]], [[1, 1]], at)).toBeNull();
  });
});

describe("shortTermAlignment", () => {
  it("counts the short timeframes leaning each way", () => {
    const f = (strength: "buying" | "strong_buying" | "neutral" | "selling") =>
      ({ strength }) as never;
    expect(
      shortTermAlignment({
        "5m": f("strong_buying"),
        "15m": f("buying"),
        "30m": f("neutral"),
        "4h": f("selling"),
      }),
    ).toEqual({ buying: 2, selling: 0, of: 3 });
  });
});

const M1 = 60_000;
const c = (t: number, o: number, h: number, l: number, cl: number): DeltaCandle => ({
  t,
  o,
  h,
  l,
  c: cl,
  base: 1,
  quote: 1,
  takerBuyQuote: 0.5,
});

describe("aggregate and ATR", () => {
  it("joins aligned 1-minute candles into full 5-minute bars only", () => {
    // Starts at minute 3: minutes 3–4 are an incomplete bar and are dropped.
    const m = Array.from({ length: 12 }, (_, i) =>
      c((i + 3) * M1, 100 + i, 101 + i, 99 + i, 100.5 + i),
    );
    const bars = aggregate(m, M1, 5);
    expect(bars).toEqual([
      { t: 5 * M1, o: 102, c: 106.5, h: 107, l: 101 },
      { t: 10 * M1, o: 107, c: 111.5, h: 112, l: 106 },
    ]);
  });

  it("true range uses the previous close when price gaps", () => {
    const bars = [
      { h: 10, l: 9, c: 9.5 },
      { h: 12, l: 11, c: 11.5 }, // gap up: 12 − 9.5
      { h: 11, l: 8, c: 8.5 }, // low 3.5 under the previous close
    ];
    expect(trueRanges(bars)).toEqual([2.5, 3.5]);
    expect(atr(bars, 2)).toBe(3);
    expect(atr(bars, 3)).toBeNull();
  });

  it("rates activity from the recent range against the usual one", () => {
    expect(classifyActivity(0.69)).toBe("quiet");
    expect(classifyActivity(0.7)).toBe("normal");
    expect(classifyActivity(1.3)).toBe("active");
    expect(classifyActivity(2)).toBe("very_active");
  });

  it("finds 5m and 15m ranges and a busier last 30 minutes", () => {
    // 4 hours of 1-minute candles with a 0.2 range; the last 30 minutes have a 0.8 range.
    const m = Array.from({ length: 240 }, (_, i) =>
      i >= 210 ? c(i * M1, 100, 100.4, 99.6, 100) : c(i * M1, 100, 100.1, 99.9, 100),
    );
    const v = shortVolatility(m);
    // Last 14 five-minute bars: 8 quiet (0.2) and 6 busy (0.8).
    expect(v.atr5m).toBeCloseTo((8 * 0.2 + 6 * 0.8) / 14, 9);
    expect(v.atr15m).toBeCloseTo((12 * 0.2 + 2 * 0.8) / 14, 9);
    // 5-minute true ranges: 41 of 0.2 then 6 of 0.8 (47 in all, the first bar has none).
    expect(v.rangeRatio).toBeCloseTo(0.8 / ((41 * 0.2 + 6 * 0.8) / 47), 9);
    expect(v.activity).toBe("very_active");
  });
});

describe("levels", () => {
  const day = Date.UTC(2026, 9, 19);
  const H = 3_600_000;
  it("separates today, the Asia session and the last 24 hours", () => {
    const candles = [
      c(day - 10 * H, 100, 130, 90, 100), // yesterday, inside 24h
      c(day + 1 * H, 100, 105, 98, 101), // Asia
      c(day + 6 * H, 101, 103, 97, 102), // Asia
      c(day + 9 * H, 102, 110, 100, 108), // London
    ];
    const l = scalpLevels(candles, day + 10 * H);
    expect(l).toEqual({
      dayHigh: 110,
      dayLow: 97,
      asiaHigh: 105,
      asiaLow: 97,
      asiaOpen: false,
      high24h: 130,
      low24h: 90,
    });
    expect(scalpLevels(candles, day + 3 * H)?.asiaOpen).toBe(true);
    expect(scalpLevels(candles.slice(0, 1), day + H)).toBeNull();
  });

  it("merges fresher highs and lows into the day's levels", () => {
    const a = {
      dayHigh: 10,
      dayLow: 5,
      asiaHigh: 8,
      asiaLow: 6,
      asiaOpen: false,
      high24h: 12,
      low24h: 4,
    };
    const b = {
      dayHigh: 11,
      dayLow: 6,
      asiaHigh: null,
      asiaLow: null,
      asiaOpen: false,
      high24h: 11,
      low24h: 5,
    };
    expect(mergeLevels(a, b)).toEqual({ ...a, dayHigh: 11 });
    expect(mergeLevels(null, b)).toBe(b);
  });

  it("names the session from UTC hours", () => {
    expect(sessionAt(new Date(Date.UTC(2026, 9, 19, 6, 59))).id).toBe("ASIA");
    expect(sessionAt(new Date(Date.UTC(2026, 9, 19, 7))).id).toBe("LONDON");
    expect(sessionAt(new Date(Date.UTC(2026, 9, 19, 14))).label).toMatch(/overlap/);
    expect(sessionAt(new Date(Date.UTC(2026, 9, 19, 21))).id).toBe("OFF_HOURS");
  });
});
