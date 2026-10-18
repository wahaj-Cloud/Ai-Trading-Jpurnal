import type { Prisma, PrismaClient } from "@atc/db";
import {
  type CmcOptions,
  fetchCmcAltcoinSeason,
  fetchCmcFearGreed,
  fetchCmcGlobal,
  fetchCmcMarketCapHistory,
} from "@atc/exchange-adapters";
import { log } from "../logger.js";

const KEEP_MS = 35 * 86_400_000;
const WEEK_MS = 7 * 86_400_000;

export interface OverviewDeps {
  db: PrismaClient;
  cmc: CmcOptions;
  now?: () => number;
}

/**
 * Every 10 minutes: CoinMarketCap's total market cap, Fear & Greed Index and Altcoin Season Index.
 * Each reading is saved on its own, so one unavailable index never hides the others; market cap is
 * also kept as a time series for the dashboard's 7-day mini chart.
 */
export async function runMarketOverview(
  deps: OverviewDeps,
): Promise<{ saved: string[]; failed: string[] }> {
  const now = (deps.now ?? Date.now)();
  const saved: string[] = [];
  const failed: string[] = [];
  const save = async (key: string, data: unknown) => {
    const json = data as Prisma.InputJsonValue;
    await deps.db.marketSnapshot.upsert({
      where: { key },
      create: { key, data: json, updatedAt: new Date(now) },
      update: { data: json, updatedAt: new Date(now) },
    });
    saved.push(key);
  };
  const tasks: Array<[string, () => Promise<unknown>]> = [
    ["global", () => fetchCmcGlobal(deps.cmc)],
    ["fear_greed", () => fetchCmcFearGreed(deps.cmc)],
    ["altcoin_season", () => fetchCmcAltcoinSeason(deps.cmc)],
  ];
  for (const [key, fetch] of tasks) {
    try {
      const data = await fetch();
      await save(key, data);
      if (key === "global") {
        const cap = (data as { totalMarketCapUsd: number }).totalMarketCapUsd;
        await deps.db.marketCapPoint.upsert({
          where: { ts: new Date(Math.floor(now / 60_000) * 60_000) },
          create: {
            ts: new Date(Math.floor(now / 60_000) * 60_000),
            totalMarketCap: cap.toFixed(2),
          },
          update: { totalMarketCap: cap.toFixed(2) },
        });
      }
    } catch (err) {
      failed.push(key);
      log.warn("market overview: CoinMarketCap unavailable", {
        key,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // With a CoinMarketCap key, a fresh install fills the last 7 days at once (2 credits).
  const apiKey = deps.cmc.apiKey;
  if (apiKey) {
    const have = await deps.db.marketCapPoint.count({
      where: { ts: { gte: new Date(now - WEEK_MS) } },
    });
    if (have < 48) {
      try {
        const points = await fetchCmcMarketCapHistory({ ...deps.cmc, apiKey }, now - WEEK_MS, now);
        await deps.db.marketCapPoint.createMany({
          data: points.map((p) => ({ ts: new Date(p.t), totalMarketCap: p.usd.toFixed(2) })),
          skipDuplicates: true,
        });
      } catch (err) {
        log.warn("market overview: history backfill failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await deps.db.marketCapPoint.deleteMany({ where: { ts: { lt: new Date(now - KEEP_MS) } } });
  return { saved, failed };
}
