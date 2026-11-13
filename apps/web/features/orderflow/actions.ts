"use server";

import { type CoinCandlesDto, coinCandlesSymbolSchema } from "@atc/shared";
import { apiFetch } from "@/lib/api";

/**
 * A coin card's 15m, 1H and 4H closed candles through our API (cached, works where Binance is
 * blocked). Null on any failure; the card then asks Binance directly.
 */
export async function getCoinCandlesAction(symbol: string): Promise<CoinCandlesDto | null> {
  const s = coinCandlesSymbolSchema.safeParse(symbol);
  if (!s.success) return null;
  try {
    return await apiFetch<CoinCandlesDto>(`/v1/market/candles/${s.data}`);
  } catch {
    return null;
  }
}
