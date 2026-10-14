import type { OpenPositionDto } from "@atc/shared";
import { TRADFI_NAMES } from "./market";

/** Unrealised P&L of a linear USDT position at `price` (null when size is unknown). */
export function livePnl(p: OpenPositionDto, price: number): number | null {
  if (!p.entryPrice || !p.quantity || p.settleAsset !== p.quoteAsset) return null;
  const dir = p.direction === "LONG" ? 1 : -1;
  return (price - Number(p.entryPrice)) * Number(p.quantity) * dir;
}

/**
 * Which of the trader's positions belong on this chart. Gold and silver also match broker symbols
 * (Exness XAUUSD, XAUUSDm…), but their live P&L is not estimated from the perpetual's price.
 */
export function positionMatch(p: OpenPositionDto, symbol: string): "exact" | "related" | null {
  if (p.symbol === symbol) return "exact";
  if (TRADFI_NAMES[symbol] && p.symbol.toUpperCase().startsWith(symbol.slice(0, 6)))
    return "related";
  return null;
}
