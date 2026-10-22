import type { Prisma, PrismaClient } from "@atc/db";
import { snapshotsOf, writeSnapshot } from "@atc/db";
import { type AdapterConfig, fetchBinanceLiveCandles } from "@atc/exchange-adapters";
import {
  isPinned,
  RATING_REFRESH_MIN,
  RATING_TFS,
  RATINGS_KEY,
  type RatingsSnapshot,
  type RatingTf,
  SCALP_BOOK_COINS,
  type ScalpSnapshot,
} from "@atc/shared";
import { technicalRatings } from "@atc/ta";
import { log } from "../logger.js";

/** Candles per request: enough for the 200-period averages and Ichimoku's 52 + 25. */
const CANDLES = 300;
const CONCURRENCY = 6;

export interface RatingsDeps {
  db: PrismaClient;
  config: AdapterConfig;
  now?: () => number;
}

/** Timeframes due this minute: 5m and 15m every minute, up to 2H every 5, longer every 15. */
export function dueTimeframes(minute: number, existing: RatingsSnapshot | null): RatingTf[] {
  return RATING_TFS.filter(
    (tf) =>
      minute % RATING_REFRESH_MIN[tf] === 0 || !existing || Object.keys(existing).length === 0,
  );
}

/**
 * Indicator gauges for the 20 most traded coins plus gold and silver, on the timeframes due this
 * minute; the rest keep their last values. Saved as one snapshot.
 */
export async function runRatings(
  deps: RatingsDeps,
  scalp: ScalpSnapshot,
): Promise<{ symbols: number; tfs: number; failed: number }> {
  const now = (deps.now ?? Date.now)();
  const binance = deps.config.binance ?? {};
  const symbols = scalp.coins
    .filter((c) => c.rank <= SCALP_BOOK_COINS || isPinned(c.symbol))
    .map((c) => c.symbol);
  const row = await snapshotsOf(deps.db).get(RATINGS_KEY);
  const prev = (row?.data as RatingsSnapshot | undefined) ?? null;
  const minute = Math.floor(now / 60_000) % 60;
  // A symbol new to the list gets every timeframe at once.
  const jobs = symbols.flatMap((s) => {
    const tfs = prev?.[s] ? dueTimeframes(minute, prev) : [...RATING_TFS];
    return tfs.map((tf) => ({ s, tf }));
  });
  let failed = 0;
  const results: Array<{ s: string; tf: RatingTf; r: ReturnType<typeof technicalRatings> }> = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      for (;;) {
        const j = jobs[next++];
        if (!j) return;
        try {
          const candles = await fetchBinanceLiveCandles(binance, j.s, j.tf, CANDLES);
          if (candles.length >= 2) results.push({ ...j, r: technicalRatings(candles, j.tf, now) });
        } catch (err) {
          failed++;
          log.warn("indicator gauge failed", { symbol: j.s, tf: j.tf, err });
        }
      }
    }),
  );
  const data: RatingsSnapshot = {};
  for (const s of symbols) data[s] = { ...(prev?.[s] ?? {}) };
  for (const { s, tf, r } of results) (data[s] as NonNullable<RatingsSnapshot[string]>)[tf] = r;
  const json = data as unknown as Prisma.InputJsonValue;
  await writeSnapshot(deps.db, RATINGS_KEY, json, new Date(now));
  return { symbols: symbols.length, tfs: results.length, failed };
}
