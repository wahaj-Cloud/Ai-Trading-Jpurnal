import { z } from "zod";
import { COCKPIT_TFS } from "./cockpit.js";
import { SCALP_ALERT_DIRECTIONS } from "./scalp-alerts.js";

/**
 * Paper bots: rules tested with virtual money on live prices. A bot never sends an order and
 * never uses a trading key; WickMentor stays read-only. Every fill pays a taker fee and slippage,
 * and open trades pay funding, so the results are not flattered.
 *
 * Fills (all pure, so the worker, tests and an independent recompute agree to the cent):
 *  - entry: the live price moved against the bot by the slippage;
 *  - stop: the worse of the stop and the price seen (a jump through the stop fills where the
 *    price is), moved against the bot by the slippage;
 *  - target: exactly the target (a resting limit order);
 *  - time: the price when the longest hold runs out, moved against the bot by the slippage.
 */

export const PAPER_SOURCES = ["COCKPIT", "SETUP"] as const;
export type PaperSource = (typeof PAPER_SOURCES)[number];
export type PaperSide = "LONG" | "SHORT";
export type PaperExitReason = "STOP" | "TARGET" | "TIME" | "MANUAL";

export const PAPER_EXIT_LABEL: Record<PaperExitReason, string> = {
  STOP: "Stop",
  TARGET: "Target",
  TIME: "Time limit",
  MANUAL: "Closed by you",
};

/** Notional never exceeds this many times equity, however tight the stop. */
export const PAPER_MAX_LEVERAGE = 20;
/** Funding is charged at 00:00, 08:00 and 16:00 UTC. */
export const FUNDING_EVERY_MS = 8 * 3_600_000;
/** Trades and weeks before the results start to mean something. */
export const PAPER_MIN_TRADES = 30;
export const PAPER_MIN_WEEKS = 4;

export const PAPER_DISCLAIMER =
  "Virtual money on live prices. A paper bot never sends an order and never touches your exchange. Past results, real or simulated, do not predict future ones.";

const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,20}USDT$/);

const exits = {
  stopRanges: z.coerce.number().min(0.3).max(10).default(1.5),
  targetR: z.coerce.number().min(0.3).max(10).default(2),
  maxHoldMin: z.coerce
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60)
    .default(60),
  riskPct: z.coerce.number().min(0.1).max(5).default(1),
  feeBps: z.coerce.number().min(0).max(30).default(5),
  slippageBps: z.coerce.number().min(0).max(50).default(2),
  startEquity: z.coerce.number().min(100).max(10_000_000).default(10_000),
};

export const createPaperBotSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("COCKPIT"),
      name: z.string().trim().min(1).max(60),
      symbol,
      tf: z.enum(COCKPIT_TFS),
      direction: z.enum(SCALP_ALERT_DIRECTIONS).default("ANY"),
      minCount: z.coerce.number().int().min(3).max(12).default(7),
      noNews: z.coerce.boolean().default(true),
      ...exits,
    })
    .strict(),
  z
    .object({
      source: z.literal("SETUP"),
      name: z.string().trim().min(1).max(60),
      symbol,
      setupId: z.uuid(),
      ...exits,
    })
    .strict(),
]);
export type CreatePaperBot = z.infer<typeof createPaperBotSchema>;

export const updatePaperBotSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type UpdatePaperBot = z.infer<typeof updatePaperBotSchema>;

/** The parts of a bot the fills depend on. */
export interface PaperRules {
  stopRanges: number;
  targetR: number;
  maxHoldMin: number;
  riskPct: number;
  feeBps: number;
  slippageBps: number;
}

export interface PaperOpen {
  side: PaperSide;
  entryAt: number;
  entryPrice: number;
  stop: number;
  target: number;
  qty: number;
  riskUsd: number;
  /** Entry fee already paid. */
  fees: number;
}

const sign = (side: PaperSide) => (side === "LONG" ? 1 : -1);

/**
 * Opens a virtual trade, or null when there is nothing sensible to open (no typical range yet,
 * no equity left, a price of zero).
 */
export function openPaperTrade(x: {
  rules: PaperRules;
  side: PaperSide;
  price: number;
  /** Typical range of the bot's timeframe (ATR), in price. */
  range: number | null;
  equity: number;
  at: number;
}): PaperOpen | null {
  const { rules, side, price, range, equity } = x;
  if (!(price > 0) || !(range !== null && range > 0) || !(equity > 0)) return null;
  const s = sign(side);
  const entryPrice = price * (1 + (s * rules.slippageBps) / 10_000);
  const dist = rules.stopRanges * range;
  if (side === "LONG" && dist >= entryPrice) return null;
  const stop = entryPrice - s * dist;
  const target = entryPrice + s * rules.targetR * dist;
  const byRisk = (equity * rules.riskPct) / 100 / dist;
  const byCap = (equity * PAPER_MAX_LEVERAGE) / entryPrice;
  const qty = Math.min(byRisk, byCap);
  return {
    side,
    entryAt: x.at,
    entryPrice,
    stop,
    target,
    qty,
    riskUsd: qty * dist,
    fees: (qty * entryPrice * rules.feeBps) / 10_000,
  };
}

