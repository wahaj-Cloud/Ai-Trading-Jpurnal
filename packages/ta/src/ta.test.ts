import { describe, expect, it } from "vitest";
import { analyzeTrade, contextFacts, TIMEFRAME_MS, timeframeFor } from "./analyze.js";
import { atr, type Candle, ema, rsi, sessionVwap, sma } from "./indicators.js";
import {
  fairValueGaps,
  liquidityPools,
  marketStructure,
  orderBlocks,
  rangePosition,
  swings,
} from "./structure.js";

const T0 = Date.UTC(2026, 8, 1);
const M5 = TIMEFRAME_MS["5m"];
const candle = (i: number, o: number, h: number, l: number, c: number, v = 100): Candle => ({
  t: T0 + i * M5,
  o,
  h,
  l,
  c,
  v,
});
/** Candles from a close path; each candle spans a small range around its move. */
function path(closes: number[], start = 0, wick = 0.3): Candle[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : (closes[i - 1] as number);
    return candle(start + i, o, Math.max(o, c) + wick, Math.min(o, c) - wick, c);
  });
}

describe("indicators", () => {
  it("EMA and SMA", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    expect(ema([5, 5, 5, 5], 2).at(-1)).toBe(5);
  });

  it("RSI: only gains = 100, only losses = 0, flat = 50", () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3).at(-1)).toBe(0);
    expect(rsi([2, 2, 2, 2, 2], 3).at(-1)).toBe(50);
  });

  it("ATR of a steady 2-point range is 2", () => {
    const cs = Array.from({ length: 20 }, (_, i) => candle(i, 100, 101, 99, 100));
    expect(atr(cs, 14).at(-1)).toBeCloseTo(2);
  });

  it("VWAP re-anchors each UTC day", () => {
    const day = 288; // 5-minute candles per day
    const cs = [candle(day - 1, 10, 10, 10, 10, 1), candle(day, 20, 20, 20, 20, 1)];
    expect(sessionVwap(cs)).toEqual([10, 20]);
  });
});

describe("structure", () => {
  // Up-trend zigzag: higher highs and higher lows, then a collapse below the last low.
  const up = [
    100, 102, 104, 103, 101, 103, 106, 108, 107, 105, 107, 110, 112, 111, 109, 111, 114, 116,
  ];
  const crash = [113, 110, 106, 103, 100];
  const cs = path([...up, ...crash]);

  it("swings are confirmed extremes", () => {
    const s = swings(cs);
    expect(s.filter((x) => x.kind === "HIGH").map((x) => x.price)).toEqual([
      104.3, 108.3, 112.3, 116.3,
    ]);
  });

  it("BOS in trend direction, CHOCH when it flips", () => {
    const res = marketStructure(cs);
    expect(res.events.map((e) => `${e.kind}-${e.direction}`)).toEqual([
      "BOS-UP",
      "BOS-UP",
      "BOS-UP",
      "CHOCH-DOWN",
    ]);
    expect(res.trend).toBe("DOWN");
    expect(marketStructure(cs, up.length).trend).toBe("UP");
  });

  it("order blocks: breaker after a higher high, mitigation after a failure swing", () => {
    const zones = orderBlocks(cs);
    // Before the crash, the first bullish block is intact.
    expect(orderBlocks(cs, up.length)[0]).toMatchObject({
      kind: "ORDER_BLOCK",
      direction: "BULLISH",
      bottom: 100.7,
    });
    expect(zones[0]).toMatchObject({ kind: "BREAKER", direction: "BEARISH", bottom: 100.7 });
    expect(zones[2]).toMatchObject({ kind: "MITIGATION", direction: "BEARISH", bottom: 108.7 });
  });

  it("fair value gap: three-candle imbalance, filled later", () => {
    const gap = [
      candle(0, 100, 101, 99, 100.5),
      candle(1, 100.5, 106, 100.4, 105.8),
      candle(2, 105.8, 107, 102, 106.5),
      candle(3, 106, 106.2, 100.5, 101),
    ];
    const [fvg] = fairValueGaps(gap);
    expect(fvg).toMatchObject({ direction: "BULLISH", bottom: 101, top: 102, touched: true });
  });

  it("equal highs form buy-side liquidity, taken by a later wick", () => {
    const eq = path([100, 102, 105, 102, 100, 102, 105, 102, 100, 103, 104, 106.5, 104]);
    const pools = liquidityPools(eq, eq.length);
    expect(pools.find((p) => p.side === "BUY_SIDE")).toMatchObject({ swings: 2, swept: true });
  });

  it("range position", () => {
    expect(rangePosition(75, 100, 50)).toBe(0.5);
    expect(rangePosition(75, null, 50)).toBeNull();
  });
});

