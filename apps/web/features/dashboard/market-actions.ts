"use server";

import type { MarketOverviewDto } from "@atc/shared";
import { apiFetch } from "@/lib/api";

/** Latest CoinMarketCap overview, or null when it cannot be loaded. */
export async function getMarketOverviewAction(): Promise<MarketOverviewDto | null> {
  try {
    return await apiFetch<MarketOverviewDto>("/v1/market/overview", {
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
}
