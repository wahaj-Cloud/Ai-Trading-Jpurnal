import { z } from "zod";
import { isoDaySchema } from "./dates.js";
import { EXCHANGE_IDS } from "./exchanges.js";

/**
 * Performance analytics as the API returns them. Money is a decimal string in the user's reporting
 * currency (USD stablecoins); ratios are plain numbers. All days, months, hours and weekdays are in
 * the user's timezone. Only closed trades count.
 */

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "ytd", "1y", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

const isoDay = isoDaySchema;

export const analyticsQuerySchema = z
  .object({
    range: z.enum(ANALYTICS_RANGES).default("all"),
    /** Custom range (inclusive days in the user's timezone); overrides `range`. */
    from: isoDay.optional(),
    to: isoDay.optional(),
    exchange: z.enum(EXCHANGE_IDS).optional(),
    accountId: z.uuid().optional(),
  })
  .strict()
  .refine((q) => !(q.from && q.to) || q.from <= q.to, {
    message: "`from` must be on or before `to`",
    path: ["from"],
  });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface StreakDto {
  kind: "WIN" | "LOSS" | null;
  length: number;
}

export interface SummaryDto {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnl: string;
  /** Sum of winning trades. */
  grossProfit: string;
  /** Sum of losing trades, as a positive number. */
  grossLoss: string;
  /** wins / (wins + losses); null with no decided trades. */
  winRate: number | null;
  /** grossProfit / grossLoss; null when there are no losses. */
  profitFactor: number | null;
  /** Average result per trade. */
  expectancy: string | null;
  avgWin: string | null;
  /** Positive number. */
  avgLoss: string | null;
  /** avgWin / avgLoss: the realised reward-to-risk ratio. */
  payoffRatio: number | null;
  largestWin: string | null;
  largestLoss: string | null;
  fees: string;
  funding: string;
  /** Largest peak-to-trough fall of cumulative PnL, trade by trade (positive number). */
  maxDrawdown: string;
  /** How far below the peak cumulative PnL is right now (positive number). */
  currentDrawdown: string;
  currentStreak: StreakDto;
  longestWinStreak: number;
  longestLossStreak: number;
  avgHoldWinSeconds: number | null;
  avgHoldLossSeconds: number | null;
  tradingDays: number;
  profitableDays: number;
  bestDay: { date: string; pnl: string } | null;
  worstDay: { date: string; pnl: string } | null;
  /** Average R multiple, over trades whose journal has a stop price. */
  avgR: number | null;
  tradesWithR: number;
}

export interface DayDto {
  /** YYYY-MM-DD in the user's timezone. */
  date: string;
  pnl: string;
  trades: number;
  wins: number;
  /** Cumulative PnL at the end of this day. */
  cumulative: string;
  /** Distance below the running peak at the end of this day (positive number). */
  drawdown: string;
}

export interface MonthDto {
  /** YYYY-MM */
  month: string;
  pnl: string;
  trades: number;
  wins: number;
}

export interface BucketDto {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pnl: string;
  avgPnl: string | null;
}

export interface AnalyticsDto {
  range: { from: string | null; to: string | null; timezone: string };
  currency: string;
  summary: SummaryDto;
  today: { pnl: string; trades: number };
  thisMonth: { pnl: string; trades: number };
  daily: DayDto[];
  monthly: MonthDto[];
  bySymbol: BucketDto[];
  /** Monday first, always 7 entries (by opening time). */
  byWeekday: BucketDto[];
  /** 0-23, always 24 entries (by opening time). */
  byHour: BucketDto[];
  /** Trading session by opening time (UTC): ASIA, LONDON, NEW_YORK, OFF_HOURS. */
  bySession: BucketDto[];
  byDirection: BucketDto[];
  /** Journal breakdowns: only trades the user has reviewed. */
  bySetup: BucketDto[];
  byMistake: BucketDto[];
  byEmotion: BucketDto[];
  byTag: BucketDto[];
  /** Trades not counted because they settle in a coin (inverse contracts), by asset. */
  excluded: { trades: number; assets: string[] };
  /** Set when the plan limits visible history: the earliest date included (ISO). */
  historyLimitedFrom?: string | null;
}

export const SESSIONS = {
  ASIA: { label: "Asia", hours: "00:00–07:00 UTC" },
  LONDON: { label: "London", hours: "07:00–13:00 UTC" },
  NEW_YORK: { label: "New York", hours: "13:00–21:00 UTC" },
  OFF_HOURS: { label: "Off-hours", hours: "21:00–24:00 UTC" },
} as const;
export type SessionId = keyof typeof SESSIONS;

/** Currencies treated as US dollars for totals. Anything else is reported separately. */
export const USD_SETTLEMENT_ASSETS = ["USDT", "USDC", "FDUSD", "BUSD", "USD"] as const;
