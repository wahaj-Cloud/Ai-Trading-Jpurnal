import { type ExitModel, SETUP_WINDOW, type SetupRule, setupRuleSchema } from "@atc/shared";
import { describe, expect, it } from "vitest";
import { accountTrades, runBacktest } from "./backtest.js";
import type { Candle } from "./indicators.js";
import { evaluateSetupAt, scanSetup } from "./setups.js";

const TF = 15 * 60_000;
const T0 = Date.UTC(2026, 0, 5, 0, 0);

/** Deterministic pseudo-random walk (same candles on every run). */
function walk(n: number, seed = 7, drift = 0): Candle[] {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = Math.max(1, o * (1 + (rand() - 0.5) * 0.02 + drift));
    const h = Math.max(o, c) * (1 + rand() * 0.006);
    const l = Math.min(o, c) * (1 - rand() * 0.006);
    out.push({ t: T0 + i * TF, o, h, l, c, v: 100 + rand() * 100 });
    price = c;
  }
  return out;
}

const rule = (all: SetupRule["all"], direction: "long" | "short" = "long"): SetupRule =>
  setupRuleSchema.parse({ version: 1, direction, all });

const RULES: SetupRule[] = [
  rule([{ type: "ema_trend", fast: 20, slow: 50, direction: "up" }]),
  rule([
    { type: "liquidity_sweep", of: "swing_low", withinCandles: 5 },
    { type: "price_vs_vwap", side: "above" },
  ]),
  rule([{ type: "fvg", bias: "bullish", state: "retest", withinCandles: 20 }]),
  rule([{ type: "order_block", bias: "bearish", withinCandles: 60 }], "short"),
  rule([
    { type: "structure", event: "any", bias: "bullish", withinCandles: 10 },
    { type: "rsi", period: 14, op: "below", value: 60 },
  ]),
  rule([{ type: "liquidity_sweep", of: "asia_low", withinCandles: 8 }]),
  rule([{ type: "volume_spike", multiple: 1.4 }]),
  rule([{ type: "premium_discount", zone: "discount" }]),
];

describe("setup evaluator", () => {
  const candles = walk(1200);

  it("never looks ahead: later candles never change an earlier result", () => {
    for (const r of RULES) {
      for (const i of [60, 300, 450, 700, 1100]) {
        expect(evaluateSetupAt(r, candles, i)).toEqual(
          evaluateSetupAt(r, candles.slice(0, i + 1), i),
        );
      }
    }
  });

  it("gives the same answer as a live scan that only has the last window", () => {
    for (const r of RULES) {
      for (const i of [500, 800, 1199]) {
        const live = candles.slice(i - SETUP_WINDOW + 1, i + 1);
        expect(evaluateSetupAt(r, candles, i).matched).toBe(
          evaluateSetupAt(r, live, live.length - 1).matched,
        );
      }
    }
  });

  it("finds matches for a trend rule in a rising market and none in a falling one", () => {
    const up = rule([{ type: "ema_trend", fast: 20, slow: 50, direction: "up" }]);
    expect(scanSetup(up, walk(300, 3, 0.003)).length).toBeGreaterThan(150);
    expect(scanSetup(up, walk(300, 3, -0.003)).length).toBe(0);
  });

  it("detects a sweep of the Asian low after the session", () => {
    const c: Candle[] = [];
    // Asian session 00:00-07:00: range 99-101.
    for (let i = 0; i < 28; i++) {
      c.push({ t: T0 + i * TF, o: 100, h: 101, l: 99, c: 100, v: 100 });
    }
    // London: one candle wicks to 98 and closes back at 100.
    c.push({ t: T0 + 28 * TF, o: 100, h: 100.5, l: 98, c: 100.2, v: 100 });
    const pad = Array.from({ length: 60 }, (_, i) => ({
      t: T0 - (60 - i) * TF,
      o: 100,
      h: 100.5,
      l: 99.5,
      c: 100,
      v: 100,
    }));
    const all = [...pad, ...c];
    const r = rule([{ type: "liquidity_sweep", of: "asia_low", withinCandles: 1 }]);
    expect(evaluateSetupAt(r, all, all.length - 1).matched).toBe(true);
    expect(evaluateSetupAt(r, all, all.length - 2).matched).toBe(false);
  });

  it("matches only when every condition holds", () => {
    const always = rule([{ type: "session", in: ["asia", "london", "new_york"] }]);
    const never = rule([
      { type: "session", in: ["asia", "london", "new_york"] },
      { type: "rsi", period: 14, op: "above", value: 99 },
    ]);
    const i = 13 * 4 + 60; // 13:00 UTC on a later day is still New York hours
    expect(evaluateSetupAt(always, candles, i).matched).toBe(true);
    expect(evaluateSetupAt(never, candles, i).matched).toBe(false);
  });
});

