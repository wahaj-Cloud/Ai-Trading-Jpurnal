import { z } from "zod";
import type { TimeframeBiasDto } from "./flow.js";

/**
 * Market Context Desk: what is driving a market right now, explained driver by driver, with the
 * evidence. Deliberately NOT a signal: there is no overall bullish/bearish verdict and no
 * confidence percentage. Each driver says which way its own evidence leans; the trader decides.
 */

export const DESK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XAUUSDT", "XAGUSDT"] as const;
export type DeskSymbol = (typeof DESK_SYMBOLS)[number];
export const DESK_FREE_SYMBOL: DeskSymbol = "BTCUSDT";
export const DESK_NAMES: Record<DeskSymbol, string> = {
  BTCUSDT: "Bitcoin",
  ETHUSDT: "Ethereum",
  SOLUSDT: "Solana",
  XAUUSDT: "Gold",
  XAGUSDT: "Silver",
};
export const DESK_SHORT: Record<DeskSymbol, string> = {
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  SOLUSDT: "SOL",
  XAUUSDT: "Gold",
  XAGUSDT: "Silver",
};
export const isMetal = (s: DeskSymbol) => s === "XAUUSDT" || s === "XAGUSDT";

/** Recomputed every 15 minutes; the AI summary at most once an hour. */
export const DESK_REFRESH_MINUTES = 15;
export const DESK_SUMMARY_MINUTES = 60;
/** Snapshot key in market_snapshots. */
export const deskKey = (s: DeskSymbol) => `desk:${s}`;

export type DeskLean = "up" | "down" | "neutral";
export const DESK_DRIVERS = [
  "trend",
  "momentum",
  "positioning",
  "liquidity",
  "macro",
  "mood",
] as const;
export type DeskDriverKey = (typeof DESK_DRIVERS)[number];
export const DESK_DRIVER_INFO: Record<DeskDriverKey, { label: string; about: string }> = {
  trend: {
    label: "Trend",
    about:
      "Price against its 20, 50 and 200 moving averages, and the swing structure on 1h and 4h.",
  },
  momentum: { label: "Momentum", about: "RSI on 1h and 4h and the move over the last 24 hours." },
  positioning: {
    label: "Positioning",
    about:
      "Futures data: open interest change, who was aggressive (taker buying vs selling) and funding.",
  },
  liquidity: {
    label: "Liquidity",
    about: "Where the biggest estimated liquidation clusters sit above and below price.",
  },
  macro: {
    label: "Macro and news",
    about:
      "High-impact US releases from the last 24 hours (actual vs forecast) and what is coming next.",
  },
  mood: {
    label: "Crypto mood",
    about: "CoinMarketCap Fear & Greed Index and Bitcoin dominance.",
  },
};

export interface DeskDriverDto {
  key: DeskDriverKey;
  lean: DeskLean;
  /** One plain sentence. */
  headline: string;
  /** The numbers behind it. */
  evidence: string[];
}

export interface DeskEventDto {
  title: string;
  currency: string;
  impact: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  startsAt: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

export interface MarketDeskDto {
  symbol: DeskSymbol;
  name: string;
  price: number;
  change24hPct: number | null;
  computedAt: string;
  drivers: DeskDriverDto[];
  /** How many drivers lean each way. A tally, never a verdict. */
  leans: Record<DeskLean, number>;
  /** Neutral AI summary of the drivers (null when AI is off or not written yet). */
  summary: string | null;
  summaryAt: string | null;
  nextEvent: DeskEventDto | null;
  /** High-impact releases in the last 24 hours, newest first. */
  recentEvents: DeskEventDto[];
  /** Trend bias on the daily, 4-hour and 1-hour charts (missing in desks saved before v34). */
  bias?: TimeframeBiasDto[];
}

/** One of the trader's open positions compared with the drivers of its market. */
export interface DeskAlignmentDto {
  symbol: DeskSymbol;
  /** The position's own symbol, as the exchange names it. */
  positionSymbol: string;
  direction: "LONG" | "SHORT";
  /** Drivers leaning the position's way, against it, and neutral. */
  with: number;
  against: number;
  neutral: number;
  note: string;
}

export type MarketDeskResponse =
  | {
      status: "ok";
      desk: MarketDeskDto;
      /** The trader's open positions on desk markets they can view. */
      alignment: DeskAlignmentDto[];
      /** Markets this plan can open. */
      allowed: DeskSymbol[];
    }
  | { status: "locked"; allowed: DeskSymbol[] }
  | { status: "unavailable"; reason: "pending"; allowed: DeskSymbol[] };

export const deskQuerySchema = z
  .object({ symbol: z.enum(DESK_SYMBOLS).default(DESK_FREE_SYMBOL) })
  .strict();
export type DeskQuery = z.infer<typeof deskQuerySchema>;

export const DESK_DISCLAIMER =
  "Context, not advice. Each driver shows which way its own evidence leans; there is no overall call and no signal to buy or sell. Markets can move against every driver, especially around news.";

/**
 * Which desk market an exchange symbol trades, if any: BTCUSDT, BTC-USDT-SWAP (OKX), BTC_USDT
 * (MEXC), XBTUSDTM (KuCoin), BTCUSD_PERP and ETHUSD_250926 (Binance coin-margined), XAUUSDm
 * (Exness). The coin must be followed directly by a dollar quote or nothing, so look-alike tickers
 * (SOLV, ETHFI, BTCDOM) never count as Solana, Ethereum or Bitcoin.
 */
const DESK_BASES: Array<[RegExp, DeskSymbol]> = [
  [/^(BTC|XBT)/, "BTCUSDT"],
  [/^ETH/, "ETHUSDT"],
  [/^SOL/, "SOLUSDT"],
  [/^(XAU|GOLD)/, "XAUUSDT"],
  [/^(XAG|SILVER)/, "XAGUSDT"],
];
export function deskSymbolOf(symbol: string): DeskSymbol | null {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const [base, desk] of DESK_BASES) {
    const m = base.exec(s);
    if (!m) continue;
    const rest = s.slice(m[0].length);
    if (rest === "" || /^(USDT|USDC|USD|BUSD|FDUSD)[A-Z0-9]*$/.test(rest)) return desk;
  }
  return null;
}

export function tallyLeans(drivers: readonly DeskDriverDto[]): Record<DeskLean, number> {
  const out: Record<DeskLean, number> = { up: 0, down: 0, neutral: 0 };
  for (const d of drivers) out[d.lean]++;
  return out;
}

/** "in 2h 05m", "in 12m", "now". */
export function untilLabel(ms: number): string {
  if (ms <= 60_000) return "now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `in ${Math.floor(h / 24)}d`;
}

/** The plain-language comparison of one position with its market's drivers. */
export function alignmentNote(
  a: Omit<DeskAlignmentDto, "note">,
  name: string,
  next: DeskEventDto | null,
  now: number,
): string {
  const side = a.direction === "LONG" ? "long" : "short";
  const total = a.with + a.against + a.neutral;
  const base =
    a.against > a.with
      ? `You're ${side} ${name} while ${a.against} of ${total} drivers lean the other way (${a.with} with you).`
      : a.with > a.against
        ? `You're ${side} ${name}; ${a.with} of ${total} drivers lean your way (${a.against} against).`
        : `You're ${side} ${name}; the drivers are split (${a.with} with you, ${a.against} against).`;
  const soon =
    next && Date.parse(next.startsAt) - now < 6 * 3_600_000 && Date.parse(next.startsAt) > now
      ? ` ${next.currency} ${next.title} is ${untilLabel(Date.parse(next.startsAt) - now)}: expect volatility.`
      : "";
  return base + soon;
}
