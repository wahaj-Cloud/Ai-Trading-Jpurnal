import type { ExchangeId } from "@atc/shared";
import type { Redis } from "ioredis";

/** Binance prices candle requests by how many candles they ask for. */
function klinesWeight(u: URL): number {
  const limit = Number(u.searchParams.get("limit") ?? 500);
  return limit < 100 ? 1 : limit < 500 ? 2 : limit <= 1000 ? 5 : 10;
}

interface Policy {
  /** Weight allowed per window, shared by every worker process (the limit is per server IP). */
  capacity: number;
  windowMs: number;
  weight: (url: URL) => number;
}

/**
 * Budgets sit well under each exchange's published limit, leaving room for key verification
 * traffic from the API and for clock skew between processes.
 */
export const POLICIES: Record<ExchangeId, Policy> = {
  // Binance futures: 2400 weight/minute per IP. Income costs 30, trades and positions 5.
  BINANCE: {
    capacity: 1200,
    windowMs: 60_000,
    weight: (u) =>
      u.pathname === "/fapi/v1/income"
        ? 30
        : u.pathname === "/fapi/v1/klines"
          ? klinesWeight(u)
          : u.pathname === "/fapi/v1/ticker/24hr"
            ? 40 // all symbols
            : u.pathname === "/fapi/v1/userTrades" || u.pathname === "/fapi/v3/positionRisk"
              ? 5
              : 1,
  },
  // MEXC futures private endpoints: 20 requests / 2 s.
  MEXC: { capacity: 8, windowMs: 1_000, weight: () => 1 },
  // KuCoin: resource pools of ~2000 weight / 30 s; history calls are light.
  KUCOIN: { capacity: 10, windowMs: 1_000, weight: () => 1 },
  // BingX: income and position history allow 2 requests/second per IP.
  BINGX: { capacity: 2, windowMs: 1_100, weight: () => 1 },
  // MetaApi: generous per-account credits; keep our whole fleet to 10 requests/second.
  EXNESS: { capacity: 10, windowMs: 1_000, weight: () => 1 },
};

// Atomic "take `weight` if it fits in this window". Returns 1 when granted, 0 when full.
const TAKE = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local weight = tonumber(ARGV[1])
if used > 0 and used + weight > tonumber(ARGV[2]) then return 0 end
redis.call('INCRBY', KEYS[1], weight)
if used == 0 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
return 1`;

/**
 * Fixed-window limiter in Redis, shared by all worker processes. A request that does not fit waits
 * for the next window. A single request heavier than the capacity is still let through alone.
 */
export class ExchangeRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async acquire(exchange: ExchangeId, url: URL): Promise<void> {
    const policy = POLICIES[exchange];
    const weight = policy.weight(url);
    for (;;) {
      const t = this.now();
      const window = Math.floor(t / policy.windowMs);
      const key = `ratelimit:${exchange}:${window}`;
      const granted = await this.redis.eval(
        TAKE,
        1,
        key,
        weight,
        policy.capacity,
        policy.windowMs * 2,
      );
      if (granted === 1) return;
      const waitMs = (window + 1) * policy.windowMs - t + Math.floor(Math.random() * 50);
      await this.sleep(waitMs);
    }
  }
}
