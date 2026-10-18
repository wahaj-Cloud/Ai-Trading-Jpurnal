import { describe, expect, it } from "vitest";
import {
  buildTradeCheck,
  type MarketContextDto,
  type TradeCheckDto,
  type TradeCheckInput,
} from "./trade-check.js";

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 17, 12);
const iso = (t: number) => new Date(t).toISOString();

function ctx(over: Partial<MarketContextDto> = {}): MarketContextDto {
  return {
    symbol: "BTCUSDT",
    computedAt: iso(NOW - 5 * 60_000),
    price: 100,
    change24hPct: 2,
    fundingRate: 0.0001,
    oiChange24hPct: 5,
    weeklyBias: { timeframe: "1w", state: "up", bars: 20, evidence: [] },
    levels: {
      prevDayHigh: 101,
      prevDayLow: 97,
      prevWeekHigh: 110,
      prevWeekLow: 90,
      ema200d: 80,
      ema50d: 95,
    },
    accounts: {
      ratio: 2.4,
      longShare: 0.7,
      shortShare: 0.3,
      change24h: 0.05,
      percentile: 90,
      at: iso(NOW),
    },
    topPositions: {
      ratio: 1.1,
      longShare: 0.52,
      shortShare: 0.48,
      change24h: 0,
      percentile: 50,
      at: iso(NOW),
    },
    taker: { ratio4h: 1.2, ratio24h: 1.05 },
    basis: {
      contract: "BTCUSDT_261225",
      expiry: iso(NOW + 70 * 24 * H),
      daysToExpiry: 70,
      basisPct: 1.5,
      annualizedPct: 7.8,
    },
    coinbasePremiumPct: -0.08,
    options: {
      currency: "BTC",
      dvol: 50,
      dvolChange24h: 1,
      putCallOi: 0.6,
      expiry: iso(NOW + 10 * 24 * H),
      expiryOiShare: 0.3,
      maxPain: 95,
      skew25d: 5,
      skewExpiry: iso(NOW + 28 * 24 * H),
      underlying: 100,
    },
    ...over,
  };
}

function input(over: Partial<TradeCheckInput> = {}): TradeCheckInput {
  return {
    symbol: "BTCUSDT",
    name: "Bitcoin",
    now: NOW,
    desk: {
      price: 100,
      computedAt: iso(NOW - 10 * 60_000),
      bias: [
        { timeframe: "1d", state: "up", bars: 10, evidence: [] },
        { timeframe: "4h", state: "down", bars: 3, evidence: [] },
        { timeframe: "1h", state: "range", bars: 2, evidence: [] },
      ],
    },
    context: ctx(),
    fearGreed: { value: 80, label: "Extreme greed" },
    btcDominance: 57.1,
    altSeason: 30,
    flow: {
      whaleBuyUsd: 9e6,
      whaleSellUsd: 3e6,
      whaleCount: 20,
      longLiqUsd: 1e6,
      shortLiqUsd: 4e6,
    },
    liqClusters: [
      { side: "short", price: 104, usd: 3e8 },
      { side: "long", price: 97, usd: 1e8 },
      { side: "long", price: 80, usd: 9e9 }, // more than 8% away: ignored
    ],
    macro: {
      updatedAt: iso(NOW - H),
      series: [
        { id: "DTWEXBGS", label: "", value: 120, date: "2026-10-16", change: 0.9, changePct: 0.76 },
        { id: "DGS10", label: "", value: 4.1, date: "2026-10-16", change: -0.2, changePct: -4.6 },
        { id: "NASDAQCOM", label: "", value: 18000, date: "2026-10-16", change: 1, changePct: 0.5 },
        { id: "SP500", label: "", value: 5800, date: "2026-10-16", change: 1, changePct: 0.4 },
        { id: "VIXCLS", label: "", value: 31, date: "2026-10-16", change: 6, changePct: 24 },
      ],
    },
    stablecoins: {
      totalUsd: 2.9e11,
      change7dPct: 0.6,
      change30dPct: 2,
      date: "2026-10-16",
      updatedAt: iso(NOW - H),
    },
    nextEvent: {
      title: "CPI y/y",
      currency: "USD",
      impact: "HIGH",
      startsAt: iso(NOW + 90 * 60_000),
      actual: null,
      forecast: "3.1%",
      previous: "3.0%",
    },
    ...over,
  };
}

