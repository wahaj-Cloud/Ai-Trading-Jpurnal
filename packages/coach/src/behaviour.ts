import { localParts } from "@atc/analytics";
import {
  type BehaviourCode,
  type BehaviourFlagDto,
  type BehaviourSummaryDto,
  type Severity,
  USD_SETTLEMENT_ASSETS,
} from "@atc/shared";
import { dec, str, ZERO } from "@atc/trade-engine";
import type { CoachTrade } from "./types.js";

/**
 * Behaviour detection: plain rules over the trader's own numbers, compared with their own normal
 * (baseline), plus what they tagged in their journal. Deterministic, explainable and free: the AI
 * explains these findings but never invents them.
 */

const MIN = 60;
const REVENGE_WINDOW_S = 15 * MIN;
const REVENGE_FAST_S = 5 * MIN;
const IMPATIENT_HOLD_S = 5 * MIN;
const NEGATIVE_EMOTIONS = new Set([
  "FOMO",
  "REVENGE",
  "FEAR",
  "GREED",
  "OVERCONFIDENT",
  "IMPATIENT",
  "BORED",
  "FRUSTRATED",
]);
const UNDISCIPLINED_MISTAKES = new Set(["NO_PLAN", "CHASED_ENTRY", "NO_STOP", "BROKE_RULES"]);
const USD = new Set<string>(USD_SETTLEMENT_ASSETS);

export interface DetectOptions {
  timeZone: string;
  /** Only trades closed in [from, to) are judged; everything given is used as the baseline. */
  from: Date;
  to: Date;
}

export interface Detection {
  /** One entry per behaviour found in the period, with evidence and the trades involved. */
  flags: BehaviourFlagDto[];
  /** Flags attached to each individual trade. */
  byTrade: Map<string, BehaviourFlagDto[]>;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

export const notional = (t: CoachTrade): number | null =>
  t.entryPrice && t.quantity && USD.has(t.settleAsset) && t.settleAsset === t.quoteAsset
    ? Number(t.entryPrice) * Number(t.quantity)
    : null;

const money = (v: string | number) => {
  const n = Number(v);
  const s = Math.abs(n).toFixed(2);
  return n < 0 ? `−${s}` : n > 0 ? `+${s}` : s;
};
const minutes = (s: number) =>
  s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : `${(s / 3600).toFixed(1)} h`;

class Collector {
  private readonly perCode = new Map<
    BehaviourCode,
    { ids: Set<string>; notes: string[]; sev: Severity }
  >();
  readonly byTrade = new Map<string, BehaviourFlagDto[]>();

  add(code: BehaviourCode, trade: CoachTrade, severity: Severity, evidence: string): void {
    const list = this.byTrade.get(trade.id) ?? [];
    if (!list.some((f) => f.code === code)) {
      list.push({ code, severity, evidence, positionIds: [trade.id] });
      this.byTrade.set(trade.id, list);
    }
    const agg = this.perCode.get(code) ?? { ids: new Set(), notes: [], sev: "LOW" as Severity };
    agg.ids.add(trade.id);
    if (agg.notes.length < 3) agg.notes.push(evidence);
    agg.sev = maxSeverity(agg.sev, severity);
    this.perCode.set(code, agg);
  }

  /** Behaviours judged on a whole period rather than on one trade (e.g. overtrading a day). */
  addGroup(code: BehaviourCode, trades: CoachTrade[], severity: Severity, evidence: string): void {
    for (const t of trades) {
      const list = this.byTrade.get(t.id) ?? [];
      if (!list.some((f) => f.code === code)) {
        list.push({ code, severity, evidence, positionIds: trades.map((x) => x.id) });
        this.byTrade.set(t.id, list);
      }
    }
    const agg = this.perCode.get(code) ?? { ids: new Set(), notes: [], sev: "LOW" as Severity };
    for (const t of trades) agg.ids.add(t.id);
    agg.notes.unshift(evidence);
    agg.notes.splice(3);
    agg.sev = maxSeverity(agg.sev, severity);
    this.perCode.set(code, agg);
  }