export interface PaperExit {
  exitPrice: number;
  reason: PaperExitReason;
}

/** Whether a live price closes the trade, and at what fill. Stop is checked before target. */
export function paperExit(
  t: Pick<PaperOpen, "side" | "entryAt" | "stop" | "target">,
  rules: Pick<PaperRules, "maxHoldMin" | "slippageBps">,
  price: number,
  now: number,
): PaperExit | null {
  if (!(price > 0)) return null;
  const s = sign(t.side);
  const slip = (p: number) => p * (1 - (s * rules.slippageBps) / 10_000);
  if (t.side === "LONG" ? price <= t.stop : price >= t.stop)
    return {
      exitPrice: slip(t.side === "LONG" ? Math.min(t.stop, price) : Math.max(t.stop, price)),
      reason: "STOP",
    };
  if (t.side === "LONG" ? price >= t.target : price <= t.target)
    return { exitPrice: t.target, reason: "TARGET" };
  if (now - t.entryAt >= rules.maxHoldMin * 60_000)
    return { exitPrice: slip(price), reason: "TIME" };
  return null;
}

/** Funding times strictly after `from` and at or before `to`. */
export function fundingTimesBetween(from: number, to: number): number[] {
  const out: number[] = [];
  for (
    let t = Math.floor(from / FUNDING_EVERY_MS) * FUNDING_EVERY_MS + FUNDING_EVERY_MS;
    t <= to;
    t += FUNDING_EVERY_MS
  )
    out.push(t);
  return out;
}

/** Funding paid (positive) or received (negative) at one funding time: longs pay a positive rate. */
export function fundingCost(side: PaperSide, qty: number, markPrice: number, rate: number): number {
  return sign(side) * qty * markPrice * rate;
}

export interface PaperClosed {
  exitPrice: number;
  fees: number;
  pnl: number;
  rMultiple: number;
}

/** Profit after both fees and funding, and the same in R (risk at entry). */
export function closePaperTrade(
  t: Pick<PaperOpen, "side" | "entryPrice" | "qty" | "riskUsd" | "fees">,
  feeBps: number,
  exitPrice: number,
  funding: number,
): PaperClosed {
  const fees = t.fees + (t.qty * exitPrice * feeBps) / 10_000;
  const pnl = sign(t.side) * (exitPrice - t.entryPrice) * t.qty - fees - funding;
  return { exitPrice, fees, pnl, rMultiple: t.riskUsd > 0 ? pnl / t.riskUsd : 0 };
}

// ─── Results ───

export interface PaperTradeDto {
  id: string;
  symbol: string;
  side: PaperSide;
  entryAt: string;
  entryPrice: number;
  stop: number;
  target: number;
  qty: number;
  riskUsd: number;
  entryNote: PaperEntryNote | null;
  exitAt: string | null;
  exitPrice: number | null;
  exitReason: PaperExitReason | null;
  fees: number;
  funding: number;
  pnl: number | null;
  rMultiple: number | null;
  status: "OPEN" | "CLOSED";
}

/** What held when the bot entered. */
export type PaperEntryNote =
  | { kind: "cockpit"; up: number; down: number; total: number }
  | { kind: "setup"; matched: string[] };

export interface PaperStats {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  netPnl: number;
  returnPct: number;
  profitFactor: number | null;
  avgR: number | null;
  expectancyUsd: number | null;
  maxDrawdownPct: number;
  fees: number;
  funding: number;
  bestR: number | null;
  worstR: number | null;
}

/**
 * Results of the closed trades, in exit order. Drawdown is the largest fall from a peak of the
 * equity after each closed trade, as a share of that peak.
 */
export function paperStats(
  closed: ReadonlyArray<Pick<PaperTradeDto, "pnl" | "rMultiple" | "fees" | "funding">>,
  startEquity: number,
): PaperStats {
  let eq = startEquity;
  let peak = startEquity;
  let dd = 0;
  let gain = 0;
  let loss = 0;
  let wins = 0;
  let losses = 0;
  let fees = 0;
  let funding = 0;
  let sumR = 0;
  let best: number | null = null;
  let worst: number | null = null;
  for (const t of closed) {
    const p = t.pnl ?? 0;
    const r = t.rMultiple ?? 0;
    eq += p;
    peak = Math.max(peak, eq);
    if (peak > 0) dd = Math.max(dd, (peak - eq) / peak);
    if (p > 0) {
      wins++;
      gain += p;
    } else if (p < 0) {
      losses++;
      loss -= p;
    }
    fees += t.fees;
    funding += t.funding;
    sumR += r;
    best = best === null ? r : Math.max(best, r);
    worst = worst === null ? r : Math.min(worst, r);
  }
  const n = closed.length;
  const net = eq - startEquity;
  return {
    trades: n,
    wins,
    losses,
    winRatePct: n ? (wins / n) * 100 : null,
    netPnl: net,
    returnPct: startEquity > 0 ? (net / startEquity) * 100 : 0,
    profitFactor: loss > 0 ? gain / loss : null,
    avgR: n ? sumR / n : null,
    expectancyUsd: n ? net / n : null,
    maxDrawdownPct: dd * 100,
    fees,
    funding,
    bestR: best,
    worstR: worst,
  };
}

