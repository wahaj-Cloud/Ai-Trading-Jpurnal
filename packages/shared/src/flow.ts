import { z } from "zod";
import type { DeskSymbol } from "./desk.js";
import { LIQ_MAP_SYMBOLS } from "./market.js";

/**
 * Market Flow: very large trades ("whale" trades) and real liquidations, live from the public
 * trade and liquidation feeds of Binance, Bybit and OKX. Facts about what already happened, never
 * a prediction.
 */

export const FLOW_SYMBOLS = LIQ_MAP_SYMBOLS;
export type FlowSymbol = (typeof FLOW_SYMBOLS)[number];
/** Free plans see these markets. */
export const FLOW_FREE_SYMBOLS: readonly FlowSymbol[] = ["BTCUSDT", "ETHUSDT"];
export const FLOW_EXCHANGES = ["BINANCE", "BYBIT", "OKX"] as const;
export type FlowExchange = (typeof FLOW_EXCHANGES)[number];

/**
 * Smallest taker order (USD) counted as a whale trade, per market. Taker orders, not single fills:
 * fills of one market order (same side, same millisecond) are added up first.
 */
export const WHALE_MIN_USD: Record<FlowSymbol, number> = {
  BTCUSDT: 250_000,
  ETHUSDT: 150_000,
  SOLUSDT: 75_000,
  XRPUSDT: 75_000,
  DOGEUSDT: 50_000,
  BNBUSDT: 75_000,
  SUIUSDT: 50_000,
  ADAUSDT: 50_000,
  LINKUSDT: 50_000,
  AVAXUSDT: 50_000,
  XAUUSDT: 100_000,
  XAGUSDT: 50_000,
};

export const FLOW_WINDOWS = ["5m", "15m", "30m", "1h", "4h", "24h"] as const;
export type FlowWindow = (typeof FLOW_WINDOWS)[number];
export const FLOW_WINDOW_LABEL: Record<FlowWindow, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1H",
  "4h": "4H",
  "24h": "1D",
};
export const FLOW_WINDOW_MS: Record<FlowWindow, number> = {
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 4 * 3_600_000,
  "24h": 24 * 3_600_000,
};
/** Rows are kept this long. */
export const FLOW_RETENTION_DAYS = 8;

/** One whale taker order. `side` is the taker's side: "buy" = someone bought at market. */
export interface WhaleTradeDto {
  id: string;
  exchange: FlowExchange;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
  usd: number;
  at: string;
}

/** One forced close. `side` is the position that was liquidated. */
export interface LiquidationDto {
  id: string;
  exchange: FlowExchange;
  symbol: string;
  side: "long" | "short";
  price: number;
  qty: number;
  usd: number;
  at: string;
}

export interface FlowSummaryDto {
  symbol: string;
  window: FlowWindow;
  from: string;
  to: string;
  whales: {
    buyUsd: number;
    sellUsd: number;
    buys: number;
    sells: number;
    /** Buys minus sells (USD). */
    netUsd: number;
  };
  liquidations: {
    longUsd: number;
    shortUsd: number;
    longs: number;
    shorts: number;
    byExchange: { exchange: FlowExchange; longUsd: number; shortUsd: number; count: number }[];
    largest: LiquidationDto | null;
  };
  /** Equal time buckets (12 per window), oldest first. */
  series: {
    t: string;
    whaleBuyUsd: number;
    whaleSellUsd: number;
    longLiqUsd: number;
    shortLiqUsd: number;
  }[];
  /** Feed health per exchange: last event time (null = nothing received in the window). */
  sources: { exchange: FlowExchange; live: boolean; lastAt: string | null }[];
  locked: boolean;
}

export interface FlowFeedPage<T> {
  items: T[];
  nextCursor: string | null;
  locked: boolean;
}

export const flowSummaryQuerySchema = z
  .object({
    symbol: z.enum(FLOW_SYMBOLS).default("BTCUSDT"),
    window: z.enum(FLOW_WINDOWS).default("24h"),
  })
  .strict();
export type FlowSummaryQuery = z.infer<typeof flowSummaryQuerySchema>;

export const flowFeedQuerySchema = z
  .object({
    symbol: z.enum(FLOW_SYMBOLS).default("BTCUSDT"),
    exchange: z.enum(FLOW_EXCHANGES).optional(),
    side: z.enum(["buy", "sell", "long", "short"]).optional(),
    minUsd: z.coerce.number().min(0).max(1e10).optional(),
    /** "<time ms>:<id>" of the last row of the previous page. */
    cursor: z
      .string()
      .regex(/^\d{1,15}:\d{1,20}$/)
      .optional(),
  })
  .strict();
export type FlowFeedQuery = z.infer<typeof flowFeedQuerySchema>;

/** Live feed status saved by the worker (market_snapshots key). */
export const FLOW_STATUS_KEY = "flow:status";
export interface FlowStatus {
  /** When this worker took over the feeds. */
  since: string;
  updatedAt: string;
  exchanges: Record<FlowExchange, { connected: boolean; lastEventAt: string | null }>;
}

export const FLOW_DISCLAIMER =
  "Live from the public trade and liquidation feeds of Binance, Bybit and OKX. Whale trades are single market orders above the size shown, after adding up their fills. Binance publishes at most one liquidation per coin per second, so its totals are a minimum. Facts about what happened, not a forecast.";

// ─── Trend bias by timeframe ───

export const BIAS_TIMEFRAMES = ["1d", "4h", "1h"] as const;
/** "1w" is used by Trade Check only; the dashboard table shows the three above. */
export type BiasTimeframe = (typeof BIAS_TIMEFRAMES)[number] | "1w";
export type BiasState = "up" | "down" | "range";

export interface TimeframeBiasDto {
  timeframe: BiasTimeframe;
  state: BiasState;
  /** Closed candles the current state has held for (capped at 99). */
  bars: number;
  evidence: string[];
}

export const BIAS_LABEL: Record<BiasState, string> = {
  up: "Up-trend",
  down: "Down-trend",
  range: "Range",
};

export const BIAS_DEFINITION =
  "Measured from closed candles on each timeframe: price against its 50 EMA, the 50 EMA against the 200 EMA, and the swing structure (higher highs and lows, or lower). Two of three agreeing set the trend; otherwise it is a range. It describes the trend now; it is not a forecast or a signal.";

/** Dashboard table: trend bias per timeframe plus 24h whale flow and liquidations. */
export interface MarketBiasRow {
  symbol: DeskSymbol;
  name: string;
  price: number | null;
  change24hPct: number | null;
  bias: TimeframeBiasDto[];
  computedAt: string | null;
  /** Whale buys minus sells and liquidations over 24h (null when the market has no flow feed). */
  whaleNet24hUsd: number | null;
  liquidations24h: { longUsd: number; shortUsd: number } | null;
}

export interface MarketBiasDto {
  items: MarketBiasRow[];
  allowed: DeskSymbol[];
}
