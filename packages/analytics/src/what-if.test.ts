import { whatIfFiltersSchema } from "@atc/shared";
import { describe, expect, it } from "vitest";
import { computeAnalytics } from "./compute.js";
import { correlateToBtc } from "./correlation.js";
import { runWhatIf, type WhatIfTrade } from "./what-if.js";

const now = new Date("2026-10-10T12:00:00Z");
const range = { from: null, to: "2026-10-10", timezone: "UTC" };
const opts = { timeZone: "UTC", now, range };

let n = 0;
function trade(
  open: string,
  close: string,
  pnl: number,
  extra: Partial<WhatIfTrade> = {},
): WhatIfTrade {
  n += 1;
  return {
    id: `t${String(n).padStart(3, "0")}`,
    symbol: "BTCUSDT",
    direction: "LONG",
    openedAt: new Date(open),
    closedAt: new Date(close),
    netPnl: String(pnl),
    fees: "1",
    funding: "0",
    holdingSeconds: 600,
    settleAsset: "USDT",
    ...extra,
  };
}

const day = [
  trade("2026-10-01T08:00:00Z", "2026-10-01T08:30:00Z", -50),
  trade("2026-10-01T09:00:00Z", "2026-10-01T09:30:00Z", -40),
  // Opened after two losses had closed.
  trade("2026-10-01T10:00:00Z", "2026-10-01T10:30:00Z", -100, { mistakes: ["REVENGE"] }),
  trade("2026-10-01T11:00:00Z", "2026-10-01T11:30:00Z", 30),
  trade("2026-10-02T14:00:00Z", "2026-10-02T15:00:00Z", 120, { riskAmount: "200", planned: true }),
];

const f = (over: Record<string, unknown> = {}) => whatIfFiltersSchema.parse(over);

describe("what-if lab", () => {
  it("with no rules equals the analytics figures exactly", () => {
    const res = runWhatIf(day, f(), opts);
    const base = computeAnalytics(day, opts);
    expect(res.scenario).toEqual(res.actual);
    expect(res.actual.netPnl).toBe(base.summary.netPnl);
    expect(res.actual.maxDrawdown).toBe(base.summary.maxDrawdown);
    expect(res.removed).toBe(0);
  });

  it("stops for the day after losses in a row, using only trades already closed", () => {
    const res = runWhatIf(day, f({ stopAfterLosses: 2 }), opts);
    expect(res.removed).toBe(2);
    expect(res.scenario.netPnl).toBe("30");
    expect(res.difference.netPnl).toBe("70");
    expect(res.reasons[0]).toEqual({ reason: "After 2 losses in a row", trades: 2, pnl: "-70" });
    expect(res.label).toBe("Stopping after 2 losses in a row");
  });

  it("does not count a loss that had not closed yet", () => {
    const overlap = [
      trade("2026-10-03T08:00:00Z", "2026-10-03T12:00:00Z", -50),
      trade("2026-10-03T09:00:00Z", "2026-10-03T09:30:00Z", -50),
      trade("2026-10-03T10:00:00Z", "2026-10-03T10:30:00Z", 80),
    ];
    // Only one loss had closed when the third trade opened.
    expect(runWhatIf(overlap, f({ stopAfterLosses: 2 }), opts).removed).toBe(0);
  });

  it("applies the daily loss limit and the trade cap", () => {
    expect(runWhatIf(day, f({ maxDailyLoss: 80 }), opts).removed).toBe(2);
    expect(runWhatIf(day, f({ maxTradesPerDay: 1 }), opts).removed).toBe(3);
  });

  it("skips tagged trades and keeps only planned ones", () => {
    expect(runWhatIf(day, f({ skipTags: ["REVENGE"] }), opts).scenario.netPnl).toBe("60");
    expect(runWhatIf(day, f({ onlyPlanned: true }), opts).scenario.trades).toBe(1);
  });

  it("scales oversized trades down to the risk cap and counts trades without a stop", () => {
    const res = runWhatIf(day, f({ riskCapUsd: 100 }), opts);
    expect(res.scaled).toBe(1);
    expect(res.noStop).toBe(4);
    expect(res.scenario.netPnl).toBe("-100");
  });

  it("leaves non-USD trades out of both sides", () => {
    const res = runWhatIf(
      [...day, trade("2026-10-04T08:00:00Z", "2026-10-04T09:00:00Z", 1, { settleAsset: "BTC" })],
      f(),
      opts,
    );
    expect(res.excludedTrades).toBe(1);
    expect(res.actual.trades).toBe(5);
  });
});

describe("BTC correlation", () => {
  const btc = Array.from({ length: 100 }, (_, i) => ({
    t: i,
    c: 100 + Math.sin(i / 3) * 5 + i * 0.1,
  }));
  it("is 1 with beta 1 for the same moves", () => {
    const r = correlateToBtc(btc, btc, 100);
    expect(r?.corr).toBeCloseTo(1, 4);
    expect(r?.beta).toBeCloseTo(1, 4);
  });
  it("finds a coin that moves twice as hard", () => {
    const coin = btc.map((p, i) => ({ t: p.t, c: 50 * (p.c / (btc[0]?.c ?? 1)) ** 2 + i * 0 }));
    const r = correlateToBtc(coin, btc, 100);
    expect(r?.corr).toBeGreaterThan(0.99);
    expect(r?.beta).toBeCloseTo(2, 1);
  });
  it("finds opposite moves", () => {
    const coin = btc.map((p) => ({ t: p.t, c: 10_000 / p.c }));
    expect(correlateToBtc(coin, btc, 100)?.corr).toBeCloseTo(-1, 3);
  });
  it("refuses thin samples", () => {
    expect(correlateToBtc(btc.slice(0, 50), btc, 100)).toBeNull();
  });
});
