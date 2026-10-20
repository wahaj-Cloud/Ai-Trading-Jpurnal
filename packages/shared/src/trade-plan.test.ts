import { describe, expect, it } from "vitest";
import { scalpAlertMet } from "./scalp-alerts.js";
import {
  buildTradePlan,
  exchangeTradeUrl,
  planBothSides,
  planFromQuery,
  planLine,
  planToQuery,
  roundQty,
} from "./trade-plan.js";

describe("trade plan", () => {
  const rules = { stopRanges: 1.5, targetR: 2, riskUsd: 50 };

  it("puts the stop and target where the rules say, both sides", () => {
    const { long, short } = planBothSides({ entry: 2000, atr5m: 4, rules });
    expect(long?.stop).toBe(1994);
    expect(long?.target).toBe(2012);
    expect(short?.stop).toBe(2006);
    expect(short?.target).toBe(1988);
    expect(long?.stopPct).toBeCloseTo(0.3, 12);
  });

  it("sizes so the loss at the stop, fees included, stays within the money at risk", () => {
    const p = buildTradePlan({ side: "LONG", price: 2000, atr5m: 4, rules });
    // Per coin: 6 + 0.0005 × (2000 + 1994) = 7.997 lost; 50 / 7.997 = 6.2523… → 6.252.
    expect(p?.qty).toBe(6.252);
    expect(p?.lossAtStopUsd).toBeCloseTo(6.252 * 7.997, 9);
    expect(p?.lossAtStopUsd).toBeLessThanOrEqual(50);
    expect(p?.gainAtTargetUsd).toBeCloseTo(6.252 * (12 - 0.0005 * 4012), 9);
    expect(p?.rrAfterFees).toBeCloseTo((12 - 2.006) / 7.997, 12);
    expect(p?.rrAfterFees).toBeLessThan(2);
  });

  it("gives no size without money at risk, and no plan without a range", () => {
    expect(
      buildTradePlan({ side: "LONG", price: 1, atr5m: 0.01, rules: { ...rules, riskUsd: null } })
        ?.qty,
    ).toBeNull();
    expect(buildTradePlan({ side: "LONG", price: 1, atr5m: null, rules })).toBeNull();
    expect(buildTradePlan({ side: "LONG", price: 1, atr5m: 1, rules })).toBeNull();
  });

  it("rounds quantities down to 4 significant figures", () => {
    expect(roundQty(0.0123456)).toBe(0.01234);
    expect(roundQty(12.349)).toBe(12.34);
    expect(roundQty(1234.9)).toBe(1234);
    expect(roundQty(123456.7)).toBe(123400);
    expect(roundQty(0.3)).toBe(0.3);
    expect(roundQty(-1)).toBe(0);
  });

  it("travels in a link and comes back the same; bad links give nothing", () => {
    const snap = { entry: 2000.5, atr5m: 3.25, rules, at: 1_760_000_000_000 };
    const back = planFromQuery(Object.fromEntries(new URLSearchParams(planToQuery(snap))));
    expect(back).toEqual(snap);
    expect(
      planFromQuery({ entry: "2000", atr: "3", sr: "1.5", tr: "2", at: "1" })?.rules.riskUsd,
    ).toBeNull();
    expect(planFromQuery({ entry: "-1", atr: "3", sr: "1.5", tr: "2", at: "1" })).toBeNull();
    expect(planFromQuery({ entry: "2000", atr: "3", sr: "99", tr: "2", at: "1" })).toBeNull();
    expect(planFromQuery({ entry: "abc", atr: "3", sr: "1", tr: "2", at: "1" })).toBeNull();
    expect(planFromQuery({})).toBeNull();
  });

  it("the alert line names both sides and leaves the call to the trader", () => {
    const line = planLine({ entry: 2000, atr5m: 4, rules }, (n) => n.toFixed(1));
    expect(line).toContain("long → stop 1994.0, target 2012.0");
    expect(line).toContain("short → stop 2006.0, target 1988.0");
    expect(line).toContain("is your call");
    expect(line).not.toMatch(/\b(buy|sell|signal|bullish|bearish)\b/i);
  });

  it("links to the market on each exchange; MetaTrader has none", () => {
    expect(exchangeTradeUrl("BINANCE", "XAUUSDT")).toBe(
      "https://www.binance.com/en/futures/XAUUSDT",
    );
    expect(exchangeTradeUrl("OKX", "BTCUSDT")).toBe("https://www.okx.com/trade-swap/btc-usdt-swap");
    expect(exchangeTradeUrl("MEXC", "ETHUSDT")).toBe("https://futures.mexc.com/exchange/ETH_USDT");
    expect(exchangeTradeUrl("KUCOIN", "BTCUSDT")).toBe(
      "https://www.kucoin.com/trade/futures/XBTUSDTM",
    );
    expect(exchangeTradeUrl("EXNESS", "XAUUSDT")).toBeNull();
  });

  it("an alert condition is unchanged by the plan", () => {
    expect(
      scalpAlertMet(
        { direction: "ANY", minCount: 3, noNews: true },
        { tally: { up: 4, down: 1, neutral: 0 }, flags: [] },
      ),
    ).toBe("up");
  });
});
