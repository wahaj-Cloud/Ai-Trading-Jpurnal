import { describe, expect, it } from "vitest";
import {
  expectancy,
  kelly,
  monteCarlo,
  positionSize,
  recoveryNeeded,
  requiredWinRate,
  riskOfRuin,
  riskReward,
  tradeProfit,
} from "./calc";

describe("calculators", () => {
  it("sizes a position from risk and stop distance", () => {
    const s = positionSize(10_000, 1, 60_000, 59_400, 10);
    expect(s?.riskAmount).toBe(100);
    expect(s?.quantity).toBeCloseTo(100 / 600);
    expect(s?.notional).toBeCloseTo(10_000);
    expect(s?.margin).toBeCloseTo(1_000);
    expect(positionSize(10_000, 1, 100, 100)).toBeNull();
  });

  it("computes reward-to-risk and rejects a target on the stop's side", () => {
    const rr = riskReward(100, 95, 112.5);
    expect(rr?.ratio).toBe(2.5);
    expect(rr?.breakevenWinRate).toBeCloseTo(28.571, 2);
    expect(riskReward(100, 95, 90)).toBeNull();
  });

  it("computes profit for longs and shorts after fees", () => {
    expect(tradeProfit("LONG", 100, 110, 2, 0)?.net).toBe(20);
    const short = tradeProfit("SHORT", 100, 90, 1, 0.05);
    expect(short?.gross).toBe(10);
    expect(short?.fees).toBeCloseTo(0.095);
  });

  it("knows a 50% drawdown needs a 100% gain", () => {
    expect(recoveryNeeded(50)).toBe(100);
    expect(recoveryNeeded(20)).toBe(25);
    expect(recoveryNeeded(100)).toBeNull();
  });

  it("computes expectancy, required win rate and Kelly", () => {
    expect(expectancy(40, 300, 100)).toBeCloseTo(60);
    expect(requiredWinRate(1)).toBe(50);
    expect(kelly(50, 2)).toBe(25);
    expect(kelly(30, 1)).toBeLessThan(0);
  });

  it("estimates risk of ruin", () => {
    expect(riskOfRuin(40, 1, 1)).toBe(100);
    const r = riskOfRuin(55, 1.5, 1, 50);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
    expect(riskOfRuin(55, 1.5, 10, 50)!).toBeGreaterThan(r!);
  });

  it("runs a reproducible Monte Carlo", () => {
    const a = monteCarlo(10_000, 50, 2, 1, 100, 500, 7);
    const b = monteCarlo(10_000, 50, 2, 1, 100, 500, 7);
    expect(a).toEqual(b);
    expect(a!.median).toBeGreaterThan(10_000);
    expect(a!.p10).toBeLessThanOrEqual(a!.median);
    expect(a!.p90).toBeGreaterThanOrEqual(a!.median);
  });
});
