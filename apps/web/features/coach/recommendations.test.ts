import type { AnalyticsDto, BehaviourSummaryDto, BucketDto } from "@atc/shared";
import { describe, expect, it } from "vitest";
import { buildRecommendations } from "./recommendations";

const b = (key: string, trades: number, pnl: string, winRate = 0.5): BucketDto => ({
  key,
  trades,
  wins: Math.round(trades * winRate),
  losses: trades - Math.round(trades * winRate),
  winRate,
  pnl,
  avgPnl: String(Number(pnl) / trades),
});

function report(over: Partial<AnalyticsDto["summary"]> = {}): AnalyticsDto {
  return {
    summary: {
      trades: 68,
      wins: 44,
      losses: 24,
      winRate: 0.65,
      profitFactor: 0.7,
      avgWin: "30",
      avgLoss: "90",
      grossProfit: "1320",
      grossLoss: "2160",
      fees: "-120",
      maxDrawdown: "1500",
      currentDrawdown: "1200",
      tradingDays: 20,
      ...over,
    },
    bySession: [b("LONDON", 6, "-309.92", 0.67), b("OFF_HOURS", 22, "-1641.87", 0.55)],
    bySymbol: [b("XRPUSDT", 10, "-900", 0.3), b("BTCUSDT", 20, "120")],
    byDirection: [b("LONG", 40, "300"), b("SHORT", 28, "-1140")],
  } as unknown as AnalyticsDto;
}

const habits = {
  costByBehaviour: [
    { code: "HOLDING_LOSERS", trades: 14, netPnl: "-6400" },
    { code: "FOMO", trades: 1, netPnl: "3" },
  ],
} as unknown as BehaviourSummaryDto;

describe("recommendations", () => {
  it("stays quiet with too few trades", () => {
    expect(buildRecommendations(report({ trades: 5 }), null)).toEqual([]);
    expect(buildRecommendations(null, null)).toEqual([]);
  });

  it("finds the big leaks and ranks them by money at stake", () => {
    const recs = buildRecommendations(report(), habits, 10);
    const ids = recs.map((r) => r.id);
    expect(ids[0]).toBe("habit-HOLDING_LOSERS");
    expect(ids).toContain("payoff");
    expect(ids).toContain("session-OFF_HOURS");
    expect(ids).toContain("coin-XRPUSDT");
    expect(ids).toContain("direction");
    expect(ids).toContain("drawdown");
    expect(ids).not.toContain("fees");
    expect(recs.find((r) => r.id === "payoff")?.detail).toContain("3.0×");
  });

  it("limits how many it shows", () => {
    expect(buildRecommendations(report(), habits, 3)).toHaveLength(3);
  });
});