const exit = (over: Partial<ExitModel> = {}): ExitModel => ({
  stop: { type: "percent", value: 1 },
  targetR: 2,
  riskPct: 1,
  startEquity: 10_000,
  slippagePct: 0,
  maxHoldCandles: null,
  ...over,
});

describe("backtest engine", () => {
  it("is deterministic and agrees with the evaluator on entries", () => {
    const candles = walk(2000, 11);
    const r = rule([
      { type: "ema_trend", fast: 9, slow: 21, direction: "up" },
      { type: "rsi", period: 14, op: "below", value: 45 },
    ]);
    const p = {
      rule: r,
      exit: exit(),
      takerFee: 0.0005,
      from: candles[60]?.t ?? 0,
      to: T0 + 2000 * TF,
    };
    const a = runBacktest([{ symbol: "XUSDT", candles, funding: [] }], p, TF);
    const b = runBacktest([{ symbol: "XUSDT", candles, funding: [] }], p, TF);
    expect(a).toEqual(b);
    expect(a.trades.length).toBeGreaterThan(0);
    for (const t of a.trades) {
      const signal = candles.findIndex((c) => c.t === t.entryAt) - 1;
      expect(evaluateSetupAt(r, candles, signal).matched).toBe(true);
      expect(t.entryPrice).toBe(candles[signal + 1]?.o);
    }
  });

  const flat = (n: number, price = 100): Candle[] =>
    Array.from({ length: n }, (_, i) => ({
      t: T0 + i * TF,
      o: price,
      h: price,
      l: price,
      c: price,
      v: 1,
    }));
  const go = rule([{ type: "session", in: ["asia", "london", "new_york"] }]);

  it("pays fees and books about +2R when the target is hit", () => {
    const candles = flat(60);
    candles.push({ t: T0 + 60 * TF, o: 100, h: 102.5, l: 99.9, c: 102, v: 1 });
    const res = runBacktest(
      [{ symbol: "XUSDT", candles, funding: [] }],
      {
        rule: go,
        exit: exit(),
        takerFee: 0.0005,
        from: candles[59]?.t ?? 0,
        to: (candles[59]?.t ?? 0) + 1,
      },
      TF,
    );
    const t = res.trades[0];
    expect(t?.exitReason).toBe("TARGET");
    // Risk $100 (1% of 10k) over a $1 stop: size 100 coins, +$200 before ~$10.1 fees.
    expect(t?.fees).toBeCloseTo(0.0005 * (100 * 100 + 100 * 102), 2);
    expect(t?.rMultiple).toBeCloseTo((200 - (t?.fees ?? 0)) / 100, 3);
  });

  it("assumes the stop first when stop and target share a candle", () => {
    const candles = flat(60);
    candles.push({ t: T0 + 60 * TF, o: 100, h: 103, l: 98, c: 100, v: 1 });
    const res = runBacktest(
      [{ symbol: "XUSDT", candles, funding: [] }],
      {
        rule: go,
        exit: exit(),
        takerFee: 0,
        from: candles[59]?.t ?? 0,
        to: (candles[59]?.t ?? 0) + 1,
      },
      TF,
    );
    expect(res.trades[0]?.exitReason).toBe("STOP");
    expect(res.trades[0]?.flags).toContain("stop_and_target_same_candle");
    expect(res.summary.ambiguous).toBe(1);
    expect(res.summary.warnings.join(" ")).toMatch(/too few/);
  });

  it("charges funding for positions held across funding times", () => {
    const candles = flat(60);
    for (let i = 60; i < 80; i++)
      candles.push({ t: T0 + i * TF, o: 100, h: 100, l: 100, c: 100, v: 1 });
    candles.push({ t: T0 + 80 * TF, o: 100, h: 102.5, l: 100, c: 102, v: 1 });
    const res = runBacktest(
      [{ symbol: "XUSDT", candles, funding: [{ t: T0 + 70 * TF, rate: 0.001 }] }],
      {
        rule: go,
        exit: exit(),
        takerFee: 0,
        from: candles[59]?.t ?? 0,
        to: (candles[59]?.t ?? 0) + 1,
      },
      TF,
    );
    // Long pays 0.1% of a $10,000 notional.
    expect(res.trades[0]?.funding).toBeCloseTo(10, 2);
    expect(res.trades[0]?.pnl).toBeCloseTo(200 - 10, 2);
  });

  it("sizes from equity at entry", () => {
    const res = accountTrades(
      [
        {
          symbol: "A",
          side: "LONG",
          entryAt: 1,
          entryPrice: 100,
          stop: 99,
          exitAt: 2,
          exitPrice: 99,
          exitReason: "STOP",
          fundingRate: 0,
          flags: [],
        },
        {
          symbol: "A",
          side: "LONG",
          entryAt: 3,
          entryPrice: 100,
          stop: 99,
          exitAt: 4,
          exitPrice: 99,
          exitReason: "STOP",
          fundingRate: 0,
          flags: [],
        },
      ],
      { rule: go, exit: exit(), takerFee: 0, from: 0, to: 10 },
    );
    expect(res.trades[0]?.pnl).toBe(-100);
    expect(res.trades[1]?.pnl).toBe(-99);
    expect(res.summary.maxDrawdownPct).toBeCloseTo(1.99, 2);
  });
});

