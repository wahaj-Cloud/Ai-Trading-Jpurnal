import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ExchangeRateLimiter, POLICIES } from "./rate-limit.js";

// Runs against a real Redis when REDIS_URL is set (CI and local); skipped otherwise.
const url = process.env.REDIS_URL;
const redis = url ? new Redis(url, { maxRetriesPerRequest: null, db: 15 }) : null;

describe.skipIf(!redis)("ExchangeRateLimiter", () => {
  beforeEach(async () => {
    await redis?.flushdb();
  });
  afterAll(async () => {
    await redis?.quit();
  });

  it("lets requests through until the window's budget is spent, then waits for the next window", async () => {
    let clock = 10_000 * 1_100; // start of a BingX window
    const waits: number[] = [];
    const limiter = new ExchangeRateLimiter(
      redis as Redis,
      () => clock,
      async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    );
    const u = new URL("https://open-api.bingx.com/openApi/swap/v2/user/income");
    for (let i = 0; i < 3; i++) await limiter.acquire("BINGX", u);
    expect(waits).toHaveLength(1); // BingX allows 2 per window; the third waited
    expect(waits[0]).toBeGreaterThanOrEqual(1_100);
    expect(waits[0]).toBeLessThan(1_150);
  });

  it("weights Binance endpoints by their published cost", () => {
    const w = (path: string) => POLICIES.BINANCE.weight(new URL(`https://fapi.binance.com${path}`));
    expect(w("/fapi/v1/income")).toBe(30);
    expect(w("/fapi/v1/userTrades")).toBe(5);
    expect(w("/api/v3/time")).toBe(1);
  });

  it("shares one budget between limiter instances (separate worker processes)", async () => {
    const clock = 7 * 60_000;
    const a = new ExchangeRateLimiter(
      redis as Redis,
      () => clock,
      async () => {
        throw new Error("should not wait");
      },
    );
    const b = new ExchangeRateLimiter(
      redis as Redis,
      () => clock,
      async () => {
        throw new Error("budget shared");
      },
    );
    const income = new URL("https://fapi.binance.com/fapi/v1/income");
    for (let i = 0; i < 20; i++) await a.acquire("BINANCE", income); // 600 of 1200
    for (let i = 0; i < 20; i++) await b.acquire("BINANCE", income); // 1200 of 1200
    await expect(b.acquire("BINANCE", income)).rejects.toThrow("budget shared");
  });
});
