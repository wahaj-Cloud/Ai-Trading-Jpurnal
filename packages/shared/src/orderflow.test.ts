import { describe, expect, it } from "vitest";
import {
  classifyRegime,
  classifyStrength,
  type DeltaCandle,
  dayVwap,
  downsample,
  type OrderflowCoinDto,
  orderflowMetrics,
  summarizeWindow,
} from "./orderflow.js";

const M1 = 60_000;
const M5 = 300_000;
function candles(
  n: number,
  step: number,
  f: (i: number) => Partial<DeltaCandle> = () => ({}),
): DeltaCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * step,
    o: 100,
    c: 100,
    base: 10,
    quote: 1000,
    takerBuyQuote: 500,
    ...f(i),
  }));
}

describe("classifyRegime", () => {
  it("names the four combinations of price and open interest", () => {
    expect(classifyRegime(1, 2, "4h")).toBe("long_buildup");
    expect(classifyRegime(-1, 2, "4h")).toBe("short_buildup");
    expect(classifyRegime(1, -2, "4h")).toBe("short_covering");
    expect(classifyRegime(-1, -2, "4h")).toBe("long_unwinding");
  });
  it("treats small moves as no clear flow, with the threshold inclusive", () => {
    expect(classifyRegime(0.59, 5, "4h")).toBe("neutral");
    expect(classifyRegime(0.6, 1, "4h")).toBe("long_buildup");
    expect(classifyRegime(-0.3, -0.5, "1h")).toBe("long_unwinding");
    expect(classifyRegime(0.15, 0.2, "5m")).toBe("long_buildup");
    expect(classifyRegime(0.14, 0.2, "5m")).toBe("neutral");
    expect(classifyRegime(3, 1.99, "24h")).toBe("neutral");
    expect(classifyRegime(3, null, "24h")).toBe("neutral");
  });
});

describe("classifyStrength", () => {
  it("uses wider bands on shorter windows, inclusive at each edge", () => {
    expect(classifyStrength(25, "5m")).toBe("strong_buying");
    expect(classifyStrength(24.99, "5m")).toBe("buying");
    expect(classifyStrength(10, "5m")).toBe("buying");
    expect(classifyStrength(9.99, "5m")).toBe("neutral");
    expect(classifyStrength(-10, "5m")).toBe("selling");
    expect(classifyStrength(-25, "5m")).toBe("strong_selling");
    expect(classifyStrength(5, "24h")).toBe("strong_buying");
    expect(classifyStrength(-2, "24h")).toBe("selling");
    expect(classifyStrength(1.9, "24h")).toBe("neutral");
  });
});

describe("downsample", () => {
  it("keeps the first and last point", () => {
    const v = Array.from({ length: 289 }, (_, i) => i);
    const d = downsample(v, 48);
    expect(d).toHaveLength(48);
    expect(d[0]).toBe(0);
    expect(d.at(-1)).toBe(288);
    expect(downsample([1, 2], 48)).toEqual([1, 2]);
  });
});

describe("orderflowMetrics", () => {
  it("adds up taker flow, price and open interest over a 5-minute window of 1-minute candles", () => {
    // 240 candles (4 hours); the 5m window is the last 5, where takers bought 70% and volume tripled.
    const c = candles(240, M1, (i) =>
      i >= 235
        ? { quote: 3000, takerBuyQuote: 2100, o: i === 235 ? 200 : 205, c: i === 239 ? 210 : 205 }
        : {},
    );
    const oi = [
      { t: 234 * M1, oi: 999 },
      { t: 235 * M1, oi: 1000 },
      { t: 239 * M1, oi: 1100 },
      { t: 250 * M1, oi: 5000 }, // after the window: ignored
    ];
    const m = orderflowMetrics(c, oi, "5m");
    expect(m?.volumeUsd).toBe(15_000);
    expect(m?.netFlowUsd).toBeCloseTo(5 * 1200, 9);
    expect(m?.buyPressurePct).toBeCloseTo(40, 9);
    expect(m?.strength).toBe("strong_buying");
    expect(m?.priceChangePct).toBeCloseTo(5, 9);
    expect(m?.oiChangePct).toBeCloseTo(10, 9);
    expect(m?.oiChangeUsd).toBeCloseTo(100 * 210, 6);
    expect(m?.regime).toBe("long_buildup");
    // 3,000 a candle against an average of (235·1,000 + 5·3,000) / 240.
    expect(m?.relVolume).toBeCloseTo(3000 / (250_000 / 240), 9);
  });

  it("uses 5-minute candles and a 10-minute open interest tolerance for 4H", () => {
    const c = candles(288, M5, (i) => (i >= 240 ? { takerBuyQuote: 250 } : {}));
    const m = orderflowMetrics(
      c,
      [
        { t: 240 * M5 + 2 * M5, oi: 100 }, // 10 minutes after the start: still accepted
        { t: 287 * M5, oi: 103 },
      ],
      "4h",
    );
    expect(m?.netFlowUsd).toBe(-48 * 500);
    expect(m?.buyPressurePct).toBe(-50);
    expect(m?.strength).toBe("strong_selling");
    expect(m?.oiChangePct).toBeCloseTo(3, 9);
    expect(m?.relVolume).toBeCloseTo(1, 9);
  });

  it("returns null when too many candles are missing and has no relative volume for 1D", () => {
    expect(orderflowMetrics(candles(53, M1), [], "1h")).toBeNull();
    expect(orderflowMetrics(candles(54, M1), [], "1h")).not.toBeNull();
    expect(orderflowMetrics(candles(54, M1), [], "1h")?.relVolume).toBeNull(); // lookback too short
    expect(orderflowMetrics(candles(288, M5), [], "24h")?.relVolume).toBeNull();
  });

  it("leaves open interest unknown when no reading is near the window start", () => {
    const m = orderflowMetrics(candles(15, M1), [{ t: 14 * M1, oi: 1 }], "15m");
    expect(m?.oiChangePct).toBeNull();
    expect(m?.regime).toBe("neutral");
  });
});

describe("dayVwap", () => {
  it("is total value ÷ total coins since 00:00 UTC", () => {
    const day = Date.UTC(2026, 9, 19);
    const c: DeltaCandle[] = [
      { t: day - M5, o: 1, c: 1, base: 1000, quote: 1e6, takerBuyQuote: 0 }, // yesterday
      { t: day, o: 1, c: 1, base: 10, quote: 1000, takerBuyQuote: 0 },
      { t: day + M5, o: 1, c: 1, base: 30, quote: 3300, takerBuyQuote: 0 },
    ];
    expect(dayVwap(c, day + 2 * M5)).toBeCloseTo(4300 / 40, 12);
    expect(dayVwap(c.slice(0, 1), day + M5)).toBeNull();
  });
});

describe("summarizeWindow", () => {
  it("counts groups and sides", () => {
    const coin = (netFlowUsd: number, regime: OrderflowCoinDto["regime"]) =>
      ({ netFlowUsd, regime }) as OrderflowCoinDto;
    const s = summarizeWindow("4h", [
      coin(5, "long_buildup"),
      coin(-3, "short_buildup"),
      coin(0, "neutral"),
      coin(2, "long_buildup"),
    ]);
    expect(s.buying).toBe(2);
    expect(s.selling).toBe(1);
    expect(s.netFlowUsd).toBe(4);
    expect(s.counts.long_buildup).toBe(2);
    expect(s.counts.short_covering).toBe(0);
  });
});
