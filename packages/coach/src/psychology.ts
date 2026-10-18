import { addDays, localParts } from "@atc/analytics";
import {
  type BehaviourCode,
  DISCIPLINE_MIN_TRADES,
  type PsychologyReportDto,
  USD_SETTLEMENT_ASSETS,
} from "@atc/shared";
import { str, ZERO } from "@atc/trade-engine";
import { type Detection, notional } from "./behaviour.js";
import { weekStart } from "./dates.js";
import type { CoachTrade } from "./types.js";

/**
 * The psychology report: the money emotional habits cost (the "psychological tax") and a 0–100
 * discipline score. Every number is measured from the trader's own trades and journal:
 *  - clean trades (50%): share of trades with no habit flagged;
 *  - steady sizing (25%): share of trades sized within half to twice the trader's normal size;
 *  - calm days (25%): share of trading days without revenge trades or overtrading.
 */

const USD = new Set<string>(USD_SETTLEMENT_ASSETS);
const TREND_WEEKS = 8;
/** Habits that make a whole day "not calm". */
const DAY_BREAKERS = new Set<BehaviourCode>(["REVENGE", "OVERTRADING"]);

export interface PsychologyOptions {
  timeZone: string;
  /** The report period: trades closed in [from, to). */
  from: Date;
  to: Date;
  fromDay: string;
  toDay: string;
}

interface Score {
  score: number | null;
  parts: { clean: number; sizing: number | null; calmDays: number } | null;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

const pct = (n: number, d: number) => Math.round((100 * n) / d);

export function disciplineScore(
  trades: readonly CoachTrade[],
  detection: Detection,
  normalSize: number | null,
  timeZone: string,
): Score {
  if (trades.length < DISCIPLINE_MIN_TRADES) return { score: null, parts: null };
  const flagsOf = (t: CoachTrade) => detection.byTrade.get(t.id) ?? [];

  const clean = trades.filter((t) => flagsOf(t).length === 0).length / trades.length;

  const sized = trades
    .map(notional)
    .filter((n): n is number => n !== null && n > 0 && normalSize !== null && normalSize > 0);
  const sizing =
    sized.length > 0 && normalSize
      ? sized.filter((n) => n >= normalSize / 2 && n <= normalSize * 2).length / sized.length
      : null;

  const days = new Map<string, boolean>();
  for (const t of trades) {
    const day = localParts(t.closedAt, timeZone).date;
    const broken = flagsOf(t).some((f) => DAY_BREAKERS.has(f.code));
    days.set(day, (days.get(day) ?? false) || broken);
  }
  const calm = [...days.values()].filter((broken) => !broken).length / days.size;

  const raw =
    sizing === null
      ? (0.5 * clean + 0.25 * calm) / 0.75
      : 0.5 * clean + 0.25 * sizing + 0.25 * calm;
  return {
    score: Math.round(100 * raw),
    parts: {
      clean: Math.round(100 * clean),
      sizing: sizing === null ? null : Math.round(100 * sizing),
      calmDays: Math.round(100 * calm),
    },
  };
}

/**
 * `all` is every trade loaded (including the baseline before the trend); `detection` must have been
 * run over at least the trend weeks and the report period.
 */
export function psychologyReport(
  all: readonly CoachTrade[],
  detection: Detection,
  opts: PsychologyOptions,
): PsychologyReportDto {
  const normalSize = median(all.map(notional).filter((n): n is number => n !== null && n > 0));
  const inPeriod = all.filter(
    (t) => t.closedAt.getTime() >= opts.from.getTime() && t.closedAt.getTime() < opts.to.getTime(),
  );
  const usd = inPeriod.filter((t) => USD.has(t.settleAsset));

  // Tax: each flagged trade counted once.
  const flagged = usd.filter((t) => (detection.byTrade.get(t.id) ?? []).length > 0);
  const flaggedNet = flagged.reduce((s, t) => s.plus(t.netPnl), ZERO);
  const losses = usd.reduce((s, t) => (Number(t.netPnl) < 0 ? s.plus(t.netPnl) : s), ZERO);
  const flaggedLosses = flagged.reduce(
    (s, t) => (Number(t.netPnl) < 0 ? s.plus(t.netPnl) : s),
    ZERO,
  );
  const tax = flaggedNet.lt(0)
    ? {
        netPnl: str(flaggedNet),
        trades: flagged.length,
        lossShare: losses.lt(0) ? Math.min(1, Number(flaggedLosses.div(losses).toFixed(4))) : null,
      }
    : null;

  // Per habit, inside the period only.
  const perHabit = new Map<BehaviourCode, { trades: number; net: typeof ZERO }>();
  for (const t of inPeriod) {
    for (const f of detection.byTrade.get(t.id) ?? []) {
      const agg = perHabit.get(f.code) ?? { trades: 0, net: ZERO };
      agg.trades++;
      if (USD.has(t.settleAsset)) agg.net = agg.net.plus(t.netPnl);
      perHabit.set(f.code, agg);
    }
  }
  const byHabit = [...perHabit]
    .map(([code, a]) => ({ code, trades: a.trades, netPnl: str(a.net) }))
    .sort((a, b) => Number(a.netPnl) - Number(b.netPnl) || b.trades - a.trades);

  // Weekly trend.
  const thisWeek = weekStart(opts.toDay);
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) =>
    addDays(thisWeek, -7 * (TREND_WEEKS - 1 - i)),
  );
  const byWeek = new Map<string, CoachTrade[]>(weeks.map((w) => [w, []]));
  for (const t of all) {
    const w = weekStart(localParts(t.closedAt, opts.timeZone).date);
    byWeek.get(w)?.push(t);
  }
  const trend = weeks.map((week) => {
    const list = byWeek.get(week) ?? [];
    return {
      week,
      trades: list.length,
      score: disciplineScore(list, detection, normalSize, opts.timeZone).score,
    };
  });

  const overall = disciplineScore(inPeriod, detection, normalSize, opts.timeZone);
  return {
    from: opts.fromDay,
    to: opts.toDay,
    trades: inPeriod.length,
    tax,
    byHabit,
    score: overall.score,
    parts: overall.parts,
    trend,
  };
}

/** One line for the coach chat. */
export function psychologyFact(r: PsychologyReportDto): string | null {
  if (r.score === null && !r.tax) return null;
  const parts: string[] = [];
  if (r.score !== null && r.parts) {
    parts.push(
      `Discipline score ${r.score}/100 (clean trades ${r.parts.clean}%, steady sizing ${r.parts.sizing ?? "n/a"}${r.parts.sizing === null ? "" : "%"}, calm days ${r.parts.calmDays}%).`,
    );
  }
  if (r.tax) {
    const worst = r.byHabit[0];
    parts.push(
      `Psychological tax: trades flagged with emotional habits netted ${r.tax.netPnl} USD over ${r.tax.trades} trades${r.tax.lossShare !== null ? ` (${Math.round(r.tax.lossShare * 100)}% of all losses)` : ""}${worst && Number(worst.netPnl) < 0 ? `; costliest habit ${worst.code} at ${worst.netPnl}` : ""}.`,
    );
  }
  return `Psychology, ${r.from} to ${r.to}: ${parts.join(" ")}`;
}
