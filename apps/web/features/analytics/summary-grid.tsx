import type { SummaryDto } from "@atc/shared";
import {
  formatDuration,
  formatMoney,
  formatPercent,
  formatPnl,
  formatR,
  formatRatio,
} from "@/features/trades/format";
import { Metric } from "./metric";

const streakText = (s: SummaryDto["currentStreak"]) =>
  s.kind === null
    ? "—"
    : `${s.length} ${s.kind === "WIN" ? "win" : "loss"}${s.length === 1 ? "" : s.kind === "WIN" ? "s" : "es"}`;

/** Every headline statistic, grouped the way traders read them: results, edge, risk, habits. */
export function SummaryGrid({ s }: { s: SummaryDto }) {
  const groups: { title: string; items: Parameters<typeof Metric>[0][] }[] = [
    {
      title: "Results",
      items: [
        { label: "Net P&L", value: formatPnl(s.netPnl), signed: s.netPnl, size: "lg" },
        {
          label: "Trades",
          value: s.trades.toLocaleString("en"),
          hint: `${s.wins} won · ${s.losses} lost${s.breakeven ? ` · ${s.breakeven} flat` : ""}`,
        },
        { label: "Fees paid", value: formatMoney(s.fees) },
        { label: "Funding", value: formatPnl(s.funding), signed: s.funding },
      ],
    },
    {
      title: "Edge",
      items: [
        { label: "Win rate", value: formatPercent(s.winRate), size: "lg" },
        {
          label: "Profit factor",
          value: formatRatio(s.profitFactor),
          hint: "Won ÷ lost. Above 1 is profitable",
        },
        {
          label: "Expectancy",
          value: formatPnl(s.expectancy),
          signed: s.expectancy,
          hint: "Average result per trade",
        },
        {
          label: "Reward : risk",
          value: s.payoffRatio === null ? "—" : `${formatRatio(s.payoffRatio)} : 1`,
          hint: "Average win ÷ average loss",
        },
      ],
    },
    {
      title: "Wins and losses",
      items: [
        { label: "Average win", value: formatPnl(s.avgWin), signed: s.avgWin },
        {
          label: "Average loss",
          value: s.avgLoss ? formatPnl(`-${s.avgLoss}`) : "—",
          signed: s.avgLoss ? `-${s.avgLoss}` : null,
        },
        { label: "Largest win", value: formatPnl(s.largestWin), signed: s.largestWin },
        { label: "Largest loss", value: formatPnl(s.largestLoss), signed: s.largestLoss },
      ],
    },
    {
      title: "Risk",
      items: [
        {
          label: "Max drawdown",
          value: s.maxDrawdown === "0" ? "0.00" : `−${formatMoney(s.maxDrawdown)}`,
          signed: s.maxDrawdown === "0" ? "0" : `-${s.maxDrawdown}`,
          hint: "Largest fall from a peak",
        },
        {
          label: "Below peak now",
          value: s.currentDrawdown === "0" ? "At peak" : `−${formatMoney(s.currentDrawdown)}`,
        },
        {
          label: "Average R",
          value: formatR(s.avgR),
          hint: s.tradesWithR ? `${s.tradesWithR} trades with a stop` : "Add stops in your journal",
        },
        {
          label: "Best / worst day",
          value: s.bestDay ? formatPnl(s.bestDay.pnl) : "—",
          signed: s.bestDay?.pnl ?? null,
          hint: s.worstDay ? `Worst ${formatPnl(s.worstDay.pnl)}` : undefined,
        },
      ],
    },
    {
      title: "Habits",
      items: [
        { label: "Current streak", value: streakText(s.currentStreak) },
        {
          label: "Longest streaks",
          value: `${s.longestWinStreak}W / ${s.longestLossStreak}L`,
        },
        {
          label: "Hold: winners",
          value: formatDuration(s.avgHoldWinSeconds),
        },
        {
          label: "Hold: losers",
          value: formatDuration(s.avgHoldLossSeconds),
          hint:
            s.avgHoldLossSeconds !== null &&
            s.avgHoldWinSeconds !== null &&
            s.avgHoldLossSeconds > s.avgHoldWinSeconds * 1.5
              ? "You hold losers much longer than winners"
              : undefined,
        },
      ],
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {groups.map((g) => (
        <section
          key={g.title}
          aria-label={g.title}
          className="rounded-[var(--radius-surface)] surface p-4"
        >
          <h2 className="mb-3 text-xs font-medium tracking-wide text-ink-faint uppercase">
            {g.title}
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 xl:grid-cols-1">
            {g.items.map((m) => (
              <Metric key={m.label} {...m} />
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
