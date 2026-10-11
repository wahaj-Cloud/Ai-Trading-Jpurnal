import {
  type AnalyticsDto,
  type BucketDto,
  type DayDto,
  type MonthDto,
  type SessionId,
  type StreakDto,
  type SummaryDto,
  USD_SETTLEMENT_ASSETS,
} from "@atc/shared";
import { type Dec, dec, str, ZERO } from "@atc/trade-engine";
import { localParts } from "./time.js";

/** One closed trade, plus the trader's journal tags when reviewed. */
export interface AnalyticsTrade {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  openedAt: Date;
  closedAt: Date;
  netPnl: string;
  fees: string | null;
  funding: string | null;
  holdingSeconds: number | null;
  settleAsset: string;
  /** Money risked (entry to stop x size), when the journal has a stop price. */
  riskAmount?: string | null;
  setup?: string | null;
  tags?: readonly string[];
  mistakes?: readonly string[];
  emotions?: readonly string[];
}

export interface AnalyticsOptions {
  timeZone: string;
  now: Date;
  range: AnalyticsDto["range"];
}

const USD = new Set<string>(USD_SETTLEMENT_ASSETS);
const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SESSION_ORDER: SessionId[] = ["ASIA", "LONDON", "NEW_YORK", "OFF_HOURS"];
/** Money values are rounded for display only here; sums stay exact until the end. */
const DP = 8;

const money = (v: Dec) => str(v.toDecimalPlaces(DP));
const ratio = (a: Dec, b: Dec) => (b.isZero() ? null : a.div(b).toDecimalPlaces(4).toNumber());

/** Global trading sessions by opening time in UTC. */
export function sessionOf(openedAt: Date): SessionId {
  const h = openedAt.getUTCHours();
  if (h < 7) return "ASIA";
  if (h < 13) return "LONDON";
  if (h < 21) return "NEW_YORK";
  return "OFF_HOURS";
}

class Bucket {
  trades = 0;
  wins = 0;
  losses = 0;
  pnl = ZERO;

  add(pnl: Dec): void {
    this.trades += 1;
    if (pnl.gt(0)) this.wins += 1;
    else if (pnl.lt(0)) this.losses += 1;
    this.pnl = this.pnl.plus(pnl);
  }

  dto(key: string): BucketDto {
    return {
      key,
      trades: this.trades,
      wins: this.wins,
      losses: this.losses,
      winRate:
        this.wins + this.losses === 0
          ? null
          : Number((this.wins / (this.wins + this.losses)).toFixed(4)),
      pnl: money(this.pnl),
      avgPnl: this.trades ? money(this.pnl.div(this.trades)) : null,
    };
  }
}

class Buckets {
  private readonly map = new Map<string, Bucket>();
  constructor(keys: readonly string[] = []) {
    for (const k of keys) this.map.set(k, new Bucket());
  }
  add(key: string, pnl: Dec): void {
    let b = this.map.get(key);
    if (!b) {
      b = new Bucket();
      this.map.set(key, b);
    }
    b.add(pnl);
  }
  entries(): [string, Bucket][] {
    return [...this.map.entries()];
  }
  /** Fixed order (weekdays, hours, sessions). */
  ordered(): BucketDto[] {
    return [...this.map.entries()].map(([k, b]) => b.dto(k));
  }
  /** Best results first (worst first with `worstFirst`); ties by name. */
  byPnl(worstFirst = false): BucketDto[] {
    const sign = worstFirst ? -1 : 1;
    return this.ordered().sort(
      (a, b) => sign * dec(b.pnl).comparedTo(dec(a.pnl)) || a.key.localeCompare(b.key),
    );
  }
}

/**
 * Computes the performance report for a set of closed trades. Pure and deterministic: the same
 * trades always give the same report, so the dashboard, exports and AI coach agree.
 */