describe("backtest safeguards", () => {
  const base = {
    symbol: "A",
    side: "LONG" as const,
    entryPrice: 100,
    exitReason: "STOP" as const,
    fundingRate: 0,
    flags: [] as string[],
  };
  const go = setupRuleSchema.parse({
    version: 1,
    direction: "long",
    all: [{ type: "volume_spike", multiple: 2 }],
  });
  const ex: ExitModel = {
    stop: { type: "percent", value: 1 },
    targetR: 2,
    riskPct: 5,
    startEquity: 1000,
    slippagePct: 0,
    maxHoldCandles: null,
  };

  it("stops trading once the account is wiped out", () => {
    // Each loss gaps far through the stop: 50% of equity per trade.
    const raw = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      entryAt: i * 10 + 1,
      exitAt: i * 10 + 2,
      stop: 90,
      exitPrice: 0.1,
    }));
    const res = accountTrades(raw, { rule: go, exit: ex, takerFee: 0, from: 0, to: 200 });
    expect(res.trades.length).toBeLessThan(10);
    expect(res.summary.warnings.join(" ")).toMatch(/wiped out/);
  });

  it("caps a position at 20x leverage when the stop is very tight", () => {
    const raw = [{ ...base, entryAt: 1, exitAt: 2, stop: 99.99, exitPrice: 99.99 }];
    const res = accountTrades(raw, { rule: go, exit: ex, takerFee: 0, from: 0, to: 10 });
    expect(res.trades[0]?.flags).toContain("size_capped");
    // 20 x 1000 notional, 0.01% move: −$2, not the planned −$50.
    expect(res.trades[0]?.pnl).toBeCloseTo(-2, 2);
    expect(res.summary.warnings.join(" ")).toMatch(/20× leverage/);
  });
});
