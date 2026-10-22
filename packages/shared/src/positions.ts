import { z } from "zod";
import { EXCHANGE_IDS, type ExchangeId } from "./exchanges.js";
import type { EntryReadoutDto } from "./scalp-alerts.js";
import type { EntryZoneDto } from "./zones.js";

/** A journal trade as the API returns it. Money and sizes are decimal strings (never floats). */
export interface PositionDto {
  id: string;
  exchange: ExchangeId;
  accountLabel: string | null;
  source: "FILLS" | "EXCHANGE" | "CSV";
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  /** Currency of PnL, fees and funding (the base coin for inverse contracts). */
  settleAsset: string;
  /** Unit of `quantity`: coins for linear contracts, USD for inverse contracts. */
  sizeAsset: string;
  direction: "LONG" | "SHORT";
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  entryPrice: string | null;
  exitPrice: string | null;
  quantity: string | null;
  /** MetaTrader (Exness) size in lots, as MT4/MT5 shows it; null for crypto exchanges. */
  lots: string | null;
  leverage: string | null;
  grossPnl: string | null;
  fees: string | null;
  funding: string | null;
  netPnl: string | null;
  holdingSeconds: number | null;
  incompleteHistory: boolean;
  /** Followed one of the trader's setup alerts (My Setup Alerts). */
  planned: boolean;
  /** How closely the coin moved with BTC (24h correlation) when the trade opened. */
  btcCorrAtEntry: number | null;
  /** Scalp Cockpit counts in the minute the trade opened (kept for trades from the last 8 days on). */
  entryReadout: EntryReadoutDto | null;
  /** 1H/4H supply and demand zones the entry price was inside (null = not recorded). */
  entryZone: EntryZoneDto | null;
  /** Whether the trader has written a journal entry for this trade, and its rating. */
  reviewed: boolean;
  rating: number | null;
}

export interface PositionsPage {
  items: PositionDto[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export const positionsQuerySchema = z
  .object({
    status: z.enum(["OPEN", "CLOSED"]).optional(),
    exchange: z.enum(EXCHANGE_IDS).optional(),
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{2,30}$/)
      .optional(),
    /** Trades closed on this calendar day, in the trader's timezone (YYYY-MM-DD). */
    day: z.iso.date().optional(),
    /** `closed`: most recently closed first (only closed trades). Default: most recently opened. */
    sort: z.enum(["opened", "closed"]).default("opened"),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type PositionsQuery = z.infer<typeof positionsQuerySchema>;

/** A live open position, as last reported by the exchange (refreshed every sync). */
export interface OpenPositionDto {
  id: string;
  accountId: string;
  accountLabel: string;
  exchange: ExchangeId;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  settleAsset: string;
  sizeAsset: string;
  direction: "LONG" | "SHORT";
  /** Null when the exchange's contract size is unknown. */
  quantity: string | null;
  /** MetaTrader (Exness) size in lots, as MT4/MT5 shows it; null for crypto exchanges. */
  lots: string | null;
  entryPrice: string | null;
  markPrice: string | null;
  unrealizedPnl: string | null;
  /** Position value at the mark price, in USD (linear contracts only). */
  notional: string | null;
  leverage: string | null;
  liquidationPrice: string | null;
  /** How far the mark price may move against the position before liquidation, as a fraction. */
  liquidationDistance: number | null;
  marginMode: "CROSS" | "ISOLATED" | null;
  openedAt: string | null;
  /** When these figures were fetched from the exchange. */
  syncedAt: string;
}

export interface OpenPositionsDto {
  items: OpenPositionDto[];
  /** Sum of unrealised PnL across USD-settled positions. */
  unrealizedPnl: string;
  /** Oldest refresh time among the positions shown, or null when there are none. */
  asOf: string | null;
}