  flags(tradesById: Map<string, CoachTrade>): BehaviourFlagDto[] {
    const out: BehaviourFlagDto[] = [];
    for (const [code, agg] of this.perCode) {
      const ids = [...agg.ids];
      // Money totals only add USD-settled results; coin-settled trades are counted but not summed.
      const cost = ids.reduce((s, id) => {
        const t = tradesById.get(id);
        return t && USD.has(t.settleAsset) ? s.plus(t.netPnl) : s;
      }, ZERO);
      const count = ids.length;
      const summary = `${count} trade${count === 1 ? "" : "s"}, net ${money(str(cost))}.`;
      out.push({
        code,
        severity: count >= 3 && cost.lt(0) ? maxSeverity(agg.sev, "MEDIUM") : agg.sev,
        evidence: `${agg.notes.join(" ")} ${summary}`.trim(),
        positionIds: ids,
      });
    }
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    return out.sort(
      (a, b) => rank[a.severity] - rank[b.severity] || b.positionIds.length - a.positionIds.length,
    );
  }
}

const SEV_ORDER: Severity[] = ["LOW", "MEDIUM", "HIGH"];
const maxSeverity = (a: Severity, b: Severity): Severity =>
  SEV_ORDER.indexOf(a) >= SEV_ORDER.indexOf(b) ? a : b;

export function detectBehaviours(all: readonly CoachTrade[], opts: DetectOptions): Detection {
  const trades = [...all].sort(
    (a, b) => a.closedAt.getTime() - b.closedAt.getTime() || a.id.localeCompare(b.id),
  );
  const inFocus = (t: CoachTrade) =>
    t.closedAt.getTime() >= opts.from.getTime() && t.closedAt.getTime() < opts.to.getTime();
  const focus = trades.filter(inFocus);
  const c = new Collector();

  // Baselines: the trader's own normal.
  const sizes = trades.map(notional).filter((n): n is number => n !== null && n > 0);
  const normalSize = median(sizes);
  const winHold = median(
    trades
      .filter((t) => Number(t.netPnl) > 0 && t.holdingSeconds !== null)
      .map((t) => t.holdingSeconds as number),
  );
  const perDay = new Map<string, CoachTrade[]>();
  for (const t of trades) {
    const day = localParts(t.openedAt, opts.timeZone).date;
    perDay.set(day, [...(perDay.get(day) ?? []), t]);
  }
  const normalPerDay = median([...perDay.values()].map((d) => d.length)) ?? 0;

  for (const t of focus) {
    const pnl = Number(t.netPnl);
    const size = notional(t);
    const j = t.journal;

    // Revenge: a new trade opened shortly after a losing trade closed.
    const prior = trades.filter(
      (p) => p.id !== t.id && p.closedAt.getTime() <= t.openedAt.getTime(),
    );
    const last = prior.at(-1);
    if (last && Number(last.netPnl) < 0) {
      const gap = (t.openedAt.getTime() - last.closedAt.getTime()) / 1000;
      if (gap <= REVENGE_WINDOW_S) {
        const bigger = size !== null && normalSize !== null && size >= 1.5 * normalSize;
        c.add(
          "REVENGE",
          t,
          gap <= REVENGE_FAST_S || bigger ? "HIGH" : "MEDIUM",
          `${t.symbol} opened ${minutes(Math.max(gap, 60))} after a ${money(last.netPnl)} loss${bigger ? `, at ${(size / (normalSize as number)).toFixed(1)}× your normal size` : ""}.`,
        );
      }
    }

    // Overconfidence: sizing up after three or more wins in a row.
    let streak = 0;
    for (let i = prior.length - 1; i >= 0 && Number(prior[i]?.netPnl) > 0; i--) streak++;
    if (streak >= 3 && size !== null && normalSize !== null && size >= 2 * normalSize) {
      c.add(
        "OVERCONFIDENCE",
        t,
        "MEDIUM",
        `${t.symbol} sized at ${(size / normalSize).toFixed(1)}× normal after ${streak} wins in a row.`,
      );
    } else if (
      (size !== null && normalSize !== null && size >= 3 * normalSize) ||
      j?.emotions.includes("GREED") ||
      j?.mistakes.includes("OVERSIZED")
    ) {
      c.add(
        "GREED",
        t,
        size !== null && normalSize !== null && size >= 3 * normalSize ? "HIGH" : "MEDIUM",
        size !== null && normalSize !== null && size >= 3 * normalSize
          ? `${t.symbol} at ${(size / normalSize).toFixed(1)}× your normal position size.`
          : `${t.symbol}: you noted greed or an oversized position.`,
      );
    }

    // Holding losers: a loser kept open far longer than your typical winner.
    if (
      pnl < 0 &&
      t.holdingSeconds !== null &&
      winHold !== null &&
      t.holdingSeconds >= Math.max(2 * winHold, 30 * MIN)
    ) {
      c.add(
        "HOLDING_LOSERS",
        t,
        t.holdingSeconds >= 4 * winHold ? "HIGH" : "MEDIUM",
        `${t.symbol} loser held ${minutes(t.holdingSeconds)}; your winners typically last ${minutes(winHold)}.`,
      );
    } else if (j?.mistakes.includes("HELD_LOSER")) {
      c.add("HOLDING_LOSERS", t, "MEDIUM", `${t.symbol}: you noted holding a loser too long.`);
    }

    // Early profit taking: a planned winner cut well short of its target.
    if (
      pnl > 0 &&
      t.rMultiple !== null &&
      t.plannedRewardRisk !== null &&
      t.plannedRewardRisk >= 1.5 &&
      t.rMultiple < t.plannedRewardRisk / 2
    ) {
      c.add(
        "EARLY_PROFIT",
        t,
        "MEDIUM",
        `${t.symbol} closed at ${t.rMultiple.toFixed(1)}R against a ${t.plannedRewardRisk.toFixed(1)}R plan.`,
      );
    } else if (j?.mistakes.includes("CUT_WINNER_EARLY")) {
      c.add("EARLY_PROFIT", t, "LOW", `${t.symbol}: you noted taking profit too early.`);
    }

    // Journal-driven behaviours.
    if (j) {
      if (j.emotions.includes("FOMO") || j.mistakes.includes("CHASED_ENTRY")) {
        c.add("FOMO", t, "MEDIUM", `${t.symbol}: you noted FOMO or chasing the entry.`);
      }
      if (j.emotions.includes("FEAR")) {
        c.add("FEAR", t, "LOW", `${t.symbol}: you noted fear.`);
      }
      const undisciplined = j.mistakes.filter((m) => UNDISCIPLINED_MISTAKES.has(m));
      if (undisciplined.length > 0 || !j.stopPrice) {
        c.add(
          "UNDISCIPLINED_ENTRY",
          t,
          undisciplined.length > 1 ? "HIGH" : "MEDIUM",
          undisciplined.length
            ? `${t.symbol}: ${undisciplined.map((m) => m.toLowerCase().replaceAll("_", " ")).join(", ")}.`
            : `${t.symbol}: no planned stop recorded.`,
        );
      }
      const negative = j.emotions.filter((e) => NEGATIVE_EMOTIONS.has(e));
      if (negative.length > 0) {
        c.add(
          "EMOTIONAL",
          t,
          pnl < 0 ? "MEDIUM" : "LOW",
          `${t.symbol} traded while feeling ${negative.map((e) => e.toLowerCase()).join(", ")} (${money(t.netPnl)}).`,
        );
      }
      if (
        j.emotions.includes("REVENGE") &&
        !c.byTrade.get(t.id)?.some((f) => f.code === "REVENGE")
      ) {
        c.add("REVENGE", t, "MEDIUM", `${t.symbol}: you noted revenge.`);
      }
    }
  }

  // Day-level behaviours.
  for (const [day, dayTrades] of perDay) {
    const judged = dayTrades.filter(inFocus);
    if (judged.length === 0) continue;
    const limit = Math.max(8, Math.ceil(2 * normalPerDay));
    if (dayTrades.length > limit) {
      c.addGroup(
        "OVERTRADING",
        judged,
        dayTrades.length > 2 * limit ? "HIGH" : "MEDIUM",
        `${dayTrades.length} trades on ${day}; you normally take about ${Math.round(normalPerDay)}.`,
      );
    }
    const quickLosses = judged.filter(
      (t) =>
        Number(t.netPnl) < 0 && t.holdingSeconds !== null && t.holdingSeconds < IMPATIENT_HOLD_S,
    );
    if (quickLosses.length >= 3) {
      c.addGroup(
        "IMPATIENCE",
        quickLosses,
        quickLosses.length >= 6 ? "HIGH" : "MEDIUM",
        `${quickLosses.length} losing trades under 5 minutes on ${day}.`,
      );
    }
  }

  const byId = new Map(trades.map((t) => [t.id, t]));
  return { flags: c.flags(byId), byTrade: c.byTrade };
}

/** Cost of each behaviour: net result of the trades involved (for "which habits cost the most"). */
export function behaviourSummary(
  detection: Detection,
  trades: readonly CoachTrade[],
  range: { from: string; to: string },
): BehaviourSummaryDto {
  const byId = new Map(trades.map((t) => [t.id, t]));
  return {
    ...range,
    flags: detection.flags,
    costByBehaviour: detection.flags
      .map((f) => ({
        code: f.code,
        trades: f.positionIds.length,
        netPnl: str(
          f.positionIds.reduce((s, id) => {
            const t = byId.get(id);
            return t && USD.has(t.settleAsset) ? s.plus(dec(t.netPnl)) : s;
          }, ZERO),
        ),
      }))
      .sort((a, b) => Number(a.netPnl) - Number(b.netPnl)),
  };
}
