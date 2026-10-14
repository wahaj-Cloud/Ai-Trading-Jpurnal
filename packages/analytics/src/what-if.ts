import {
  EMOTIONS,
  MISTAKES,
  type SummaryDto,
  USD_SETTLEMENT_ASSETS,
  type WhatIfFilters,
  type WhatIfResultDto,
  type WhatIfSummary,
} from "@atc/shared";
import { dec, str } from "@atc/trade-engine";
import { type AnalyticsTrade, computeAnalytics, sessionOf } from "./compute.js";
import { localParts } from "./time.js";

/** A closed trade plus whether it followed one of the trader's setup alerts. */
export interface WhatIfTrade extends AnalyticsTrade {
  planned?: boolean;
}

export interface WhatIfOptions {
  timeZone: string;
  now: Date;
  range: WhatIfResultDto["range"];
}

const USD = new Set<string>(USD_SETTLEMENT_ASSETS);
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SESSION_NAMES: Record<string, string> = {
  ASIA: "Asia",
  LONDON: "London",
  NEW_YORK: "New York",
  OFF_HOURS: "off-hours",
};
const TAG_LABELS: Record<string, string> = { ...EMOTIONS, ...MISTAKES };

const summaryOf = (s: SummaryDto): WhatIfSummary => ({
  trades: s.trades,
  wins: s.wins,
  losses: s.losses,
  netPnl: s.netPnl,
  winRate: s.winRate,
  profitFactor: s.profitFactor,
  expectancy: s.expectancy,
  maxDrawdown: s.maxDrawdown,
});

