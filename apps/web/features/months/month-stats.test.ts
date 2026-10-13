import type { DayDto } from "@atc/shared";
import { describe, expect, it } from "vitest";
import { monthLabel, monthStats, shiftMonth } from "./month-stats";

const day = (date: string, pnl: string, trades: number, wins: number): DayDto => ({
  date,
  pnl,
  trades,
  wins,
  cumulative: "0",
  drawdown: "0",
});

const days = [
  day("2026-09-30", "50", 2, 2),
  day("2026-10-01", "40", 3, 2),
  day("2026-10-02", "-25.5", 4, 1),
  day("2026-10-06", "10", 1, 1),
];

describe("monthStats", () => {
  it("sums only the requested month", () => {
    const s = monthStats(days, "2026-10");
    expect(s.trades).toBe(8);
    expect(s.wins).toBe(4);
    expect(s.winRate).toBe(0.5);
    expect(s.net).toBeCloseTo(24.5);
    expect(s.tradingDays).toBe(3);
    expect(s.greenDays).toBe(2);
    expect(s.redDays).toBe(1);
    expect(s.best?.date).toBe("2026-10-01");
    expect(s.worst?.date).toBe("2026-10-02");
  });

  it("handles an empty month", () => {
    const s = monthStats(days, "2026-11");
    expect(s.trades).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.best).toBeNull();
    expect(s.avgDay).toBeNull();
  });

  it("shifts and names months", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
});
