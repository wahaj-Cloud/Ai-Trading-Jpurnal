import type { Prisma, PrismaClient } from "@atc/db";
import { type AdapterConfig, computeLiquidationMap } from "@atc/exchange-adapters";
import {
  LIQ_MAP_STATUS_KEY,
  LIQ_MAP_SYMBOLS,
  type LiqMapRunStatus,
  type LiqMapWindow,
} from "@atc/shared";
import { log } from "../logger.js";

/** The 7-day map uses hourly candles, so it only needs recomputing about once an hour. */
const SLOW_WINDOW_REFRESH_MS = 55 * 60_000;
const CONCURRENCY = 3;

export interface LiqMapDeps {
  db: PrismaClient;
  config: AdapterConfig;
  now?: () => number;
}

/**
 * Every 5 minutes: the estimated liquidation map for each supported market, from public open
 * interest on Binance, Bybit and OKX. Each market is saved on its own, so one failing market
 * (or exchange) never blocks the others; the previous map stays until a new one is ready.
 */
export async function runLiquidationMaps(
  deps: LiqMapDeps,
): Promise<{ maps: number; failed: number; ms: number }> {
  const started = Date.now();
  const now = (deps.now ?? Date.now)();
  const slow = await deps.db.liquidationMap.findMany({
    where: { window: "7d" },
    select: { symbol: true, computedAt: true },
  });
  const slowAge = new Map(slow.map((r) => [r.symbol, now - r.computedAt.getTime()]));

  const jobs: Array<{ symbol: string; window: LiqMapWindow }> = [];
  for (const symbol of LIQ_MAP_SYMBOLS) {
    jobs.push({ symbol, window: "24h" });
    if ((slowAge.get(symbol) ?? Number.POSITIVE_INFINITY) >= SLOW_WINDOW_REFRESH_MS) {
      jobs.push({ symbol, window: "7d" });
    }
  }

  let maps = 0;
  let failed = 0;
  let next = 0;
  const errors: LiqMapRunStatus["errors"] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const job = jobs[next++];
        if (!job) return;
        try {
          const data = await computeLiquidationMap(deps.config, job.symbol, job.window, now);
          const computedAt = new Date(now);
          const json = data as unknown as Prisma.InputJsonValue;
          await deps.db.liquidationMap.upsert({
            where: { symbol_window: { symbol: job.symbol, window: job.window } },
            create: { symbol: job.symbol, window: job.window, data: json, computedAt },
            update: { data: json, computedAt },
          });
          maps++;
        } catch (err) {
          failed++;
          const error = err instanceof Error ? err.message : String(err);
          errors.push({ ...job, error: error.slice(0, 300) });
          log.warn("liquidation map failed", { ...job, err: error });
        }
      }
    }),
  );
  // The last run's outcome, so the app can say why a map is missing instead of waiting forever.
  const status: LiqMapRunStatus = {
    at: new Date(now).toISOString(),
    maps,
    failed,
    errors: errors.slice(0, 30),
  };
  await deps.db.liquidationMap.upsert({
    where: { symbol_window: LIQ_MAP_STATUS_KEY },
    create: {
      ...LIQ_MAP_STATUS_KEY,
      data: status as unknown as Prisma.InputJsonValue,
      computedAt: new Date(now),
    },
    update: { data: status as unknown as Prisma.InputJsonValue, computedAt: new Date(now) },
  });
  return { maps, failed, ms: Date.now() - started };
}