describe("analyzeTrade", () => {
  // 300 candles of steady up-trend with pullbacks, so every indicator has history.
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < 320; i++) {
    p += i % 10 < 7 ? 0.5 : -0.9;
    closes.push(Number(p.toFixed(2)));
  }
  const cs = path(closes, 0, 0.2);

  it("a pullback long in an up-trend passes the trend checks and measures the excursion", () => {
    const entryIdx = 300; // candle after a pullback
    const entry = cs[entryIdx] as Candle;
    const ctx = analyzeTrade(
      cs,
      {
        direction: "LONG",
        openedAt: new Date(entry.t + 60_000),
        closedAt: new Date(entry.t + 10 * M5),
        entryPrice: entry.o,
        exitPrice: (cs[entryIdx + 10] as Candle).c,
        stopPrice: entry.o - 2,
      },
      "5m",
      "BINANCE",
    );
    expect(ctx).not.toBeNull();
    const byCode = Object.fromEntries((ctx?.checks ?? []).map((c) => [c.code, c.ok]));
    expect(byCode.TREND_ALIGNED).toBe(true);
    expect(byCode.EMA_ALIGNED).toBe(true);
    expect(ctx?.excursion?.mfe).toBeGreaterThan(0);
    expect(ctx?.excursion?.mfeR).not.toBeNull();
    expect(ctx?.entryScore).toBeGreaterThan(40);
    expect(contextFacts(ctx as NonNullable<typeof ctx>)).toContain(
      "Timeframe 5m (BINANCE candles)",
    );
  });

  it("a short against the trend fails trend alignment", () => {
    const entry = cs[305] as Candle;
    const ctx = analyzeTrade(
      cs,
      {
        direction: "SHORT",
        openedAt: new Date(entry.t + 1),
        closedAt: null,
        entryPrice: entry.o,
        exitPrice: null,
        stopPrice: null,
      },
      "5m",
      "BINANCE",
    );
    expect(ctx?.checks.find((c) => c.code === "TREND_ALIGNED")?.ok).toBe(false);
    expect(ctx?.excursion).toBeNull();
  });

  it("chasing a vertical move is flagged as an extended entry", () => {
    const spike = [
      ...closes.slice(0, 300),
      ...Array.from({ length: 12 }, (_, i) => (closes[299] as number) + (i + 1) * 3),
    ];
    const sc = path(spike, 0, 0.2);
    const last = sc.at(-1) as Candle;
    const ctx = analyzeTrade(
      sc,
      {
        direction: "LONG",
        openedAt: new Date(last.t + M5 + 1),
        closedAt: null,
        entryPrice: last.c,
        exitPrice: null,
        stopPrice: null,
      },
      "5m",
      "BINANCE",
    );
    expect(ctx?.extendedEntry).toBe(true);
    expect(ctx?.checks.find((c) => c.code === "NOT_EXTENDED")?.ok).toBe(false);
  });

  it("uses no candle that had not closed before the entry", () => {
    const entry = cs[300] as Candle;
    const trade = {
      direction: "LONG" as const,
      openedAt: new Date(entry.t + 1),
      closedAt: null,
      entryPrice: entry.o,
      exitPrice: null,
      stopPrice: null,
    };
    const full = analyzeTrade(cs, trade, "5m", "X");
    const truncated = analyzeTrade(cs.slice(0, 300), trade, "5m", "X");
    expect(full?.entry).toEqual(truncated?.entry);
  });

  it("too little history: no context rather than a wrong one", () => {
    const entry = cs[10] as Candle;
    expect(
      analyzeTrade(
        cs,
        {
          direction: "LONG",
          openedAt: new Date(entry.t),
          closedAt: null,
          entryPrice: 1,
          exitPrice: null,
          stopPrice: null,
        },
        "5m",
        "X",
      ),
    ).toBeNull();
  });

  it("timeframe follows holding time", () => {
    expect([600, 5 * 3600, 30 * 3600, 5 * 86400].map(timeframeFor)).toEqual([
      "5m",
      "15m",
      "1h",
      "4h",
    ]);
  });
});

describe("order block lifecycle", () => {
  it("records where a block was broken, so a breaker's life starts there", () => {
    let s = 3;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const cs: Candle[] = [];
    let p = 100;
    for (let i = 0; i < 600; i++) {
      const o = p;
      p *= 1 + (rand() - 0.5) * 0.02;
      cs.push({
        t: i * 900_000,
        o,
        h: Math.max(o, p) * (1 + rand() * 0.004),
        l: Math.min(o, p) * (1 - rand() * 0.004),
        c: p,
        v: 1,
      });
    }
    const zones = orderBlocks(cs);
    const broken = zones.filter((z) => z.kind !== "ORDER_BLOCK");
    expect(broken.length).toBeGreaterThan(0);
    for (const z of broken) {
      expect(z.brokenIndex).toBeGreaterThan(z.index);
      const k = z.brokenIndex as number;
      const breaking = cs[k] as Candle;
      // The breaking close went through the block's far side.
      expect(breaking.c < z.bottom || breaking.c > z.top).toBe(true);
    }
    for (const z of zones.filter((x) => x.kind === "ORDER_BLOCK")) expect(z.brokenIndex).toBeNull();
  });
});
