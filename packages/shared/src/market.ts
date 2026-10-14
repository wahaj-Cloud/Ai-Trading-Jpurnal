import { z } from "zod";

/**
 * Market Pulse: how closely each top futures coin moves with Bitcoin. Context, not signals.
 */

export const PULSE_WINDOWS = ["24h", "7d", "30d"] as const;
export type PulseWindow = (typeof PULSE_WINDOWS)[number];

/** Candle size and count per window. */
export const PULSE_WINDOW_SPEC: Record<
  PulseWindow,
  { interval: "15m" | "1h" | "4h"; points: number }
> = {
  "24h": { interval: "15m", points: 96 },
  "7d": { interval: "1h", points: 168 },
  "30d": { interval: "4h", points: 180 },
};

export const PULSE_LINKS = {
  FOLLOWS: "Follows BTC",
  LOOSE: "Loosely linked",
  INDEPENDENT: "Independent",
  OPPOSITE: "Moves opposite",
} as const;
export type PulseLink = keyof typeof PULSE_LINKS;

export function pulseLink(corr: number): PulseLink {
  if (corr >= 0.7) return "FOLLOWS";
  if (corr >= 0.3) return "LOOSE";
  if (corr > -0.3) return "INDEPENDENT";
  return "OPPOSITE";
}

export const marketPulseQuerySchema = z
  .object({
    window: z.enum(PULSE_WINDOWS).default("24h"),
    sort: z.enum(["volume", "corr", "beta", "rs"]).default("volume"),
    filter: z
      .enum(["all", "FOLLOWS", "LOOSE", "INDEPENDENT", "OPPOSITE", "decoupled"])
      .default("all"),
  })
  .strict();
export type MarketPulseQuery = z.infer<typeof marketPulseQuerySchema>;

export interface PulseRowDto {
  symbol: string;
  rank: number;
  quoteVolume24h: string;
  corr: number;
  beta: number;
  /** Coin return minus BTC return over the window (fraction, 0.05 = +5 points). */
  relStrength: number;
  coinReturn: number;
  link: PulseLink;
  /** Follows BTC over 30 days (≥0.7) but not today (<0.3). */
  decoupled: boolean;
}

export interface MarketPulseDto {
  window: PulseWindow;
  computedAt: string | null;
  btcReturn: number | null;
  rows: PulseRowDto[];
  /** What the plan keeps hidden. */
  locked: { windows: boolean; hiddenCoins: number };
  totals: Record<PulseLink, number> & { decoupled: number };
}

export interface PulseSymbolDto {
  symbol: string;
  computedAt: string | null;
  windows: Partial<Record<PulseWindow, PulseRowDto>>;
  /** Hourly 24h correlation over the last 7 days, oldest first. */
  history: Array<{ t: string; corr: number }>;
}

export const PULSE_DISCLAIMER =
  "Market context from public Binance futures prices, not a trading signal. Past correlation does not guarantee future moves.";

/** The trader's own results grouped by how linked each coin was to BTC when they entered. */
export interface PulseMyTradesDto {
  groups: Array<{
    link: PulseLink;
    trades: number;
    winRate: number | null;
    netPnl: string;
    avgPnl: string | null;
    /** At least PULSE_MIN_GROUP trades: enough to read anything into it. */
    enough: boolean;
  }>;
  /** Closed trades with a correlation at entry (USD-settled). */
  total: number;
}

export const PULSE_MIN_GROUP = 15;

// ─── Estimated liquidation map ───

/** Markets the worker maps every 5 minutes (Binance symbol names). */
export const LIQ_MAP_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "BNBUSDT",
  "SUIUSDT",
  "ADAUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "XAUUSDT",
  "XAGUSDT",
] as const;
/** Free plans see this market only. */
export const LIQ_MAP_FREE_SYMBOL = "BTCUSDT";

export const LIQ_MAP_WINDOWS = ["24h", "7d"] as const;
export type LiqMapWindow = (typeof LIQ_MAP_WINDOWS)[number];
export const LIQ_MAP_WINDOW_SPEC: Record<
  LiqMapWindow,
  { period: "5m" | "1h"; bucketMs: number; spanMs: number; label: string }
> = {
  "24h": { period: "5m", bucketMs: 300_000, spanMs: 86_400_000, label: "Last 24 hours" },
  "7d": { period: "1h", bucketMs: 3_600_000, spanMs: 7 * 86_400_000, label: "Last 7 days" },
};

export const LIQ_MAP_SOURCES = ["BINANCE", "BYBIT", "OKX"] as const;
export type LiqMapSource = (typeof LIQ_MAP_SOURCES)[number];

export interface LiquidationClusterDto {
  side: "long" | "short";
  price: number;
  usd: number;
}

export interface LiquidationMapDto {
  symbol: string;
  window: LiqMapWindow;
  computedAt: string;
  /** First column (ms) and column length (ms). */
  start: number;
  bucketMs: number;
  count: number;
  priceMin: number;
  priceMax: number;
  bins: number;
  /** Base64 of count × bins bytes (time-major), 0..255 on a square-root scale of maxCellUsd. */
  cells: string;
  maxCellUsd: number;
  clusters: LiquidationClusterDto[];
  totalLongUsd: number;
  totalShortUsd: number;
  /** Which exchanges' open interest went into this map. */
  sources: Array<{ exchange: LiqMapSource; ok: boolean }>;
}

export type LiquidationMapResponse =
  | { status: "ok"; map: LiquidationMapDto }
  /** The market is not mapped, or the first map is not ready yet. */
  | { status: "unavailable"; reason: "unsupported" | "pending" }
  /** The plan shows Bitcoin only. */
  | { status: "locked" };

export const liquidationMapQuerySchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,20}USDT$/),
    window: z.enum(LIQ_MAP_WINDOWS).default("24h"),
  })
  .strict();
export type LiquidationMapQuery = z.infer<typeof liquidationMapQuerySchema>;

export const LIQ_MAP_DISCLAIMER =
  "Estimated, not real orders: built from public open interest on Binance, Bybit and OKX, who was buying or selling, and a typical leverage mix. Shows where many positions would be liquidated if price got there. Context, never a signal.";
