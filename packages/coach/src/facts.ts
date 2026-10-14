import {
  type AnalyticsDto,
  BEHAVIOURS,
  type BehaviourFlagDto,
  EMOTIONS,
  MISTAKES,
  PULSE_LINKS,
  PULSE_MIN_GROUP,
  pulseLink,
  USD_SETTLEMENT_ASSETS,
} from "@atc/shared";
import type { GradeResult } from "./grade.js";
import type { CoachTrade } from "./types.js";

/**
 * Turns computed data into compact, labelled facts for the model. Every number the model may quote
 * appears here already formatted, so it has no reason to calculate (and mis-calculate) anything.
 */

const USD_ASSETS = new Set<string>(USD_SETTLEMENT_ASSETS);
const fmt = (v: string | number | null | undefined, digits = 2) =>
  v === null || v === undefined ? "unknown" : Number(v).toFixed(digits);
/** USD amounts to the cent; coin-settled amounts (e.g. 0.0034 BTC) keep their precision. */
const amount = (v: string | number | null | undefined, asset: string) =>
  fmt(v, USD_ASSETS.has(asset) ? 2 : 8);
const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);
const dur = (s: number | null) =>
  s === null ? "unknown" : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
const label = (map: Record<string, string>, code: string) => map[code] ?? code;

/** Journal text is the trader's own writing: fenced so the model treats it as data. */
const fence = (text: string | null) =>
  text
    ? `<journal>${text.replaceAll("<", "‹").replaceAll(">", "›").slice(0, 1500)}</journal>`
    : "none";

export function flagLines(flags: readonly BehaviourFlagDto[]): string {
  return flags.length
    ? flags
        .map((f) => `- ${BEHAVIOURS[f.code].label} (${f.severity.toLowerCase()}): ${f.evidence}`)
        .join("\n")
    : "- none detected";
}

export function tradeFacts(
  t: CoachTrade,
  grade: GradeResult,
  flags: readonly BehaviourFlagDto[],
  extra: { marketContext?: string | null; timeZone: string },
): string {
  const j = t.journal;
  const when = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: extra.timeZone,
  });
  return `TRADE
- ${t.symbol} ${t.direction.toLowerCase()}, opened ${when.format(t.openedAt)}, closed ${when.format(t.closedAt)}, held ${dur(t.holdingSeconds)}
- Entry ${fmt(t.entryPrice, 8)}, exit ${fmt(t.exitPrice, 8)}, size ${fmt(t.quantity, 8)}, leverage ${t.leverage ?? "unknown"}x
- Net result ${amount(t.netPnl, t.settleAsset)} ${t.settleAsset} after fees ${amount(t.fees, t.settleAsset)}
- R multiple: ${t.rMultiple === null ? "unknown (no stop logged)" : `${t.rMultiple.toFixed(2)}R`}; planned reward:risk ${t.plannedRewardRisk === null ? "unknown" : `${t.plannedRewardRisk.toFixed(2)}:1`}

GRADE (computed): ${grade.grade} (${grade.score}/100)
${grade.factors.map((f) => `- ${f.label}: ${f.points > 0 ? "+" : ""}${f.points}`).join("\n")}

BEHAVIOUR FLAGS (computed)
${flagLines(flags)}

JOURNAL
${
  j
    ? `- Setup: ${j.setup ?? "not named"}; self-rating: ${j.rating ?? "none"}/5
- Planned stop ${j.stopPrice ?? "none"}, target ${j.targetPrice ?? "none"}
- Emotions: ${j.emotions.map((e) => label(EMOTIONS, e)).join(", ") || "none"}
- Mistakes: ${j.mistakes.map((m) => label(MISTAKES, m)).join(", ") || "none"}
- Notes: ${fence(j.notes)}`
    : "- Not journaled."
}

MARKET CONTEXT
${extra.marketContext ?? "- not available"}`;
}

