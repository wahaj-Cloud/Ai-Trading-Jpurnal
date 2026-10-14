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