export function computeAnalytics(
  input: readonly AnalyticsTrade[],
  options: AnalyticsOptions,
): AnalyticsDto {
  const { timeZone, now } = options;
  const excludedAssets = new Set<string>();
  let excludedTrades = 0;
  const trades = input
    .filter((t) => {
      if (USD.has(t.settleAsset)) return true;
      excludedTrades += 1;
      excludedAssets.add(t.settleAsset);
      return false;
    })
    .slice()
    .sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime() || a.id.localeCompare(b.id));

  const today = localParts(now, timeZone);
  const all = new Bucket();
  let grossProfit = ZERO;
  let grossLoss = ZERO;
  let largestWin: Dec | null = null;
  let largestLoss: Dec | null = null;
  let fees = ZERO;
  let funding = ZERO;
  let equity = ZERO;
  let peak = ZERO;
  let maxDrawdown = ZERO;
  let streak: StreakDto = { kind: null, length: 0 };
  let longestWin = 0;
  let longestLoss = 0;
  let holdWin = 0;
  let holdWinCount = 0;
  let holdLoss = 0;
  let holdLossCount = 0;
  let rSum = ZERO;
  let rCount = 0;
  const todayTotals = new Bucket();
  const monthTotals = new Bucket();

  const days = new Buckets();
  const months = new Buckets();
  const bySymbol = new Buckets();
  const byWeekday = new Buckets(WEEKDAY_KEYS);
  const byHour = new Buckets(Array.from({ length: 24 }, (_, h) => String(h)));
  const bySession = new Buckets(SESSION_ORDER);
  const byDirection = new Buckets(["LONG", "SHORT"]);
  const bySetup = new Buckets();
  const byMistake = new Buckets();
  const byEmotion = new Buckets();
  const byTag = new Buckets();

  for (const t of trades) {
    const pnl = dec(t.netPnl);
    all.add(pnl);
    fees = fees.plus(t.fees ?? 0);
    funding = funding.plus(t.funding ?? 0);

    if (pnl.gt(0)) {
      grossProfit = grossProfit.plus(pnl);
      if (!largestWin || pnl.gt(largestWin)) largestWin = pnl;
      if (t.holdingSeconds !== null) {
        holdWin += t.holdingSeconds;
        holdWinCount += 1;
      }
    } else if (pnl.lt(0)) {
      grossLoss = grossLoss.plus(pnl.abs());
      if (!largestLoss || pnl.lt(largestLoss)) largestLoss = pnl;
      if (t.holdingSeconds !== null) {
        holdLoss += t.holdingSeconds;
        holdLossCount += 1;
      }
    }

    // Streaks: break-even trades neither extend nor break a streak.
    const kind = pnl.gt(0) ? "WIN" : pnl.lt(0) ? "LOSS" : null;
    if (kind) {
      streak = streak.kind === kind ? { kind, length: streak.length + 1 } : { kind, length: 1 };
      if (kind === "WIN") longestWin = Math.max(longestWin, streak.length);
      else longestLoss = Math.max(longestLoss, streak.length);
    }

    equity = equity.plus(pnl);
    if (equity.gt(peak)) peak = equity;
    if (peak.minus(equity).gt(maxDrawdown)) maxDrawdown = peak.minus(equity);

    if (t.riskAmount) {
      const risk = dec(t.riskAmount);
      if (risk.gt(0)) {
        rSum = rSum.plus(pnl.div(risk));
        rCount += 1;
      }
    }

    const closed = localParts(t.closedAt, timeZone);
    const opened = localParts(t.openedAt, timeZone);
    days.add(closed.date, pnl);
    months.add(closed.month, pnl);
    if (closed.date === today.date) todayTotals.add(pnl);
    if (closed.month === today.month) monthTotals.add(pnl);

    bySymbol.add(t.symbol, pnl);
    byWeekday.add(WEEKDAY_KEYS[opened.weekday] ?? "Mon", pnl);
    byHour.add(String(opened.hour), pnl);
    bySession.add(sessionOf(t.openedAt), pnl);
    byDirection.add(t.direction, pnl);
    if (t.setup) bySetup.add(t.setup, pnl);
    for (const m of t.mistakes ?? []) byMistake.add(m, pnl);
    for (const e of t.emotions ?? []) byEmotion.add(e, pnl);
    for (const tag of t.tags ?? []) byTag.add(tag, pnl);
  }

  // Daily equity and drawdown (end of day).
  const daily: DayDto[] = [];
  let cumulative = ZERO;
  let dayPeak = ZERO;
  let best: { date: string; pnl: Dec } | null = null;
  let worst: { date: string; pnl: Dec } | null = null;
  let profitableDays = 0;
  for (const [date, b] of days.entries().sort(([a], [b]) => a.localeCompare(b))) {
    cumulative = cumulative.plus(b.pnl);
    if (cumulative.gt(dayPeak)) dayPeak = cumulative;
    if (b.pnl.gt(0)) profitableDays += 1;
    if (!best || b.pnl.gt(best.pnl)) best = { date, pnl: b.pnl };
    if (!worst || b.pnl.lt(worst.pnl)) worst = { date, pnl: b.pnl };
    daily.push({
      date,
      pnl: money(b.pnl),
      trades: b.trades,
      wins: b.wins,
      cumulative: money(cumulative),
      drawdown: money(dayPeak.minus(cumulative)),
    });
  }
  const monthly: MonthDto[] = months
    .entries()
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => ({ month, pnl: money(b.pnl), trades: b.trades, wins: b.wins }));

  const decided = all.wins + all.losses;
  const avgWin = all.wins ? grossProfit.div(all.wins) : null;
  const avgLoss = all.losses ? grossLoss.div(all.losses) : null;
  const summary: SummaryDto = {
    trades: all.trades,
    wins: all.wins,
    losses: all.losses,
    breakeven: all.trades - decided,
    netPnl: money(all.pnl),
    grossProfit: money(grossProfit),
    grossLoss: money(grossLoss),
    winRate: decided ? Number((all.wins / decided).toFixed(4)) : null,
    profitFactor: ratio(grossProfit, grossLoss),
    expectancy: all.trades ? money(all.pnl.div(all.trades)) : null,
    avgWin: avgWin ? money(avgWin) : null,
    avgLoss: avgLoss ? money(avgLoss) : null,
    payoffRatio: avgWin && avgLoss ? ratio(avgWin, avgLoss) : null,
    largestWin: largestWin ? money(largestWin) : null,
    largestLoss: largestLoss ? money(largestLoss) : null,
    fees: money(fees),
    funding: money(funding),
    maxDrawdown: money(maxDrawdown),
    currentDrawdown: money(peak.minus(equity)),
    currentStreak: streak,
    longestWinStreak: longestWin,
    longestLossStreak: longestLoss,
    avgHoldWinSeconds: holdWinCount ? Math.round(holdWin / holdWinCount) : null,
    avgHoldLossSeconds: holdLossCount ? Math.round(holdLoss / holdLossCount) : null,
    tradingDays: days.entries().length,
    profitableDays,
    bestDay: best?.pnl.gt(0) ? { date: best.date, pnl: money(best.pnl) } : null,
    worstDay: worst?.pnl.lt(0) ? { date: worst.date, pnl: money(worst.pnl) } : null,
    avgR: rCount ? rSum.div(rCount).toDecimalPlaces(2).toNumber() : null,
    tradesWithR: rCount,
  };

  return {
    range: options.range,
    currency: "USD",
    summary,
    today: { pnl: money(todayTotals.pnl), trades: todayTotals.trades },
    thisMonth: { pnl: money(monthTotals.pnl), trades: monthTotals.trades },
    daily,
    monthly,
    bySymbol: bySymbol.byPnl(),
    byWeekday: byWeekday.ordered(),
    byHour: byHour.ordered(),
    bySession: bySession.ordered(),
    byDirection: byDirection.ordered(),
    bySetup: bySetup.byPnl(),
    byMistake: byMistake.byPnl(true), // costliest first
    byEmotion: byEmotion.byPnl(),
    byTag: byTag.byPnl(),
    excluded: { trades: excludedTrades, assets: [...excludedAssets].sort() },
  };
}
