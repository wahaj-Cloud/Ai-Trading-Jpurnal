import { describe, expect, it } from "vitest";
import { gradeTradePlan, type TradePlan } from "./grade-plan";

const base: TradePlan = {
  side: "LONG",
  balance: 10_000,
  entry: 100,
  stop: 98,
  target: 106,
  positionUsd: 4_000,
  leverage: 5,
  feePct: 0.05,
};

describe("trade grader", () => {
  it("rewards a disciplined plan", () => {
    const r = gradeTradePlan(base);
    if ("error" in r) throw new Error(r.error);
    // Risk: 2 × 40 + 4 fees = 84 → 0.84%.
    expect(r.riskUsd).toBeCloseTo(84, 6);
    expect(r.riskPct).toBeCloseTo(0.84, 6);
    // Reward: 6 × 40 − 4 = 236 → 1 : 2.81.
    expect(r.rr).toBeCloseTo(236 / 84, 6);
    expect(r.grade).toBe("A");
    expect(r.checks.every((c) => c.status !== "bad")).toBe(true);
  });

  it("punishes oversized, overleveraged trades", () => {
    const r = gradeTradePlan({ ...base, positionUsd: 60_000, leverage: 50 });
    if ("error" in r) throw new Error(r.error);
    expect(r.riskPct).toBeGreaterThan(5);
    expect(r.grade).toBe("F");
    // At 50× liquidation (~98.5) sits before the 98 stop.
    expect(r.checks.find((c) => c.id === "liquidation")?.points).toBe(0);
  });

  it("caps a plan that would be liquidated before its stop", () => {
    const r = gradeTradePlan({ ...base, positionUsd: 400, leverage: 100 });
    if ("error" in r) throw new Error(r.error);
    expect(r.score).toBeLessThanOrEqual(54);
  });

  it("checks the stop and target sides, for shorts too", () => {
    expect(gradeTradePlan({ ...base, stop: 101 })).toHaveProperty("error");
    expect(gradeTradePlan({ ...base, side: "SHORT", stop: 102, target: 94 })).not.toHaveProperty(
      "error",
    );
    expect(gradeTradePlan({ ...base, side: "SHORT" })).toHaveProperty("error");
    expect(gradeTradePlan({ ...base, entry: Number.NaN })).toHaveProperty("error");
  });
});
