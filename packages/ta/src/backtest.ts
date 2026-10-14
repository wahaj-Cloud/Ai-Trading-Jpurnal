import type {
  BacktestExitReason,
  BacktestSplit,
  BacktestSummary,
  ExitModel,
  SetupRule,
} from "@atc/shared";
import { atr, type Candle } from "./indicators.js";
import { evaluateSetupAt, setupWindow } from "./setups.js";
import { swings } from "./structure.js";

/**
 * Strategy Lab engine. Honest by construction:
 *  - signals use only closed candles (the shared evaluator); entry is the next candle's open;
 *  - taker fees on entry and exit, slippage on every market fill, real funding while held;
 *  - when stop and target sit inside one candle, the stop is assumed hit first (and flagged);
 *  - one position per coin at a time; size from equity at entry (fixed-fractional risk).
 */

export interface FundingPoint {
  t: number;
  rate: number;
}

export interface BacktestSeries {
  symbol: string;
  /** Oldest first, including warm-up candles before `from`. */
  candles: Candle[];
  funding: FundingPoint[];
}

export interface BacktestParams {
  rule: SetupRule;
  exit: ExitModel;
  /** Taker fee per fill as a fraction (0.0005 = 0.05%). */
  takerFee: number;
  /** Signals are taken only for candles opening inside [from, to). */
  from: number;
  to: number;
  onProgress?: (done: number) => void;
}

export interface SimTrade {
  symbol: string;
  side: "LONG" | "SHORT";
  entryAt: number;
  entryPrice: number;
  exitAt: number;
  exitPrice: number;
  exitReason: BacktestExitReason;
  rMultiple: number;
  pnl: number;
  fees: number;
  funding: number;
  flags: string[];
}

interface RawTrade {
  symbol: string;
  side: "LONG" | "SHORT";
  entryAt: number;
  entryPrice: number;
  stop: number;
  exitAt: number;
  exitPrice: number;
  exitReason: BacktestExitReason;
  /** Sum of funding rates paid while held (positive = the position paid). */
  fundingRate: number;
  flags: string[];
}

/** Stop price for a signal on candle `i` (null when it would not sit on the losing side). */
function stopFor(
  exit: ExitModel,
  candles: readonly Candle[],
  i: number,
  entry: number,
  long: boolean,
): number | null {
  let stop: number | null = null;
  switch (exit.stop.type) {
    case "percent":
      stop = entry * (1 + ((long ? -1 : 1) * exit.stop.value) / 100);
      break;
    case "atr": {
      const w = setupWindow(candles, i);
      const value = atr(w, 14)[w.length - 1];
      if (value === null || value === undefined) return null;
      stop = long ? entry - value * exit.stop.multiple : entry + value * exit.stop.multiple;
      break;
    }
    case "swing": {
      const w = setupWindow(candles, i);
      const kind = long ? "LOW" : "HIGH";
      // Only swings confirmed by the signal candle's close.
      const s = swings(w, 2, w.length)
        .filter((x) => x.kind === kind && x.index + 2 <= w.length - 1)
        .at(-1);
      if (!s) return null;
      const buffer = exit.stop.bufferPct / 100;
      stop = long ? s.price * (1 - buffer) : s.price * (1 + buffer);
      break;
    }
  }
  if (stop === null || !Number.isFinite(stop) || stop <= 0) return null;
  return long ? (stop < entry ? stop : null) : stop > entry ? stop : null;
}

