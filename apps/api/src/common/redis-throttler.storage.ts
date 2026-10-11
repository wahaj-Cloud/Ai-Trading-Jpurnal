import type { OnModuleDestroy } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import { Redis } from "ioredis";

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Atomic: count this hit in the window, and start a block when the limit is passed.
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl <= 0 and hits > tonumber(ARGV[2]) and tonumber(ARGV[3]) > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blockTtl = tonumber(ARGV[3])
end
return { hits, ttl, blockTtl }
`;

/**
 * Rate-limit counters in Redis, so limits hold across every API instance (in-memory counters would
 * multiply the allowance by the number of instances).
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(url: string) {
    // Commands wait for the connection (bounded retries); if Redis stays down, requests fail open.
    this.redis = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5_000, family: 0 });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    try {
      const [hits, pttl, blockTtl] = (await this.redis.eval(
        SCRIPT,
        2,
        base,
        `${base}:block`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number];
      return {
        totalHits: hits,
        timeToExpire: Math.max(0, Math.ceil(pttl / 1000)),
        isBlocked: blockTtl > 0,
        timeToBlockExpire: Math.max(0, Math.ceil(blockTtl / 1000)),
      };
    } catch {
      // Redis unavailable: fail open rather than locking every user out; auth still applies.
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