const lean = (c: TradeCheckDto, key: string) => c.factors.find((f) => f.key === key)?.lean;

describe("Trade Check rules", () => {
  it("judges every factor by its published rule", () => {
    const c = buildTradeCheck(input());
    const expected: Record<string, string> = {
      bias_1w: "long",
      bias_1d: "long",
      bias_4h: "short",
      bias_1h: "neutral",
      ema200d: "long", // 100 vs 80: +25%
      week_range: "neutral", // 50% of 90–110
      day_range: "info",
      fear_greed: "short", // 80 ≥ 75
      btc_dominance: "info",
      alt_season: "info",
      funding: "neutral", // 0.01%
      oi_price: "long", // OI +5%, price +2%
      ls_accounts: "short", // 90th percentile, contrarian
      ls_top: "neutral", // 50th percentile
      taker: "long", // 1.2 ≥ 1.1
      whales: "long", // (9−3)/12 = 0.5 ≥ 0.2
      liquidations: "info",
      liq_pools: "long", // 3e8 above vs 1e8 below = 3 ≥ 1.5
      coinbase_premium: "short", // −0.08 ≤ −0.05
      basis: "neutral", // 7.8%
      stablecoins: "long", // +0.6 ≥ 0.3
      skew: "short", // 5 ≥ 4
      put_call: "info",
      dvol: "info",
      max_pain: "neutral", // expiry 10 days away
      dxy: "short", // +0.76 ≥ 0.5
      us10y: "long", // −0.2 ≤ −0.15
      nasdaq: "neutral", // +0.5 within ±1.5
      sp500: "info",
      vix: "short", // 31 ≥ 25
    };
    expect(Object.fromEntries(c.factors.map((f) => [f.key, f.lean]))).toEqual(expected);
    const counted = Object.values(expected).filter((v) => v !== "info");
    expect(c.tally).toEqual({
      long: counted.filter((v) => v === "long").length,
      short: counted.filter((v) => v === "short").length,
      neutral: counted.filter((v) => v === "neutral").length,
    });
    expect(c.missing).toEqual([]);
  });

  it("raises flags: release within 2h first, trend conflict, VIX", () => {
    const c = buildTradeCheck(input());
    expect(c.flags[0]).toMatchObject({ key: "event", level: "high" });
    expect(c.flags[0]?.text).toContain("in 1h 30m");
    expect(c.flags.map((f) => f.key)).toEqual(["event", "trend_conflict", "vix"]);
    expect(c.reading[0]).toMatch(/^More readings support longs \(\d+\) than shorts \(\d+\);/);
    expect(c.reading.at(-1)).toContain("Caution");
  });

  it("applies thresholds at their exact edges", () => {
    const at = (over: Partial<MarketContextDto>, key: string) =>
      lean(buildTradeCheck(input({ context: ctx(over) })), key);
    expect(at({ fundingRate: 0.0003 }, "funding")).toBe("neutral");
    expect(at({ fundingRate: 0.00031 }, "funding")).toBe("short");
    expect(at({ fundingRate: -0.00011 }, "funding")).toBe("long");
    expect(at({ taker: { ratio4h: 0.9, ratio24h: 1 } }, "taker")).toBe("short");
    expect(at({ oiChange24hPct: 3, change24hPct: -1 }, "oi_price")).toBe("short");
    expect(at({ oiChange24hPct: -5, change24hPct: 4 }, "oi_price")).toBe("neutral");
    expect(at({ coinbasePremiumPct: 0.05 }, "coinbase_premium")).toBe("long");
    expect(at({ price: 80.3 }, "ema200d")).toBe("neutral"); // within 0.5%
    expect(at({ price: 111 }, "week_range")).toBe("long"); // above last week's high
    expect(at({ price: 89 }, "week_range")).toBe("short");
    expect(at({ price: 106 }, "week_range")).toBe("short"); // 80% of range
    expect(at({ price: 94 }, "week_range")).toBe("long"); // 20%
    const b = ctx().basis;
    expect(at({ basis: b && { ...b, annualizedPct: 20 } }, "basis")).toBe("short");
  });

  it("flags a release that came out within the last hour, with its figures", () => {
    const c = buildTradeCheck(
      input({
        nextEvent: null,
        recentEvents: [
          {
            title: "NFP",
            currency: "USD",
            impact: "HIGH",
            startsAt: iso(NOW - 3 * H),
            actual: "1",
            forecast: "2",
            previous: null,
          },
          {
            title: "CPI m/m",
            currency: "USD",
            impact: "HIGH",
            startsAt: iso(NOW - 12 * 60_000),
            actual: "0.4%",
            forecast: "0.3%",
            previous: null,
          },
        ],
      }),
    );
    expect(c.flags[0]?.key).toBe("released");
    expect(c.flags[0]?.text).toBe(
      "USD CPI m/m came out 12 min ago (actual 0.4% vs forecast 0.3%): price can keep swinging for a while after a release.",
    );
    expect(c.flags.filter((f) => f.key === "released")).toHaveLength(1);
  });

  it("pulls toward max pain only in the 3 days before a big expiry", () => {
    const o = ctx().options;
    if (!o) throw new Error("fixture");
    const near = buildTradeCheck(
      input({ context: ctx({ options: { ...o, expiry: iso(NOW + 20 * H) } }) }),
    );
    // Price 100 vs max pain 95: +5.3%, so the pull is down.
    expect(lean(near, "max_pain")).toBe("short");
    expect(near.flags.some((f) => f.key === "expiry")).toBe(true);
  });

  it("leaves out crypto-only readings for gold and judges macro for metals", () => {
    const c = buildTradeCheck(
      input({
        symbol: "XAUUSDT",
        name: "Gold",
        context: ctx({ symbol: "XAUUSDT", options: null, coinbasePremiumPct: null, basis: null }),
      }),
    );
    for (const k of ["fear_greed", "stablecoins", "btc_dominance", "coinbase_premium", "skew"])
      expect(lean(c, k)).toBeUndefined();
    expect(lean(c, "nasdaq")).toBe("info");
    expect(lean(c, "vix")).toBe("info");
    expect(lean(c, "dxy")).toBe("short");
  });

  it("never shows stale readings as current", () => {
    const c = buildTradeCheck(
      input({
        context: ctx({ computedAt: iso(NOW - 2 * H) }),
        desk: null,
        macro: { updatedAt: iso(NOW - 5 * 24 * H), series: [] },
      }),
    );
    expect(
      c.factors.filter(
        (f) => f.group === "positioning" && f.key !== "whales" && f.key !== "liquidations",
      ),
    ).toHaveLength(0);
    expect(c.factors.some((f) => f.group === "macro")).toBe(false);
    expect(c.missing.join(" ")).toContain("FRED");
    expect(c.price).toBeNull();
  });

  it("never uses buy/sell wording", () => {
    const c = buildTradeCheck(input());
    const text = [
      ...c.factors.flatMap((f) => [f.value, f.why, f.label]),
      ...c.reading,
      ...c.flags.map((f) => f.text),
    ].join(" ");
    expect(text).not.toMatch(
      /\b(buy signal|sell signal|go long|go short|you should|bullish|bearish)\b/i,
    );
  });
});