function simulateSymbol(series: BacktestSeries, p: BacktestParams, tfMs: number): RawTrade[] {
  const { candles, funding } = series;
  const long = p.rule.direction === "long";
  const slip = p.exit.slippagePct / 100;
  const trades: RawTrade[] = [];
  let i = candles.findIndex((c) => c.t >= p.from);
  if (i < 0) return trades;
  let fi = 0;
  for (; i < candles.length - 1; i++) {
    const signal = candles[i] as Candle;
    if (signal.t >= p.to) break;
    if (!evaluateSetupAt(p.rule, candles, i).matched) continue;
    const next = candles[i + 1] as Candle;
    const entry = next.o * (long ? 1 + slip : 1 - slip);
    const stop = stopFor(p.exit, candles, i, entry, long);
    if (stop === null) continue;
    const risk = Math.abs(entry - stop);
    const target = long ? entry + risk * p.exit.targetR : entry - risk * p.exit.targetR;
    const flags: string[] = [];
    let exitAt = 0;
    let exitPrice = 0;
    let reason: BacktestExitReason = "END";
    let k = i + 1;
    for (; k < candles.length; k++) {
      const c = candles[k] as Candle;
      // A gap through the stop at the open fills at the open, not at the stop.
      const gapStop = k > i + 1 && (long ? c.o <= stop : c.o >= stop);
      const hitStop = long ? c.l <= stop : c.h >= stop;
      const hitTarget = long ? c.h >= target : c.l <= target;
      if (gapStop || hitStop) {
        if (hitTarget && !gapStop) flags.push("stop_and_target_same_candle");
        const at = gapStop ? c.o : stop;
        exitPrice = at * (long ? 1 - slip : 1 + slip);
        exitAt = c.t;
        reason = "STOP";
        break;
      }
      if (hitTarget) {
        // A resting limit order: no slippage.
        exitPrice = target;
        exitAt = c.t;
        reason = "TARGET";
        break;
      }
      if (p.exit.maxHoldCandles !== null && k - i >= p.exit.maxHoldCandles) {
        exitPrice = c.c * (long ? 1 - slip : 1 + slip);
        exitAt = c.t + tfMs;
        reason = "TIME";
        break;
      }
    }
    if (k >= candles.length) {
      const last = candles.at(-1) as Candle;
      exitPrice = last.c * (long ? 1 - slip : 1 + slip);
      exitAt = last.t + tfMs;
      reason = "END";
      k = candles.length - 1;
    }
    // Funding is paid at each funding time the position was open across.
    const entryAt = next.t;
    let rate = 0;
    while (fi < funding.length && (funding[fi] as FundingPoint).t <= entryAt) fi++;
    for (let x = fi; x < funding.length && (funding[x] as FundingPoint).t <= exitAt; x++) {
      rate += (funding[x] as FundingPoint).rate;
    }
    trades.push({
      symbol: series.symbol,
      side: long ? "LONG" : "SHORT",
      entryAt,
      entryPrice: entry,
      stop,
      exitAt,
      exitPrice,
      exitReason: reason,
      fundingRate: long ? rate : -rate,
      flags,
    });
    // The next signal can only come from a candle that closes after this exit.
    i = k;
  }
  return trades;
}

const round = (v: number, dp = 8) => Number(v.toFixed(dp));
/** Largest position allowed, as a multiple of equity (Binance's common default for majors). */
export const MAX_LEVERAGE = 20;
/** Below this share of starting equity the account counts as wiped out. */
const RUIN_FRACTION = 0.02;

function splitStats(trades: readonly SimTrade[]): BacktestSplit {
  const decided = trades.filter((t) => t.pnl !== 0);
  return {
    trades: trades.length,
    winRate: decided.length
      ? round(decided.filter((t) => t.pnl > 0).length / decided.length, 4)
      : null,
    expectancyR: trades.length
      ? round(trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length, 3)
      : null,
  };
}

