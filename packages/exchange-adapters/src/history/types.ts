import type { ExchangePositionRecord } from "@atc/trade-engine";
import type { VerificationFailure } from "../types.js";

/** One execution, normalised: canonical symbol, quantity in base units, fee positive = paid. */
export interface NormalizedFill {
  exchangeFillId: string;
  orderId: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: "LONG" | "SHORT" | "BOTH";
  price: string;
  qty: string;
  fee: string;
  feeAsset: string | null;
  realizedPnl: string | null;
  isMaker: boolean | null;
  executedAt: Date;
  raw: unknown;
}

/** Ledger entry. Amount signed: positive = received. */
export interface NormalizedIncome {
  externalId: string;
  type: "FUNDING" | "COMMISSION" | "REALIZED_PNL" | "OTHER";
  amount: string;
  asset: string;
  symbol: string | null;
  occurredAt: Date;
  raw: unknown;
}

/**
 * An exchange position record exactly as stored. `raw` carries the exchange payload plus anything
 * needed to interpret it later (e.g. contract size), so records can be rebuilt without re-fetching.
 */
export interface RawExchangePosition {
  externalId: string;
  symbol: string;
  closed: boolean;
  closedAt: Date | null;
  raw: Record<string, unknown>;
}

/**
 * A live open position as the exchange reports it now. Sizes are in base units (USD for inverse
 * contracts); unrealised PnL is in the settlement currency. Fields an exchange does not report are null.
 */
export interface OpenPositionSnapshot {
  /** Exchange position ID, or `symbol:side` when the exchange has none. */
  externalId: string;
  /** Canonical symbol, e.g. BTCUSDT. */
  symbol: string;
  direction: "LONG" | "SHORT";
  /** Null when the exchange reports contracts and their size is unknown. */
  quantity: string | null;
  /** MetaTrader brokers: size in lots. */
  lots?: string | null;
  entryPrice: string | null;
  markPrice: string | null;
  unrealizedPnl: string | null;
  leverage: string | null;
  liquidationPrice: string | null;
  marginMode: "CROSS" | "ISOLATED" | null;
  openedAt: Date | null;
}

export interface HistoryWindow {
  since: Date;
  until: Date;
}

export interface HistoryBatch {
  fills: NormalizedFill[];
  income: NormalizedIncome[];
  positions: RawExchangePosition[];
}

/**
 * How we download history from one exchange account.
 *  - FILLS: the exchange gives complete fills; our engine builds positions (Binance).
 *  - POSITIONS: the exchange computes positions itself; we take them as reported (MEXC, KuCoin, BingX).
 */
export interface HistorySource {
  readonly model: "FILLS" | "POSITIONS";
  /** Longest window one fetchHistory call accepts; the worker splits longer ranges. */
  readonly maxWindowMs: number;
  /** How far back the exchange's API keeps this account's history. */
  readonly retentionMs: number;
  fetchHistory(window: HistoryWindow): Promise<HistoryBatch>;
  /** Turns every stored raw record of an account into journal records (pure; no network). */
  toRecords(raws: readonly RawExchangePosition[]): ExchangePositionRecord[];
  /** Every position open right now, with mark price and unrealised PnL. */
  fetchOpenPositions(): Promise<OpenPositionSnapshot[]>;
  /** Explains a sync failure with the same codes and messages as key verification. */
  classify(err: unknown): VerificationFailure;
}

export const DAY_MS = 86_400_000;
