import { describe, expect, it } from "vitest";
import {
  closePaperTrade,
  createPaperBotSchema,
  FUNDING_EVERY_MS,
  fundingCost,
  fundingTimesBetween,
  openPaperTrade,
  type PaperRules,
  type PaperTradeDto,
  paperBreakdown,
  paperExit,
  paperMaturity,
  paperSessionOf,
  paperStats,
} from "./paper.js";

const rules: PaperRules = {
  stopRanges: 1.5,
  targetR: 2,
  maxHoldMin: 60,
  riskPct: 1,
  feeBps: 5,
  slippageBps: 2,
};
const T = Date.UTC(2026, 9, 20, 9, 30);

describe("opening a paper trade", () => {
  it("fills against the bot by the slippage and sizes on the risk", () => {
    const t = openPaperTrade({ rules, side: "LONG", price: 100, range: 2, equity: 10_000, at: T });
    expect(t?.entryPrice).toBeCloseTo(100.02, 12);
    expect(t?.stop).toBeCloseTo(100.02 - 3, 12);
    expect(t?.target).toBeCloseTo(100.02 + 6, 12);
    // 1% of 10,000 = 100 at risk over a 3.00 stop.
    expect(t?.qty).toBeCloseTo(100 / 3, 12);
    expect(t?.riskUsd).toBeCloseTo(100, 9);
    expect(t?.fees).toBeCloseTo(((100 / 3) * 100.02 * 5) / 10_000, 12);
  });

  it("mirrors for a short", () => {
    const t = openPaperTrade({ rules, side: "SHORT", price: 100, range: 2, equity: 10_000, at: T });
    expect(t?.entryPrice).toBeCloseTo(99.98, 12);
    expect(t?.stop).toBeCloseTo(102.98, 12);
    expect(t?.target).toBeCloseTo(93.98, 12);
  });

  it("caps the position at 20× the balance when the stop is very tight", () => {
    const t = openPaperTrade({
      rules: { ...rules, stopRanges: 0.3 },
      side: "LONG",
      price: 100,
      range: 0.01,
      equity: 1000,
      at: T,
    });
    expect((t?.qty ?? 0) * (t?.entryPrice ?? 0)).toBeCloseTo(20_000, 6);
    expect(t?.riskUsd).toBeLessThan(10);
  });

  it("opens nothing without a range, a price or money", () => {
    const base = { rules, side: "LONG" as const, price: 100, range: 2, equity: 100, at: T };
    expect(openPaperTrade({ ...base, range: null })).toBeNull();
    expect(openPaperTrade({ ...base, range: 0 })).toBeNull();
    expect(openPaperTrade({ ...base, price: 0 })).toBeNull();
    expect(openPaperTrade({ ...base, equity: -5 })).toBeNull();
    // A long stop below zero is impossible.
    expect(openPaperTrade({ ...base, range: 80 })).toBeNull();
  });
});

describe("exits", () => {
  const long = { side: "LONG" as const, entryAt: T, stop: 97, target: 106 };
  const short = { side: "SHORT" as const, entryAt: T, stop: 103, target: 94 };

  it("stop fills at the worse of stop and price, less slippage", () => {
    expect(paperExit(long, rules, 97, T + 1000)).toEqual({
      exitPrice: 97 * (1 - 0.0002),
      reason: "STOP",
    });
    // Jumped through the stop: fills where the price is.
    expect(paperExit(long, rules, 95, T + 1000)?.exitPrice).toBeCloseTo(95 * 0.9998, 12);
    expect(paperExit(short, rules, 104, T + 1000)?.exitPrice).toBeCloseTo(104 * 1.0002, 12);
  });

  it("target fills exactly at the target", () => {
    expect(paperExit(long, rules, 107, T + 1000)).toEqual({ exitPrice: 106, reason: "TARGET" });
    expect(paperExit(short, rules, 93, T + 1000)).toEqual({ exitPrice: 94, reason: "TARGET" });
  });

  it("time limit closes at the price, less slippage; nothing before it", () => {
    expect(paperExit(long, rules, 100, T + 59 * 60_000)).toBeNull();
    expect(paperExit(long, rules, 100, T + 60 * 60_000)).toEqual({
      exitPrice: 100 * 0.9998,
      reason: "TIME",
    });
  });
});

describe("funding", () => {
  it("lists the 8-hourly funding times after the entry", () => {
    const from = Date.UTC(2026, 9, 20, 7, 59);
    expect(fundingTimesBetween(from, Date.UTC(2026, 9, 20, 16, 0))).toEqual([
      Date.UTC(2026, 9, 20, 8),
      Date.UTC(2026, 9, 20, 16),
    ]);
    // Entered exactly at a funding time: that one is not charged.
    expect(fundingTimesBetween(Date.UTC(2026, 9, 20, 8), Date.UTC(2026, 9, 20, 9))).toEqual([]);
    expect(FUNDING_EVERY_MS).toBe(8 * 3_600_000);
  });

  it("longs pay a positive rate, shorts receive it", () => {
    expect(fundingCost("LONG", 2, 100, 0.0001)).toBeCloseTo(0.02, 12);
    expect(fundingCost("SHORT", 2, 100, 0.0001)).toBeCloseTo(-0.02, 12);
  });
});

