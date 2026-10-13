import type { AnalyticsDto, PositionDto } from "@atc/shared";
import { describe, expect, it } from "vitest";
import {
  convertAnalytics,
  convertOpenPositions,
  convertPosition,
  type Display,
  USD_DISPLAY,
} from "./convert";

const PKR: Display = { code: "PKR", rate: 280, asOf: "2026-10-13T00:00:00.000Z" };

const bucket = (key: string, pnl: string) => ({
  key,
  trades: 2,
  wins: 1,
  losses: 1,
  winRate: 0.5,
  pnl,
  avgPnl: String(Number(pnl) / 2),
});

const analytics = {
  range: { from: null, to: "2026-10-13", timezone: "Asia/Karachi" },
  currency: "USD",
  summary: {
    trades: 2,
    wins: 1,
    losses: 1,
    breakeven: 0,
    netPnl: "10.5",
    grossProfit: "20",
    grossLoss: "9.5",
    winRate: 0.5,
    profitFactor: 2.1,
    expectancy: "5.25",
    avgWin: "20",
    avgLoss: "9.5",
    payoffRatio: 2.1,
    largestWin: "20",
    largestLoss: "-9.5",
    fees: "1",
    funding: "0",
    maxDrawdown: "9.5",
    currentDrawdown: "0",
    currentStreak: { kind: "WIN", count: 1 },
    longestWinStreak: 1,
    longestLossStreak: 1,
    avgHoldWinSeconds: null,
    avgHoldLossSeconds: null,
    tradingDays: 2,
    profitableDays: 1,
    bestDay: { date: "2026-10-12", pnl: "20" },
    worstDay: null,
    avgR: null,
    tradesWithR: 0,
  },
  today: { pnl: "-9.5", trades: 1 },
  thisMonth: { pnl: "10.5", trades: 2 },
  daily: [{ date: "2026-10-12", pnl: "20", trades: 1, wins: 1, cumulative: "20", drawdown: "0" }],
  monthly: [{ month: "2026-10", pnl: "10.5", trades: 2, wins: 1 }],
  bySymbol: [bucket("BTCUSDT", "10.5")],
  byWeekday: [],
  byHour: [],
  bySession: [bucket("LONDON", "10.5")],
  byDirection: [],
  bySetup: [],
  byMistake: [],
  byEmotion: [],
  byTag: [],
  excluded: { trades: 0, assets: [] },
} as unknown as AnalyticsDto;

const position = (settleAsset: string): PositionDto =>
  ({
    id: "p1",
    settleAsset,
    entryPrice: "60000",
    exitPrice: "61000",
    grossPnl: "11",
    fees: "0.5",
    funding: null,
    netPnl: "10.5",
  }) as unknown as PositionDto;

describe("display currency", () => {
  it("leaves USD untouched (same object)", () => {
    expect(convertAnalytics(analytics, USD_DISPLAY)).toBe(analytics);
  });

  it("converts every amount and nothing else", () => {
    const c = convertAnalytics(analytics, PKR);
    expect(c.currency).toBe("PKR");
    expect(c.summary.netPnl).toBe("2940");
    expect(c.summary.largestLoss).toBe("-2660");
    expect(c.summary.bestDay?.pnl).toBe("5600");
    expect(c.summary.profitFactor).toBe(2.1);
    expect(c.summary.winRate).toBe(0.5);
    expect(c.today.pnl).toBe("-2660");
    expect(c.daily[0]?.cumulative).toBe("5600");
    expect(c.monthly[0]?.pnl).toBe("2940");
    expect(c.bySession[0]?.avgPnl).toBe("1470");
    expect(c.bySession[0]?.trades).toBe(2);
  });

  it("converts USD-settled trades but never prices or coin-settled ones", () => {
    const p = convertPosition(position("USDT"), PKR);
    expect(p.netPnl).toBe("2940");
    expect(p.fees).toBe("140");
    expect(p.funding).toBeNull();
    expect(p.entryPrice).toBe("60000");
    expect(p.settleAsset).toBe("PKR");
    const btc = position("BTC");
    expect(convertPosition(btc, PKR)).toBe(btc);
  });

  it("converts open positions' P&L and size in money", () => {
    const o = convertOpenPositions(
      {
        unrealizedPnl: "2",
        asOf: null,
        items: [
          { settleAsset: "USDT", unrealizedPnl: "2", notional: "100", markPrice: "5" },
        ] as never,
      },
      PKR,
    );
    expect(o.unrealizedPnl).toBe("560");
    expect(o.items[0]?.notional).toBe("28000");
    expect(o.items[0]?.markPrice).toBe("5");
  });
});
