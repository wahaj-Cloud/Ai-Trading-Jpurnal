import "server-only";
import type { PositionsPage, TradeDetailDto } from "@atc/shared";
import { convertPositionsPage, convertTradeDetail } from "@/features/currency/convert";
import { apiFetch } from "@/lib/api";
import { getDisplay } from "@/lib/display";

/** A page of trades, with money shown in the trader's display currency. */
export async function getPositions(query: URLSearchParams | string): Promise<PositionsPage> {
  const [page, display] = await Promise.all([
    apiFetch<PositionsPage>(`/v1/positions?${query}`),
    getDisplay(),
  ]);
  return convertPositionsPage(page, display);
}

export async function getTradeDetail(id: string): Promise<TradeDetailDto> {
  const [dto, display] = await Promise.all([
    apiFetch<TradeDetailDto>(`/v1/positions/${encodeURIComponent(id)}`),
    getDisplay(),
  ]);
  return convertTradeDetail(dto, display);
}
