import { describe, expect, it } from "vitest";
import {
  applyLiveToScalpCoin,
  LIVE_WINDOWS,
  type LiveCoin,
  type LiveTick,
  liveCoin,
  liveViewOf,
  liveVolatility,
  summarizeLive,
} from "./live-flow.js";
import { type DeltaCandle, orderflowMetrics } from "./orderflow.js";
import type { ScalpCoinDto } from "./scalp.js";

const M1 = 60_000;
const T0 = Date.UTC(2026, 9, 20, 8, 0);

function candles(n: number, seed = 3): DeltaCandle[] {
  let s = seed;
  const r = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: DeltaCandle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p;
    p *= 1 + (r() - 0.5) * 0.004;
    const quote = 1000 + r() * 9000;
    out.push({
      t: T0 + i * M1,
      o,
      h: Math.max(o, p) * (1 + r() * 0.001),
      l: Math.min(o, p) * (1 - r() * 0.001),
      c: p,
      base: quote / p,
      quote,
      takerBuyQuote: quote * (0.3 + r() * 0.4),
    });
  }
  return out;
}

const oiFor = (cs: DeltaCandle[]) =>
  cs.map((c, i) => ({ t: c.t + 30_000, oi: 1_000_000 * (1 + i * 0.0004) }));

describe("live coin", () => {
  const closed = candles(240);
  const last = closed.at(-1) as DeltaCandle;
  const forming: DeltaCandle = {
    t: last.t + M1,
    o: last.c,
    h: last.c * 1.002,
    l: last.c * 0.999,
    c: last.c * 1.001,
    base: 20,
    quote: 2000,
    takerBuyQuote: 1500,
  };
  const oi = oiFor([...closed, forming]);

  it("without a forming candle, equals the minute scan exactly", () => {
    const live = liveCoin({
      symbol: "BTCUSDT",
      rank: 1,
      closed,
      forming: null,
      oi,
      funding: 0.0001,
      spreadBps: 0.4,
      updatedAt: last.t,
      now: last.t + M1,
    });
    for (const w of LIVE_WINDOWS) {
      const m = orderflowMetrics(closed, oi, w);
      const c = live?.w[w];
      expect(c?.bp).toBe(m?.buyPressurePct);
      expect(c?.nf).toBe(m?.netFlowUsd);
      expect(c?.pc).toBe(m?.priceChangePct);
      expect(c?.oi).toBe(m?.oiChangePct);
      expect(c?.st).toBe(m?.strength);
      expect(c?.rg).toBe(m?.regime);
      expect(c?.rv).toBeCloseTo(m?.relVolume as number, 12);
    }
  });

  it("counts the forming candle as the newest of each window", () => {
    const now = forming.t + 15_000; // a quarter of the minute gone
    const live = liveCoin({
      symbol: "BTCUSDT",
      rank: 1,
      closed,
      forming,
      oi,
      funding: null,
      spreadBps: null,
      updatedAt: now,
      now,
    });
    const all = [...closed, forming];
    const avg = closed.reduce((s, c) => s + c.quote, 0) / closed.length;
    for (const [w, n] of [
      ["5m", 5],
      ["15m", 15],
      ["30m", 30],
      ["1h", 60],
    ] as const) {
      const m = orderflowMetrics(all, oi, w);
      const c = live?.w[w];
      expect(c?.bp).toBe(m?.buyPressurePct);
      expect(c?.vol).toBe(m?.volumeUsd);
      expect(c?.oiu).toBe(m?.oiChangeUsd);
      // Pace over the minutes actually elapsed: n − 1 full minutes plus a quarter.
      expect(c?.rv).toBeCloseTo((m?.volumeUsd as number) / (n - 1 + 0.25) / avg, 12);
    }
    expect(live?.p).toBe(forming.c);
    expect(live?.h).toBe(forming.h);
  });

  it("ignores a forming candle that is not newer than the last closed one", () => {
    const stale = { ...forming, t: last.t };
    const a = liveCoin({
      symbol: "X",
      rank: 1,
      closed,
      forming: stale,
      oi,
      funding: null,
      spreadBps: null,
      updatedAt: 0,
      now: last.t + M1,
    });
    expect(a?.p).toBe(last.c);
  });

  it("puts a burst inside the current 5-minute bar into the activity ratio at once", () => {
    const quiet = liveVolatility(closed, null);
    const spike: DeltaCandle = { ...forming, h: last.c * 1.03, l: last.c * 0.97 };
    const loud = liveVolatility(closed, spike);
    expect(loud.rangeRatio as number).toBeGreaterThan(quiet.rangeRatio as number);
    expect(loud.activity).toBe("very_active");
    // ATR comes from full bars of closed candles only.
    expect(loud.atr5m).toBe(quiet.atr5m);
  });
});

