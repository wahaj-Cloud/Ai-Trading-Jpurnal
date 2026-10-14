"use server";

import { type LiquidationMapResponse, liquidationMapQuerySchema } from "@atc/shared";
import { apiFetch } from "@/lib/api";

/** The latest estimated liquidation map for a market, or why there is none. */
export async function getLiquidationMapAction(
  symbol: string,
  window: string,
): Promise<LiquidationMapResponse | { status: "error" }> {
  const q = liquidationMapQuerySchema.safeParse({ symbol, window });
  if (!q.success) return { status: "unavailable", reason: "unsupported" };
  try {
    return await apiFetch<LiquidationMapResponse>(
      `/v1/market/liquidation-map?symbol=${q.data.symbol}&window=${q.data.window}`,
      { signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return { status: "error" };
  }
}