/** Sizes every simulated trade from equity at its entry and computes the report. */
export function accountTrades(
  raw: readonly RawTrade[],
  p: BacktestParams,
): { trades: SimTrade[]; summary: BacktestSummary } {
  const ordered = [...raw].sort(
    (a, b) => a.entryAt - b.entryAt || a.symbol.localeCompare(b.symbol),
  );
  const done: SimTrade[] = [];
  const trades: SimTrade[] = [];
  let ruinedAt: number | null = null;
  let capped = 0;
  for (const t of ordered) {
    // Equity known at entry: start plus every trade already closed.
    const equity =
      p.exit.startEquity + done.filter((d) => d.exitAt <= t.entryAt).reduce((a, d) => a + d.pnl, 0);
    // A wiped-out account takes no more trades.
    if (equity <= p.exit.startEquity * RUIN_FRACTION) {
      ruinedAt ??= t.entryAt;
      continue;
    }
    const riskAmount = equity * (p.exit.riskPct / 100);
    let size = riskAmount / Math.abs(t.entryPrice - t.stop);
    const flags = [...t.flags];
    // A very tight stop would need an unrealistic position: cap it at the leverage limit.
    if (size * t.entryPrice > equity * MAX_LEVERAGE) {
      size = (equity * MAX_LEVERAGE) / t.entryPrice;
      flags.push("size_capped");
      capped += 1;
    }
    const dir = t.side === "LONG" ? 1 : -1;
    const notional = size * t.entryPrice;
    const fees = p.takerFee * (notional + size * t.exitPrice);
    const funding = t.fundingRate * notional;
    const pnl = size * (t.exitPrice - t.entryPrice) * dir - fees - funding;
    const sim: SimTrade = {
      symbol: t.symbol,
      side: t.side,
      entryAt: t.entryAt,
      entryPrice: t.entryPrice,
      exitAt: t.exitAt,
      exitPrice: t.exitPrice,
      exitReason: t.exitReason,
      rMultiple: riskAmount > 0 ? round(pnl / riskAmount, 4) : 0,
      pnl: round(pnl, 2),
      fees: round(fees, 2),
      funding: round(funding, 2),
      flags,
    };
    done.push(sim);
    trades.push(sim);
  }

  // Equity and drawdown in exit order.
  const byExit = [...trades].sort((a, b) => a.exitAt - b.exitAt);
  let equity = p.exit.startEquity;
  let peak = equity;
  let maxDd = 0;
  const curve: Array<{ t: number; equity: number }> = [{ t: p.from, equity }];
  for (const t of byExit) {
    equity += t.pnl;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / peak);
    curve.push({ t: t.exitAt, equity: round(equity, 2) });
  }
  const step = Math.max(1, Math.ceil(curve.length / 500));
  const equityCurve = curve.filter((_, idx) => idx % step === 0 || idx === curve.length - 1);

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const boundary = p.from + (p.to - p.from) * 0.7;
  const first = splitStats(trades.filter((t) => t.entryAt < boundary));
  const last = splitStats(trades.filter((t) => t.entryAt >= boundary));
  const gapFlag =
    first.trades >= 10 &&
    last.trades >= 5 &&
    first.expectancyR !== null &&
    last.expectancyR !== null &&
    first.expectancyR > 0 &&
    last.expectancyR < first.expectancyR * 0.3;
  const ambiguous = trades.filter((t) => t.flags.includes("stop_and_target_same_candle")).length;
  const warnings: string[] = [];
  if (ruinedAt !== null)
    warnings.push(
      `The account would have been wiped out on ${new Date(ruinedAt).toISOString().slice(0, 10)}; no trades were taken after that.`,
    );
  if (capped)
    warnings.push(
      `${capped} trade${capped === 1 ? "" : "s"} had a stop so tight the position was capped at ${MAX_LEVERAGE}× leverage, so they risked less than planned.`,
    );
  if (trades.length < 30)
    warnings.push(
      `Only ${trades.length} trade${trades.length === 1 ? "" : "s"}: too few to judge this setup. Test more coins or a longer period.`,
    );
  if (gapFlag)
    warnings.push(
      "Results were much weaker in the last 30% of the period than in the first 70%. The setup may be fitted to past conditions.",
    );
  if (ambiguous)
    warnings.push(
      `${ambiguous} trade${ambiguous === 1 ? "" : "s"} hit stop and target inside one candle; the stop was assumed first.`,
    );
  const netPnl = trades.reduce((a, t) => a + t.pnl, 0);
  const decided = wins.length + losses.length;
  return {
    trades,
    summary: {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: decided ? round(wins.length / decided, 4) : null,
      netPnl: round(netPnl, 2),
      returnPct: round((netPnl / p.exit.startEquity) * 100, 2),
      profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : null,
      avgR: trades.length
        ? round(trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length, 3)
        : null,
      maxDrawdownPct: round(maxDd * 100, 2),
      fees: round(
        trades.reduce((a, t) => a + t.fees, 0),
        2,
      ),
      funding: round(
        trades.reduce((a, t) => a + t.funding, 0),
        2,
      ),
      ambiguous,
      split: { first, last, gapFlag },
      warnings,
      equity: equityCurve,
    },
  };
}

/** Runs a setup over each coin's candles and returns sized trades plus the report. */
export function runBacktest(
  series: readonly BacktestSeries[],
  p: BacktestParams,
  tfMs: number,
): { trades: SimTrade[]; summary: BacktestSummary } {
  const raw: RawTrade[] = [];
  series.forEach((s, idx) => {
    raw.push(...simulateSymbol(s, p, tfMs));
    p.onProgress?.((idx + 1) / series.length);
  });
  return accountTrades(raw, p);
}