export function periodFacts(
  title: string,
  report: AnalyticsDto,
  flags: readonly BehaviourFlagDto[],
  baseline: AnalyticsDto | null,
): string {
  const s = report.summary;
  const b = baseline?.summary;
  return `PERIOD: ${title}
- Trades ${s.trades} (${s.wins} won, ${s.losses} lost); net ${fmt(s.netPnl)}; win rate ${pct(s.winRate)}; profit factor ${s.profitFactor ?? "n/a"}
- Average win ${fmt(s.avgWin)}, average loss ${s.avgLoss ? `-${fmt(s.avgLoss)}` : "n/a"}; largest win ${fmt(s.largestWin)}, largest loss ${fmt(s.largestLoss)}
- Fees ${fmt(s.fees)}, funding ${fmt(s.funding)}; max drawdown ${fmt(s.maxDrawdown)}
- Average hold: winners ${dur(s.avgHoldWinSeconds)}, losers ${dur(s.avgHoldLossSeconds)}
- Best coin: ${report.bySymbol[0] ? `${report.bySymbol[0].key} ${fmt(report.bySymbol[0].pnl)}` : "n/a"}; worst coin: ${report.bySymbol.at(-1) ? `${report.bySymbol.at(-1)?.key} ${fmt(report.bySymbol.at(-1)?.pnl)}` : "n/a"}
- Setups: ${report.bySetup.map((x) => `${x.key} ${fmt(x.pnl)} (${x.trades})`).join("; ") || "none logged"}
- Costliest mistakes: ${report.byMistake.map((x) => `${label(MISTAKES, x.key)} ${fmt(x.pnl)} (${x.trades})`).join("; ") || "none logged"}
${b ? `COMPARED WITH THE PREVIOUS 30 DAYS: win rate ${pct(b.winRate)}, expectancy ${fmt(b.expectancy)} per trade, ${b.trades} trades` : ""}

BEHAVIOUR FLAGS (computed)
${flagLines(flags)}`;
}

export function recentTradesFacts(
  trades: readonly CoachTrade[],
  timeZone: string,
  limit = 15,
): string {
  const when = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  const rows = [...trades]
    .sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime())
    .slice(0, limit)
    .map(
      (t) =>
        `- ${when.format(t.closedAt)} ${t.symbol} ${t.direction.toLowerCase()} ${amount(t.netPnl, t.settleAsset)} ${t.settleAsset}${t.rMultiple !== null ? ` (${t.rMultiple.toFixed(1)}R)` : ""}, held ${dur(t.holdingSeconds)}${t.journal?.setup ? `, setup ${t.journal.setup}` : ""}${t.journal?.mistakes.length ? `, mistakes: ${t.journal.mistakes.map((m) => label(MISTAKES, m)).join("/")}` : ""}`,
    );
  return `RECENT TRADES (newest first)\n${rows.join("\n") || "- none"}`;
}

/**
 * Planned (followed a setup alert) vs unplanned trades, and results by how linked the coin was to
 * BTC at entry. A group is only described with at least PULSE_MIN_GROUP trades; below that the
 * model is told there is not enough data, so it never draws conclusions from a handful of trades.
 */
export function edgeFacts(trades: readonly CoachTrade[], usesSetups: boolean): string {
  const usd = trades.filter((t) => USD_ASSETS.has(t.settleAsset));
  const stats = (list: readonly CoachTrade[]) => {
    const wins = list.filter((t) => Number(t.netPnl) > 0).length;
    const losses = list.filter((t) => Number(t.netPnl) < 0).length;
    const net = list.reduce((a, t) => a + Number(t.netPnl), 0);
    return `${list.length} trades, win rate ${pct(wins + losses ? wins / (wins + losses) : null)}, net ${net.toFixed(2)}, average ${(net / list.length).toFixed(2)} per trade`;
  };
  const line = (name: string, list: readonly CoachTrade[]) =>
    list.length >= PULSE_MIN_GROUP
      ? `- ${name}: ${stats(list)}`
      : `- ${name}: ${list.length} trades (not enough to compare; needs ${PULSE_MIN_GROUP})`;
  const out: string[] = [];
  if (usesSetups) {
    out.push(
      "PLANNED VS UNPLANNED (planned = opened soon after one of the trader's own setup alerts)",
      line(
        "Planned",
        usd.filter((t) => t.planned),
      ),
      line(
        "No setup",
        usd.filter((t) => !t.planned),
      ),
    );
  }
  const linked = usd.filter((t) => t.btcCorr !== null && t.btcCorr !== undefined);
  if (linked.length) {
    out.push("BY LINK TO BTC AT ENTRY (24h correlation; context, not a signal)");
    for (const code of Object.keys(PULSE_LINKS) as Array<keyof typeof PULSE_LINKS>) {
      const group = linked.filter((t) => pulseLink(t.btcCorr as number) === code);
      if (group.length) out.push(line(PULSE_LINKS[code], group));
    }
  }
  return out.join("\n");
}