describe("closing", () => {
  it("books the move less both fees and funding, and its R", () => {
    const open = { side: "LONG" as const, entryPrice: 100, qty: 10, riskUsd: 30, fees: 0.5 };
    const c = closePaperTrade(open, 5, 106, 0.2);
    expect(c.fees).toBeCloseTo(0.5 + 0.53, 12);
    expect(c.pnl).toBeCloseTo(60 - 1.03 - 0.2, 12);
    expect(c.rMultiple).toBeCloseTo((60 - 1.23) / 30, 12);
    const s = closePaperTrade({ ...open, side: "SHORT" }, 5, 106, -0.2);
    expect(s.pnl).toBeCloseTo(-60 - 1.03 + 0.2, 12);
  });
});

const tr = (pnl: number, r: number, entryAt = "2026-10-20T09:00:00Z"): PaperTradeDto => ({
  id: String(Math.random()),
  symbol: "XAUUSDT",
  side: pnl >= 0 ? "LONG" : "SHORT",
  entryAt,
  entryPrice: 1,
  stop: 1,
  target: 1,
  qty: 1,
  riskUsd: 1,
  entryNote: null,
  exitAt: entryAt,
  exitPrice: 1,
  exitReason: pnl >= 0 ? "TARGET" : "STOP",
  fees: 1,
  funding: 0.5,
  pnl,
  rMultiple: r,
  status: "CLOSED",
});

describe("results", () => {
  it("counts wins, profit factor, R and the deepest drop", () => {
    const s = paperStats([tr(200, 2), tr(-100, -1), tr(-100, -1), tr(300, 3)], 1000);
    expect(s.trades).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.winRatePct).toBe(50);
    expect(s.netPnl).toBe(300);
    expect(s.returnPct).toBe(30);
    expect(s.profitFactor).toBe(2.5);
    expect(s.avgR).toBe(0.75);
    expect(s.expectancyUsd).toBe(75);
    // Peak 1200, low 1000.
    expect(s.maxDrawdownPct).toBeCloseTo((200 / 1200) * 100, 12);
    expect(s.fees).toBe(4);
    expect(s.funding).toBe(2);
    expect(s.bestR).toBe(3);
    expect(s.worstR).toBe(-1);
  });

  it("has nothing to say with no trades, and no profit factor without a loss", () => {
    const s = paperStats([], 1000);
    expect(s.winRatePct).toBeNull();
    expect(s.avgR).toBeNull();
    expect(paperStats([tr(5, 1)], 1000).profitFactor).toBeNull();
  });

  it("groups by session", () => {
    expect(paperSessionOf(Date.UTC(2026, 0, 1, 7, 59))).toBe("asia");
    expect(paperSessionOf(Date.UTC(2026, 0, 1, 8))).toBe("london");
    expect(paperSessionOf(Date.UTC(2026, 0, 1, 13))).toBe("new_york");
    expect(paperSessionOf(Date.UTC(2026, 0, 1, 21))).toBe("late");
    const rows = paperBreakdown(
      [
        tr(10, 1, "2026-10-20T02:00:00Z"),
        tr(-5, -0.5, "2026-10-20T02:30:00Z"),
        tr(4, 0.4, "2026-10-20T14:00:00Z"),
      ],
      (t) => paperSessionOf(Date.parse(t.entryAt)),
      { asia: "Asia", london: "London", new_york: "New York", late: "Late" },
    );
    expect(rows.map((r) => [r.key, r.trades, r.netPnl])).toEqual([
      ["asia", 2, 5],
      ["new_york", 1, 4],
    ]);
    expect(rows[0]?.avgR).toBe(0.25);
  });

  it("says when a run is too young to judge", () => {
    const start = Date.UTC(2026, 9, 1);
    expect(paperMaturity(start, start + 3 * 86_400_000, 4).ready).toBe(false);
    expect(paperMaturity(start, start + 3 * 86_400_000, 4).text).toContain(
      "4–8 weeks and 30+ trades",
    );
    expect(paperMaturity(start, start + 29 * 86_400_000, 31).ready).toBe(true);
    expect(paperMaturity(start, start + 40 * 86_400_000, 12).text).toContain("30+ trades");
  });
});

describe("creating a bot", () => {
  it("fills defaults and refuses silly values", () => {
    const ok = createPaperBotSchema.parse({
      source: "COCKPIT",
      name: "Gold",
      symbol: "xauusdt",
      tf: "5m",
    });
    expect(ok).toMatchObject({ symbol: "XAUUSDT", minCount: 7, stopRanges: 1.5, riskPct: 1 });
    expect(
      createPaperBotSchema.safeParse({
        source: "COCKPIT",
        name: "x",
        symbol: "BTCUSDT",
        tf: "5m",
        riskPct: 50,
      }).success,
    ).toBe(false);
    expect(
      createPaperBotSchema.safeParse({
        source: "SETUP",
        name: "x",
        symbol: "BTCUSDT",
        setupId: "nope",
      }).success,
    ).toBe(false);
  });
});