const live = (s: string, r: number, bp: number): LiveCoin => ({
  s,
  r,
  p: 105,
  h: 106,
  l: 99,
  f: 0.0002,
  sp: 1.5,
  v: { atr5m: 1, atr15m: 2, rangeRatio: 2.4, activity: "very_active" },
  w: {
    "5m": {
      bp,
      nf: bp * 100,
      vol: 1e6,
      pc: 0.5,
      oi: 0.3,
      oiu: 1e4,
      rg: "long_buildup",
      st: bp > 25 ? "strong_buying" : "neutral",
      rv: 1.2,
      ser: [1, 2, 3],
    },
    "1h": {
      bp: -bp,
      nf: -bp,
      vol: 1e7,
      pc: -0.1,
      oi: null,
      oiu: null,
      rg: "neutral",
      st: "neutral",
      rv: 1,
      ser: [4, 5],
    },
  },
  t: 1,
});

describe("applying a tick", () => {
  const coin: ScalpCoinDto = {
    symbol: "XAUUSDT",
    rank: 125,
    price: 100,
    vwap: 100,
    vwapDistPct: 0,
    funding: 0.0001,
    frames: {
      "5m": {
        strength: "selling",
        buyPressurePct: -12,
        netFlowUsd: -1,
        priceChangePct: 0,
        oiChangePct: 0,
        relVolume: 1,
        regime: "neutral",
      },
      "4h": {
        strength: "buying",
        buyPressurePct: 4,
        netFlowUsd: 1,
        priceChangePct: 0,
        oiChangePct: 0,
        relVolume: 1,
        regime: "neutral",
      },
    },
    book: { asOf: "", mid: 100, spreadBps: 0.2, bands: [], walls: [] },
    levels: {
      dayHigh: 104,
      dayLow: 98,
      asiaHigh: 103,
      asiaLow: 99.5,
      asiaOpen: false,
      high24h: 110,
      low24h: 97,
    },
    volatility: { atr5m: 0.5, atr15m: 1, atr1h: 3, rangeRatio: 1, activity: "normal" },
  };

  it("replaces the live windows, price, extremes, spread and activity", () => {
    const out = applyLiveToScalpCoin(coin, live("XAUUSDT", 125, 30));
    expect(out.frames["5m"]?.strength).toBe("strong_buying");
    expect(out.frames["4h"]?.strength).toBe("buying"); // 4H stays per scan
    expect(out.price).toBe(105);
    expect(out.vwapDistPct).toBeCloseTo(5, 12);
    expect(out.levels?.dayHigh).toBe(106);
    expect(out.levels?.dayLow).toBe(98);
    expect(out.levels?.asiaLow).toBe(99.5); // Asia closed: unchanged
    expect(out.book?.spreadBps).toBe(1.5);
    expect(out.volatility.activity).toBe("very_active");
    expect(out.volatility.atr1h).toBe(3);
    expect(out.funding).toBe(0.0002);
  });
});

describe("what one page receives", () => {
  const tick: LiveTick = {
    at: 5,
    universe: 101,
    coins: [live("BTCUSDT", 1, 30), live("C30USDT", 30, 5), live("XAUUSDT", 125, 10)],
    summary: summarizeLive([live("BTCUSDT", 1, 30), live("C30USDT", 30, 5)]),
  };

  it("keeps the plan's coins plus gold and silver", () => {
    const v = liveViewOf(tick, { view: "scalp" }, 20);
    expect(v.coins.map((c) => c.s)).toEqual(["BTCUSDT", "XAUUSDT"]);
    expect(liveViewOf(tick, { view: "scalp" }, null).coins).toHaveLength(3);
  });

  it("sends flow lines only for the Order Flow window", () => {
    const v = liveViewOf(tick, { view: "orderflow", w: "5m" }, null);
    expect(v.coins[0]?.w["5m"]?.ser).toEqual([1, 2, 3]);
    expect(v.coins[0]?.w["1h"]?.ser).toBeUndefined();
    expect(v.summary?.buying).toBe(2);
    expect(liveViewOf(tick, { view: "orderflow", w: "4h" }, null).summary).toBeNull();
  });

  it("the Cockpit gets one market, and none outside the plan", () => {
    expect(liveViewOf(tick, { view: "cockpit", s: "XAUUSDT" }, 20).coins).toHaveLength(1);
    expect(liveViewOf(tick, { view: "cockpit", s: "C30USDT" }, 20).coins).toHaveLength(0);
  });

  it("counts the market per window", () => {
    expect(tick.summary["5m"]).toEqual({
      buying: 2,
      selling: 0,
      netFlowUsd: 3500,
      counts: {
        long_buildup: 2,
        short_buildup: 0,
        short_covering: 0,
        long_unwinding: 0,
        neutral: 0,
      },
    });
    expect(tick.summary["1h"].selling).toBe(2);
  });
});
