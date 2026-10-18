import { describe, expect, it } from "vitest";
import { cryptoPriceUsd, nextCryptoPaidUntil, yearlySavingPct } from "./plans.js";

const DAY = 86_400_000;
const now = new Date("2026-10-16T00:00:00Z");

describe("yearly and crypto pricing", () => {
  it("yearly is two months free", () => {
    expect(cryptoPriceUsd("PRO", "year")).toBe(150);
    expect(cryptoPriceUsd("PREMIUM", "month")).toBe(25);
    expect(yearlySavingPct(15, 150)).toBe(17);
    expect(yearlySavingPct(25, 250)).toBe(17);
  });

  it("a first purchase starts now", () => {
    const until = nextCryptoPaidUntil({
      now,
      currentPlan: "FREE",
      currentUntil: null,
      plan: "PRO",
      interval: "month",
    });
    expect(until.getTime() - now.getTime()).toBe(30 * DAY);
  });

  it("renewing the same plan extends the time left", () => {
    const currentUntil = new Date(now.getTime() + 10 * DAY);
    const until = nextCryptoPaidUntil({
      now,
      currentPlan: "PRO",
      currentUntil,
      plan: "PRO",
      interval: "year",
    });
    expect(until.getTime() - now.getTime()).toBe(375 * DAY);
  });

  it("time left on another plan is converted by value, never lost", () => {
    const currentUntil = new Date(now.getTime() + 10 * DAY);
    const up = nextCryptoPaidUntil({
      now,
      currentPlan: "PRO",
      currentUntil,
      plan: "PREMIUM",
      interval: "month",
    });
    expect(up.getTime() - now.getTime()).toBe(36 * DAY); // 10 days x 15/25 = 6 days
    const down = nextCryptoPaidUntil({
      now,
      currentPlan: "PREMIUM",
      currentUntil: new Date(now.getTime() + 6 * DAY),
      plan: "PRO",
      interval: "month",
    });
    expect(down.getTime() - now.getTime()).toBe(40 * DAY);
  });

  it("an expired period is not carried over", () => {
    const until = nextCryptoPaidUntil({
      now,
      currentPlan: "PRO",
      currentUntil: new Date(now.getTime() - DAY),
      plan: "PRO",
      interval: "month",
    });
    expect(until.getTime() - now.getTime()).toBe(30 * DAY);
  });
});
