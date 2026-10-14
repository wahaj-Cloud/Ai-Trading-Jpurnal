import { describe, expect, it } from "vitest";
import { aiCostMicros } from "./ai-cost.js";
import { PLAN_DEFAULTS, resolveLimits } from "./plans.js";

const old = {
  exchangeAccounts: 5,
  aiReviewsPerMonth: 300,
  historyDays: 365,
  coachMessagesPerDay: 50,
};

describe("plan limits", () => {
  it("fills fields added later from the plan defaults", () => {
    expect(resolveLimits("PRO", old)).toEqual({ ...old, ...PLAN_DEFAULTS.PRO });
    expect(resolveLimits("PREMIUM", old).brokerAccounts).toBe(2);
    expect(resolveLimits("PREMIUM", old).backtestRunsPerMonth).toBe(30);
    expect(resolveLimits("FREE", old)).toMatchObject({
      setups: 1,
      whatIf: 0,
      marketPulseCoins: 20,
    });
  });
  it("keeps values an admin saved", () => {
    expect(resolveLimits("PRO", { ...old, aiBudgetUsd: 5, brokerAccounts: 1 })).toMatchObject({
      aiBudgetUsd: 5,
      brokerAccounts: 1,
    });
  });
  it("fails closed on unreadable limits", () => {
    expect(resolveLimits("PREMIUM", { nope: true })).toMatchObject({
      aiBudgetUsd: 0,
      brokerAccounts: 0,
      setups: 0,
      whatIf: 0,
      backtestRunsPerMonth: 0,
    });
  });
});

describe("AI cost", () => {
  it("prices by model family, in micro-dollars", () => {
    expect(aiCostMicros("claude-haiku-4-5-20251001", 4000, 500)).toBe(4000 + 2500);
    expect(aiCostMicros("claude-sonnet-5", 4000, 500)).toBe(12000 + 7500);
    expect(aiCostMicros("mystery-model", 1000, 0)).toBe(3000);
  });
});
