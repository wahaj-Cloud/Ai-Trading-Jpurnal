import { z } from "zod";
import type { SessionId } from "./analytics.js";
import { EMOTIONS, MISTAKES } from "./journal.js";
import { SETUP_EXCHANGES, type SetupTimeframe } from "./setups.js";

// ─── What-If Lab ───

const SESSIONS = [
  "ASIA",
  "LONDON",
  "NEW_YORK",
  "OFF_HOURS",
] as const satisfies readonly SessionId[];
const TAG_CODES = [...Object.keys(MISTAKES), ...Object.keys(EMOTIONS)] as [string, ...string[]];

/**
 * Filters applied to the trader's real closed trades. The lab only removes or scales real trades;
 * it never invents trades or prices, so every number traces back to the journal.
 */
export const whatIfFiltersSchema = z
  .object({
    range: z.enum(["30d", "90d", "365d", "all"]).default("90d"),
    /** Stop for the day after this many losses in a row. */
    stopAfterLosses: z.number().int().min(1).max(20).nullable().default(null),
    /** Stop for the day once the day's loss reaches this (USD). */
    maxDailyLoss: z.number().positive().max(1e9).nullable().default(null),
    maxTradesPerDay: z.number().int().min(1).max(500).nullable().default(null),
    /** Skip trades journaled with these mistakes or emotions (e.g. FOMO, REVENGE). */
    skipTags: z.array(z.enum(TAG_CODES)).max(30).default([]),
    /** Keep only these (empty = all). */
    sessions: z.array(z.enum(SESSIONS)).max(4).default([]),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    symbols: z.array(z.string().trim().toUpperCase().min(2).max(30)).max(50).default([]),
    directions: z
      .array(z.enum(["LONG", "SHORT"]))
      .max(2)
      .default([]),
    /** Keep only trades that followed one of your setup alerts. */
    onlyPlanned: z.boolean().default(false),
    /** Trades that risked more than this (USD, from the journal stop) are scaled down to it. */
    riskCapUsd: z.number().positive().max(1e9).nullable().default(null),
  })
  .strict();
export type WhatIfFilters = z.output<typeof whatIfFiltersSchema>;
export type WhatIfFiltersInput = z.input<typeof whatIfFiltersSchema>;

export interface WhatIfSummary {
  trades: number;
  wins: number;
  losses: number;
  netPnl: string;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: string | null;
  maxDrawdown: string;
}

export interface WhatIfResultDto {
  range: { from: string | null; to: string; timezone: string };
  actual: WhatIfSummary;
  scenario: WhatIfSummary;
  /** Scenario minus actual. */
  difference: { netPnl: string; maxDrawdown: string; winRate: number | null; trades: number };
  removed: number;
  scaled: number;
  /** Trades the risk cap could not check because no stop was journaled. */
  noStop: number;
  /** Why trades were left out, with what they had made or lost. */
  reasons: Array<{ reason: string; trades: number; pnl: string }>;
  /** End-of-day cumulative net P&L, real vs scenario. */
  curve: Array<{ date: string; actual: string; scenario: string }>;
  /** The rules in words: "Stopping after 2 losses in a row". */
  label: string;
  /** Trades outside USD settlement are not compared (same rule as Analytics). */
  excludedTrades: number;
}

/** Free-plan preview: one fixed scenario on the trader's own trades. */
export interface WhatIfTeaserDto {
  label: string;
  trades: number;
  /** Scenario minus actual net P&L (USD); null with too few trades to say. */
  difference: string | null;
  drawdownBefore: string | null;
  drawdownAfter: string | null;
}

export const whatIfScenarioInputSchema = z
  .object({ name: z.string().trim().min(1).max(60), filters: whatIfFiltersSchema })
  .strict();
export type WhatIfScenarioInput = z.input<typeof whatIfScenarioInputSchema>;

export interface WhatIfScenarioDto {
  id: string;
  name: string;
  filters: WhatIfFilters;
  createdAt: string;
}

// ─── Strategy Lab ───

