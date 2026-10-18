import { dec, str } from "./decimal.js";
import type { DerivedPosition, Direction } from "./types.js";

/** A position as reported by an exchange that computes positions itself (MEXC, KuCoin, BingX). */
export interface ExchangePositionRecord {
  externalId: string;
  symbol: string;
  direction: Direction;
  closed: boolean;
  openedAt: Date;
  closedAt: Date | null;
  entryPrice: string | null;
  exitPrice: string | null;
  quantity: string | null;
  /** MetaTrader brokers: size in lots (quantity is lots × contract size). */
  lots?: string | null;
  leverage: string | null;
  grossPnl: string | null;
  fees: string | null;
  funding: string | null;
  netPnl: string | null;
  /** The venue's own settlement currency (MetaTrader account currency), when known. */
  settleAsset?: string;
  /** True when the opening part of the position is outside the downloaded history. */
  incompleteHistory?: boolean;
}

/**
 * Maps an exchange-computed position to the journal shape. The exchange's figures are kept as
 * reported; a missing one is derived from the others only when the identity
 * net = gross - fees + funding makes it unambiguous.
 */
export function fromExchangeRecord(record: ExchangePositionRecord): DerivedPosition {
  let { grossPnl, netPnl } = record;
  const fees = record.fees === null ? null : dec(record.fees);
  const funding = record.funding === null ? null : dec(record.funding);

  if (netPnl === null && grossPnl !== null && fees !== null) {
    netPnl = str(
      dec(grossPnl)
        .minus(fees)
        .plus(funding ?? 0),
    );
  }
  if (grossPnl === null && netPnl !== null && fees !== null) {
    grossPnl = str(
      dec(netPnl)
        .plus(fees)
        .minus(funding ?? 0),
    );
  }

  return {
    sourceKey: `X:${record.externalId}`,
    symbol: record.symbol,
    direction: record.direction,
    status: record.closed ? "CLOSED" : "OPEN",
    openedAt: record.openedAt,
    closedAt: record.closed ? (record.closedAt ?? record.openedAt) : null,
    entryPrice: record.entryPrice,
    exitPrice: record.exitPrice,
    quantity: record.quantity,
    lots: record.lots ?? null,
    leverage: record.leverage,
    grossPnl,
    fees: fees === null ? null : str(fees),
    funding: funding === null ? null : str(funding),
    netPnl,
    incompleteHistory: record.incompleteHistory ?? false,
    ...(record.settleAsset ? { settleAsset: record.settleAsset } : {}),
  };
}
