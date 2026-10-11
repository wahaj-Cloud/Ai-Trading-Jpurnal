import { describe, expect, it } from "vitest";
import { type AnalyticsTrade, computeAnalytics, sessionOf } from "./compute.js";
import { resolveRange } from "./range.js";
import { tradeRisk } from "./risk.js";
import { localParts, startOfLocalDay } from "./time.js";

const range = { from: null, to: null, timezone: "UTC" };
let seq = 0;
function trade(netPnl: string, closedAt: string, extra: Partial<AnalyticsTrade> = {}) {
  seq += 1;
  const closed = new Date(closedAt);
  return {
    id: `t${String(seq).padStart(3, "0")}`,
    symbol: "BTCUSDT",
    direction: "LONG",
    openedAt: new Date(closed.getTime() - 3_600_000),
    closedAt: closed,
    netPnl,
    fees: "1",
    funding: "-0.5",
    holdingSeconds: 3600,
    settleAsset: "USDT",
    ...extra,
  } satisfies AnalyticsTrade;
}

describe("computeAnalytics summary", () => {
  // W W L L L W, then a break-even trade.
  const trades = [
    trade("100", "2026-09-01T10:00:00Z"),
    trade("40", "2026-09-01T12:00:00Z"),
    trade("-50", "2026-09-02T10:00:00Z"),
    trade("-30", "2026-09-03T10:00:00Z", { holdingSeconds: 7200 }),
    trade("-40", "2026-09-03T11:00:00Z", { holdingSeconds: 10800 }),
    trade("60", "2026-09-04T10:00:00Z"),
    trade("0", "2026-09-05T10:00:00Z"),
  ];
  const report = computeAnalytics(trades, {
    timeZone: "UTC",
    now: new Date("2026-09-05T12:00:00Z"),
    range,
  });
  const s = report.summary;

  it("counts, totals and ratios", () => {
    expect(s).toMatchObject({
      trades: 7,
      wins: 3,
      losses: 3,
      breakeven: 1,
      netPnl: "80",
      grossProfit: "200",
      grossLoss: "120",
      winRate: 0.5,
      profitFactor: 1.6667,
      avgWin: "66.66666667",
      avgLoss: "40",
      payoffRatio: 1.6667,
      largestWin: "100",
      largestLoss: "-50",
      fees: "7",
      funding: "-3.5",
    });
    expect(s.expectancy).toBe("11.42857143");
  });

  it("drawdown is peak-to-trough of cumulative results", () => {
    // Equity: 100, 140 (peak), 90, 60, 20 (trough: -120), 80, 80.
    expect(s.maxDrawdown).toBe("120");
    expect(s.currentDrawdown).toBe("60");
  });

  it("streaks ignore break-even trades", () => {
    expect(s.currentStreak).toEqual({ kind: "WIN", length: 1 });
    expect(s.longestWinStreak).toBe(2);
    expect(s.longestLossStreak).toBe(3);
  });

  it("holding time of winners vs losers", () => {
    expect(s.avgHoldWinSeconds).toBe(3600);
    expect(s.avgHoldLossSeconds).toBe(7200);
  });

  it("daily series with equity, drawdown, best and worst day", () => {
    expect(report.daily.map((d) => [d.date, d.pnl, d.cumulative, d.drawdown])).toEqual([
      ["2026-09-01", "140", "140", "0"],
      ["2026-09-02", "-50", "90", "50"],
      ["2026-09-03", "-70", "20", "120"],
      ["2026-09-04", "60", "80", "60"],
      ["2026-09-05", "0", "80", "60"],
    ]);
    expect(s.tradingDays).toBe(5);
    expect(s.profitableDays).toBe(2);
    expect(s.bestDay).toEqual({ date: "2026-09-01", pnl: "140" });
    expect(s.worstDay).toEqual({ date: "2026-09-03", pnl: "-70" });
    expect(report.today).toEqual({ pnl: "0", trades: 1 });
    expect(report.thisMonth).toEqual({ pnl: "80", trades: 7 });
    expect(report.monthly).toEqual([{ month: "2026-09", pnl: "80", trades: 7, wins: 3 }]);
  });

  it("fixed-shape breakdowns", () => {
    expect(report.byWeekday.map((b) => b.key)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(report.byHour).toHaveLength(24);
    // Every trade opened between 09:00 and 11:00 UTC -> London session.
    expect(report.byHour[9]?.trades).toBe(5);
    expect(report.byWeekday[1]).toMatchObject({ key: "Tue", trades: 2, pnl: "140" });
    expect(report.bySession.map((b) => [b.key, b.trades])).toEqual([
      ["ASIA", 0],
      ["LONDON", 7],
      ["NEW_YORK", 0],
      ["OFF_HOURS", 0],
    ]);
  });
});

describe("computeAnalytics edge cases", () => {
  it("no trades: zeros and nulls, never NaN", () => {
    const r = computeAnalytics([], { timeZone: "UTC", now: new Date(), range });
    expect(r.summary).toMatchObject({
      trades: 0,
      winRate: null,
      profitFactor: null,
      expectancy: null,
      payoffRatio: null,
      maxDrawdown: "0",
      currentStreak: { kind: null, length: 0 },
      bestDay: null,
      worstDay: null,
    });
    expect(r.daily).toEqual([]);
  });

  it("no losses: profit factor is undefined rather than infinite", () => {
    const r = computeAnalytics([trade("10", "2026-09-01T10:00:00Z")], {
      timeZone: "UTC",
      now: new Date(),
      range,
    });
    expect(r.summary.profitFactor).toBeNull();
    expect(r.summary.winRate).toBe(1);
  });

  it("days follow the trader's timezone", () => {
    // 20:30 UTC on the 26th is 01:30 on the 27th in Karachi (UTC+5).
    const t = trade("5", "2026-09-26T20:30:00Z");
    const utc = computeAnalytics([t], { timeZone: "UTC", now: new Date(), range });
    const pk = computeAnalytics([t], { timeZone: "Asia/Karachi", now: new Date(), range });
    expect(utc.daily[0]?.date).toBe("2026-09-26");
    expect(pk.daily[0]?.date).toBe("2026-09-27");
    // Opened 19:30 UTC = 00:30 Karachi.
    expect(pk.byHour[0]?.trades).toBe(1);
    expect(utc.byHour[19]?.trades).toBe(1);
  });

  it("coin-settled (inverse) trades are reported separately, not added to USD totals", () => {
    const r = computeAnalytics(
      [
        trade("10", "2026-09-01T10:00:00Z"),
        trade("0.002", "2026-09-01T11:00:00Z", { settleAsset: "BTC", symbol: "BTCUSD" }),
      ],
      { timeZone: "UTC", now: new Date(), range },
    );
    expect(r.summary.trades).toBe(1);
    expect(r.summary.netPnl).toBe("10");
    expect(r.excluded).toEqual({ trades: 1, assets: ["BTC"] });
  });

  it("journal breakdowns and R multiples", () => {
    const r = computeAnalytics(
      [
        trade("200", "2026-09-01T10:00:00Z", {
          setup: "Breakout",
          riskAmount: "100",
          emotions: ["CALM"],
        }),
        trade("-150", "2026-09-02T10:00:00Z", {
          setup: "Breakout",
          riskAmount: "100",
          mistakes: ["MOVED_STOP", "OVERSIZED"],
          emotions: ["REVENGE"],
        }),
        trade("-20", "2026-09-03T10:00:00Z", { mistakes: ["CHASED_ENTRY"], tags: ["news"] }),
      ],
      { timeZone: "UTC", now: new Date(), range },
    );
    expect(r.summary.avgR).toBe(0.25); // (+2R + -1.5R) / 2
    expect(r.summary.tradesWithR).toBe(2);
    expect(r.bySetup).toEqual([
      { key: "Breakout", trades: 2, wins: 1, losses: 1, winRate: 0.5, pnl: "50", avgPnl: "25" },
    ]);
    // Costliest mistake first.
    expect(r.byMistake.map((b) => [b.key, b.pnl])).toEqual([
      ["MOVED_STOP", "-150"],
      ["OVERSIZED", "-150"],
      ["CHASED_ENTRY", "-20"],
    ]);
    expect(r.byEmotion.map((b) => b.key)).toEqual(["CALM", "REVENGE"]);
    expect(r.byTag).toHaveLength(1);
  });

  it("results are exact decimals", () => {
    const r = computeAnalytics(
      [trade("0.1", "2026-09-01T10:00:00Z"), trade("0.2", "2026-09-01T11:00:00Z")],
      { timeZone: "UTC", now: new Date(), range },
    );
    expect(r.summary.netPnl).toBe("0.3");
  });
});

describe("sessions", () => {
  it.each([
    ["2026-09-01T00:00:00Z", "ASIA"],
    ["2026-09-01T06:59:59Z", "ASIA"],
    ["2026-09-01T07:00:00Z", "LONDON"],
    ["2026-09-01T13:00:00Z", "NEW_YORK"],
    ["2026-09-01T20:59:00Z", "NEW_YORK"],
    ["2026-09-01T21:00:00Z", "OFF_HOURS"],
  ])("%s -> %s", (iso, session) => {
    expect(sessionOf(new Date(iso))).toBe(session);
  });
});

describe("time and ranges", () => {
  it("local midnight to UTC, across daylight saving changes", () => {
    expect(startOfLocalDay("2026-09-27", "Asia/Karachi").toISOString()).toBe(
      "2026-09-26T19:00:00.000Z",
    );
    // New York switches to daylight time at 02:00 on 8 March 2026.
    expect(startOfLocalDay("2026-03-08", "America/New_York").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(startOfLocalDay("2026-03-09", "America/New_York").toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
    expect(localParts(new Date("2026-03-08T06:59:00Z"), "America/New_York")).toMatchObject({
      date: "2026-03-08",
      hour: 1,
      weekday: 6,
    });
  });

  it("presets count today as the last day", () => {
    const now = new Date("2026-09-26T19:30:00Z"); // 00:30 on the 27th in Karachi
    expect(resolveRange({ range: "7d" }, "Asia/Karachi", now)).toEqual({
      from: new Date("2026-09-20T19:00:00.000Z"),
      to: null,
      fromDay: "2026-09-21",
      toDay: "2026-09-27",
    });
    expect(resolveRange({ range: "ytd" }, "UTC", now).fromDay).toBe("2026-01-01");
    expect(resolveRange({ range: "all" }, "UTC", now).from).toBeNull();
  });

  it("custom ranges include the last day", () => {
    expect(
      resolveRange({ range: "all", from: "2026-09-01", to: "2026-09-30" }, "UTC", new Date()),
    ).toEqual({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-10-01T00:00:00.000Z"),
      fromDay: "2026-09-01",
      toDay: "2026-09-30",
    });
  });
});

describe("tradeRisk", () => {
  const base = {
    direction: "LONG" as const,
    entryPrice: "100",
    quantity: "2",
    netPnl: "30",
    stopPrice: "95",
    targetPrice: "115",
    inverse: false,
  };
  it("R multiple and planned reward-to-risk", () => {
    expect(tradeRisk(base)).toEqual({ riskAmount: "10", rMultiple: 3, plannedRewardRisk: 3 });
  });
  it("shorts measure risk upwards", () => {
    expect(
      tradeRisk({
        ...base,
        direction: "SHORT",
        stopPrice: "110",
        targetPrice: "80",
        netPnl: "-20",
      }),
    ).toEqual({ riskAmount: "20", rMultiple: -1, plannedRewardRisk: 2 });
  });
  it("a stop on the wrong side has no initial risk", () => {
    expect(tradeRisk({ ...base, stopPrice: "105" }).rMultiple).toBeNull();
  });
  it("inverse contracts are not measured yet", () => {
    expect(tradeRisk({ ...base, inverse: true }).riskAmount).toBeNull();
  });
});

describe("risk limits and goals", () => {
  it("daily loss: near at 80%, breached at the limit; profit target hit", async () => {
    const { evaluateRiskLimits } = await import("./goals.js");
    const limits = {
      maxDailyLoss: "100",
      maxTradesPerDay: 5,
      maxDrawdown: "500",
      dailyProfitTarget: "200",
    };
    const near = evaluateRiskLimits(limits, { pnl: "-85", trades: 4 }, "300");
    expect(near.map((r) => [r.rule, r.state])).toEqual([
      ["MAX_DAILY_LOSS", "NEAR"],
      ["MAX_TRADES_PER_DAY", "NEAR"],
      ["MAX_DRAWDOWN", "OK"],
      ["DAILY_PROFIT_TARGET", "OK"],
    ]);
    const bad = evaluateRiskLimits(limits, { pnl: "-100", trades: 6 }, "520");
    expect(bad.filter((r) => r.state === "BREACHED").map((r) => r.rule)).toEqual([
      "MAX_DAILY_LOSS",
      "MAX_TRADES_PER_DAY",
      "MAX_DRAWDOWN",
    ]);
    expect(bad[0]?.message).toContain("Stop trading for today");
    expect(evaluateRiskLimits(limits, { pnl: "250", trades: 1 }, "0")[3]?.state).toBe("HIT");
    expect(
      evaluateRiskLimits(
        { maxDailyLoss: null, maxTradesPerDay: null, maxDrawdown: null, dailyProfitTarget: null },
        { pnl: "0", trades: 0 },
        "0",
      ),
    ).toEqual([]);
  });

  it("goal periods: Monday weeks and calendar months", async () => {
    const { goalPeriod } = await import("./goals.js");
    expect(goalPeriod("WEEK", "2026-09-27")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
    expect(goalPeriod("MONTH", "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("goal states: pace, met, and 'at most' goals", async () => {
    const { evaluateGoal } = await import("./goals.js");
    const period = { start: "2026-09-01", end: "2026-09-30" };
    const figures = { netPnl: "300", winRate: 0.6, profitFactor: 1.8, trades: 10, reviewed: 4 };
    const g = (metric: string, target: string) => ({
      id: "g",
      period: "MONTH" as const,
      metric: metric as never,
      target,
    });
    expect(evaluateGoal(g("NET_PNL", "1000"), figures, period, 0.5).state).toBe("BEHIND");
    expect(evaluateGoal(g("NET_PNL", "500"), figures, period, 0.5).state).toBe("ON_TRACK");
    expect(evaluateGoal(g("WIN_RATE", "55"), figures, period, 0.5).state).toBe("ON_TRACK");
    expect(evaluateGoal(g("WIN_RATE", "55"), figures, period, 1).state).toBe("MET");
    expect(evaluateGoal(g("REVIEW_RATE", "80"), figures, period, 0.5)).toMatchObject({
      value: "40",
      state: "BEHIND",
    });
    expect(evaluateGoal(g("MAX_TRADES", "8"), figures, period, 0.5).state).toBe("FAILED");
    expect(evaluateGoal(g("MAX_TRADES", "20"), figures, period, 1).state).toBe("MET");
  });
});