export const exitModelSchema = z
  .object({
    stop: z.discriminatedUnion("type", [
      /** Beyond the most recent swing low (long) / high (short), plus a buffer. */
      z.object({ type: z.literal("swing"), bufferPct: z.number().min(0).max(2) }).strict(),
      z.object({ type: z.literal("percent"), value: z.number().min(0.1).max(20) }).strict(),
      z.object({ type: z.literal("atr"), multiple: z.number().min(0.5).max(10) }).strict(),
    ]),
    targetR: z.number().min(0.5).max(10),
    /** Share of equity risked per trade (percent). */
    riskPct: z.number().min(0.1).max(5).default(1),
    startEquity: z.number().min(100).max(10_000_000).default(10_000),
    /** Per fill, percent. */
    slippagePct: z.number().min(0).max(1).default(0.05),
    /** Close at market after this many candles (null = hold until stop or target). */
    maxHoldCandles: z.number().int().min(1).max(2000).nullable().default(null),
  })
  .strict();
export type ExitModel = z.output<typeof exitModelSchema>;
export type ExitModelInput = z.input<typeof exitModelSchema>;

const day = z.iso.date();

export const backtestInputSchema = z
  .object({
    setupId: z.uuid(),
    exchange: z.enum(SETUP_EXCHANGES).default("BINANCE"),
    symbols: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9]{2,20}USDT$/),
      )
      .min(1)
      .max(5)
      .transform((s) => [...new Set(s)]),
    from: day,
    to: day,
    exit: exitModelSchema,
  })
  .strict()
  .refine((b) => b.from < b.to, { message: "The start date must be before the end date" });
export type BacktestInput = z.output<typeof backtestInputSchema>;

export const BACKTEST_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED"] as const;
export type BacktestStatus = (typeof BACKTEST_STATUSES)[number];

export interface BacktestSplit {
  trades: number;
  winRate: number | null;
  expectancyR: number | null;
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number;
  returnPct: number;
  profitFactor: number | null;
  avgR: number | null;
  maxDrawdownPct: number;
  fees: number;
  funding: number;
  /** Trades where stop and target sat inside one candle (stop assumed first). */
  ambiguous: number;
  /** First 70% of the date range vs the last 30%: a big gap hints at overfitting. */
  split: { first: BacktestSplit; last: BacktestSplit; gapFlag: boolean };
  warnings: string[];
  /** Equity after each trade (downsampled). */
  equity: Array<{ t: number; equity: number }>;
}

export interface BacktestRunDto {
  id: string;
  setupId: string | null;
  setupName: string;
  timeframe: SetupTimeframe;
  symbols: string[];
  from: string;
  to: string;
  exit: ExitModel;
  status: BacktestStatus;
  /** 0-1. */
  progress: number;
  summary: BacktestSummary | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface BacktestRunsDto {
  items: BacktestRunDto[];
  used: number;
  /** -1 = unlimited. */
  limit: number;
  historyMonths: number;
}

export const BACKTEST_EXIT_REASONS = ["STOP", "TARGET", "TIME", "END"] as const;
export type BacktestExitReason = (typeof BACKTEST_EXIT_REASONS)[number];

export interface BacktestTradeDto {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryAt: string;
  entryPrice: number;
  exitAt: string;
  exitPrice: number;
  exitReason: BacktestExitReason;
  rMultiple: number;
  pnl: number;
  fees: number;
  funding: number;
  flags: string[];
}

export interface BacktestTradesPage {
  items: BacktestTradeDto[];
  nextCursor: string | null;
}

export interface BacktestTradeChartDto {
  symbol: string;
  timeframe: SetupTimeframe;
  candles: Array<{ t: number; o: number; h: number; l: number; c: number }>;
  entryAt: number;
  exitAt: number;
  side: "LONG" | "SHORT";
  win: boolean;
}

export const backtestTradesQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export type BacktestTradesQuery = z.infer<typeof backtestTradesQuerySchema>;

export const BACKTEST_QUEUE = "backtest";
/** Monthly backtest allowance counter (UTC months). */
export const BACKTEST_USAGE_METRIC = "backtest_run";
export interface BacktestJobData {
  runId: string;
}

export const BACKTEST_DISCLAIMER =
  "Simulated on past candles with fees, slippage and funding. Past results do not guarantee future results.";

/** Taker fee per fill, as a fraction (public standard tier). */
export const TAKER_FEES: Record<(typeof SETUP_EXCHANGES)[number], number> = { BINANCE: 0.0005 };