/** The rules in plain words, for headlines ("Stopping after 2 losses in a row"). */
export function describeWhatIf(f: WhatIfFilters): string {
  const parts: string[] = [];
  if (f.stopAfterLosses !== null)
    parts.push(
      `stopping after ${f.stopAfterLosses} loss${f.stopAfterLosses === 1 ? "" : "es"} in a row`,
    );
  if (f.maxDailyLoss !== null) parts.push(`stopping at a $${f.maxDailyLoss} daily loss`);
  if (f.maxTradesPerDay !== null) parts.push(`taking at most ${f.maxTradesPerDay} trades a day`);
  if (f.skipTags.length)
    parts.push(`skipping ${f.skipTags.map((t) => TAG_LABELS[t] ?? t).join(", ")} trades`);
  if (f.sessions.length)
    parts.push(`trading only ${f.sessions.map((s) => SESSION_NAMES[s] ?? s).join(" / ")}`);
  if (f.weekdays.length)
    parts.push(`trading only on ${f.weekdays.map((d) => WEEKDAYS[d] ?? d).join(", ")}`);
  if (f.symbols.length) parts.push(`trading only ${f.symbols.join(", ")}`);
  if (f.directions.length === 1)
    parts.push(`taking only ${(f.directions[0] ?? "").toLowerCase()}s`);
  if (f.onlyPlanned) parts.push("taking only trades that followed a setup alert");
  if (f.riskCapUsd !== null) parts.push(`risking at most $${f.riskCapUsd} a trade`);
  if (!parts.length) return "Your trades as they happened";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface Kept {
  t: WhatIfTrade;
  pnl: string;
}

/**
 * Replays the trader's real closed trades under discipline rules. It only removes or scales real
 * trades, so every figure traces back to the journal. Day rules look only at trades that had
 * closed before the next one opened, exactly what the trader could have known at the time.
 */
export function runWhatIf(
  input: readonly WhatIfTrade[],
  filters: WhatIfFilters,
  opts: WhatIfOptions,
): WhatIfResultDto {
  const { timeZone, now } = opts;
  const usd = input.filter((t) => USD.has(t.settleAsset));
  const excludedTrades = input.length - usd.length;
  const ordered = [...usd].sort(
    (a, b) => a.openedAt.getTime() - b.openedAt.getTime() || a.id.localeCompare(b.id),
  );

  const sessions = new Set(filters.sessions);
  const weekdays = new Set(filters.weekdays);
  const symbols = new Set(filters.symbols);
  const directions = new Set(filters.directions);
  const skipTags = new Set(filters.skipTags);
  const reasons = new Map<string, { trades: number; pnl: ReturnType<typeof dec> }>();
  const drop = (reason: string, t: WhatIfTrade) => {
    const r = reasons.get(reason) ?? { trades: 0, pnl: dec(0) };
    r.trades += 1;
    r.pnl = r.pnl.plus(t.netPnl);
    reasons.set(reason, r);
  };

  const kept: Kept[] = [];
  const keptByDay = new Map<string, Kept[]>();
  let scaled = 0;
  let noStop = 0;

  for (const t of ordered) {
    const opened = localParts(t.openedAt, timeZone);
    if (sessions.size && !sessions.has(sessionOf(t.openedAt))) {
      drop("Outside the chosen sessions", t);
      continue;
    }
    if (weekdays.size && !weekdays.has(opened.weekday)) {
      drop("Outside the chosen weekdays", t);
      continue;
    }
    if (symbols.size && !symbols.has(t.symbol)) {
      drop("Other coins", t);
      continue;
    }
    if (directions.size && !directions.has(t.direction)) {
      drop(`${t.direction === "LONG" ? "Longs" : "Shorts"} left out`, t);
      continue;
    }
    const tag = [...(t.mistakes ?? []), ...(t.emotions ?? [])].find((x) => skipTags.has(x));
    if (tag) {
      drop(`Tagged ${TAG_LABELS[tag] ?? tag}`, t);
      continue;
    }
    if (filters.onlyPlanned && !t.planned) {
      drop("No setup alert before the trade", t);
      continue;
    }

    // Day rules: only trades of the scenario that had already closed when this one opened.
    const today = keptByDay.get(opened.date) ?? [];
    const open = t.openedAt.getTime();
    const closedBefore = today
      .filter((k) => k.t.closedAt.getTime() <= open)
      .sort((a, b) => a.t.closedAt.getTime() - b.t.closedAt.getTime());
    if (filters.maxTradesPerDay !== null && today.length >= filters.maxTradesPerDay) {
      drop("Over the daily trade limit", t);
      continue;
    }
    if (filters.stopAfterLosses !== null) {
      let streak = 0;
      for (const k of closedBefore) {
        const p = dec(k.pnl);
        if (p.lt(0)) streak += 1;
        else if (p.gt(0)) streak = 0;
      }
      if (streak >= filters.stopAfterLosses) {
        drop(`After ${filters.stopAfterLosses} losses in a row`, t);
        continue;
      }
    }
    if (filters.maxDailyLoss !== null) {
      const realized = closedBefore.reduce((sum, k) => sum.plus(k.pnl), dec(0));
      if (realized.lte(-filters.maxDailyLoss)) {
        drop("After the daily loss limit", t);
        continue;
      }
    }

    let trade: WhatIfTrade = t;
    if (filters.riskCapUsd !== null) {
      const risk = t.riskAmount ? dec(t.riskAmount) : null;
      if (!risk || risk.lte(0)) noStop += 1;
      else if (risk.gt(filters.riskCapUsd)) {
        const k = dec(filters.riskCapUsd).div(risk);
        const scale = (v: string | null) => (v === null ? null : str(dec(v).times(k)));
        trade = {
          ...t,
          netPnl: str(dec(t.netPnl).times(k)),
          fees: scale(t.fees),
          funding: scale(t.funding),
          riskAmount: String(filters.riskCapUsd),
        };
        scaled += 1;
      }
    }
    const entry = { t: trade, pnl: trade.netPnl };
    kept.push(entry);
    today.push(entry);
    keptByDay.set(opened.date, today);
  }

  const range = { from: opts.range.from, to: opts.range.to, timezone: timeZone };
  const actual = computeAnalytics(usd, { timeZone, now, range });
  const scenario = computeAnalytics(
    kept.map((k) => k.t),
    { timeZone, now, range },
  );

  // One curve over every day either version traded, carrying the last value across gaps.
  const days = [...new Set([...actual.daily, ...scenario.daily].map((d) => d.date))].sort();
  const a = new Map(actual.daily.map((d) => [d.date, d.cumulative]));
  const s = new Map(scenario.daily.map((d) => [d.date, d.cumulative]));
  let lastA = "0";
  let lastS = "0";
  const curve = days.map((date) => {
    lastA = a.get(date) ?? lastA;
    lastS = s.get(date) ?? lastS;
    return { date, actual: lastA, scenario: lastS };
  });

  const removed = usd.length - kept.length;
  const winRate =
    actual.summary.winRate === null || scenario.summary.winRate === null
      ? null
      : Number((scenario.summary.winRate - actual.summary.winRate).toFixed(4));
  return {
    range: opts.range,
    actual: summaryOf(actual.summary),
    scenario: summaryOf(scenario.summary),
    difference: {
      netPnl: str(dec(scenario.summary.netPnl).minus(actual.summary.netPnl).toDecimalPlaces(8)),
      maxDrawdown: str(
        dec(scenario.summary.maxDrawdown).minus(actual.summary.maxDrawdown).toDecimalPlaces(8),
      ),
      winRate,
      trades: -removed,
    },
    removed,
    scaled,
    noStop,
    reasons: [...reasons.entries()]
      .map(([reason, r]) => ({ reason, trades: r.trades, pnl: str(r.pnl.toDecimalPlaces(8)) }))
      .sort((x, y) => y.trades - x.trades),
    curve,
    label: describeWhatIf(filters),
    excludedTrades,
  };
}