/** Plain-language state of a run: how long it has gone and whether it means anything yet. */
export function paperMaturity(
  startedAt: number,
  now: number,
  trades: number,
): { days: number; ready: boolean; text: string } {
  const days = Math.max(0, Math.floor((now - startedAt) / 86_400_000));
  const weeks = days / 7;
  const ready = weeks >= PAPER_MIN_WEEKS && trades >= PAPER_MIN_TRADES;
  const run = `Running ${days} day${days === 1 ? "" : "s"}, ${trades} closed trade${trades === 1 ? "" : "s"}.`;
  if (ready)
    return {
      days,
      ready,
      text: `${run} Enough to start judging; keep it running across quiet and busy markets.`,
    };
  const need: string[] = [];
  if (weeks < PAPER_MIN_WEEKS) need.push(`${PAPER_MIN_WEEKS}–8 weeks`);
  if (trades < PAPER_MIN_TRADES) need.push(`${PAPER_MIN_TRADES}+ trades`);
  return {
    days,
    ready,
    text: `${run} Too early to judge: results mean something after ${need.join(" and ")}.`,
  };
}

export interface PaperBotDto {
  id: string;
  name: string;
  symbol: string;
  source: PaperSource;
  tf: string;
  setupId: string | null;
  setupName: string | null;
  direction: "ANY" | "UP" | "DOWN";
  minCount: number;
  noNews: boolean;
  stopRanges: number;
  targetR: number;
  maxHoldMin: number;
  riskPct: number;
  feeBps: number;
  slippageBps: number;
  startEquity: number;
  equity: number;
  enabled: boolean;
  startedAt: string;
  createdAt: string;
  stats: PaperStats;
  open: PaperTradeDto | null;
  maturity: { days: number; ready: boolean; text: string };
}

export interface PaperBotsPage {
  items: PaperBotDto[];
  /** Bots this plan allows (-1 = no limit). */
  limit: number;
  /** Markets a Cockpit bot can watch on this plan, most traded first. */
  markets: string[];
  /** The trader's saved setups a setup bot can trade. */
  setups: Array<{ id: string; name: string; timeframe: string; symbols: string[] }>;
  /** Whether the live feed is running (bots only check while it is). */
  live: boolean;
}

export interface PaperBreakdownRow {
  key: string;
  label: string;
  trades: number;
  winRatePct: number | null;
  netPnl: number;
  avgR: number | null;
}

export interface PaperBotDetailDto extends PaperBotDto {
  trades: PaperTradeDto[];
  /** Equity after each closed trade, starting with the start equity. */
  curve: Array<{ at: string; equity: number }>;
  bySession: PaperBreakdownRow[];
  bySide: PaperBreakdownRow[];
  byExit: PaperBreakdownRow[];
  /** Your real trades on the same market since the run started, for comparison. */
  real: { trades: number; winRatePct: number | null; netPnl: number } | null;
}

/** Trading session of a UTC time (Asia 00–08, London 08–13, New York 13–21, late 21–24). */
export function paperSessionOf(at: number): "asia" | "london" | "new_york" | "late" {
  const h = new Date(at).getUTCHours();
  if (h < 8) return "asia";
  if (h < 13) return "london";
  if (h < 21) return "new_york";
  return "late";
}
export const PAPER_SESSION_LABEL = {
  asia: "Asia (00–08 UTC)",
  london: "London (08–13 UTC)",
  new_york: "New York (13–21 UTC)",
  late: "Late (21–24 UTC)",
} as const;

/** Groups closed trades by a key, in the order of `labels`. Empty groups are left out. */
export function paperBreakdown<K extends string>(
  trades: ReadonlyArray<PaperTradeDto>,
  keyOf: (t: PaperTradeDto) => K,
  labels: Record<K, string>,
): PaperBreakdownRow[] {
  const out: PaperBreakdownRow[] = [];
  for (const key of Object.keys(labels) as K[]) {
    const g = trades.filter((t) => t.status === "CLOSED" && keyOf(t) === key);
    if (g.length === 0) continue;
    const wins = g.filter((t) => (t.pnl ?? 0) > 0).length;
    out.push({
      key,
      label: labels[key],
      trades: g.length,
      winRatePct: (wins / g.length) * 100,
      netPnl: g.reduce((s, t) => s + (t.pnl ?? 0), 0),
      avgR: g.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / g.length,
    });
  }
  return out;
}
